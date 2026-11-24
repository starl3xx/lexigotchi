/**
 * Profile reads and writes (schema.ts `profiles`). Server-only. Every write here is made for a
 * wallet the caller has proven with a session (lib/profile/session.ts); these helpers don't check.
 */
import { and, desc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "./client";
import { emailCodes, profiles, xLinkStates, type Profile } from "./schema";
import type { NameSource, ProfileView, PublicProfileRow, PublicProfileView } from "@/lib/profile/rules";
import { accountWallets, walletsOfAccount, farcasterWalletsOf } from "./walletLinks";

/**
 * Postgres "relation does not exist": the owner hasn't applied migration 0006 yet. Drizzle wraps
 * the driver's error ("Failed query: …"), so the code is on `cause`, not on the error itself.
 */
export function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "42P01" || e?.cause?.code === "42P01";
}

export async function getProfile(address: string): Promise<Profile | null> {
  const rows = await getDb().select().from(profiles).where(eq(profiles.address, address.toLowerCase())).limit(1);
  return rows[0] ?? null;
}

export async function setNameSource(address: string, source: NameSource | null): Promise<void> {
  const a = address.toLowerCase();
  await getDb()
    .insert(profiles)
    .values({ address: a, nameSource: source })
    .onConflictDoUpdate({ target: profiles.address, set: { nameSource: source, updatedAt: sql`now()` } });
}

/** An account's own profile view (email included) with its wallets: what the profile routes return. */
export async function accountView(account: string): Promise<ProfileView> {
  const [p, wallets, viaFarcaster] = await Promise.all([getProfile(account), walletsOfAccount(account), farcasterWalletsOf(account)]);
  return { ...toView(account, p), account: account.toLowerCase(), wallets, viaFarcaster };
}

/** A wallet's public view, resolved to its account: the account's X and name, and its wallets. */
export async function publicViewOf(address: string): Promise<PublicProfileView> {
  const { account, wallets } = await accountWallets(address);
  const [p, viaFarcaster] = await Promise.all([getProfile(account), farcasterWalletsOf(account)]);
  return { ...toPublicView(account, p), address: address.toLowerCase(), account, wallets, viaFarcaster };
}

/** The public view: everything but the email. */
export function toPublicView(address: string, p: Profile | null): PublicProfileView {
  const { email: _email, ...rest } = toView(address, p);
  return rest;
}

export function toView(address: string, p: Profile | null): ProfileView {
  return {
    address: address.toLowerCase(),
    nameSource: p?.nameSource === "x" || p?.nameSource === "farcaster" ? p.nameSource : null,
    x: p?.xUserId && p.xUsername
      ? {
          id: p.xUserId,
          username: p.xUsername,
          name: p.xName,
          pfpUrl: p.xPfpUrl,
          createdAt: p.xCreatedAt?.toISOString() ?? null,
          linkedAt: p.xLinkedAt?.toISOString() ?? null,
        }
      : null,
    email: p?.email && p.emailVerifiedAt ? { address: p.email, reminders: p.emailReminders } : null,
  };
}

// ── X ────────────────────────────────────────────────────────────────────────────────────────────

export async function createLinkState(state: string, address: string, codeVerifier: string, ttlMs: number): Promise<void> {
  await getDb().insert(xLinkStates).values({ state, address: address.toLowerCase(), codeVerifier, expiresAt: new Date(Date.now() + ttlMs) });
}

/**
 * Take a link attempt's row, once: it is marked used in the same statement that reads it, so a
 * replayed callback finds nothing. Null if unknown, used, or expired.
 */
export async function consumeLinkState(state: string): Promise<{ address: string; codeVerifier: string } | null> {
  const rows = await getDb()
    .update(xLinkStates)
    .set({ usedAt: sql`now()` })
    .where(and(eq(xLinkStates.state, state), isNull(xLinkStates.usedAt), gt(xLinkStates.expiresAt, sql`now()`)))
    .returning({ address: xLinkStates.address, codeVerifier: xLinkStates.codeVerifier });
  return rows[0] ?? null;
}

/**
 * Link an X account to a wallet. One X account names one wallet: if it was linked elsewhere, it
 * moves here (whoever can sign in to the X account decides), and the old wallet stops showing it.
 * Returns the wallet it moved from, if any.
 */
export async function linkX(
  address: string,
  x: { id: string; username: string; name: string | null; pfpUrl: string | null; createdAt: Date | null },
): Promise<{ movedFrom: string | null }> {
  const a = address.toLowerCase();
  return getDb().transaction(async (tx) => {
    const prev = await tx.select({ address: profiles.address }).from(profiles).where(eq(profiles.xUserId, x.id)).limit(1);
    const movedFrom = prev[0] && prev[0].address !== a ? prev[0].address : null;
    // The old wallet loses X entirely, its name choice included, as an unlink does (Bugbot on #137).
    if (movedFrom)
      await tx
        .update(profiles)
        .set({ ...X_CLEARED, nameSource: sql`case when ${profiles.nameSource} = 'x' then null else ${profiles.nameSource} end`, updatedAt: sql`now()` })
        .where(eq(profiles.address, movedFrom));
    const values = { xUserId: x.id, xUsername: x.username, xName: x.name, xPfpUrl: x.pfpUrl, xCreatedAt: x.createdAt, xLinkedAt: new Date() };
    await tx
      .insert(profiles)
      .values({ address: a, ...values })
      .onConflictDoUpdate({ target: profiles.address, set: { ...values, updatedAt: sql`now()` } });
    return { movedFrom };
  });
}

const X_CLEARED = { xUserId: null, xUsername: null, xName: null, xPfpUrl: null, xCreatedAt: null, xLinkedAt: null } as const;

/** The wallet an X account is linked to now, if any. */
export async function walletForX(xUserId: string): Promise<string | null> {
  const rows = await getDb().select({ address: profiles.address }).from(profiles).where(eq(profiles.xUserId, xUserId)).limit(1);
  return rows[0]?.address ?? null;
}

/** Unlink X. A name source of "x" falls back to automatic. */
export async function unlinkX(address: string): Promise<void> {
  const a = address.toLowerCase();
  await getDb()
    .update(profiles)
    .set({ ...X_CLEARED, nameSource: sql`case when ${profiles.nameSource} = 'x' then null else ${profiles.nameSource} end`, updatedAt: sql`now()` })
    .where(eq(profiles.address, a));
}

/** The public parts of these wallets' profiles (never the email), for /api/world. */
export async function publicProfileRows(addresses: readonly string[]): Promise<PublicProfileRow[]> {
  const list = [...new Set(addresses.map((x) => x.toLowerCase()))];
  if (list.length === 0) return [];
  return getDb()
    .select({ address: profiles.address, xUsername: profiles.xUsername, xPfpUrl: profiles.xPfpUrl, nameSource: profiles.nameSource })
    .from(profiles)
    .where(inArray(profiles.address, list));
}

/** Linked X user ids for these wallets (lowercase address → id), for the daily reminder. */
export async function xUserIdsFor(addresses: readonly string[]): Promise<Map<string, string>> {
  const list = [...new Set(addresses.map((x) => x.toLowerCase()))];
  if (list.length === 0) return new Map();
  const rows = await getDb()
    .select({ address: profiles.address, xUserId: profiles.xUserId })
    .from(profiles)
    .where(inArray(profiles.address, list));
  return new Map(rows.filter((r) => r.xUserId).map((r) => [r.address, r.xUserId!]));
}

// ── email ────────────────────────────────────────────────────────────────────────────────────────

/** Codes sent for this wallet since `since` (a cap on sends, with no rate-limit service needed). */
export async function codesSentSince(address: string, since: Date): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(emailCodes)
    .where(and(eq(emailCodes.address, address.toLowerCase()), gt(emailCodes.createdAt, since)));
  return rows[0]?.n ?? 0;
}

export async function createEmailCode(address: string, email: string, codeHash: string, ttlMs: number): Promise<number> {
  const [row] = await getDb()
    .insert(emailCodes)
    .values({ address: address.toLowerCase(), email, codeHash, expiresAt: new Date(Date.now() + ttlMs) })
    .returning({ id: emailCodes.id });
  return row.id;
}

/** Forget a code that never went out, so a failed send doesn't count toward the hourly cap. */
export async function deleteEmailCode(id: number): Promise<void> {
  await getDb().delete(emailCodes).where(eq(emailCodes.id, id));
}

/**
 * Every live code for this wallet and address, newest first. All of them count: a player who asked
 * twice may type the first code to arrive, and it must work (Bugbot on #139).
 */
export async function liveEmailCodes(address: string, email: string): Promise<{ id: number; codeHash: string; attempts: number }[]> {
  return getDb()
    .select({ id: emailCodes.id, codeHash: emailCodes.codeHash, attempts: emailCodes.attempts })
    .from(emailCodes)
    .where(and(eq(emailCodes.address, address.toLowerCase()), eq(emailCodes.email, email), isNull(emailCodes.usedAt), gt(emailCodes.expiresAt, sql`now()`)))
    .orderBy(desc(emailCodes.id))
    .limit(10);
}

/** A wrong guess counts against every live code for the address, so sending more codes buys no tries. */
export async function countCodeAttempt(ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  await getDb().update(emailCodes).set({ attempts: sql`${emailCodes.attempts} + 1` }).where(inArray(emailCodes.id, [...ids]));
}

/**
 * Confirm the email for this wallet and turn reminders on (that is what it's for). Spends the code.
 * One address per wallet and one wallet per address: "taken" if another wallet confirmed it.
 */
export async function confirmEmail(address: string, email: string, codeId: number): Promise<"ok" | "taken"> {
  const a = address.toLowerCase();
  try {
    await getDb().transaction(async (tx) => {
      await tx.update(emailCodes).set({ usedAt: sql`now()` }).where(eq(emailCodes.id, codeId));
      const values = { email, emailVerifiedAt: new Date(), emailReminders: true };
      await tx.insert(profiles).values({ address: a, ...values }).onConflictDoUpdate({ target: profiles.address, set: { ...values, updatedAt: sql`now()` } });
    });
    return "ok";
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    if (e?.code === "23505" || e?.cause?.code === "23505") return "taken";
    throw err;
  }
}

export async function clearEmail(address: string): Promise<void> {
  await getDb()
    .update(profiles)
    .set({ email: null, emailVerifiedAt: null, emailReminders: false, updatedAt: sql`now()` })
    .where(eq(profiles.address, address.toLowerCase()));
}

export async function setEmailReminders(address: string, on: boolean): Promise<void> {
  await getDb().update(profiles).set({ emailReminders: on, updatedAt: sql`now()` }).where(eq(profiles.address, address.toLowerCase()));
}

export interface EmailRecipient {
  address: string;
  email: string;
  /** The UTC day each reminder kind last went out (send-once markers, migration 0007). */
  emailDailyDay: number | null;
  emailHungerDay: number | null;
}

/** Wallets with a confirmed email and reminders on (all of them, or just these). Server-only. */
export async function emailRecipients(addresses?: readonly string[]): Promise<EmailRecipient[]> {
  const base = and(eq(profiles.emailReminders, true), isNotNull(profiles.emailVerifiedAt), isNotNull(profiles.email));
  const where = addresses ? and(base, inArray(profiles.address, [...new Set(addresses.map((x) => x.toLowerCase()))])) : base;
  if (addresses && addresses.length === 0) return [];
  const rows = await getDb()
    .select({ address: profiles.address, email: profiles.email, emailDailyDay: profiles.emailDailyDay, emailHungerDay: profiles.emailHungerDay })
    .from(profiles)
    .where(where);
  return rows.filter((r): r is EmailRecipient => Boolean(r.email));
}

/** Mark a reminder kind as sent today for these wallets, so a retried run skips them. */
export async function markEmailSent(kind: "daily" | "hunger", addresses: readonly string[], day: number): Promise<void> {
  if (addresses.length === 0) return;
  const set = kind === "daily" ? { emailDailyDay: day } : { emailHungerDay: day };
  await getDb().update(profiles).set(set).where(inArray(profiles.address, [...new Set(addresses.map((a) => a.toLowerCase()))]));
}
