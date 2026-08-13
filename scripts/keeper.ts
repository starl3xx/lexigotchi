/**
 * The daily keeper — the operator's heartbeat, run once per UTC day (cron or by hand):
 *
 *   npm run keeper -- --resolve          reveal today's word + resolve the jackpot
 *   npm run keeper -- --yield            open today's yield epoch (epochId = UTC day)
 *   npm run keeper -- --bounty           open this week's bounty period if unopened
 *   npm run keeper -- --dry [...]        compute + verify everything, send nothing
 *
 * Env: KEEPER_PRIVATE_KEY (the contracts' keeper role — Sepolia: the throwaway deployer),
 * NEXT_PUBLIC_CHAIN_ID / NEXT_PUBLIC_RPC_URL as usual. The AnswerChain schedule is read from
 * ANSWER_CHAIN_FILE (default: the Sepolia rehearsal file). NEVER commit or log schedule contents —
 * whoever holds future words wins every jackpot.
 *
 * Epoch trees are written to keeper-output/<stream>-<epoch>.json (gitignored), each entry carrying
 * its proof — the file IS the claim server's data. Losing one is recoverable (the math is
 * deterministic; re-run with --dry to regenerate), but treat the directory as operational state.
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
import { encodeAbiParameters } from "viem";
import { buildEpochFile, verifyEntry } from "../src/lib/keeper/tree";
import { DEFAULT_PARAMS } from "../src/lib/params";
import { THEMES, themeForPeriod } from "../src/lib/themes";

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
  const file = process.env.ANSWER_CHAIN_FILE ?? "contracts/answer-chain.sepolia-rehearsal.secret.json";
  const schedule = JSON.parse(readFileSync(file, "utf8")) as { schedule: { word: string; salt: string; next: string }[] };
  const revealed = Number(
    await getPublicClient().readContract({ address: addressOf("answerChain"), abi: answerChainAbi, functionName: "revealedDay" }),
  );
  const entry = schedule.schedule[revealed]; // revealedDay counts reveals; the next entry is at that index
  if (!entry) throw new Error(`Schedule exhausted at reveal #${revealed} — rotate the chain.`);
  console.log(`resolve: reveal #${revealed + 1} (word withheld from logs)`);
  if (DRY) return;
  const w = wallet();
  try {
    const hash = await w.writeContract({
      address: addressOf("jackpot"), abi: jackpotAbi, functionName: "resolve",
      args: [entry.word, entry.salt as `0x${string}`, entry.next as `0x${string}`],
    });
    const rcpt = await w.waitForTransactionReceipt({ hash });
    console.log(`resolve: ${rcpt.status} in block ${rcpt.blockNumber} (${hash})`);
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

  mkdirSync(OUT, { recursive: true });
  const path = `${OUT}/${kind}-${epochId}.json`;
  writeFileSync(path, JSON.stringify(epoch, null, 1));
  console.log(`${kind}: epoch ${epochId} — ${leaves.length} leaves, total ${total} wei → ${path}`);

  if (DRY) return;
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

const jobs: Promise<void>[] = [];
if (args.has("--resolve")) jobs.push(resolveJackpot());
if (args.has("--yield")) jobs.push(openStream("yield"));
if (args.has("--bounty")) jobs.push(openStream("bounty"));
if (args.has("--achievements")) jobs.push(attestAchievements());
if (jobs.length === 0) {
  console.log("usage: npm run keeper -- [--resolve] [--yield] [--bounty] [--achievements] [--dry]");
  process.exit(1);
}
// Sequential, not parallel — same key, and nonce races on the public RPC cost us a deploy once.
for (const j of jobs) await j;
