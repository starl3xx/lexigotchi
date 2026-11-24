/**
 * Every daily key that belongs to the player behind a daily request, for the one-letter-a-day rule.
 * Server-only.
 *
 * A request shows only part of a player: a Farcaster sign-in (or not) and one wallet. But the same
 * player may have pulled today under a FID in the mini app and now be on the web, unsigned, with a
 * wallet whose X or Coinbase key would issue a second letter (Bugbot on #138). So the server walks
 * one hop each way: the FIDs that verified this wallet, every wallet those FIDs verified, and each
 * wallet's Coinbase key and linked X key. A lookup that fails just adds fewer keys (a Neynar
 * outage never blocks a daily).
 *
 * Linked wallets (lib/db/walletLinks.ts) join at the start: every wallet in this wallet's account,
 * then the FIDs that verified any of them. Still one hop, and capped (MAX_ACCOUNT_WALLETS). Linking
 * never creates a key of its own: the daily is always signed under a FID, an X account, or a
 * Coinbase-verified wallet, so letters a day can't exceed the identities a player actually proves.
 */
import { fidsByAddresses, lookupProfiles } from "@/lib/neynar";
import { accountWallets } from "@/lib/db/walletLinks";
import { xUserIdsFor } from "@/lib/db/profiles";
import { profilesEnabled } from "@/lib/profile/session";
import { verifiedDailyKey, xDailyKey } from "./verifications";
import { addressOf, isSuiteDeployed } from "./addresses";
import { lettersAbi } from "./abis";
import { getPublicClient, readChainTime } from "./reads";
import { NETWORK } from "./network";
import { readDraw } from "@/lib/db/draws";

/** Pure: the keys for a set of FIDs, wallets, and X ids. Exported for tests. */
export function keysFrom(fids: Iterable<number>, wallets: Iterable<string>, xIds: Iterable<string>): bigint[] {
  const out = new Set<bigint>();
  for (const f of fids) out.add(BigInt(f));
  for (const w of wallets) out.add(verifiedDailyKey(w));
  for (const x of xIds) out.add(xDailyKey(x));
  return [...out];
}

export async function relatedDailyKeys(opts: { fid: number | null; wallet: string }): Promise<bigint[]> {
  const { wallets } = await accountWallets(opts.wallet);
  return (await relatedDailyKeysMany([{ fid: opts.fid, wallets }]))[0];
}

/** Where a key walk starts: a FID the player signed in with (or none), and their account's wallets. */
export interface KeyStart {
  fid: number | null;
  wallets: readonly string[];
}

/**
 * Pure: the walk, given its lookups. One hop each way from each start: the FIDs that verified any of
 * its wallets, every wallet those FIDs verified, and each wallet's Coinbase key and X key. Exported
 * for tests; `relatedDailyKeysMany` feeds it.
 */
export function relatedKeysFrom(
  starts: readonly KeyStart[],
  fidsOfWallet: ReadonlyMap<string, readonly number[]>,
  walletsOfFid: ReadonlyMap<number, readonly string[]>,
  xIdOfWallet: ReadonlyMap<string, string>,
): bigint[][] {
  return starts.map((s) => {
    const fids = new Set<number>(s.fid ? [s.fid] : []);
    for (const w of s.wallets) for (const f of fidsOfWallet.get(w.toLowerCase()) ?? []) fids.add(f);
    const wallets = new Set<string>(s.wallets.map((w) => w.toLowerCase()));
    for (const f of fids) for (const w of walletsOfFid.get(f) ?? []) wallets.add(w.toLowerCase());
    const xIds = [...wallets].flatMap((w) => {
      const x = xIdOfWallet.get(w);
      return x ? [x] : [];
    });
    return keysFrom(fids, wallets, xIds);
  });
}

/**
 * The same walk for many players at once (the reminder cron): one batched lookup per hop instead of
 * one per player. A lookup that fails adds fewer keys, as in the daily route; for a reminder that
 * means at worst one extra nudge, never a missed one.
 */
export async function relatedDailyKeysMany(starts: readonly KeyStart[]): Promise<bigint[][]> {
  const lower = (a: string) => a.toLowerCase();
  const startWallets = [...new Set(starts.flatMap((s) => s.wallets.map(lower)))];
  const fidsRaw = startWallets.length ? await fidsByAddresses(startWallets).catch(() => new Map<string, number[]>()) : new Map<string, number[]>();
  const fidsOfWallet = new Map([...fidsRaw.entries()].map(([w, f]) => [lower(w), f]));
  const allFids = new Set<number>();
  for (const s of starts) {
    if (s.fid) allFids.add(s.fid);
    for (const w of s.wallets) for (const f of fidsOfWallet.get(lower(w)) ?? []) allFids.add(f);
  }
  const profiles = allFids.size ? await lookupProfiles([...allFids]).catch(() => []) : [];
  const walletsOfFid = new Map(profiles.map((p) => [p.fid, p.linkedWallets.map(lower)]));
  const everyWallet = new Set(startWallets);
  for (const list of walletsOfFid.values()) for (const w of list) everyWallet.add(w);
  const xIdOfWallet = profilesEnabled() && everyWallet.size
    ? await xUserIdsFor([...everyWallet]).catch(() => new Map<string, string>())
    : new Map<string, string>();
  return relatedKeysFrom(starts, fidsOfWallet, walletsOfFid, xIdOfWallet);
}

/**
 * Did this X account's key take today's daily, or get a voucher for it? Unlinking, moving, or
 * replacing such an account waits for tomorrow: once it leaves the wallet, its key drops out of the
 * wallet's one-letter check, and the same wallet could pull again today on Farcaster or Coinbase
 * (Bugbot on #138). A voucher counts too: it's valid for ten minutes before the chain spends the
 * slot, and the daily route stores its draw (`d:<key>:<day>`, letter_draws) as it signs. Throws if
 * the chain can't say.
 */
export async function xKeyUsedToday(xUserId: string): Promise<boolean> {
  if (!isSuiteDeployed()) return false;
  const key = xDailyKey(xUserId);
  const [now, used] = await Promise.all([
    readChainTime(),
    getPublicClient().readContract({ address: addressOf("letters"), abi: lettersAbi, functionName: "dailyUsed", args: [key] }),
  ]);
  const today = Math.floor(now / 86_400);
  if (Number(used) === today + 1) return true;
  const issued = await readDraw(NETWORK.id, `d:${key}:${today}`).catch(() => null);
  return issued !== null;
}

/**
 * Did this account take today's free letter, or get a voucher for it, under any of its keys? While
 * it did, no wallet can leave the account: a wallet that leaves takes its keys out of the account's
 * one-letter check, and could pull again today on its own Farcaster, X, or Coinbase key. The same
 * rule as moving an X account (xKeyUsedToday). Throws if the chain can't say: the caller refuses.
 */
export async function accountClaimedToday(account: string): Promise<boolean> {
  if (!isSuiteDeployed()) return false;
  const keys = await relatedDailyKeys({ fid: null, wallet: account });
  const letters = addressOf("letters");
  const [now, used] = await Promise.all([
    readChainTime(),
    getPublicClient().multicall({
      allowFailure: false,
      contracts: keys.map((k) => ({ address: letters, abi: lettersAbi, functionName: "dailyUsed" as const, args: [k] })),
    }) as Promise<(number | bigint)[]>,
  ]);
  const today = Math.floor(now / 86_400);
  if (used.some((u) => Number(u) === today + 1)) return true;
  for (const k of keys) if (await readDraw(NETWORK.id, `d:${k}:${today}`)) return true;
  return false;
}
