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
  const { wallets: account } = await accountWallets(opts.wallet);
  const fids = new Set<number>(opts.fid ? [opts.fid] : []);
  for (const list of (await fidsByAddresses(account).catch(() => new Map<string, number[]>())).values()) for (const f of list) fids.add(f);
  const wallets = new Set<string>(account);
  if (fids.size > 0) for (const p of await lookupProfiles([...fids]).catch(() => [])) for (const w of p.linkedWallets) wallets.add(w);
  const xIds = profilesEnabled() ? await xUserIdsFor([...wallets]).catch(() => new Map<string, string>()) : new Map<string, string>();
  return keysFrom(fids, wallets, xIds.values());
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
