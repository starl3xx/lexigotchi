/**
 * Read-only queries for the operator console's Players and System tabs. Server-only, and only ever
 * called behind the admin gate (lib/admin/serverAuth.ts).
 *
 * Each query SELECTS ONLY what the console shows: whether an email is confirmed, never the email;
 * how many browsers a wallet subscribed, never an endpoint. A missing table (a migration the owner
 * hasn't applied) reads as empty, with `missing` set so the tab can say which.
 */
import { count, isNotNull, sql } from "drizzle-orm";
import { getDb } from "./client";
import { profiles, swapOrders, users, webPushSubscriptions } from "./schema";
import { isMissingTable } from "./profiles";
import type { ProfileFlags } from "@/lib/admin/playerRows";

export interface Read<T> {
  value: T;
  /** The table isn't there yet (its migration is owed). */
  missing: boolean;
}

async function read<T>(empty: T, q: () => Promise<T>): Promise<Read<T>> {
  try {
    return { value: await q(), missing: false };
  } catch (err) {
    if (isMissingTable(err)) return { value: empty, missing: true };
    throw err;
  }
}

export function profileFlags(): Promise<Read<ProfileFlags[]>> {
  return read([], async () => {
    const rows = await getDb()
      .select({
        address: profiles.address,
        xUsername: profiles.xUsername,
        emailConfirmed: sql<boolean>`${profiles.emailVerifiedAt} is not null`,
        emailReminders: profiles.emailReminders,
      })
      .from(profiles);
    return rows.map((r) => ({ ...r, emailConfirmed: Boolean(r.emailConfirmed) }));
  });
}

export function pushBrowserCounts(): Promise<Read<Map<string, number>>> {
  return read(new Map(), async () => {
    const rows = await getDb()
      .select({ address: webPushSubscriptions.address, n: count() })
      .from(webPushSubscriptions)
      .groupBy(webPushSubscriptions.address);
    return new Map(rows.map((r) => [r.address.toLowerCase(), Number(r.n)]));
  });
}

export function listingCounts(): Promise<Read<Map<string, number>>> {
  return read(new Map(), async () => {
    const rows = await getDb().select({ maker: swapOrders.maker, n: count() }).from(swapOrders).groupBy(swapOrders.maker);
    return new Map(rows.map((r) => [r.maker.toLowerCase(), Number(r.n)]));
  });
}

/** Farcaster players the campaign backend knows (by FID), and how many added the mini app. */
export function farcasterUserCounts(): Promise<Read<{ users: number; added: number }>> {
  return read({ users: 0, added: 0 }, async () => {
    const [all] = await getDb().select({ n: count() }).from(users);
    const [added] = await getDb().select({ n: count() }).from(users).where(isNotNull(users.addedMiniAppAt));
    return { users: Number(all?.n ?? 0), added: Number(added?.n ?? 0) };
  });
}

/** Opted-in counts for the Notifications tab: confirmed emails with reminders on, and browsers. */
export function reminderAudience(): Promise<Read<{ emailOptedIn: number; pushBrowsers: number; pushWallets: number }>> {
  return read({ emailOptedIn: 0, pushBrowsers: 0, pushWallets: 0 }, async () => {
    const db = getDb();
    const [email] = await db
      .select({ n: count() })
      .from(profiles)
      .where(sql`${profiles.emailVerifiedAt} is not null and ${profiles.emailReminders}`);
    const [push] = await db
      .select({ n: count(), wallets: sql<number>`count(distinct ${webPushSubscriptions.address})` })
      .from(webPushSubscriptions);
    return { emailOptedIn: Number(email?.n ?? 0), pushBrowsers: Number(push?.n ?? 0), pushWallets: Number(push?.wallets ?? 0) };
  });
}

/**
 * Which tables exist, and the newest migration drizzle recorded as applied (`created_at` there is
 * the journal entry's `when`). Null for the latter when drizzle's own table can't be read.
 */
export async function schemaState(): Promise<{ tables: string[]; appliedThrough: number | null }> {
  const db = getDb();
  const tables = (await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public'`)) as unknown as {
    table_name: string;
  }[];
  let appliedThrough: number | null = null;
  try {
    const r = (await db.execute(sql`select max(created_at) as at from drizzle.__drizzle_migrations`)) as unknown as { at: string | number | null }[];
    appliedThrough = r[0]?.at != null ? Number(r[0].at) : null;
  } catch {
    appliedThrough = null;
  }
  return { tables: tables.map((t) => t.table_name).sort(), appliedThrough };
}
