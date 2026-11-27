/**
 * The keeper's jobs, as a library: the command line (scripts/keeper.ts) and the daily cron route
 * (src/app/api/cron/keeper) both build one with `createKeeper({ dry })` and run its jobs ONE AT A
 * TIME, because they share one key and parallel sends race for the same nonce.
 *
 * The job code below moved here unchanged from scripts/keeper.ts; see that file's header for what
 * each job does and the environment it needs.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { createWalletClient, publicActions } from "viem";
import { rpcTransport } from "@/lib/onchain/transport";
import { privateKeyToAccount } from "viem/accounts";
import { ACTIVE_CHAIN } from "@/lib/onchain/chain";
import { addressOf, achievementsSchema, deployBlock, wordTokenAddress } from "@/lib/onchain/addresses";
import { BUILDER_DATA_SUFFIX } from "@/lib/onchain/builderCode";
import { erc20Abi, jackpotAbi, lettersAbi, rollsAbi, saleFeesAbi, shopAbi, wordsAbi, stakingAbi, prestigeAbi, yieldDistributorAbi } from "@/lib/onchain/abis";
import { shopAddress } from "@/lib/onchain/addresses";
import { MIN_SWEEP_USDC, holderProfiles, sweepMinWordOut } from "@/lib/keeper/shop";
import { catchUp as catchUpWardrobe } from "@/lib/shop/indexer";
import { catchUpSales } from "@/lib/market/sales";
import { clearPicksOffLeftWords } from "@/lib/db/wordPicks";
import { readGameParams } from "@/lib/onchain/reads";
import { fetchWordPrice } from "@/lib/oracle/wordPrice";
import { planRepeg, type PricePoint } from "@/lib/keeper/repeg";
import { getPublicClient, readChainTime } from "@/lib/onchain/reads";
import { scanAllWords } from "@/lib/keeper/scan";
import { yieldLeaves, bountyLeaves, leavesTotal } from "@/lib/keeper/shares";
import { computeAchievements, type AchievementLeaf } from "@/lib/keeper/achievements";
import { readLetterCounts, readWalletBalances } from "@/lib/onchain/reads";
import { WORDS } from "@/lib/dictionary";
import { encodeAbiParameters, parseEventLogs } from "viem";
import { buildEpochFile, verifyEntry } from "@/lib/keeper/tree";
import { DEFAULT_PARAMS } from "@/lib/params";
import { THEMES, themeForPeriod } from "@/lib/themes";
import { notifiableFids } from "@/lib/db/queries";
import { lookupProfiles } from "@/lib/neynar";
import {
  hungerTargets,
  hungerTargetsByAddress,
  fidLookupFrom,
  accountFidLookup,
  jackpotWinnerFid,
  webPushHungerTargets,
  webPushWinnerSubs,
  type FidLookup,
} from "@/lib/notify/triggers";
import { hungerWarning, jackpotWon } from "@/lib/notify/templates";
import { sendNotification, LIMITS } from "@/lib/notify/send";
import { sendWebPush } from "@/lib/notify/webPush";
import { notifySold } from "@/lib/notify/sold";
import { notifyPaid, shareKey, type LandedShare } from "@/lib/notify/paid";
import { DEAL_AGAIN_SECONDS, DEAL_DAILY_SECONDS, tellDeals } from "@/lib/notify/deals";
import { notifyPlayers } from "@/lib/notify/players";
import { claimMark, claimMarkEvery, releaseMark } from "@/lib/db/reminderMarks";
import { tellByTelegram, telegramRemindersOn } from "@/lib/notify/telegram";
import { sendDigests, weekEarned, weekSold, wordsNeedingCare } from "@/lib/notify/digest";
import { loadShares } from "@/lib/rewards/load";
import { salesBySellers } from "@/lib/db/market";
import { readLetterBook } from "@/lib/market/letterBoard";
import { loadPrefs } from "@/lib/db/reminderPrefs";
import type { SaleRow } from "@/lib/db/market";
import { emailEnabled, reminderEmail, sendEmails } from "@/lib/notify/email";
import { emailRecipients, markEmailSent, type EmailRecipient } from "@/lib/db/profiles";
import { allWebPushSubscriptions } from "@/lib/db/webPush";
import { rewardTreeLeaves, rewardTrees, storeEpochLeaves } from "@/lib/db/rewards";
import { MULTICALL3, PAYOUT_BUDGET_MS, multicall3Abi, payoutBatches, payoutCalls } from "@/lib/keeper/payout";
import type { Claimable } from "@/lib/keeper/claimables";
import { NETWORK } from "@/lib/onchain/network";
import { loadAnswerSchedule, linkToReveal } from "@/lib/keeper/answerSchedule";
import type { WebPushSubscription } from "@/lib/db/schema";
import type { KeeperWord } from "@/lib/keeper/shares";
import { loadLinkMap, loadLinkMapStrict } from "@/lib/db/walletLinks";


/** Strip a jackpot word and salt from text in every encoding viem may print them in. */
export function redactSecrets(text: string, word: string, salt: string): string {
  const forms: [string, string][] = [
    [word, "[WORD]"],
    [Buffer.from(word, "utf8").toString("hex"), "[WORD]"],
    [salt.replace(/^0x/i, ""), "[SALT]"],
  ];
  let out = text;
  for (const [secret, label] of forms) {
    if (secret) out = out.replace(new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), label);
  }
  return out;
}

// The job names and the KEEPER_JOBS parser live in jobList.ts, so a status page can read them
// without importing this module (and the sender it imports). Re-exported: callers are unchanged.
import type { KeeperJob } from "./jobList";
export { DEFAULT_JOBS, KNOWN_JOBS, jobsFrom, type KeeperJob } from "./jobList";

/**
 * The bounty period the daily run settles today, or null. A period pays when it ENDS, so players
 * can chase its theme all week: the Bounty screen shows the current week's theme, and the sim pays
 * on a period's last day. So the run on the FIRST day of period P settles P - 1, from the state as
 * that week closed. No other day settles anything: a later snapshot would count words staked after
 * the week ended. A missed first day leaves that week's bucket to roll forward, as an unsatisfied
 * week does. (The first version opened the CURRENT period on its first day, before anyone could
 * chase its theme.)
 */
export function bountyPeriodToSettle(day: number, periodDays: number = DEFAULT_PARAMS.bounty.periodDays): number | null {
  if (day < 0 || day % periodDays !== 0) return null;
  const period = day / periodDays - 1;
  return period >= 0 ? period : null;
}


export function createKeeper(opts: { dry: boolean }) {
  const DRY = opts.dry;
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
        dataSuffix: BUILDER_DATA_SUFFIX, // ERC-8021: the keeper's writes are app writes too
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
      // Redact every form the secret can take in viem's dump, including the raw calldata hex, where
    // the word appears as its UTF-8 bytes and the salt without its 0x. Case-insensitive.
    const redacted = redactSecrets(msg, entry.word, entry.salt).slice(0, 400);
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
      // The winner's account (linked wallets): its email row, its Farcaster, and every browser it
      // subscribed on. loadLinkMap never throws; with no links the account is the winner itself.
      const links = await loadLinkMap();
      // The winner may have turned this one off (lib/notify/kinds.ts); unreadable choices send nothing.
      if (!(await loadPrefs()).wants(links.accountOf(winner), "jackpot")) {
        return void console.log(`resolve: winner ${winner.slice(0, 10)} isn't told (turned off, or choices unreadable)`);
      }
      // Email first and independently: a player who opted in hears about a win however else we reach them.
      await notifyWinnerEmail(links.accountOf(winner), jackpotWon(word, `${(amount / 10n ** 18n).toLocaleString("en-US")} $WORD`));
      // And by Telegram, as independently: a winner who linked it hears there too.
      await notifyWinnerTelegram(links.accountOf(winner), jackpotWon(word, `${(amount / 10n ** 18n).toLocaleString("en-US")} $WORD`));

      const profiles = await lookupProfiles(await notifiableFids());
      const fidOf = accountFidLookup(fidLookupFrom(profiles), links);
      const fid = jackpotWinnerFid(winner, fidOf);
      const display = `${(amount / 10n ** 18n).toLocaleString("en-US")} $WORD`;
      if (fid === undefined) {
        // Not reachable on Farcaster: try the winner's browsers instead.
        const subs = webPushWinnerSubs(winner, await webPushSubscriptions(), fidOf, links.accountOf);
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
    let epochId: bigint;
    if (kind === "yield") {
      epochId = BigInt(day);
    } else {
      const period = bountyPeriodToSettle(day);
      if (period === null) {
        const left = DEFAULT_PARAMS.bounty.periodDays - (day % DEFAULT_PARAMS.bounty.periodDays);
        return void console.log(`bounty: a week settles on the first day of the next; next in ${left} day(s)`);
      }
      epochId = BigInt(period);
    }

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
        dataSuffix: BUILDER_DATA_SUFFIX, // ERC-8021: the keeper's writes are app writes too
      address: streamAddr, abi: merkleEpochsAbi, functionName: "openEpoch",
      args: [epochId, epoch.root, total, meta],
    });
    const rcpt = await w.waitForTransactionReceipt({ hash });
    console.log(`${kind}: openEpoch ${rcpt.status} in block ${rcpt.blockNumber} (${hash})`);
  }

  /**
   * Pay every stored share that is still unpaid (decisions.md #16): today's yield right after
   * `yield` opens it, a settled bounty week after `bounty`, and anything an earlier run missed.
   * Only trees the chain opened with that same root, and only epochs with something left, so a
   * claim here can't revert for a reason the next run would repeat. Batched through Multicall3 with
   * per-call failure allowed; what doesn't fit in PAYOUT_BUDGET_MS waits for the next run.
   */
  async function payOut() {
    const client = getPublicClient();
    const streamAddr = (s: "yield" | "bounty") => addressOf(s === "yield" ? "yieldDistributor" : "bounty");

    // The trees the chain opened with that root and that still have something to pay.
    const trees = await rewardTrees(NETWORK.id);
    if (trees.length === 0) return void console.log("payout: no stored shares");
    const epochKeys = [...new Map(trees.map((t) => [`${t.stream}:${t.epochId}`, t])).values()];
    const states = (await client.multicall({
      allowFailure: false,
      contracts: epochKeys.map((t) => ({
        address: streamAddr(t.stream), abi: merkleEpochsAbi, functionName: "epochs" as const, args: [BigInt(t.epochId)],
      })),
    })) as unknown as (readonly [string, bigint, bigint, bigint, boolean, bigint])[];
    // stream:epoch:root of each epoch that is open and has something left to pay
    const owing = new Set<string>();
    epochKeys.forEach((t, i) => {
      const [root, funded, claimed, , open] = states[i];
      if (open && claimed < funded) owing.add(`${t.stream}:${t.epochId}:${root.toLowerCase()}`);
    });
    const live = trees.filter((t) => owing.has(`${t.stream}:${t.epochId}:${t.root.toLowerCase()}`));
    if (live.length === 0) return void console.log("payout: every opened share is paid");

    const rows = (await Promise.all(live.map((t) => rewardTreeLeaves(NETWORK.id, t)))).flat();
    const paid = (await client.multicall({
      allowFailure: false,
      contracts: rows.map((r) => ({
        address: streamAddr(r.stream as "yield" | "bounty"), abi: yieldDistributorAbi, functionName: "hasClaimed" as const,
        args: [BigInt(r.epochId), BigInt(r.tokenId)],
      })),
    })) as unknown as boolean[];
    const unpaid: Claimable[] = rows
      .filter((_, i) => !paid[i])
      .map((r) => ({
        stream: r.stream as "yield" | "bounty", epochId: r.epochId, tokenId: r.tokenId,
        account: r.account as `0x${string}`, amount: r.amount, proof: r.proof,
      }));
    const owed = unpaid.reduce((a, c) => a + BigInt(c.amount), 0n);
    console.log(`payout: ${unpaid.length} unpaid share(s), ${owed} wei, in ${live.length} epoch(s)`);
    if (unpaid.length === 0 || DRY) return;

    const w = wallet();
    const started = Date.now();
    const sentShares: Claimable[] = [];
    // Each share this run PAID, from its event: what players are told of (lib/notify/paid.ts).
    const landedShares: LandedShare[] = [];
    const bountyAddr = streamAddr("bounty").toLowerCase();
    let landed = 0, landedWei = 0n;
    // A batch that fails (a refused send, a receipt that never comes) ends the sending, not the run:
    // the batches before it paid, and their players are told below before the error is thrown.
    let sendFailed: unknown;
    try {
      for (const batch of payoutBatches(unpaid)) {
        if (Date.now() - started > PAYOUT_BUDGET_MS) {
          console.log(`payout: out of time — ${unpaid.length - sentShares.length} share(s) wait for the next run`);
          break;
        }
        const hash = await w.writeContract({
          dataSuffix: BUILDER_DATA_SUFFIX, // ERC-8021: the keeper's writes are app writes too
          address: MULTICALL3, abi: multicall3Abi, functionName: "aggregate3",
          args: [payoutCalls(batch, streamAddr)],
        });
        const rcpt = await w.waitForTransactionReceipt({ hash });
        sentShares.push(...batch);
        // What this run paid: RewardClaimed events, not the batch size (a call may fail on its own).
        for (const ev of parseEventLogs({ abi: yieldDistributorAbi, eventName: "RewardClaimed", logs: rcpt.logs })) {
          landed += 1;
          landedWei += ev.args.amount;
          // The two streams share the event; the contract that emitted it says which this is.
          landedShares.push({
            stream: ev.address.toLowerCase() === bountyAddr ? "bounty" : "yield", epochId: Number(ev.args.epochId),
            tokenId: ev.args.tokenId.toString(), account: ev.args.account, amount: ev.args.amount,
          });
        }
        console.log(`payout: batch of ${batch.length} ${rcpt.status} in block ${rcpt.blockNumber} (${hash})`);
      }
    } catch (err) {
      sendFailed = err;
      console.error(`payout: a batch failed, the rest wait for the next run: ${String((err as Error)?.message ?? err).slice(0, 160)}`);
    }
    console.log(`payout: paid ${landed} of ${sentShares.length} share(s) sent, ${landedWei} wei`);

    // What became of every share this run did not see land, the ones it never reached too: one read.
    // A player may have collected one a moment earlier (the keeper's claim then reverts harmlessly,
    // AlreadyClaimed), and a transaction whose receipt never came may have landed all the same.
    const landedKeys = new Set(landedShares.map(shareKey));
    const notLanded = unpaid.filter((c) => !landedKeys.has(shareKey(c)));
    const paidMeanwhile = new Set<string>();
    let recheckFailed: unknown;
    if (notLanded.length > 0) {
      try {
        const nowPaid = (await client.multicall({
          allowFailure: false,
          contracts: notLanded.map((c) => ({
            address: streamAddr(c.stream), abi: yieldDistributorAbi, functionName: "hasClaimed" as const,
            args: [BigInt(c.epochId), BigInt(c.tokenId)],
          })),
        })) as unknown as boolean[];
        notLanded.forEach((c, i) => void (nowPaid[i] && paidMeanwhile.add(shareKey(c))));
      } catch (err) {
        recheckFailed = err; // said below, after the players are told
        console.warn(`payout: couldn't re-read the unpaid shares: ${String((err as Error)?.message ?? err).slice(0, 160)}`);
      }
    }
    // Players who asked hear what was paid, before anything below can end the job with an error:
    // the money has moved either way (lib/notify/paid.ts; it never throws). It gets every share of
    // the epochs this run worked through, so a message states a player's whole share of a day or a
    // week, and says "paid" of all of it only when all of it is.
    await notifyPaid(
      landedShares,
      rows.map((r, i) => ({
        stream: r.stream as "yield" | "bounty", epochId: Number(r.epochId), tokenId: BigInt(r.tokenId).toString(),
        account: r.account, amount: BigInt(r.amount), paidBefore: paid[i], paidNow: paidMeanwhile.has(shareKey(r)),
      })),
    );
    if (sendFailed) throw sendFailed;
    // A sent call that didn't pay is only a failure if its share is STILL unpaid.
    const missed = sentShares.filter((c) => !landedKeys.has(shareKey(c)));
    if (missed.length === 0) return;
    if (recheckFailed) throw recheckFailed;
    const stillUnpaid = missed.filter((c) => !paidMeanwhile.has(shareKey(c))).length;
    if (stillUnpaid > 0) throw new Error(`payout: ${stillUnpaid} share(s) sent but still unpaid — they're retried next run`);
    console.log(`payout: the other ${missed.length} were already paid by someone else`);
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
    const uid = achievementsSchema();
    if (!uid) throw new Error(`no easAchievementsSchema in the ${NETWORK.key} registry — register the schema first`);
    return uid;
  }
  /** The EAS indexer for the active network (the dedupe source). */
  const EAS_GRAPHQL = NETWORK.isTestnet ? "https://base-sepolia.easscan.org/graphql" : "https://base.easscan.org/graphql";

  /** Attestations we've already issued, from the EAS indexer — the dedupe set. */
  async function alreadyAttested(attester: string): Promise<Set<string>> {
    const res = await fetch(EAS_GRAPHQL, {
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
      // From the deploy block, never 0: a mainnet RPC refuses a log range back to genesis.
      address: addressOf("letters"), event: LETTERS_TRANSFER_SINGLE, fromBlock: deployBlock(), toBlock: "latest",
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
        dataSuffix: BUILDER_DATA_SUFFIX, // ERC-8021: the keeper's writes are app writes too
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
    const [all, fids, subs, links, prefs] = await Promise.all([scanAllWords(), notifiableFids(), webPushSubscriptions(), loadLinkMap(), loadPrefs()]);
    // A player may have turned hunger warnings off (lib/notify/kinds.ts). Choices that couldn't be
    // read are no licence to send: the pass is skipped, and loadPrefs has logged why.
    if (!prefs.known) return void console.error("notify: reminder choices unreadable — no hunger warnings this pass");
    // Their words leave the pass HERE, before any channel groups them: one filter for all three.
    const words = all.filter((w) => prefs.wants(links.accountOf(w.owner), "hunger"));
    if (words.length < all.length) console.log(`notify: ${all.length - words.length} word(s) belong to players who turned hunger warnings off`);
    // One warning per PLAYER: a linked wallet's words reach its account's Farcaster, browsers, and email.
    const fidOf = accountFidLookup(fidLookupFrom(fids.length > 0 ? await lookupProfiles(fids) : []), links);
    console.log(`notify: ${links.size} linked wallet(s)`);
    await notifyHungerFarcaster(words, fids, fidOf);
    await notifyHungerBrowsers(words, subs, fidOf, links.accountOf);
    await notifyHungerEmail(words, links.accountOf);
    await notifyHungerTelegram(words, links.accountOf);
  }

  /** The `notify` job: the hunger warnings, which players are owed, then the deal alerts. A failed first step still runs the second. */
  async function notifyJob() {
    try {
      await notifyHunger();
    } finally {
      await notifyDeals();
      await notifyDigest();
    }
  }

  /**
   * The weekly email digest (lib/notify/digest.ts), for players who chose it in place of the daily
   * emails. Sent on the first day of a week, for the week that just ended (the day its bounty is
   * settled). Part of the `notify` job, which already runs daily; it reads the chain only on that
   * day and only when somebody chose it. Never throws.
   */
  async function notifyDigest() {
    try {
      if (!emailEnabled()) return;
      const days = DEFAULT_PARAMS.bounty.periodDays;
      const day = Math.floor((await readChainTime()) / 86_400);
      // The first day of a week, and the day after it: a run that failed on the first day is made
      // up on the second, and the send-once mark keeps a week to one email.
      if (day % days > 1) return void console.log(`digest: a week's email goes out on the first day of the next; next in ${days - (day % days)} day(s)`);
      const prefs = await loadPrefs();
      // Unreadable choices send nothing (and take no mark): tomorrow's run is the second chance.
      if (!prefs.known) return void console.log("digest: the choices couldn't be read, nothing sent");
      const accounts = prefs.weekly();
      if (accounts.length === 0) return void console.log("digest: nobody chose the weekly email");
      // A line the player turned off as a reminder stays out of their digest too.
      const noHunger = new Set(prefs.chose("hunger", false));
      const noSold = new Set(prefs.chose("sold", false));
      const period = Math.floor(day / days) - 1;
      const [since, until] = [new Date(period * days * 86_400_000), new Date((period + 1) * days * 86_400_000)];
      const [links, words] = await Promise.all([loadLinkMap(), scanAllWords()]);
      const res = await sendDigests(
        {
          accounts,
          walletsOf: links.walletsOf,
          recipients: (list) => emailRecipients(list),
          weekOf: async (account, wallets) => {
            const [shares, sales] = await Promise.all([loadShares(wallets), noSold.has(account) ? [] : salesBySellers(NETWORK.id, wallets, since, until)]);
            return {
              earned: weekEarned(shares, period, days),
              sold: weekSold(sales, account, links.accountOf),
              ...(noHunger.has(account) ? { hungry: [], peckish: [] } : wordsNeedingCare(words, wallets, DEFAULT_PARAMS.care)),
            };
          },
          claim: (account, mark) => claimMark(account, "digest", mark),
          release: (account, mark) => releaseMark(account, "digest", mark),
          send: async (to, account, note, facts, id) => {
            const message = reminderEmail(to, account, note, facts);
            return !!message && (await sendEmails([message], { idempotency: id })).sent === 1;
          },
        },
        period,
        { dry: DRY, log: (line) => console.log(line) },
      );
      console.log(`digest: week ${period}: ${res.sent} sent, ${res.empty} with nothing to say, ${res.skipped} sent before`);
    } catch (err) {
      console.error("digest: the weekly email failed:", String((err as Error)?.message ?? err).slice(0, 200));
    }
  }

  /**
   * The deal alert (lib/notify/deals.ts): for each player who turned it on, the one letter for sale
   * that finishes a word nobody owns. Part of the `notify` job, which already runs daily. Reads the
   * chain only when somebody opted in. Never throws: a courtesy must not fail the job.
   */
  async function notifyDeals() {
    try {
      const prefs = await loadPrefs();
      const accounts = prefs.chose("deal", true);
      if (accounts.length === 0) return void console.log("deals: nobody turned the deal alert on");
      const [links, words, book, now] = await Promise.all([loadLinkMap(), scanAllWords(), readLetterBook(), readChainTime()]);
      const claimed = new Set(words.map((w) => w.word.toUpperCase()));
      const day = Math.floor(now / 86_400);
      const { notes, told } = await tellDeals(
        {
          accounts,
          walletsOf: links.walletsOf,
          accountOf: links.accountOf,
          lettersOf: async (wallets) => {
            const balances = await readWalletBalances(wallets as `0x${string}`[]);
            return Object.fromEntries(Object.entries(balances).map(([w, b]) => [w, b.letters]));
          },
          unclaimed: WORDS.filter((w) => !claimed.has(w)),
          book,
          marks: {
            claimDay: (account) => claimMarkEvery(account, "deal-day", "last", DEAL_DAILY_SECONDS),
            releaseDay: (account) => releaseMark(account, "deal-day", "last"),
            claimDeal: (account, mark) => claimMarkEvery(account, "deal-seen", mark, DEAL_AGAIN_SECONDS),
            releaseDeal: (account, mark) => releaseMark(account, "deal-seen", mark),
          },
          // The accounts a message went out to; a mark for anyone else is given back (lib/notify/deals.ts).
          tell: async (toTell) => {
            const reached = new Set<string>();
            await notifyPlayers("deal", () => toTell, { onReached: (account) => reached.add(account.toLowerCase()) });
            return reached;
          },
        },
        day,
        { dry: DRY },
      );
      console.log(`deals: ${accounts.length} player(s) asked, ${notes.length} deal(s) to tell of${DRY ? "" : `, ${told} told`}`);
      if (DRY) notes.forEach((n) => console.log(`  [dry] would tell ${n.account.slice(0, 10)}: ${n.note.body}`));
    } catch (err) {
      console.error("deals: the deal alert failed:", String((err as Error)?.message ?? err).slice(0, 200));
    }
  }

  /**
   * Email recipients among these wallets (confirmed address, reminders on), or none. Never throws:
   * before migration 0006, or with email switched off, the other channels carry on as before.
   */
  async function emailRecipientsSafe(addresses: readonly string[]): Promise<EmailRecipient[]> {
    if (!process.env.DATABASE_URL || !emailEnabled() || addresses.length === 0) return [];
    try {
      return await emailRecipients(addresses);
    } catch (err) {
      console.error("notify (email): couldn't read recipients, skipping email:", err instanceof Error ? err.message : err);
      return [];
    }
  }

  /** The hunger warning by email, one message per account (its email row's key), for players who opted in. */
  async function notifyHungerEmail(words: readonly KeeperWord[], accountOf: (address: string) => string) {
    const targets = hungerTargetsByAddress(words, undefined, undefined, accountOf);
    // One hunger email per wallet per UTC day: the keeper runs more often than that, and a retried
    // run must not email twice (Bugbot on #139).
    const today = Math.floor(Date.now() / 86_400_000);
    const recips = (await emailRecipientsSafe(targets.map((t) => t.address))).filter((r) => r.emailHungerDay !== today);
    if (recips.length === 0) return;
    const emailOf = new Map(recips.map((r) => [r.address, r.email]));
    const messages = targets.flatMap((t) => {
      const to = emailOf.get(t.address);
      return (to && reminderEmail(to, t.address, hungerWarning(t))) || [];
    });
    console.log(`notify (email): ${messages.length} wallet(s) to warn`);
    if (DRY || messages.length === 0) return;
    const res = await sendEmails(messages, {
      idempotency: `hunger-${today}`,
      onSent: (batch) => markEmailSent("hunger", batch.flatMap((m) => (m.address ? [m.address] : [])), today),
    });
    console.log(`  email: ${res.sent} sent, ${res.failed} failed`);
  }

  /**
   * The hunger warning by Telegram message, one per account, for players who linked Telegram
   * (lib/notify/telegram.ts). One a UTC day, like the email: the day is the send-once mark, so a
   * retried run can't warn twice. Never throws.
   */
  async function notifyHungerTelegram(words: readonly KeeperWord[], accountOf: (address: string) => string) {
    if (!telegramRemindersOn()) return;
    const targets = hungerTargetsByAddress(words, undefined, undefined, accountOf);
    if (targets.length === 0) return;
    const today = Math.floor(Date.now() / 86_400_000);
    if (DRY) return void console.log(`  [dry] notify (telegram): ${targets.length} account(s) would be checked for a link`);
    const res = await tellByTelegram("hunger", targets.map((t) => ({ account: t.address, note: hungerWarning(t), mark: String(today) })));
    if (res) console.log(`notify (telegram): ${res.sent} sent, ${res.skipped} already told, ${res.failed} failed${res.gone ? `, ${res.gone} unlinked` : ""}`);
  }

  /** The jackpot win by Telegram message, to a winner who linked Telegram. Never throws. */
  async function notifyWinnerTelegram(account: string, note: { title: string; body: string; notificationId?: string }) {
    if (!telegramRemindersOn() || !note.notificationId) return;
    if (DRY) return void console.log("  [dry] would tell the winner by Telegram, if they linked it");
    const res = await tellByTelegram("jackpot", [{ account, note, mark: note.notificationId }]);
    if (res?.sent) console.log("resolve: winner told by Telegram");
  }

  async function notifyWinnerEmail(winner: string, note: { title: string; body: string }) {
    try {
      const [r] = await emailRecipientsSafe([winner]);
      const message = r && reminderEmail(r.email, r.address, note);
      if (!message) return;
      if (DRY) return void console.log("  [dry] would email the winner");
      const res = await sendEmails([message]);
      console.log(`resolve: winner ${res.sent ? "emailed" : "not emailed"}`);
    } catch (err) {
      console.error("resolve: winner email failed (payout unaffected):", err);
    }
  }

  async function notifyHungerFarcaster(words: readonly KeeperWord[], fids: readonly number[], fidOf: FidLookup) {
    if (fids.length === 0) return console.log("notify: nobody has added the mini app — Farcaster pass skipped");
    const targets = hungerTargets(words, fidOf);
    console.log(`notify: ${words.length} words, ${fids.length} notifiable, ${targets.length} to warn`);
    if (targets.length === 0) return;

    // Grouped by identical copy (the named word, the count, the hours), so players who'd read the
    // same message share one send. Naming the word (decisions.md #24) makes most groups a single
    // player: about one request per player, where the count-only copy shared one per deadline.
    const groups = new Map<string, { word: string; words: number; hoursLeft: number; fids: number[] }>();
    for (const t of targets) {
      const key = `${t.word}:${t.words}:${t.hoursLeft}`;
      const g = groups.get(key) ?? { word: t.word, words: t.words, hoursLeft: t.hoursLeft, fids: [] };
      g.fids.push(t.fid);
      groups.set(key, g);
    }

    for (const g of groups.values()) {
      const note = hungerWarning(g);
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
  async function notifyHungerBrowsers(
    words: readonly KeeperWord[],
    subs: readonly WebPushSubscription[],
    fidOf: FidLookup,
    accountOf: (address: string) => string,
  ) {
    if (subs.length === 0) return console.log("notify (browser): no subscriptions — nothing to do");
    const targets = webPushHungerTargets(hungerTargetsByAddress(words, undefined, undefined, accountOf), subs, fidOf, accountOf);
    console.log(`notify (browser): ${subs.length} subscription(s), ${targets.length} wallet(s) to warn`);
    if (targets.length === 0) return;

    const groups = new Map<string, { word: string; words: number; hoursLeft: number; addresses: Set<string> }>();
    for (const t of targets) {
      const key = `${t.word}:${t.words}:${t.hoursLeft}`;
      const g = groups.get(key) ?? { word: t.word, words: t.words, hoursLeft: t.hoursLeft, addresses: new Set<string>() };
      g.addresses.add(t.address);
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      const note = hungerWarning(g);
      const recipients = subs.filter((s) => g.addresses.has(accountOf(s.address).toLowerCase()));
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


  /**
   * The price keeper: keep each onchain price near its USD target as $WORD moves
   * (src/lib/keeper/repeg.ts holds the rules). A DISTINCT hot key (PRICE_KEEPER_PRIVATE_KEY) from
   * the resolution keeper, and a no-op until the owner wires it as each contract's `priceKeeper`.
   */
  async function repegPrices() {
    const key = process.env.PRICE_KEEPER_PRIVATE_KEY;
    if (!key) return void console.log("repeg: PRICE_KEEPER_PRIVATE_KEY not set — skipped");
    const account = privateKeyToAccount(key as `0x${string}`);
    const client = getPublicClient();
    const [params, live] = await Promise.all([readGameParams(), fetchWordPrice()]);
    const P = DEFAULT_PARAMS.prices;
    const snackUsd = P.snack * DEFAULT_PARAMS.prestige.snacksPerAttempt;

    // One call per contract, each carrying ALL of that contract's prices (an unchanged one is
    // passed through as-is, which the contract treats as "no change").
    const targets = [
      { key: "letters" as const, abi: lettersAbi, fn: "repegPrices" as const,
        points: [{ item: "pack", currentWei: params.wei.pack, targetUsd: P.pack }, { item: "daily", currentWei: params.wei.daily, targetUsd: P.dailyMint }] },
      { key: "rolls" as const, abi: rollsAbi, fn: "repegRollPrice" as const,
        points: [{ item: "roll", currentWei: params.wei.roll, targetUsd: P.roll }] },
      { key: "words" as const, abi: wordsAbi, fn: "repegClaimPrice" as const,
        points: [{ item: "claim", currentWei: params.wei.claim, targetUsd: P.claim }] },
      { key: "staking" as const, abi: stakingAbi, fn: "repegSnackPrice" as const,
        points: [{ item: "snack", currentWei: params.wei.snack, targetUsd: P.snack }] },
      { key: "prestige" as const, abi: prestigeAbi, fn: "repegFees" as const,
        points: [
          { item: "prestige", currentWei: params.wei.prestigeFee, targetUsd: DEFAULT_PARAMS.prestige.commitFeeUsd },
          { item: "prestigeSnack", currentWei: params.wei.prestigeSnackCost, targetUsd: snackUsd },
        ] },
    ] satisfies { key: string; abi: unknown; fn: string; points: PricePoint[] }[];

    const w = createWalletClient({
      account,
      chain: ACTIVE_CHAIN,
      transport: rpcTransport(process.env.NEXT_PUBLIC_RPC_URL || undefined),
    }).extend(publicActions);

    for (const t of targets) {
      const address = addressOf(t.key);
      const [wired, maxMoveBps] = await Promise.all([
        client.readContract({ address, abi: t.abi as typeof lettersAbi, functionName: "priceKeeper" }) as Promise<string>,
        client.readContract({ address, abi: t.abi as typeof lettersAbi, functionName: "maxMoveBps" }) as Promise<number>,
      ]);
      if (wired.toLowerCase() !== account.address.toLowerCase()) {
        console.log(`repeg: ${t.key} — this key is not its priceKeeper (${wired}); skipped`);
        continue;
      }
      const plan = planRepeg(live, t.points, Number(maxMoveBps));
      if (!plan.ok) return void console.log(`repeg: no moves — ${plan.reason}`); // same reason for every contract
      if (plan.moves.length === 0) {
        console.log(`repeg: ${t.key} — within the drift threshold`);
        continue;
      }
      const next = t.points.map((p) => plan.moves.find((m) => m.item === p.item)?.toWei ?? p.currentWei);
      for (const m of plan.moves) {
        console.log(`repeg: ${t.key}.${m.item} ${m.fromWei / 10n ** 18n} → ${m.toWei / 10n ** 18n} $WORD${m.clamped ? " (clamped; continues next run)" : ""}`);
      }
      if (DRY) continue;
      const hash = await w.writeContract({
        dataSuffix: BUILDER_DATA_SUFFIX, // ERC-8021: the keeper's writes are app writes too
        address, abi: t.abi as typeof lettersAbi, functionName: t.fn as "repegPrices",
        args: next as [bigint, bigint],
      });
      const rcpt = await w.waitForTransactionReceipt({ hash });
      console.log(`repeg: ${t.key} ${rcpt.status} in block ${rcpt.blockNumber} (${hash})`);
    }
  }

  /**
   * Route the word-sale fees into the Rewards Pool (SaleFees.flush, decisions.md #18). It runs just
   * before `yield`, so a day's fees are in the pool that day's epoch is opened from. Anyone may
   * flush; the keeper is the one that always does. Skips when nothing waits, or where SaleFees isn't
   * deployed yet.
   */
  async function flushSaleFees() {
    let saleFees: `0x${string}`;
    try {
      saleFees = addressOf("saleFees");
    } catch {
      return void console.log("fees: SaleFees isn't deployed on this network; skipped");
    }
    const pending = (await getPublicClient().readContract({
      address: wordTokenAddress(), abi: erc20Abi, functionName: "balanceOf", args: [saleFees],
    })) as bigint;
    if (pending === 0n) return void console.log("fees: no sale fees waiting");
    console.log(`fees: ${(pending / 10n ** 18n).toLocaleString("en-US")} $WORD of sale fees → the Rewards Pool`);
    if (DRY) return;
    const w = wallet();
    const hash = await w.writeContract({
      dataSuffix: BUILDER_DATA_SUFFIX, // ERC-8021: the keeper's writes are app writes too
      address: saleFees, abi: saleFeesAbi, functionName: "flush",
    });
    const rcpt = await w.waitForTransactionReceipt({ hash });
    console.log(`fees: flush ${rcpt.status} in block ${rcpt.blockNumber} (${hash})`);
  }

  /**
   * The Shop's daily upkeep (decisions.md #22), in the `fees` job right after SaleFees.flush, so both
   * reach the pool before `yield` opens the day's epoch. Each step is on its own: a failed sweep never
   * skips the wardrobe or the picks, and none of them skips the flush.
   * - sweep: the USDC whose swap waited, at most the Shop's `maxSweepUsdc` a run (the rest waits for
   *   tomorrow's run, or anyone's sweep), with a minimum from the live price on mainnet. A no-op when
   *   nothing waits or the Shop isn't deployed.
   * - the wardrobe: Purchased events it hasn't read (a reader's catch-up does the same).
   * - picks: scene picks come off words that left their profile (staking and Move keep them).
   */
  async function shopUpkeep() {
    const shop = shopAddress();
    if (shop) {
      try {
        const client = getPublicClient();
        const [pending, cap] = await Promise.all([
          client.readContract({ address: shop, abi: shopAbi, functionName: "pendingUsdc" }) as Promise<bigint>,
          client.readContract({ address: shop, abi: shopAbi, functionName: "maxSweepUsdc" }) as Promise<bigint>,
        ]);
        if (pending < MIN_SWEEP_USDC) {
          console.log("shop: no waiting USDC to sweep");
        } else {
          const usdcIn = pending < cap ? pending : cap;
          const price = await fetchWordPrice();
          const minWordOut = sweepMinWordOut({
            usdcIn,
            wordPerUsd: price.wordPerUsd,
            live: price.source !== "fallback",
            isTestnet: NETWORK.isTestnet,
          });
          console.log(`shop: sweep ${(Number(usdcIn) / 1e6).toFixed(2)} USDC of ${(Number(pending) / 1e6).toFixed(2)} waiting → the Rewards Pool`);
          if (!DRY) {
            const w = wallet();
            const hash = await w.writeContract({
              dataSuffix: BUILDER_DATA_SUFFIX, // ERC-8021: the keeper's writes are app writes too
              address: shop, abi: shopAbi, functionName: "sweep", args: [minWordOut],
            });
            const rcpt = await w.waitForTransactionReceipt({ hash });
            console.log(`shop: sweep ${rcpt.status} in block ${rcpt.blockNumber} (${hash})`);
          }
        }
      } catch (err) {
        console.error("shop: sweep failed (the USDC keeps waiting):", String((err as Error)?.message ?? err).slice(0, 200));
      }
      try {
        const r = DRY ? null : await catchUpWardrobe();
        if (r) console.log(`shop: wardrobe recorded ${r.recorded} purchase(s), through block ${r.through}`);
      } catch (err) {
        console.error("shop: wardrobe catch-up failed:", String((err as Error)?.message ?? err).slice(0, 200));
      }
    } else {
      console.log("shop: the Shop isn't deployed on this network; skipped");
    }
    try {
      // The STRICT link read: a failed read must skip this step, never read as "no links" (then every
      // linked wallet's profile would look like another profile, and its picks would all go).
      const [words, links] = await Promise.all([scanAllWords(), loadLinkMapStrict()]);
      const held = holderProfiles(words, links.accountOf);
      if (DRY) return void console.log(`shop: ${held.size} held words checked for picks (dry run)`);
      const cleared = await clearPicksOffLeftWords(held, links.accountOf);
      console.log(`shop: ${cleared} pick(s) taken off words that left their profile`);
    } catch (err) {
      console.error("shop: clearing picks failed:", String((err as Error)?.message ?? err).slice(0, 200));
    }
  }

  /**
   * The Market's recent sales (decisions.md #30): read any sale the table hasn't seen. The Market's
   * own route does the same on a visit; this covers a day nobody opened it. Reads, then tells the
   * sellers of what it found.
   */
  async function marketSales() {
    // Recording a sale is what makes it "new", once: a dry run that recorded it could only log the
    // message, and the real run after it would find nothing new to tell the seller of.
    if (DRY) return void console.log("market: [dry] sales not read (recording one uses up its seller's notification)");
    try {
      // Each sale's seller is told as it is recorded, before the pass reads on: a sale is new only
      // once, so a pass stopped part way must already have told what it recorded
      // (lib/notify/sold.ts: recent sales only; it never throws).
      const got = await catchUpSales({ onNew: async (rows: SaleRow[]) => void (await notifySold(rows)) });
      console.log(got ? `market: ${got.recorded} new sale${got.recorded === 1 ? "" : "s"}, read through block ${got.through}` : "market: SaleFees isn't deployed here");
    } catch (err) {
      console.error("market: reading sales failed:", String((err as Error)?.message ?? err).slice(0, 200));
    }
  }

  /** The `fees` job: the sale fees, then the Shop, then the Market's sales. A failed step never skips the next. */
  async function feesJob() {
    try {
      await flushSaleFees();
    } catch (err) {
      console.error("fees: flush failed:", String((err as Error)?.message ?? err).slice(0, 200));
    }
    await shopUpkeep();
    if (!DRY) await marketSales();
  }

  return {
    resolveJackpot,
    flushSaleFees,
    shopUpkeep,
    openStream,
    payOut,
    attestAchievements,
    notifyHunger,
    announce,
    repegPrices,
    /** One named job, for the schedulers. */
    run(job: KeeperJob): Promise<void> {
      switch (job) {
        case "resolve":
          return resolveJackpot();
        case "fees":
          return feesJob();
        case "yield":
          return openStream("yield");
        case "bounty":
          return openStream("bounty");
        case "payout":
          return payOut();
        case "achievements":
          return attestAchievements();
        case "repeg":
          return repegPrices();
        case "notify":
          return notifyJob();
      }
    },
  };
}
