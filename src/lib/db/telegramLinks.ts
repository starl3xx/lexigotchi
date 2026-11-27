/**
 * A profile's Telegram account (schema.ts `telegram_links`, `telegram_link_codes`; migration 0020):
 * where the bot sends that player's reminders. Server-only.
 *
 * - **One Telegram account names one profile, and a profile has one.** A new link takes the place
 *   of the old one on BOTH sides, in one transaction (`linkTelegram`), as linking X does.
 * - **A missing table is "nobody is linked"** to every reader (`isMissingTable`), so the senders
 *   and the profile carry on before the migration runs; the writers throw, and their routes answer
 *   not_configured.
 * - Rows are keyed by the profile's ACCOUNT (its first wallet). A wallet that later joins another
 *   account leaves its own row behind, which no reader reaches; linking again from the new account
 *   replaces it.
 */
import { randomBytes } from "node:crypto";
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "./client";
import { telegramLinkCodes, telegramLinks, type TelegramLink } from "./schema";
import { isMissingTable } from "./profiles";

/** How long a "Link Telegram" code lives: time to tap the link and press Start. */
export const TELEGRAM_CODE_TTL_MS = 15 * 60_000;

const lower = (s: string) => s.toLowerCase();

/**
 * A fresh code for this account, to carry in `t.me/<bot>?start=<code>`. 22 characters of A-Z, a-z,
 * 0-9, "_" and "-": what Telegram allows in a start link (at most 64). Throws.
 */
export async function createTelegramCode(account: string, now = Date.now()): Promise<{ code: string; expiresAt: Date }> {
  const code = randomBytes(16).toString("base64url");
  const expiresAt = new Date(now + TELEGRAM_CODE_TTL_MS);
  await getDb().insert(telegramLinkCodes).values({ code, account: lower(account), expiresAt });
  return { code, expiresAt };
}

/** Use a code up, once: the account it named, or null if it was unknown, used, or expired. Throws. */
export async function consumeTelegramCode(code: string): Promise<string | null> {
  const rows = await getDb()
    .update(telegramLinkCodes)
    .set({ usedAt: sql`now()` })
    .where(and(eq(telegramLinkCodes.code, code), isNull(telegramLinkCodes.usedAt), gt(telegramLinkCodes.expiresAt, sql`now()`)))
    .returning({ account: telegramLinkCodes.account });
  return rows[0]?.account ?? null;
}

/**
 * Link this Telegram account to this profile, in place of whatever either was linked to before.
 * One transaction: the old rows go and the new one arrives together, so there is never a moment
 * with two profiles on one Telegram account. Throws.
 */
export async function linkTelegram(account: string, telegramId: number, name: string): Promise<void> {
  const a = lower(account);
  await getDb().transaction(async (tx) => {
    await tx.delete(telegramLinks).where(or(eq(telegramLinks.account, a), eq(telegramLinks.telegramId, telegramId)));
    await tx.insert(telegramLinks).values({ account: a, telegramId, name });
  });
}

/** Unlink a profile's Telegram account. True when there was one. Throws. */
export async function unlinkTelegram(account: string): Promise<boolean> {
  const rows = await getDb().delete(telegramLinks).where(eq(telegramLinks.account, lower(account))).returning({ account: telegramLinks.account });
  return rows.length > 0;
}

/** Unlink by the Telegram account (the bot's `/unlink`, or a person who blocked the bot). True when it was linked. Throws. */
export async function unlinkTelegramId(telegramId: number): Promise<boolean> {
  const rows = await getDb().delete(telegramLinks).where(eq(telegramLinks.telegramId, telegramId)).returning({ account: telegramLinks.account });
  return rows.length > 0;
}

/** A profile's link, or null: none, or no table yet. Throws on any other database error. */
export async function telegramLinkOf(account: string): Promise<TelegramLink | null> {
  try {
    const rows = await getDb().select().from(telegramLinks).where(eq(telegramLinks.account, lower(account))).limit(1);
    return rows[0] ?? null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/**
 * Where to reach each of these profiles: account → the Telegram chat. Only the linked ones. An
 * empty map before the migration runs; throws on any other database error (a sender then sends
 * nothing by Telegram, and says why).
 */
export async function telegramChats(accounts: readonly string[]): Promise<Map<string, number>> {
  const list = [...new Set(accounts.map(lower))];
  if (list.length === 0) return new Map();
  try {
    const rows = await getDb().select({ account: telegramLinks.account, telegramId: telegramLinks.telegramId }).from(telegramLinks).where(inArray(telegramLinks.account, list));
    return new Map(rows.map((r) => [r.account, r.telegramId]));
  } catch (err) {
    if (isMissingTable(err)) return new Map();
    throw err;
  }
}

/**
 * Whether linking can work here: the tables exist (migration 0020 has run). For the profile's
 * config (`/api/profile/config`), so the profile shows its Telegram card only where a tap on it
 * would work. A yes is kept for good (tables don't go away); a no, or a failed read, is asked
 * again after a minute, so the card appears soon after the migration runs.
 */
let ready: { at: number; yes: boolean } | null = null;
const READY_RECHECK_MS = 60_000;
export async function telegramLinksReady(now = Date.now()): Promise<boolean> {
  if (ready && (ready.yes || now - ready.at < READY_RECHECK_MS)) return ready.yes;
  let yes = false;
  try {
    await getDb().select({ account: telegramLinks.account }).from(telegramLinks).limit(1);
    yes = true;
  } catch {
    yes = false; // no table yet, no database, or it didn't answer: not ready, as far as a player can tell
  }
  ready = { at: now, yes };
  return yes;
}
/** Tests only: forget what was learned. */
export function resetTelegramLinksReady() {
  ready = null;
}

/** Every link (the operator console's Players tab). Empty before the migration runs. Throws otherwise. */
export async function allTelegramLinks(): Promise<TelegramLink[]> {
  try {
    return await getDb().select().from(telegramLinks);
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}
