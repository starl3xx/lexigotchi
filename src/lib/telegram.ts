/**
 * The beta testers' Telegram group and its bot (@lexigotchi_bot).
 *
 * Telegram calls `/api/telegram/webhook` with every update the bot can see. The bot is an
 * ADMINISTRATOR of the beta group, and Telegram sends an administrator every message in the group,
 * whatever its privacy mode. So this module reads only what it acts on: a join (the welcome) and a
 * command typed to the bot (`commandOf`; lib/telegramCommands answers it). Nothing else in a
 * message is read, kept, or logged, and nothing here may start to. One command keeps what was
 * typed after it, because that is what it is for: `/bug` (lib/telegramReports).
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

/** A marked stretch of a message's text. Offsets are UTF-16 code units, as a JS string indexes. */
export interface TgEntity {
  type: string;
  offset: number;
  length: number;
}

export interface TgMessage {
  message_id?: number;
  /** For a group admin who posts anonymously this is Telegram's own stand-in bot, and `sender_chat` is the group. */
  from?: TgUser;
  sender_chat?: { id: number };
  /** `type` is "private" for a chat with one person; a group is "group" or "supergroup". */
  chat: { id: number; type?: string; title?: string };
  text?: string;
  entities?: TgEntity[];
  /** A picture's words, and their entities: a command can be typed under a screenshot. */
  caption?: string;
  caption_entities?: TgEntity[];
  /** A picture, in several sizes, smallest first. */
  photo?: { file_id: string }[];
  new_chat_members?: TgUser[];
  migrate_to_chat_id?: number;
}

export interface TgUpdate {
  update_id?: number;
  message?: TgMessage;
}

/** The bot's @username, without the @: how a command names it in a group ("/status@lexigotchi_bot"). */
export function botUsername(): string {
  return (process.env.TELEGRAM_BOT_USERNAME ?? "lexigotchi_bot").replace(/^@/, "");
}

/**
 * The command a message opens with, or null: "/word CRANE" is `{ name: "word", args: "CRANE" }`.
 *
 * Only a command Telegram itself marked (a `bot_command` entity) at the very start of the text, or
 * of a picture's caption, and never one addressed to another bot ("/status@other_bot"). The name is
 * lowercased; `args` is the rest, trimmed. This is the ONLY reading of a group message's words in
 * the app: a message that opens with no command gives null, and its words go nowhere.
 */
export function commandOf(m: TgMessage | undefined, bot = botUsername()): { name: string; args: string } | null {
  if (!m) return null;
  const [text, entities] = m.text !== undefined ? [m.text, m.entities] : [m.caption ?? "", m.caption_entities];
  const mark = entities?.find((e) => e.type === "bot_command" && e.offset === 0);
  if (!mark || text[0] !== "/") return null;
  const [name, to] = text.slice(1, mark.length).split("@");
  if (!name || (to !== undefined && to.toLowerCase() !== bot.toLowerCase())) return null;
  return { name: name.toLowerCase(), args: text.slice(mark.length).trim() };
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
/**
 * A member's name as plain words, to keep beside something they filed: their username WITHOUT the
 * "@" (so writing it never mentions anyone), else their first name, else null. Control characters
 * out, at most 40 characters, never cutting an emoji in half.
 */
export function plainName(u: TgUser | undefined): string | null {
  const raw = (u?.username || u?.first_name?.trim() || "").replace(/[\u0000-\u001f\u007f]/g, "");
  return raw ? Array.from(raw).slice(0, 40).join("") : null;
}

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
 * How many members the beta group has (people and bots, the operator included), for the operator
 * console. Null when the bot isn't configured or Telegram doesn't answer in time. Never logs: the
 * request URL carries the bot token.
 */
export async function chatMemberCount(
  chatId = process.env.TELEGRAM_CHAT_ID ?? "",
  token = process.env.TELEGRAM_BOT_TOKEN ?? "",
): Promise<number | null> {
  if (!chatId || !token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getChatMemberCount?chat_id=${encodeURIComponent(chatId)}`, {
      signal: AbortSignal.timeout(5_000),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown } | null;
    return data?.ok && typeof data.result === "number" ? data.result : null;
  } catch {
    return null;
  }
}

/**
 * Whether someone is in the beta group now: true, false, or null when Telegram didn't say. For a
 * request that arrives in a private chat with the bot, where anyone on Telegram can type. (The bot
 * is an administrator of the group, which is what makes this read dependable.) Never logs: the
 * request URL carries the bot token.
 */
export async function inBetaGroup(
  userId: number,
  chatId = process.env.TELEGRAM_CHAT_ID ?? "",
  token = process.env.TELEGRAM_BOT_TOKEN ?? "",
): Promise<boolean | null> {
  if (!chatId || !token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${userId}`, {
      signal: AbortSignal.timeout(5_000),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: { status?: string; is_member?: boolean } } | null;
    if (!data?.ok || !data.result?.status) return res.status === 400 ? false : null; // 400: Telegram knows no such member
    const { status, is_member } = data.result;
    return status === "creator" || status === "administrator" || status === "member" || (status === "restricted" && is_member === true);
  } catch {
    return null;
  }
}

/**
 * A file someone sent the bot (a report's screenshot), by Telegram's id for it: its bytes and
 * type, or null when Telegram no longer has it or doesn't answer. Never logs: both URLs carry the
 * bot token.
 */
export async function telegramFile(fileId: string, token = process.env.TELEGRAM_BOT_TOKEN ?? ""): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  if (!fileId || !token) return null;
  try {
    const meta = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`, { signal: AbortSignal.timeout(5_000) });
    const data = (await meta.json().catch(() => null)) as { ok?: boolean; result?: { file_path?: string } } | null;
    const path = data?.ok ? data.result?.file_path : undefined;
    if (!path) return null;
    const file = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, { signal: AbortSignal.timeout(15_000) });
    if (!file.ok) return null;
    return { bytes: await file.arrayBuffer(), type: /\.png$/i.test(path) ? "image/png" : /\.webp$/i.test(path) ? "image/webp" : "image/jpeg" };
  } catch {
    return null;
  }
}

/** How long a send may take: Telegram answers in well under a second when it answers at all. */
const SEND_TIMEOUT_MS = 10_000;

/** What a send may carry besides its words. */
export interface SendOptions {
  /** Mentions in the text (or the caption) of people with no @username. */
  mentions?: TgMention[];
  /**
   * The message this one answers. If that message has been deleted by the time we answer, ours is
   * sent anyway, as an ordinary message.
   */
  replyTo?: number;
}

const replyTo = (id: number | undefined) => (id ? { message_id: id, allow_sending_without_reply: true } : undefined);

/** Telegram's answer to a call, or a throw carrying its own description (never the URL: it holds the token). */
async function sent(method: string, res: Response): Promise<void> {
  const data = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (!data?.ok) throw new Error(`${method}: ${data?.description ?? res.status}`);
}

/**
 * Send `text` to the chat, as typed: no parse mode, so a player's name or a word can't be read as
 * formatting, and no link preview. Throws with Telegram's own description on failure.
 */
export async function sendMessage(
  chatId: string | number,
  text: string,
  opts: SendOptions = {},
  token = process.env.TELEGRAM_BOT_TOKEN ?? "",
): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(opts.mentions?.length ? { entities: opts.mentions } : {}),
      link_preview_options: { is_disabled: true },
      reply_parameters: replyTo(opts.replyTo),
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  await sent("sendMessage", res);
}

/**
 * Send `png` with `caption` to the chat as a photo, with `opts.mentions` as the caption's entities.
 * Throws with Telegram's own description on failure.
 */
export async function sendPhoto(
  chatId: string | number,
  png: Blob,
  caption: string,
  opts: SendOptions = {},
  token = process.env.TELEGRAM_BOT_TOKEN ?? "",
): Promise<void> {
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("caption", caption);
  if (opts.mentions?.length) form.set("caption_entities", JSON.stringify(opts.mentions));
  const reply = replyTo(opts.replyTo);
  if (reply) form.set("reply_parameters", JSON.stringify(reply));
  form.set("photo", png, "card.png");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
  await sent("sendPhoto", res);
}
