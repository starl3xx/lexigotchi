import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { addressOf, isSuiteDeployed } from "@/lib/onchain/addresses";
import { lettersAbi } from "@/lib/onchain/abis";
import { getPublicClient, readChainTime } from "@/lib/onchain/reads";
import { relatedDailyKeys } from "@/lib/onchain/dailyIdentity";
import { NETWORK } from "@/lib/onchain/network";
import { accountWallets } from "@/lib/db/walletLinks";
import { freeDailiesTaken, freeLettersSigned, freePackTaken, recordedFreeKey } from "@/lib/db/freeClaims";
import { settleGrants } from "@/lib/onchain/freeLedger";
import { claimedWordCount } from "@/lib/onchain/claimedWords";
import { dailiesLeft, freeLetterBudget, freeStop, FREE_LETTERS, type FreeStop } from "@/lib/freeLetters";
import { WORD_COUNT } from "@/lib/dictionary";
import { DEFAULT_PARAMS } from "@/lib/params";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export interface DailyStatus {
  ok: true;
  /** Took today's daily under ANY key the daily route counts. */
  claimed: boolean;
  /** Free daily letters this profile has taken, of `dailyLimit` (null: can't count yet). */
  dailyTaken: number | null;
  dailyLimit: number;
  /** All 10 taken: the server signs no more dailies for this profile (decisions.md #21). */
  done: boolean;
  /** The profile took its free pack (any key, or its record). */
  packTaken: boolean;
  /** Why new free letters stop for everyone, or null. A pack also stops when fewer than 5 are left. */
  stop: FreeStop;
  packStop: FreeStop;
  /** The dictionary is about 95% claimed (the pack-buy card points at the Market). */
  dictionaryFull: boolean;
}

/**
 * GET `?wallet=0x…[&fid=123]` → the player's free letters: today's daily (under ANY key the daily route
 * would count: relatedDailyKeys walks the FIDs that verified the wallet, those FIDs' other wallets,
 * every Coinbase and X key), how many of the 10 free dailies the profile has taken (`done` after the
 * 10th), whether it took its free pack, and whether free letters have stopped (the budget, or the
 * dictionary about 95% claimed). The client can't walk Farcaster on its own, so without this a player
 * who pulled in the mini app would see Pull on the web and get refused (Bugbot on #138).
 *
 * Read-only for the player: `fid` only adds keys to read, it unlocks nothing. It does settle this
 * profile's expired grants against the chain (bookkeeping the next voucher request would do anyway).
 */
export async function GET(req: Request) {
  const limit = DEFAULT_PARAMS.freeLetters.freeDailyLimit;
  if (!isSuiteDeployed()) {
    return NextResponse.json({ ok: true, claimed: false, dailyTaken: null, dailyLimit: limit, done: false, packTaken: false, stop: null, packStop: null, dictionaryFull: false } satisfies DailyStatus);
  }
  const u = new URL(req.url);
  const wallet = u.searchParams.get("wallet") ?? "";
  const fidRaw = Number(u.searchParams.get("fid"));
  if (!isAddress(wallet)) return NextResponse.json({ ok: false, error: "bad_wallet" }, { status: 400 });
  const fid = Number.isInteger(fidRaw) && fidRaw > 0 && fidRaw < 2 ** 32 ? fidRaw : null;
  try {
    const [related, now, { account }] = await Promise.all([relatedDailyKeys({ fid, wallet }), readChainTime(), accountWallets(wallet)]);
    const today = Math.floor(now / 86_400);
    // The key this PROFILE took today's letter under (lib/db/freeClaims.ts), whatever the walk finds:
    // the walk needs Farcaster's lookups, and a failed one would show Pull to a profile that pulled.
    const [recorded, recordedPack] = await Promise.all([
      recordedFreeKey(NETWORK.id, account, "daily", today),
      recordedFreeKey(NETWORK.id, account, "pack", 0),
    ]);
    const keys = [...new Set([...related, ...(recorded !== null ? [recorded] : []), ...(recordedPack !== null ? [recordedPack] : [])])];
    const letters = addressOf("letters");
    const reads = (await getPublicClient().multicall({
      allowFailure: false,
      contracts: keys.flatMap((k) => [
        { address: letters, abi: lettersAbi, functionName: "dailyUsed" as const, args: [k] },
        { address: letters, abi: lettersAbi, functionName: "freePackClaimed" as const, args: [k] },
      ]),
    })) as unknown as (number | bigint | boolean)[];
    const claimed = keys.some((_, i) => Number(reads[i * 2]) === today + 1);
    const packOnchain = keys.some((_, i) => Boolean(reads[i * 2 + 1]));

    await settleGrants(NETWORK.id, account);
    const [taken, packRecorded, signed, claimedWords] = await Promise.all([
      freeDailiesTaken(NETWORK.id, account).catch(() => null),
      freePackTaken(NETWORK.id, account).catch(() => null),
      freeLettersSigned(NETWORK.id).catch(() => null),
      claimedWordCount(),
    ]);
    const left = dailiesLeft(taken);
    const budget = freeLetterBudget();
    const stopFor = (n: number) => freeStop({ claimed: claimedWords, dictionary: WORD_COUNT, signed, budget, letters: n });
    const body: DailyStatus = {
      ok: true,
      claimed,
      dailyTaken: taken,
      dailyLimit: limit,
      done: left === 0,
      packTaken: packOnchain || Boolean(packRecorded),
      stop: stopFor(FREE_LETTERS.daily),
      packStop: stopFor(FREE_LETTERS.pack),
      dictionaryFull: stopFor(0) === "dictionary",
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "private, max-age=20" } });
  } catch (err) {
    console.error("[daily-status] failed:", String((err as Error)?.message ?? err).slice(0, 120));
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
