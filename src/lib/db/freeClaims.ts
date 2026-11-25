/**
 * Free things, once per PROFILE (schema `freeClaims`, migration 0013; starl3xx: "only one wallet per
 * profile should get a free anything"). A free route records the account and the key it signs under;
 * the first key wins. A different key is refused, so a profile's other wallets can't take a second
 * one, even when the Farcaster lookups behind the onchain checks fail. One exception keeps a lost
 * voucher from costing the player: when the recorded voucher expired unused (its key never reached the
 * chain), another key may take over.
 *
 * Kinds: "daily" (period = the UTC chain day) and "pack" (period 0, once ever).
 * Before the migration (no table), every call answers "skipped" and the route relies on the onchain
 * checks alone, as before. Any other database error throws: the route refuses rather than sign twice.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./client";
import { freeClaims } from "./schema";
import { isMissingTable } from "./profiles";

export type FreeKind = "daily" | "pack";
export type FreeClaim = "ok" | "taken" | "skipped";

const whereOf = (chainId: number, account: string, kind: FreeKind, period: number) =>
  and(eq(freeClaims.chainId, chainId), eq(freeClaims.account, account.toLowerCase()), eq(freeClaims.kind, kind), eq(freeClaims.period, period));

/** The key this profile took the free thing under, or null (none yet, or no table). Never throws. */
export async function recordedFreeKey(chainId: number, account: string, kind: FreeKind, period: number): Promise<bigint | null> {
  try {
    const [row] = await getDb().select({ claimKey: freeClaims.claimKey }).from(freeClaims).where(whereOf(chainId, account, kind, period)).limit(1);
    return row ? BigInt(row.claimKey) : null;
  } catch {
    return null;
  }
}

export async function claimFree(opts: {
  chainId: number;
  account: string;
  kind: FreeKind;
  period: number;
  key: bigint;
  /** Seconds a voucher stays spendable: an older claim whose key never reached the chain can be taken over. */
  voucherTtlSeconds: number;
  /** Did this key take the free thing onchain? */
  usedOnchain: (key: bigint) => Promise<boolean>;
}): Promise<FreeClaim> {
  const account = opts.account.toLowerCase();
  const where = whereOf(opts.chainId, account, opts.kind, opts.period);
  try {
    const inserted = await getDb()
      .insert(freeClaims)
      .values({ chainId: opts.chainId, account, kind: opts.kind, period: opts.period, claimKey: opts.key.toString() })
      .onConflictDoNothing()
      .returning({ claimKey: freeClaims.claimKey });
    if (inserted.length > 0) return "ok";
    const [row] = await getDb().select({ claimKey: freeClaims.claimKey, claimedAt: freeClaims.claimedAt }).from(freeClaims).where(where).limit(1);
    if (!row) return "taken"; // vanished under us: refuse, the player retries
    if (row.claimKey === opts.key.toString()) return "ok"; // the same identity asking again
    const expired = Date.now() - row.claimedAt.getTime() > opts.voucherTtlSeconds * 1000;
    if (!expired || (await opts.usedOnchain(BigInt(row.claimKey)))) return "taken";
    // The first voucher expired unused: this key takes over (compare-and-set on the old key).
    const moved = await getDb()
      .update(freeClaims)
      .set({ claimKey: opts.key.toString(), claimedAt: sql`now()` })
      .where(and(where, eq(freeClaims.claimKey, row.claimKey)))
      .returning({ claimKey: freeClaims.claimKey });
    return moved.length > 0 ? "ok" : "taken";
  } catch (err) {
    if (isMissingTable(err)) return "skipped";
    throw err;
  }
}
