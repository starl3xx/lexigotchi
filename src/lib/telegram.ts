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

/** A mention of a member with no @username: their name in the caption, linked to their account. */
export interface TgMention {
  type: "text_mention";
  /** In UTF-16 code units, which is how Telegram counts and how a JS string indexes. */
  offset: number;
  length: number;
  user: { id: number };
}

/**
 * A member's name for the greeting: their @username, which Telegram turns into a mention that
 * notifies them; else (not everyone sets one) their first name, which the caption makes a mention
 * of their account (`mention`), so it notifies them too and Telegram doesn't read a name like
 * "free-eth.example" as a link; else nothing. Control characters out, at most 40 characters, never
 * cutting an emoji in half.
 */
function nameOf(u: TgUser): { text: string; mention?: number } | null {
  const raw = (u.username ? `@${u.username}` : u.first_name?.trim() || "").replace(/[\u0000-\u001f\u007f]/g, "");
  if (!raw) return null;
  const text = Array.from(raw).slice(0, 40).join("");
  return u.username ? { text } : { text, mention: u.id };
}

/**
 * The welcome for an update, or null. Only people (never bots, including this one being added)
 * joining THE beta group get one; one greeting covers several people joining at once: "Ann",
 * "Ann and Bo", "Ann, Bo, and Cy" (Oxford comma, the house style).
 */
export function welcomeFor(update: TgUpdate, chatId: string): { caption: string; mentions: TgMention[] } | null {
  const m = update.message;
  if (!m || String(m.chat.id) !== chatId) return null;
  const people = (m.new_chat_members ?? []).filter((u) => !u.is_bot);
  if (people.length === 0) return null;
  const names = people.flatMap((u) => nameOf(u) ?? []);

  let caption = "HEYOO, ";
  const mentions: TgMention[] = [];
  names.forEach((n, i) => {
    if (i > 0) caption += names.length === 2 ? " and " : i === names.length - 1 ? ", and " : ", ";
    if (n.mention !== undefined) mentions.push({ type: "text_mention", offset: caption.length, length: n.text.length, user: { id: n.mention } });
    caption += n.text;
  });
  if (names.length === 0) caption += "there";
  caption += "! 👋 Welcome to the Lexigotchi beta. The pinned message has everything you need to get set up, then jump in at lexigotchi.fun/play.";
  return { caption, mentions };
}

/**
 * Send `png` with `caption` to the chat as a photo, with `mentions` as the caption's entities.
 * Throws with Telegram's own description on failure.
 */
export async function sendPhoto(
  chatId: string,
  png: Blob,
  caption: string,
  mentions: TgMention[] = [],
  token = process.env.TELEGRAM_BOT_TOKEN ?? "",
): Promise<void> {
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("caption", caption);
  if (mentions.length > 0) form.set("caption_entities", JSON.stringify(mentions));
  form.set("photo", png, "heyoo.png");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (!data?.ok) throw new Error(`sendPhoto: ${data?.description ?? res.status}`);
}
