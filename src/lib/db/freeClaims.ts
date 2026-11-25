/**
 * Free things, once per PROFILE (schema `freeClaims`, migration 0013; starl3xx: "only one wallet per
 * profile should get a free anything"). A free route records the account and the key it signs under;
 * the first key wins. A different key is refused, so a profile's other wallets can't take a second
 * one, even when the Farcaster lookups behind the onchain checks fail. One exception keeps a lost
 * voucher from costing the player: when the recorded voucher expired unused (its key never reached the
 * chain), another key may take over.
 *
 * Kinds: "daily" (period = the UTC chain day) and "pack" (period 0, once ever).
 *
 * It is also the free-letter LEDGER (migration 0015, decisions.md #21): each row gives `letters` (1 or
 * 5), counts toward the budget from the moment it is signed, and is settled once its voucher expires:
 * `used` true if the key reached the chain, false if not (the letters go back, and a daily's day stops
 * counting toward the profile's 10). Unsettled rows count, the safe side for a budget. A database
 * without 0015 reads as "can't count" (null), and the routes skip those rules, as they do without 0013.
 *
 * Only a key that BELONGS to the profile is recorded (the caller decides: `keyOwnedByProfile`): the
 * request's wallet is the client's word, so a stranger's own Farcaster sign-in naming someone else's
 * wallet must not plant its key on that profile and hold its free claim (Bugbot on #178).
 * Before the migration (no table), every call answers "skipped" and the route relies on the onchain
 * checks alone, as before. Any other database error throws: the route refuses rather than sign twice.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./client";
import { freeClaims } from "./schema";
import { isMissingTable } from "./profiles";

/** A table (0013) or a column (0015) this code expects isn't there yet: the migration hasn't run. */
export function isMissingSchema(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return isMissingTable(err) || e?.code === "42703" || e?.cause?.code === "42703";
}

/** Rows that count: settled used, or not settled yet. */
const counts = sql`${freeClaims.used} IS DISTINCT FROM false`;

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

/**
 * This profile's grant for (kind, period), and whether it counts (settled used, or not settled yet),
 * or null. Never throws. Without migration 0015 a recorded grant reads as counting.
 */
export async function recordedFreeGrant(chainId: number, account: string, kind: FreeKind, period: number): Promise<{ key: bigint; counts: boolean } | null> {
  try {
    const [row] = await getDb().select({ claimKey: freeClaims.claimKey, used: freeClaims.used }).from(freeClaims).where(whereOf(chainId, account, kind, period)).limit(1);
    return row ? { key: BigInt(row.claimKey), counts: row.used !== false } : null;
  } catch (err) {
    if (isMissingSchema(err) && !isMissingTable(err)) {
      const key = await recordedFreeKey(chainId, account, kind, period);
      return key === null ? null : { key, counts: true };
    }
    return null;
  }
}

export async function claimFree(opts: {
  chainId: number;
  account: string;
  kind: FreeKind;
  period: number;
  key: bigint;
  /** Letters this grant gives (1 for a daily, 5 for the pack): the ledger's amount. */
  letters: number;
  /** The voucher's deadline: after it, the row is settled against the chain. */
  expiresAt: Date;
  /** The wallet the voucher pays (its buyer): ties a grant on another ledger account to the profile. */
  wallet: string;
  /** Seconds a voucher stays spendable: an older claim whose key never reached the chain can be taken over. */
  voucherTtlSeconds: number;
  /** Did this key take the free thing onchain? */
  usedOnchain: (key: bigint) => Promise<boolean>;
}): Promise<FreeClaim> {
  try {
    return await claimFreeWith(opts, true);
  } catch (err) {
    // A database with 0013 but not 0015 (the ledger columns): keep recording the profile's claim the
    // way it did before, so merging ahead of the migration never switches the record off.
    if (isMissingSchema(err) && !isMissingTable(err)) {
      try {
        return await claimFreeWith(opts, false);
      } catch (e) {
        if (isMissingSchema(e)) return "skipped";
        throw e;
      }
    }
    if (isMissingSchema(err)) return "skipped";
    throw err;
  }
}

async function claimFreeWith(opts: Parameters<typeof claimFree>[0], ledger: boolean): Promise<FreeClaim> {
  const account = opts.account.toLowerCase();
  const where = whereOf(opts.chainId, account, opts.kind, opts.period);
  const fresh = ledger ? { letters: opts.letters, expiresAt: opts.expiresAt, used: null, wallet: opts.wallet.toLowerCase() } : {};
  // Drizzle's insert names EVERY schema column (DEFAULT for the ones not given), so the pre-0015
  // insert is raw SQL with 0013's columns only.
  const inserted = ledger
    ? await getDb()
        .insert(freeClaims)
        .values({ chainId: opts.chainId, account, kind: opts.kind, period: opts.period, claimKey: opts.key.toString(), ...fresh })
        .onConflictDoNothing()
        .returning({ claimKey: freeClaims.claimKey })
    : await getDb().execute(
        sql`insert into ${freeClaims} (chain_id, account, kind, period, claim_key) values (${opts.chainId}, ${account}, ${opts.kind}, ${opts.period}, ${opts.key.toString()}) on conflict do nothing returning claim_key`,
      );
  if (inserted.length > 0) return "ok";
  const [row] = await getDb().select({ claimKey: freeClaims.claimKey, claimedAt: freeClaims.claimedAt }).from(freeClaims).where(where).limit(1);
  if (!row) return "taken"; // vanished under us: refuse, the player retries
  if (row.claimKey === opts.key.toString()) {
    // The same identity asking again gets a fresh voucher, so the takeover window restarts from now
    // (Bugbot on #178: a stale time let a second key in while the retried voucher was spendable), and
    // the grant counts again until its new voucher is settled.
    await getDb()
      .update(freeClaims)
      .set({ claimedAt: sql`now()`, ...fresh })
      .where(and(where, eq(freeClaims.claimKey, row.claimKey)));
    return "ok";
  }
  const expired = Date.now() - row.claimedAt.getTime() > opts.voucherTtlSeconds * 1000;
  if (!expired || (await opts.usedOnchain(BigInt(row.claimKey)))) return "taken";
  // The first voucher expired unused: this key takes over. Compare-and-set on the old key AND on the
  // row still being expired when written, so a same-key retry that refreshed it meanwhile wins
  // (Bugbot on #178: matching the key alone let a takeover overwrite a just-refreshed voucher).
  const moved = await getDb()
    .update(freeClaims)
    .set({ claimKey: opts.key.toString(), claimedAt: sql`now()`, ...fresh })
    .where(
      and(
        where,
        eq(freeClaims.claimKey, row.claimKey),
        sql`${freeClaims.claimedAt} < now() - make_interval(secs => ${opts.voucherTtlSeconds})`,
      ),
    )
    .returning({ claimKey: freeClaims.claimKey });
  return moved.length > 0 ? "ok" : "taken";
}

/**
 * The ledger account for a Farcaster sign-in whose FID never verified the profile's wallets: its
 * grants can't be recorded ON that profile (a stranger's sign-in must not plant its key there), but
 * they still count toward the 10 and the budget, under an account of the FID's own.
 */
export const fidLedgerAccount = (fid: number) => `fid:${fid}`;

/** How long after a voucher's deadline its grant is settled (stale RPC reads after a send). */
export const SETTLE_GRACE_SECONDS = 300;

/** An expired, unsettled grant, as the settle check sees it. */
export interface PendingGrant {
  account: string;
  kind: FreeKind;
  period: number;
  key: bigint;
}

/**
 * Settle grants whose voucher has expired: ask the chain (`check`, in the same order) whether each
 * key took its letters, and record the answer. Bounded by `limit` per call. Never throws: a grant
 * left unsettled still counts, which only errs toward giving fewer free letters.
 */
export async function settleFreeClaims(opts: {
  chainId: number;
  /** Only this profile's grants (the one asking), else the oldest anywhere (the budget). */
  account?: string;
  limit: number;
  check: (rows: readonly PendingGrant[]) => Promise<readonly boolean[]>;
}): Promise<number> {
  try {
    // Only vouchers expired a while ago: a public RPC can answer from a node that hasn't seen a
    // just-mined transaction, and a grant settled as unused is final. A row written without an
    // expiry (main's insert, before 0015) is taken to expire ten minutes after it was claimed.
    const conds = [
      eq(freeClaims.chainId, opts.chainId),
      sql`${freeClaims.used} IS NULL`,
      sql`coalesce(${freeClaims.expiresAt}, ${freeClaims.claimedAt} + interval '600 seconds') < now() - make_interval(secs => ${SETTLE_GRACE_SECONDS})`,
    ];
    if (opts.account) conds.push(eq(freeClaims.account, opts.account.toLowerCase()));
    const rows = await getDb()
      .select({ account: freeClaims.account, kind: freeClaims.kind, period: freeClaims.period, claimKey: freeClaims.claimKey })
      .from(freeClaims)
      .where(and(...conds))
      .orderBy(freeClaims.claimedAt)
      .limit(opts.limit);
    if (rows.length === 0) return 0;
    const pending = rows.map((r) => ({ account: r.account, kind: r.kind as FreeKind, period: r.period, key: BigInt(r.claimKey) }));
    const used = await opts.check(pending);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      await getDb()
        .update(freeClaims)
        .set({ used: Boolean(used[i]) })
        .where(and(whereOf(opts.chainId, r.account, r.kind as FreeKind, r.period), eq(freeClaims.claimKey, r.claimKey), sql`${freeClaims.used} IS NULL`));
    }
    return rows.length;
  } catch (err) {
    if (!isMissingSchema(err)) console.error("[free-claims] settle failed (grants stay counted):", String((err as Error)?.message ?? err).slice(0, 120));
    return 0;
  }
}

/** Every free letter signed and not given back, on this chain. Null without migration 0015. */
export async function freeLettersSigned(chainId: number): Promise<number | null> {
  try {
    const [row] = await getDb()
      .select({ n: sql<string>`coalesce(sum(${freeClaims.letters}), 0)` })
      .from(freeClaims)
      .where(and(eq(freeClaims.chainId, chainId), counts));
    return Number(row?.n ?? 0);
  } catch (err) {
    if (isMissingSchema(err)) return null;
    throw err;
  }
}

/** Free daily letters this profile has taken (every day, today's included). Null without migration 0015. */
export async function freeDailiesTaken(chainId: number, account: string): Promise<number | null> {
  try {
    const [row] = await getDb()
      .select({ n: sql<string>`count(*)` })
      .from(freeClaims)
      .where(and(eq(freeClaims.chainId, chainId), eq(freeClaims.account, account.toLowerCase()), eq(freeClaims.kind, "daily"), counts));
    return Number(row?.n ?? 0);
  } catch (err) {
    if (isMissingSchema(err)) return null;
    throw err;
  }
}

/** Has this profile taken its free pack (signed and not given back)? Null without migration 0015. */
export async function freePackTaken(chainId: number, account: string): Promise<boolean | null> {
  try {
    const rows = await getDb()
      .select({ k: freeClaims.claimKey })
      .from(freeClaims)
      .where(and(whereOf(chainId, account, "pack", 0), counts))
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    if (isMissingSchema(err)) return null;
    throw err;
  }
}

/** A grant as the cross-ledger rules read it (lib/freeLetters.ts). */
export interface GrantRow {
  account: string;
  kind: FreeKind;
  period: number;
  key: bigint;
  used: boolean | null;
  wallet: string | null;
}

const toGrant = (r: { account: string; kind: string; period: number; claimKey: string; used: boolean | null; wallet: string | null }): GrantRow => ({
  account: r.account,
  kind: r.kind as FreeKind,
  period: r.period,
  key: BigInt(r.claimKey),
  used: r.used,
  wallet: r.wallet,
});
const grantCols = { account: freeClaims.account, kind: freeClaims.kind, period: freeClaims.period, claimKey: freeClaims.claimKey, used: freeClaims.used, wallet: freeClaims.wallet };

/** The days a ledger account's free dailies count for. Null without migration 0015. */
export async function dailyPeriods(chainId: number, account: string): Promise<number[] | null> {
  try {
    const rows = await getDb()
      .select({ period: freeClaims.period })
      .from(freeClaims)
      .where(and(eq(freeClaims.chainId, chainId), eq(freeClaims.account, account.toLowerCase()), eq(freeClaims.kind, "daily"), counts));
    return rows.map((r) => r.period);
  } catch (err) {
    if (isMissingSchema(err)) return null;
    throw err;
  }
}

/**
 * Grants recorded on OTHER ledger accounts that paid one of `wallets` (a profile's): an unverified
 * FID's grants, which belong to the profile whose wallet they paid (Bugbot on #199). Empty without
 * migration 0015 (no wallet column), or when there are none.
 */
export async function crossGrants(chainId: number, wallets: readonly string[], excludeAccounts: readonly string[]): Promise<GrantRow[]> {
  if (wallets.length === 0) return [];
  try {
    const rows = await getDb()
      .select(grantCols)
      .from(freeClaims)
      .where(
        and(
          eq(freeClaims.chainId, chainId),
          inArray(freeClaims.wallet, wallets.map((w) => w.toLowerCase())),
          ...(excludeAccounts.length ? [sql`${freeClaims.account} NOT IN (${sql.join(excludeAccounts.map((a) => sql`${a.toLowerCase()}`), sql`, `)})`] : []),
        ),
      );
    return rows.map(toGrant);
  } catch (err) {
    if (isMissingSchema(err)) return [];
    throw err;
  }
}

/** Every daily grant that counts, for the reminder's "finished" sets (lib/freeLetters.ts finishedProfiles). */
export async function countingDailyGrants(chainId: number): Promise<GrantRow[]> {
  try {
    const rows = await getDb()
      .select(grantCols)
      .from(freeClaims)
      .where(and(eq(freeClaims.chainId, chainId), eq(freeClaims.kind, "daily"), counts));
    return rows.map(toGrant);
  } catch (err) {
    if (!isMissingSchema(err)) console.error("[free-claims] daily grants read failed:", String((err as Error)?.message ?? err).slice(0, 120));
    return [];
  }
}

/** The ledger's totals for the admin Supply tab. Null without migration 0015. */
export async function freeLetterTotals(chainId: number): Promise<{ signed: number; packs: number; dailies: number; pending: number } | null> {
  try {
    const [row] = await getDb()
      .select({
        signed: sql<string>`coalesce(sum(${freeClaims.letters}) filter (where ${counts}), 0)`,
        packs: sql<string>`count(*) filter (where ${freeClaims.kind} = 'pack' and ${counts})`,
        dailies: sql<string>`count(*) filter (where ${freeClaims.kind} = 'daily' and ${counts})`,
        pending: sql<string>`coalesce(sum(${freeClaims.letters}) filter (where ${freeClaims.used} is null), 0)`,
      })
      .from(freeClaims)
      .where(eq(freeClaims.chainId, chainId));
    return { signed: Number(row?.signed ?? 0), packs: Number(row?.packs ?? 0), dailies: Number(row?.dailies ?? 0), pending: Number(row?.pending ?? 0) };
  } catch (err) {
    if (isMissingSchema(err)) return null;
    throw err;
  }
}

/**
 * Does `key` belong to the profile whose wallets are `accountWallets`? An X key or a Coinbase key the
 * route derived from the profile itself always does (pass `derivedFromProfile`). A FID does when it
 * verified one of the profile's wallets; when Farcaster can't be asked, it counts (a stranger can't
 * cause that outage, and the record is the backstop for exactly that case).
 */
export async function keyOwnedByProfile(opts: {
  fid: number | null;
  derivedFromProfile: boolean;
  accountWallets: readonly string[];
  lookup: (addresses: readonly string[]) => Promise<{ fids: Map<string, number[]>; answered: boolean }>;
}): Promise<boolean> {
  if (opts.fid === null) return opts.derivedFromProfile;
  try {
    const { fids, answered } = await opts.lookup(opts.accountWallets);
    if ([...fids.values()].some((list) => list.includes(opts.fid!))) return true;
    return !answered; // couldn't ask Farcaster in full: count it, as above
  } catch {
    return true;
  }
}
