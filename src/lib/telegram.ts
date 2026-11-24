/**
 * The beta testers' Telegram group and its bot (@lexigotchi_bot).
 *
 * Telegram calls `/api/telegram/webhook` with every update the bot can see. In a group with privacy
 * mode on (the default), that is commands, replies to the bot, and service messages, such as
 * "<name> joined the group". This module decides what to do with one; the route does it.
 *
 * Dark until all three are set: TELEGRAM_BOT_TOKEN (from @BotFather), TELEGRAM_CHAT_ID (the beta
 * group, "-<id>" for a basic group), and TELEGRAM_WEBHOOK_SECRET (Telegram sends it back in the
 * X-Telegram-Bot-Api-Secret-Token header, so nobody else can drive the bot). The webhook itself is
 * registered by the "Telegram webhook" GitHub workflow.
 */
import { timingSafeEqual } from "node:crypto";

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

export interface TgUpdate {
  update_id?: number;
  message?: {
    chat: { id: number; title?: string };
    new_chat_members?: TgUser[];
    migrate_to_chat_id?: number;
  };
}

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID && process.env.TELEGRAM_WEBHOOK_SECRET);
}

/** Telegram's echo of our secret, compared in constant time. */
export function webhookSecretMatches(header: string | null, secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? ""): boolean {
  if (!header || !secret) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A member's name for the greeting: first name, else @username, else nothing. Control characters out. */
function nameOf(u: TgUser): string | null {
  const raw = (u.first_name?.trim() || (u.username ? `@${u.username}` : "")).replace(/[\u0000-\u001f\u007f]/g, "");
  return raw ? raw.slice(0, 40) : null;
}

/** "Ann", "Ann and Bo", "Ann, Bo, and Cy" (Oxford comma, the house style). */
function listOf(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * The welcome for an update, or null. Only people (never bots, including this one being added)
 * joining THE beta group get one; one greeting covers several people joining at once.
 */
export function welcomeFor(update: TgUpdate, chatId: string): { caption: string } | null {
  const m = update.message;
  if (!m || String(m.chat.id) !== chatId) return null;
  const people = (m.new_chat_members ?? []).filter((u) => !u.is_bot);
  if (people.length === 0) return null;
  const names = people.map(nameOf).filter((n): n is string => n !== null);
  const who = names.length > 0 ? listOf(names) : "there";
  return {
    caption: `HEYOO, ${who}! 👋 Welcome to the Lexigotchi beta. The pinned message has everything you need to get set up, then jump in at lexigotchi.fun/play.`,
  };
}

/** Send `png` with `caption` to the chat as a photo. Throws with Telegram's own description on failure. */
export async function sendPhoto(chatId: string, png: Blob, caption: string, token = process.env.TELEGRAM_BOT_TOKEN ?? ""): Promise<void> {
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("caption", caption);
  form.set("photo", png, "heyoo.png");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (!data?.ok) throw new Error(`sendPhoto: ${data?.description ?? res.status}`);
}
