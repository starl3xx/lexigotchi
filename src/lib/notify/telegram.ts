/**
 * Reminders by Telegram message: to a player who linked their Telegram account to their profile
 * (lib/telegramLink.ts, lib/db/telegramLinks.ts), from @lexigotchi_bot, in their private chat with
 * it. A fourth channel beside Farcaster, the browser, and email, and like email it is one the
 * player asked for: it goes to a linked player whatever else reached them.
 *
 * - **The kind is the caller's to ask** (lib/notify/kinds.ts): every caller filters by the
 *   player's choices before it gets here, as it does for the other channels.
 * - **Once.** Each message's send-once mark (lib/db/reminderMarks.ts, under "telegram:<kind>" so it
 *   never meets the email's mark for the same event) is CLAIMED before the send. With no mark to
 *   keep, nothing is sent. Telegram's clear "not delivered" (a refusal, or a rate limit) gives
 *   the mark back; after a timeout the message may have arrived, so the mark stays.
 * - **A person who blocked the bot, or left Telegram, is unlinked** (`forget`): Telegram says so
 *   in its refusal, and writing to them again would only fail again.
 * - **Production's own deployment only** (`telegramRemindersOn`), like the bot's other unasked
 *   posts (lib/telegram `mayPostUnasked`). `TELEGRAM_REMINDERS=off` mutes the channel.
 * - **It can't hurt its caller:** `tellByTelegram` never throws, and a pass STOPS at the first send
 *   that fails any other way than Telegram's refusal of that one message (a timeout, a server
 *   error, a rate limit). Each send
 *   may wait ten seconds, and the callers are the keeper's jobs, which share one time limit: an
 *   outage must cost one wait, not one per linked player. The players not reached keep their marks
 *   unclaimed, so the next pass tells them.
 *
 * Sent as typed, with no parse mode, like everything the bot says.
 */
import type { ReminderKind } from "./kinds";
import type { Notification } from "./templates";
import { SITE_URL } from "@/lib/site";

/** One message for one player. `mark` names the EVENT (a day, a sale's fill), so it is sent once. */
export interface TelegramNote {
  /** The player: their account (its first wallet), lowercase. */
  account: string;
  note: Pick<Notification, "title" | "body" | "targetUrl">;
  mark: string;
}

export interface TelegramResult {
  /** Messages Telegram took. */
  sent: number;
  /** Not sent: already told, or no mark could be kept. */
  skipped: number;
  /** Not sent: Telegram refused or didn't answer. */
  failed: number;
  /** Players never tried, because the pass stopped at a send Telegram didn't answer. */
  dropped: number;
  /** People who blocked the bot or left Telegram, now unlinked. */
  gone: number;
}

export interface TelegramDeps {
  /** Account → the Telegram chat, for the linked ones (lib/db/telegramLinks `telegramChats`). */
  chats: (accounts: readonly string[]) => Promise<Map<string, number>>;
  claim: (account: string, mark: string) => Promise<"claimed" | "taken" | "unavailable">;
  release: (account: string, mark: string) => Promise<void>;
  /** Send one message. Throws with Telegram's own description on failure. */
  send: (chatId: number, text: string) => Promise<void>;
  /** Unlink a Telegram account that can't be written to any more. */
  forget: (chatId: number) => Promise<void>;
  /** Called with each account a message went out to. */
  onReached?: (account: string) => void;
}

/** Is the channel armed? The production deployment, with the bot's token, and not muted. */
export function telegramRemindersOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const production = env.NODE_ENV === "production" && (env.VERCEL_ENV || "production") === "production";
  return production && Boolean(env.TELEGRAM_BOT_TOKEN) && env.TELEGRAM_REMINDERS !== "off";
}

/** A reminder as a Telegram message: its title, its body, and where to go. */
export function telegramText(note: Pick<Notification, "title" | "body" | "targetUrl">): string {
  return `${note.title}\n${note.body}\n\n${note.targetUrl ?? `${SITE_URL}/play`}`;
}

/** Telegram's words for "this person can't be written to any more": they blocked the bot, or their account is gone. */
const GONE = /bot was blocked by the user|user is deactivated|chat not found|bot can't initiate conversation/i;
/** Telegram's "no" to this one message: nothing was delivered, and the next player's may still go. */
const REFUSED = /Bad Request|Forbidden|Unauthorized/i;
/**
 * Telegram's "not now" to the bot (429): nothing was delivered either, and nothing more will be
 * for a while. (A timeout or a server error says nothing either way about delivery.)
 */
const RATE_LIMITED = /Too Many Requests|retry after/i;

/** The messages, over deps already chosen. Each player's failure is its own; never throws past `chats`. */
export async function telegramNotes(notes: readonly TelegramNote[], deps: TelegramDeps): Promise<TelegramResult> {
  const out: TelegramResult = { sent: 0, skipped: 0, failed: 0, dropped: 0, gone: 0 };
  if (notes.length === 0) return out;
  const chatOf = await deps.chats(notes.map((n) => n.account));
  const linked = notes.flatMap((n) => {
    const chat = chatOf.get(n.account.toLowerCase());
    return chat === undefined ? [] : [{ n, chat }]; // not linked: not this channel's player
  });
  for (const [i, { n, chat }] of linked.entries()) {
    if ((await deps.claim(n.account, n.mark)) !== "claimed") {
      out.skipped++;
      continue;
    }
    try {
      await deps.send(chat, telegramText(n.note));
      out.sent++;
      deps.onReached?.(n.account);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      out.failed++;
      if (GONE.test(why)) {
        out.gone++;
        await deps.forget(chat).catch(() => {});
      }
      // Not delivered, by Telegram's own word: the mark goes back, so a later pass tells them.
      if (REFUSED.test(why) || RATE_LIMITED.test(why)) await deps.release(n.account, n.mark);
      if (!REFUSED.test(why)) {
        // Telegram didn't answer, or said "not now": nobody after this player is tried this pass.
        // (After no answer at all, this player's mark stays: the message may have arrived.)
        out.dropped = linked.length - i - 1;
        break;
      }
    }
  }
  return out;
}

/**
 * Tell these players by Telegram, where the channel is armed. The caller has already dropped the
 * players who turned this kind off. Never throws: null when the channel is dark, there was nothing
 * to say, or the links couldn't be read (logged).
 */
export async function tellByTelegram(kind: ReminderKind, notes: readonly TelegramNote[], opts: { onReached?: (account: string) => void } = {}): Promise<TelegramResult | null> {
  if (!telegramRemindersOn() || notes.length === 0) return null;
  try {
    // Loaded at the moment of use, as the other channels' senders are (lib/notify/players.ts).
    const [links, marks, telegram] = await Promise.all([import("@/lib/db/telegramLinks"), import("@/lib/db/reminderMarks"), import("@/lib/telegram")]);
    return await telegramNotes(notes, {
      chats: links.telegramChats,
      claim: (account, mark) => marks.claimMark(account, `telegram:${kind}`, mark),
      release: (account, mark) => marks.releaseMark(account, `telegram:${kind}`, mark),
      send: (chatId, text) => telegram.sendMessage(chatId, text),
      forget: async (chatId) => void (await links.unlinkTelegramId(chatId)),
      onReached: opts.onReached,
    });
  } catch (err) {
    console.error(`${kind}: the Telegram pass failed:`, String((err as Error)?.message ?? err).slice(0, 160));
    return null;
  }
}
