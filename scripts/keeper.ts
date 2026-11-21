/**
 * The daily keeper — the operator's heartbeat, run once per UTC day (cron or by hand):
 *
 *   npm run keeper -- --resolve          reveal today's word + resolve the jackpot
 *   npm run keeper -- --yield            open today's yield epoch (epochId = UTC day)
 *   npm run keeper -- --bounty           open this week's bounty period if unopened
 *   npm run keeper -- --achievements     attest newly-earned EAS badges
 *   npm run keeper -- --notify           warn players whose staked words are about to go hungry
 *   npm run keeper -- --announce "t" "b" one-off push to everyone who added the mini app
 *   npm run keeper -- --dry [...]        compute + verify everything, send nothing
 *
 * `.env.local` loads automatically (--env-file-if-exists in the npm script). Without it the chain
 * defaults to mainnet and the run dies on a missing deployment rather than doing something wrong.
 *
 * Env: KEEPER_PRIVATE_KEY (the contracts' keeper role — Sepolia: the throwaway deployer),
 * NEXT_PUBLIC_CHAIN_ID / NEXT_PUBLIC_RPC_URL as usual. The AnswerChain schedule comes from
 * ANSWER_CHAIN_SEED (+ ANSWER_CHAIN_DAYS) when set, else ANSWER_CHAIN_FILE (default: the Sepolia
 * rehearsal file); see src/lib/keeper/answerSchedule.ts. NEVER commit or log schedule contents —
 * whoever holds future words wins every jackpot.
 *
 * Epoch trees are stored in the `reward_leaves` table (DATABASE_URL) before each openEpoch, each
 * entry carrying its proof — that table IS the claim route's data, so a run without a database
 * refuses to open an epoch. A copy also lands in keeper-output/<stream>-<epoch>-<root>.json (gitignored)
 * when the file system allows. Treat both as operational state: a tree can NOT be rebuilt later,
 * because the scan reads the latest chain state, not the state the epoch was opened at.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createWalletClient, publicActions } from "viem";
import { rpcTransport } from "../src/lib/onchain/transport";
import { privateKeyToAccount } from "viem/accounts";
import { ACTIVE_CHAIN } from "../src/lib/onchain/chain";
import { addressOf } from "../src/lib/onchain/addresses";
import { jackpotAbi } from "../src/lib/onchain/abis";
import { getPublicClient, readChainTime } from "../src/lib/onchain/reads";
import { scanAllWords } from "../src/lib/keeper/scan";
import { yieldLeaves, bountyLeaves, leavesTotal } from "../src/lib/keeper/shares";
import { computeAchievements, type AchievementLeaf } from "../src/lib/keeper/achievements";
import { readLetterCounts } from "../src/lib/onchain/reads";
import { encodeAbiParameters, parseEventLogs } from "viem";
import { buildEpochFile, verifyEntry } from "../src/lib/keeper/tree";
import { DEFAULT_PARAMS } from "../src/lib/params";
import { THEMES, themeForPeriod } from "../src/lib/themes";
import { notifiableFids } from "../src/lib/db/queries";
import { lookupProfiles } from "../src/lib/neynar";
import {
  hungerTargets,
  hungerTargetsByAddress,
  fidLookupFrom,
  jackpotWinnerFid,
  webPushHungerTargets,
  webPushWinnerSubs,
  type FidLookup,
} from "../src/lib/notify/triggers";
import { hungerWarning, jackpotWon } from "../src/lib/notify/templates";
import { sendNotification, LIMITS } from "../src/lib/notify/send";
import { sendWebPush } from "../src/lib/notify/webPush";
import { allWebPushSubscriptions } from "../src/lib/db/webPush";
import { storeEpochLeaves } from "../src/lib/db/rewards";
import { NETWORK } from "../src/lib/onchain/network";
import { loadAnswerSchedule, linkToReveal } from "../src/lib/keeper/answerSchedule";
import type { WebPushSubscription } from "../src/lib/db/schema";
import type { KeeperWord } from "../src/lib/keeper/shares";

const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry");
const OUT = "keeper-output";

const merkleEpochsAbi = [
  { type: "function", name: "openEpoch", stateMutability: "nonpayable",
    inputs: [{ name: "epochId", type: "uint256" }, { name: "root", type: "bytes32" }, { name: "amount", type: "uint256" }, { name: "meta", type: "uint256" }],
    outputs: [] },
  { type: "function", name: "epochs", stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "root", type: "bytes32" }, { name: "funded", type: "uint256" }, { name: "claimed", type: "uint256" }, { name: "meta", type: "uint256" }, { name: "open", type: "bool" }, { name: "recoverableAt", type: "uint64" }] },
] as const;
const feeRouterAbi = [
  { type: "function", name: "poolBalance", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "bountyBalance", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;
const answerChainAbi = [
  { type: "function", name: "revealedDay", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  { type: "function", name: "currentCommit", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
] as const;

function wallet() {
  const key = process.env.KEEPER_PRIVATE_KEY;
  if (!key) throw new Error("KEEPER_PRIVATE_KEY is not set");
  return createWalletClient({
    account: privateKeyToAccount(key as `0x${string}`),
    chain: ACTIVE_CHAIN,
    // rpcTransport, never bare http(): the Alchemy key's domain allowlist rejects
    // originless requests, and every server-side sender must stamp our Origin (transport.ts).
    transport: rpcTransport(process.env.NEXT_PUBLIC_RPC_URL || undefined),
  }).extend(publicActions);
}

async function resolveJackpot() {
  const { links, source } = loadAnswerSchedule();
  const chain = addressOf("answerChain");
  const [revealedRaw, currentCommit] = await Promise.all([
    getPublicClient().readContract({ address: chain, abi: answerChainAbi, functionName: "revealedDay" }),
    getPublicClient().readContract({ address: chain, abi: answerChainAbi, functionName: "currentCommit" }),
  ]);
  const revealed = Number(revealedRaw);
  // Checked against the onchain commit before anything is sent (wrong seed, days, file, or dictionary).
  const entry = linkToReveal(links, revealed, currentCommit as string);
  console.log(`resolve: reveal #${revealed + 1} from the ${source} schedule (word withheld from logs)`);
  if (DRY) return;
  const w = wallet();
  try {
    const hash = await w.writeContract({
      address: addressOf("jackpot"), abi: jackpotAbi, functionName: "resolve",
      args: [entry.word, entry.salt as `0x${string}`, entry.next as `0x${string}`],
    });
    const rcpt = await w.waitForTransactionReceipt({ hash });
    console.log(`resolve: ${rcpt.status} in block ${rcpt.blockNumber} (${hash})`);
    // Telling the winner is safe ONLY here, on the success path: the word is public the moment the
    // reveal lands. On the failure path above it is still tomorrow's secret, which is why that
    // branch redacts it.
    if (rcpt.status === "success") await notifyJackpotWinner(rcpt.logs, entry.word);
  } catch (err) {
    // NEVER rethrow raw: viem embeds the call args in its error dump, and on a FAILED resolve the
    // word is still tomorrow's secret. Redact, classify the one expected case, die on the rest.
    const msg = String((err as Error).message ?? err);
    if (msg.includes("0x7e6a08cf") || msg.includes("AlreadyResolvedToday")) {
      console.log("resolve: already resolved today — nothing to do");
      return;
    }
    const redacted = msg.replaceAll(entry.word, "[WORD]").replaceAll(entry.salt, "[SALT]").slice(0, 400);
    throw new Error(`resolve failed (args redacted): ${redacted}`);
  }
}

/**
 * Tell the jackpot winner they won. Best-effort by construction: a notification failure must never
 * turn a SUCCESSFUL on-chain resolve into a keeper crash, because the retry would then hit
 * AlreadyResolvedToday and look like a broken day. The payout already happened; this is a courtesy.
 */
async function notifyJackpotWinner(logs: readonly unknown[], word: string) {
  try {
    const won = parseEventLogs({ abi: jackpotAbi, eventName: "JackpotWon", logs: logs as never })[0];
    if (!won) return; // rolled over — nobody to tell
    const { winner, amount } = won.args as unknown as { winner: string; amount: bigint };

    const profiles = await lookupProfiles(await notifiableFids());
    const fidOf = fidLookupFrom(profiles);
    const fid = jackpotWinnerFid(winner, fidOf);
    const display = `${(amount / 10n ** 18n).toLocaleString("en-US")} $WORD`;
    if (fid === undefined) {
      // Not reachable on Farcaster: try the winner's browsers instead.
      const subs = webPushWinnerSubs(winner, await webPushSubscriptions(), fidOf);
      if (subs.length === 0) {
        return void console.log(`resolve: winner ${winner.slice(0, 10)} isn't a notifiable player`);
      }
      if (DRY) return void console.log(`  [dry] would tell ${subs.length} browser(s): won ${display}`);
      const res = await sendWebPush(subs, jackpotWon(word, display));
      return void console.log(`resolve: winner's browsers ${res.ok ? "notified" : `not notified (${res.skipped ?? `${res.failed} failed`})`}`);
    }
    if (DRY) return void console.log(`  [dry] would tell fid ${fid}: won ${display}`);
    const res = await sendNotification({ ...jackpotWon(word, display), targetFids: [fid] });
    console.log(`resolve: winner fid ${fid} ${res.ok ? "notified" : `not notified (${res.skipped ?? res.error})`}`);
  } catch (err) {
    console.error("resolve: winner notification failed (payout unaffected):", err);
  }
}

async function openStream(kind: "yield" | "bounty") {
  const client = getPublicClient();
  const now = await readChainTime();
  const day = Math.floor(now / 86_400);
  const streamAddr = addressOf(kind === "yield" ? "yieldDistributor" : "bounty");
  const epochId = kind === "yield" ? BigInt(day) : BigInt(Math.floor(day / 7));

  const existing = (await client.readContract({
    address: streamAddr, abi: merkleEpochsAbi, functionName: "epochs", args: [epochId],
  })) as unknown as readonly [string, bigint, bigint, bigint, boolean, bigint];
  if (existing[4]) return void console.log(`${kind}: epoch ${epochId} already open — nothing to do`);

  const words = await scanAllWords();
  const feeRouter = addressOf("feeRouter");
  const bucket = (await client.readContract({
    address: feeRouter, abi: feeRouterAbi, functionName: kind === "yield" ? "poolBalance" : "bountyBalance",
  })) as bigint;

  let leaves, meta = 0n;
  if (kind === "yield") {
    // pool × dailyDistributionRate — the self-scaling fraction the sim equilibrates on.
    const pot = (bucket * BigInt(Math.round(DEFAULT_PARAMS.staking.dailyDistributionRate * 1e6))) / 1_000_000n;
    leaves = yieldLeaves(words, pot);
  } else {
    const themeIdx = themeForPeriod(Number(epochId));
    meta = BigInt(themeIdx);
    leaves = bountyLeaves(words, bucket, THEMES[themeIdx].test);
    console.log(`bounty: period ${epochId}, theme "${THEMES[themeIdx].name}"`);
  }

  if (leaves.length === 0) {
    // An unsatisfied period simply isn't opened — funds roll forward (Bounty NatSpec).
    return void console.log(`${kind}: no eligible words — epoch ${epochId} not opened, bucket rolls forward`);
  }

  const epoch = buildEpochFile(leaves);
  const bad = epoch.entries.filter((e) => !verifyEntry(epoch.root, e));
  if (bad.length) throw new Error(`${kind}: ${bad.length} proofs failed self-verification — refusing to open`);
  const total = leavesTotal(leaves);
  if (total > bucket) throw new Error(`${kind}: tree total ${total} exceeds bucket ${bucket}`);

  console.log(`${kind}: epoch ${epochId} — ${leaves.length} leaves, total ${total} wei`);
  // A local copy, for inspection and as a backup. Best-effort: a scheduler's file system may be
  // read-only, and the database below is the copy the claim screen reads.
  try {
    mkdirSync(OUT, { recursive: true });
    // The root is in the name: a rerun for the same epoch must not overwrite a tree that may open.
    writeFileSync(`${OUT}/${kind}-${epochId}-${epoch.root.slice(2, 10)}.json`, JSON.stringify(epoch, null, 1));
  } catch (err) {
    console.log(`${kind}: local copy not written (${(err as Error).message}) — the database copy is what counts`);
  }

  if (DRY) return;
  // Store the proofs BEFORE opening the epoch, and never open without them: an open epoch whose
  // proofs nobody serves is funded rewards that no player can claim.
  await storeEpochLeaves(NETWORK.id, kind, epochId, epoch);
  console.log(`${kind}: stored ${epoch.entries.length} claim proofs`);
  const w = wallet();
  const hash = await w.writeContract({
    address: streamAddr, abi: merkleEpochsAbi, functionName: "openEpoch",
    args: [epochId, epoch.root, total, meta],
  });
  const rcpt = await w.waitForTransactionReceipt({ hash });
  console.log(`${kind}: openEpoch ${rcpt.status} in block ${rcpt.blockNumber} (${hash})`);
}

const EAS = "0x4200000000000000000000000000000000000021" as const;
const LETTERS_TRANSFER_SINGLE = {
  type: "event", name: "TransferSingle",
  inputs: [
    { name: "operator", type: "address", indexed: true },
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "id", type: "uint256", indexed: false },
    { name: "value", type: "uint256", indexed: false },
  ],
} as const;
const easAbi = [
  { type: "function", name: "attest", stateMutability: "payable",
    inputs: [{ name: "request", type: "tuple", components: [
      { name: "schema", type: "bytes32" },
      { name: "data", type: "tuple", components: [
        { name: "recipient", type: "address" },
        { name: "expirationTime", type: "uint64" },
        { name: "revocable", type: "bool" },
        { name: "refUID", type: "bytes32" },
        { name: "data", type: "bytes" },
        { name: "value", type: "uint256" },
      ]}]}],
    outputs: [{ type: "bytes32" }] },
] as const;

function schemaUid(): `0x${string}` {
  // Lives in the deployment registry beside the contract addresses (per-network).
  const cfg = JSON.parse(readFileSync("config/deployments.base-sepolia.json", "utf8"));
  if (!cfg.easAchievementsSchema) throw new Error("easAchievementsSchema missing from registry");
  return cfg.easAchievementsSchema;
}

/** Attestations we've already issued, from the EAS indexer — the dedupe set. */
async function alreadyAttested(attester: string): Promise<Set<string>> {
  const res = await fetch("https://base-sepolia.easscan.org/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query($schema:String!,$attester:String!){ attestations(where:{schemaId:{equals:$schema},attester:{equals:$attester},revoked:{equals:false}},take:1000){ recipient decodedDataJson }}`,
      variables: { schema: schemaUid(), attester },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json();
  const seen = new Set<string>();
  for (const a of data?.data?.attestations ?? []) {
    try {
      const fields = JSON.parse(a.decodedDataJson);
      const ach = Number(fields.find((f: { name: string }) => f.name === "achievement")?.value?.value ?? 0);
      const val = Number(fields.find((f: { name: string }) => f.name === "value")?.value?.value ?? 0);
      seen.add(`${a.recipient.toLowerCase()}:${ach}:${val}`);
    } catch { /* unparseable row — treat as absent; the worst case is a duplicate attestation */ }
  }
  return seen;
}

async function attestAchievements() {
  const client = getPublicClient();
  const words = await scanAllWords();

  // Letter holders: everyone TransferSingle ever delivered to, then live balances. The Words
  // contract itself accumulates escrowed letters — exclude it, it is not a player.
  const logs = await client.getLogs({
    address: addressOf("letters"), event: LETTERS_TRANSFER_SINGLE, fromBlock: 0n, toBlock: "latest",
  });
  const holders = new Set<string>();
  for (const l of logs) {
    const to = String(l.args.to).toLowerCase();
    if (to !== "0x0000000000000000000000000000000000000000") holders.add(to);
  }
  holders.delete(addressOf("words").toLowerCase());
  const letterCounts = new Map<string, number[]>();
  for (const h of holders) letterCounts.set(h, await readLetterCounts(h as `0x${string}`));

  const proposed = computeAchievements(words, letterCounts);
  const w = wallet();
  const seen = await alreadyAttested(w.account.address);
  const fresh = proposed.filter(
    (a) => !seen.has(`${a.recipient.toLowerCase()}:${a.achievement}:${a.value}`),
  );
  console.log(`achievements: ${proposed.length} earned, ${fresh.length} new`);
  if (DRY || fresh.length === 0) return;

  for (const a of fresh) {
    const hash = await w.writeContract({
      address: EAS, abi: easAbi, functionName: "attest",
      args: [{
        schema: schemaUid(),
        data: {
          recipient: a.recipient, expirationTime: 0n, revocable: false,
          refUID: "0x0000000000000000000000000000000000000000000000000000000000000000",
          data: encodeAbiParameters(
            [{ type: "uint8" }, { type: "uint32" }],
            [a.achievement, a.value],
          ),
          value: 0n,
        },
      }],
    });
    await w.waitForTransactionReceipt({ hash });
    console.log(`  attested ${a.achievement}/${a.value} → ${a.recipient.slice(0, 10)} (${hash.slice(0, 14)})`);
  }
}

/**
 * The hunger warning — the one notification the game genuinely owes its players.
 *
 * Rides the world scan that --yield and --bounty already perform, so it costs one extra Neynar
 * lookup and nothing on-chain. A hungry word earns zero yield AND loses jackpot eligibility;
 * without a warning that is a tax on people who were asleep, and with one, hunger becomes a
 * mechanic you can play around.
 *
 * Sends nothing unless notifications are armed (NODE_ENV=production + NOTIFICATIONS_ENABLED=true),
 * so --dry and every local run report the audience and stay silent.
 */
async function notifyHunger() {
  const [words, fids, subs] = await Promise.all([scanAllWords(), notifiableFids(), webPushSubscriptions()]);
  const fidOf = fidLookupFrom(fids.length > 0 ? await lookupProfiles(fids) : []);
  await notifyHungerFarcaster(words, fids, fidOf);
  await notifyHungerBrowsers(words, subs, fidOf);
}

async function notifyHungerFarcaster(words: readonly KeeperWord[], fids: readonly number[], fidOf: FidLookup) {
  if (fids.length === 0) return console.log("notify: nobody has added the mini app — Farcaster pass skipped");
  const targets = hungerTargets(words, fidOf);
  console.log(`notify: ${words.length} words, ${fids.length} notifiable, ${targets.length} to warn`);
  if (targets.length === 0) return;

  // Grouped by (words, hoursLeft) so players sharing a deadline share one send — the copy is
  // identical, and it keeps a large audience inside a handful of requests.
  const groups = new Map<string, { words: number; hoursLeft: number; fids: number[] }>();
  for (const t of targets) {
    const key = `${t.words}:${t.hoursLeft}`;
    const g = groups.get(key) ?? { words: t.words, hoursLeft: t.hoursLeft, fids: [] };
    g.fids.push(t.fid);
    groups.set(key, g);
  }

  for (const g of groups.values()) {
    const note = hungerWarning(g.words, g.hoursLeft);
    if (DRY) {
      console.log(`  [dry] ${g.fids.length} fid(s): "${note.title}" / "${note.body}"`);
      continue;
    }
    const res = await sendNotification({ ...note, targetFids: g.fids });
    console.log(`  ${g.fids.length} fid(s) ${res.ok ? "sent" : `skipped (${res.skipped ?? res.error})`}`);
  }
}

/**
 * The same warning for players who turned on browser reminders, by WALLET. Anyone the Farcaster
 * pass already warned is skipped (webPushHungerTargets), and players sharing a deadline share one
 * message, exactly like the FID path. Silent unless WEB_PUSH_ENABLED=true in production.
 */
async function notifyHungerBrowsers(words: readonly KeeperWord[], subs: readonly WebPushSubscription[], fidOf: FidLookup) {
  if (subs.length === 0) return console.log("notify (browser): no subscriptions — nothing to do");
  const targets = webPushHungerTargets(hungerTargetsByAddress(words), subs, fidOf);
  console.log(`notify (browser): ${subs.length} subscription(s), ${targets.length} wallet(s) to warn`);
  if (targets.length === 0) return;

  const groups = new Map<string, { words: number; hoursLeft: number; addresses: Set<string> }>();
  for (const t of targets) {
    const key = `${t.words}:${t.hoursLeft}`;
    const g = groups.get(key) ?? { words: t.words, hoursLeft: t.hoursLeft, addresses: new Set<string>() };
    g.addresses.add(t.address);
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    const note = hungerWarning(g.words, g.hoursLeft);
    const recipients = subs.filter((s) => g.addresses.has(s.address));
    if (DRY) {
      console.log(`  [dry] ${recipients.length} browser(s): "${note.title}" / "${note.body}"`);
      continue;
    }
    const res = await sendWebPush(recipients, note);
    console.log(
      `  ${recipients.length} browser(s) ${res.ok ? "sent" : `skipped (${res.skipped ?? `${res.failed} failed`})`}` +
        (res.gone ? `, ${res.gone} gone and removed` : ""),
    );
  }
}

/**
 * Browser subscriptions, or none. Never throws: before the web_push_subscriptions migration runs
 * (or with no database at all) the Farcaster passes must carry on exactly as they did.
 */
async function webPushSubscriptions(): Promise<WebPushSubscription[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    return await allWebPushSubscriptions();
  } catch (err) {
    console.error("notify (browser): couldn't read subscriptions, skipping browsers:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * A one-off operator announcement to everyone who added the mini app.
 *
 * This lives in the CLI rather than the admin console deliberately. The console's other actions are
 * transaction builders gated by the owner wallet's signature; a push has no signature, so a web
 * endpoint that could send one would be the entire authority for an irreversible, everyone-reaching
 * action. Shell access plus the deploy's env is a real gate. The Notifications tab previews copy;
 * this sends it.
 *
 * Broadcasts to the full audience — pass copy you would be happy to receive at 3am.
 */
async function announce(title: string, body: string) {
  const over: string[] = [];
  if (title.length > LIMITS.title) over.push(`title ${title.length}/${LIMITS.title}`);
  if (body.length > LIMITS.body) over.push(`body ${body.length}/${LIMITS.body}`);
  if (over.length) throw new Error(`announce: over the limit (${over.join(", ")}) — shorten it`);

  const fids = await notifiableFids();
  console.log(`announce: "${title}" / "${body}"`);
  console.log(`announce: ${fids.length} player(s) have added the mini app`);
  if (fids.length === 0) return;
  if (DRY) return void console.log("announce: [dry] nothing sent");

  // Explicit FIDs, never an empty list: an empty targetFids would mean "everyone with notifications
  // on" to Neynar, which is a broader and less inspectable audience than the one just counted.
  // UNIQUE PER INVOCATION — an announcement is a receipt, not a nudge. Keying it on the day plus a
  // title prefix (the obvious-looking choice) means a second announcement the same day with the
  // same opening 24 characters is dropped by the client for 24h while the keeper still reports
  // success: an invisible failure, which is the worst kind. A timestamp makes every deliberate send
  // land. The trade-off is that re-running the command genuinely sends twice — but the operator is
  // at a terminal and can see that, which beats a silent drop reported as delivered. The id is
  // logged so a double-send is identifiable after the fact.
  const notificationId = `announce-${Date.now()}`;
  const res = await sendNotification({ title, body, targetFids: fids, notificationId });
  console.log(`announce: id ${notificationId}`);
  console.log("announce:", res.ok ? `sent to ${res.delivered ?? "?"}` : `not sent (${res.skipped ?? res.error})`);
}

const jobs: Promise<void>[] = [];
if (args.has("--resolve")) jobs.push(resolveJackpot());
if (args.has("--yield")) jobs.push(openStream("yield"));
if (args.has("--bounty")) jobs.push(openStream("bounty"));
if (args.has("--achievements")) jobs.push(attestAchievements());
if (args.has("--notify")) jobs.push(notifyHunger());
// --announce "<title>" "<body>" — positional, so the copy is visible in shell history.
const annIdx = process.argv.indexOf("--announce");
if (annIdx !== -1) {
  const [title, body] = [process.argv[annIdx + 1], process.argv[annIdx + 2]];
  if (!title || !body || title.startsWith("--") || body.startsWith("--")) {
    console.log('usage: npm run keeper -- --announce "<title>" "<body>" [--dry]');
    process.exit(1);
  }
  jobs.push(announce(title, body));
}
if (jobs.length === 0) {
  console.log(
    'usage: npm run keeper -- [--resolve] [--yield] [--bounty] [--achievements] [--notify] ' +
      '[--announce "<title>" "<body>"] [--dry]',
  );
  process.exit(1);
}
// Sequential, not parallel — same key, and nonce races on the public RPC cost us a deploy once.
for (const j of jobs) await j;
