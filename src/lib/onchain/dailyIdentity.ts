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
 */
import { fidsByAddress, lookupProfiles } from "@/lib/neynar";
import { xUserIdsFor } from "@/lib/db/profiles";
import { profilesEnabled } from "@/lib/profile/session";
import { verifiedDailyKey, xDailyKey } from "./verifications";

/** Pure: the keys for a set of FIDs, wallets, and X ids. Exported for tests. */
export function keysFrom(fids: Iterable<number>, wallets: Iterable<string>, xIds: Iterable<string>): bigint[] {
  const out = new Set<bigint>();
  for (const f of fids) out.add(BigInt(f));
  for (const w of wallets) out.add(verifiedDailyKey(w));
  for (const x of xIds) out.add(xDailyKey(x));
  return [...out];
}

export async function relatedDailyKeys(opts: { fid: number | null; wallet: string }): Promise<bigint[]> {
  const fids = new Set<number>(opts.fid ? [opts.fid] : []);
  for (const f of await fidsByAddress(opts.wallet)) fids.add(f);
  const wallets = new Set<string>([opts.wallet.toLowerCase()]);
  if (fids.size > 0) for (const p of await lookupProfiles([...fids]).catch(() => [])) for (const w of p.linkedWallets) wallets.add(w);
  const xIds = profilesEnabled() ? await xUserIdsFor([...wallets]).catch(() => new Map<string, string>()) : new Map<string, string>();
  return keysFrom(fids, wallets, xIds.values());
}
