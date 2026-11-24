/**
 * Farcaster wallets join the profile (starl3xx, 2026-11-24: "no matter how they first sign in,
 * their profile is built from that"). Server-only.
 *
 * A wallet joins an account automatically when ONE Farcaster account verified both it and a wallet
 * the account already has as its first wallet or by signature (Link another wallet). Farcaster's
 * verifications are the proof: each verified wallet signed "I am this FID". Two rules keep that
 * proof honest:
 * - No chaining: a wallet that joined through Farcaster never vouches for another. Only the first
 *   wallet and signature links ("seeds") do.
 * - No merging accounts: a wallet already in another account, heading one, or with its own X or
 *   email stays where it is (the same refusals as Link another wallet).
 * A Farcaster link leaves when its FID's verification of it (or of every seed) is gone, but only on
 * a POSITIVE answer from Farcaster about that FID (an outage must never empty an account), and never
 * on a day the account took its free letter (the same hold as Unlink).
 *
 * Adopted wallets are ordinary `wallet_links` rows (via "farcaster", with the vouching FID), so the
 * bag, the leaderboard, reminders, Move here, and the swap board all count them with no new lookups.
 */
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/lib/db/client";
import { profiles, walletLinks } from "@/lib/db/schema";
import { MAX_ACCOUNT_WALLETS, accountOf, withLinkLock } from "@/lib/db/walletLinks";
import { fidsByAddresses, lookupProfiles } from "@/lib/neynar";
import { accountClaimedToday } from "@/lib/onchain/dailyIdentity";

export interface LinkRowFull {
  address: string;
  account: string;
  via: string;
  fid: number | null;
}

export type SkipReason = "linked_elsewhere" | "has_wallets" | "has_profile" | "too_many";

export interface FarcasterPlan {
  adopt: { address: string; fid: number }[];
  prune: string[];
  skipped: { address: string; reason: SkipReason }[];
}

const lower = (a: string) => a.toLowerCase();

/** Pure: what to adopt, prune, and skip for `account`. Exported for tests. */
export function planFarcasterWallets(input: {
  account: string;
  /** Every link row whose address OR account is the account or a candidate. */
  rows: readonly LinkRowFull[];
  /** POSITIVE answers only: FID → the wallets it verified (lowercase). A FID missing here is unknown. */
  fidWallets: ReadonlyMap<number, readonly string[]>;
  /** Candidate wallets with their own X link or confirmed email. */
  hasOwnProfile: ReadonlySet<string>;
  /** Skip the prune pass (the account took today's letter, or that couldn't be checked). */
  holdPrune?: boolean;
  max?: number;
}): FarcasterPlan {
  const A = lower(input.account);
  const max = input.max ?? MAX_ACCOUNT_WALLETS;
  const mine = input.rows.filter((r) => lower(r.account) === A);
  const members = new Set([A, ...mine.map((r) => lower(r.address))]);
  const seeds = [A, ...mine.filter((r) => r.via !== "farcaster").map((r) => lower(r.address))];
  const vouches = (fid: number) => (input.fidWallets.get(fid) ?? []).some((w) => seeds.includes(lower(w)));

  // Prune: a Farcaster link whose FID answered, and no longer verifies it or any seed.
  const prune: string[] = [];
  if (!input.holdPrune) {
    for (const r of mine) {
      if (r.via !== "farcaster" || r.fid === null || !input.fidWallets.has(r.fid)) continue;
      const verified = (input.fidWallets.get(r.fid) ?? []).map(lower);
      if (!verified.includes(lower(r.address)) || !vouches(r.fid)) prune.push(lower(r.address));
    }
  }

  // Adopt: every wallet a vouching FID verified, in a fixed order (FID, then Farcaster's order).
  const adopt: FarcasterPlan["adopt"] = [];
  const skipped: FarcasterPlan["skipped"] = [];
  let size = members.size - prune.length;
  const seen = new Set<string>();
  const fids = [...input.fidWallets.keys()].filter(vouches).sort((a, b) => a - b);
  for (const fid of fids) {
    for (const raw of input.fidWallets.get(fid) ?? []) {
      const w = lower(raw);
      if (members.has(w) || seen.has(w)) continue;
      seen.add(w);
      const row = input.rows.find((r) => lower(r.address) === w);
      if (row && lower(row.account) !== A) skipped.push({ address: w, reason: "linked_elsewhere" });
      else if (input.rows.some((r) => lower(r.account) === w)) skipped.push({ address: w, reason: "has_wallets" });
      else if (input.hasOwnProfile.has(w)) skipped.push({ address: w, reason: "has_profile" });
      else if (size >= max) skipped.push({ address: w, reason: "too_many" });
      else {
        adopt.push({ address: w, fid });
        size++;
      }
    }
  }
  return { adopt, prune, skipped };
}

/**
 * Pure: which account a Farcaster sign-in (no wallet signature) builds on, by a rule that never
 * depends on who asks, so two devices syncing at once agree: an account one of the FID's wallets is
 * already in (the lowest, if several), else the one wallet with its own profile, else the lowest
 * verified wallet. Exported for tests.
 */
export function chooseAccountForFid(
  verified: readonly string[],
  rows: readonly LinkRowFull[],
  hasOwnProfile: ReadonlySet<string>,
): string | null {
  const ws = [...new Set(verified.map(lower))].sort();
  if (ws.length === 0) return null;
  const accounts = new Set<string>();
  for (const w of ws) {
    const row = rows.find((r) => lower(r.address) === w);
    if (row) accounts.add(lower(row.account));
    if (rows.some((r) => lower(r.account) === w)) accounts.add(w);
  }
  if (accounts.size > 0) return [...accounts].sort()[0];
  const withProfile = ws.filter((w) => hasOwnProfile.has(w));
  return withProfile[0] ?? ws[0];
}

/**
 * Pure: the account a sync builds on, the same whichever wallet signs in first. A wallet session
 * keeps its account when that account is real (the wallet is linked, has links, or has its own X or
 * email). A BARE session wallet (none of those) builds where a Farcaster sign-in would
 * (chooseAccountForFid over every wallet its FIDs verified): otherwise signing in first with a bare
 * wallet would make it the head and strand a verified wallet that already holds the player's X or
 * email. Exported for tests.
 */
export function resolveSyncAccount(input: {
  sessionWallet?: string;
  /** The session wallet's account (accountOf), when there is a session. */
  sessionAccount?: string;
  /** Every wallet the relevant FIDs verified. */
  verified: readonly string[];
  rows: readonly LinkRowFull[];
  hasOwnProfile: ReadonlySet<string>;
}): string | null {
  const w = input.sessionWallet ? lower(input.sessionWallet) : null;
  if (w) {
    const acct = lower(input.sessionAccount ?? w);
    const bare = acct === w && !input.rows.some((r) => lower(r.account) === w) && !input.hasOwnProfile.has(w);
    if (!bare) return acct;
    // Only where Farcaster verified this wallet: a wallet no FID verified stays its own account.
    const verified = input.verified.map(lower);
    return verified.includes(w) ? chooseAccountForFid(verified, input.rows, input.hasOwnProfile) ?? w : w;
  }
  return chooseAccountForFid(input.verified, input.rows, input.hasOwnProfile);
}

// ── database ─────────────────────────────────────────────────────────────────────────────────────

type Db = DbOrTx;
type Tx = DbOrTx;

/**
 * Every link row touching these wallets (as the wallet or as the account). Before migration 0009 it
 * reads every row as a signature link (there were no others); the writes still need 0009, so a sync
 * there plans but can't write, and a dry run can preview production before the migration.
 */
async function rowsTouching(db: Db | Tx, wallets: readonly string[]): Promise<LinkRowFull[]> {
  const list = [...new Set(wallets.map(lower))];
  if (list.length === 0) return [];
  const where = or(inArray(walletLinks.address, list), inArray(walletLinks.account, list));
  try {
    return await db
      .select({ address: walletLinks.address, account: walletLinks.account, via: walletLinks.via, fid: walletLinks.fid })
      .from(walletLinks)
      .where(where);
  } catch {
    const rows = await db.select({ address: walletLinks.address, account: walletLinks.account }).from(walletLinks).where(where);
    return rows.map((r) => ({ ...r, via: "signature", fid: null }));
  }
}

/** Wallets among these with their own X link or confirmed email (they never merge automatically). */
async function withOwnProfile(db: Db | Tx, wallets: readonly string[]): Promise<Set<string>> {
  const list = [...new Set(wallets.map(lower))];
  if (list.length === 0) return new Set();
  const rows = await db
    .select({ address: profiles.address })
    .from(profiles)
    .where(and(inArray(profiles.address, list), or(isNotNull(profiles.xUserId), isNotNull(profiles.emailVerifiedAt))));
  return new Set(rows.map((r) => r.address));
}

export interface SyncResult {
  account: string;
  adopted: string[];
  pruned: string[];
  skipped: FarcasterPlan["skipped"];
}

/**
 * Bring an account's Farcaster wallets up to date. Start from a wallet the player signed in with
 * (`wallet`: its account), or from a Farcaster sign-in (`fid`: the account chosen by
 * chooseAccountForFid). Returns null when there is nothing to work on (no links table columns yet,
 * Farcaster unreachable, or no verified wallets).
 */
export async function syncFarcasterWallets(opts: { wallet?: string; fid?: number; dryRun?: boolean }): Promise<SyncResult | null> {
  const db = getDb();
  try {
    // 1. The account, by one rule whichever wallet signs in first (resolveSyncAccount).
    // With a wallet session, only the FIDs that verified THAT wallet place it: a Farcaster sign-in in
    // the same browser is not proof the two are one player (Bugbot on #163). Without one, the FID.
    const startFids = new Set<number>();
    if (opts.wallet) {
      for (const list of (await fidsByAddresses([opts.wallet]).catch(() => new Map<string, number[]>())).values()) for (const f of list) startFids.add(f);
    } else if (opts.fid) startFids.add(opts.fid);
    const startProfiles = startFids.size ? await lookupProfiles([...startFids]).catch(() => []) : [];
    const verified = [...new Set(startProfiles.flatMap((p) => p.verifiedWallets ?? []))];
    const near = [...verified, ...(opts.wallet ? [lower(opts.wallet)] : [])];
    const account = resolveSyncAccount({
      sessionWallet: opts.wallet,
      sessionAccount: opts.wallet ? await accountOf(opts.wallet) : undefined,
      verified,
      rows: await rowsTouching(db, near),
      hasOwnProfile: await withOwnProfile(db, near),
    });
    if (!account) return null;

    // 2. The FIDs that could vouch (verifying a seed), plus those behind existing Farcaster links
    // (to prune), plus the signed-in FID. Then their verified wallets: positive answers only.
    const own = await rowsTouching(db, [account]);
    const seeds = [account, ...own.filter((r) => r.account === account && r.via !== "farcaster").map((r) => r.address)];
    const fids = new Set<number>(opts.fid ? [opts.fid] : []);
    for (const list of (await fidsByAddresses(seeds).catch(() => new Map<string, number[]>())).values()) for (const f of list) fids.add(f);
    for (const r of own) if (r.via === "farcaster" && r.fid !== null) fids.add(r.fid);
    if (fids.size === 0) return { account, adopted: [], pruned: [], skipped: [] };
    const answered = await lookupProfiles([...fids]).catch(() => []);
    const fidWallets = new Map(answered.map((p) => [p.fid, p.verifiedWallets ?? []]));
    const candidates = [...new Set([...fidWallets.values()].flat())];

    // 3. The daily hold, read before the lock (it reads the chain): unknown counts as held. Only
    // asked when there is a Farcaster link that could leave.
    let holdPrune = false;
    if (own.some((r) => r.account === account && r.via === "farcaster")) {
      try {
        holdPrune = await accountClaimedToday(account);
      } catch {
        holdPrune = true;
      }
    }

    // A dry run plans against what's there now and writes nothing.
    if (opts.dryRun) {
      const plan = planFarcasterWallets({
        account,
        rows: await rowsTouching(db, [account, ...candidates]),
        fidWallets,
        hasOwnProfile: await withOwnProfile(db, candidates),
        holdPrune,
      });
      return { account, adopted: plan.adopt.map((a) => a.address), pruned: plan.prune, skipped: plan.skipped };
    }

    // 4. Plan and write under one lock, re-reading the links inside it, so two devices syncing at
    // once can't insert A→B and B→A, or overfill an account.
    const acct = account;
    return await withLinkLock(async (tx) => {
      // The account must still head itself: if it joined another account meanwhile, stop.
      const joined = await tx.select({ account: walletLinks.account }).from(walletLinks).where(eq(walletLinks.address, acct)).limit(1);
      if (joined.length > 0) return { account: acct, adopted: [], pruned: [], skipped: [] };
      const rows = await rowsTouching(tx, [acct, ...candidates]);
      const plan = planFarcasterWallets({
        account: acct,
        rows,
        fidWallets,
        hasOwnProfile: await withOwnProfile(tx, candidates),
        holdPrune,
      });
      if (plan.prune.length > 0) {
        await tx
          .delete(walletLinks)
          .where(and(eq(walletLinks.account, acct), eq(walletLinks.via, "farcaster"), inArray(walletLinks.address, plan.prune)));
      }
      if (plan.adopt.length > 0) {
        await tx
          .insert(walletLinks)
          .values(plan.adopt.map((a) => ({ address: a.address, account: acct, via: "farcaster", fid: a.fid })))
          .onConflictDoNothing();
      }
      return { account: acct, adopted: plan.adopt.map((a) => a.address), pruned: plan.prune, skipped: plan.skipped };
    });
  } catch (err) {
    // Before migration 0009 (no via/fid columns), or the database is down: nothing changes.
    console.error("[farcaster-wallets] sync skipped:", err instanceof Error ? err.message.slice(0, 160) : err);
    return null;
  }
}
