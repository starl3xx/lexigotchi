/**
 * Linking a Telegram account to a Lexigotchi profile, the bot's side: `/start <code>` and `/unlink`,
 * in a private chat with @lexigotchi_bot.
 *
 * The player taps "Link Telegram" in their profile (a profile session makes a single-use code:
 * `/api/profile/telegram`), which opens `t.me/<bot>?start=<code>`. Pressing Start sends the bot
 * `/start <code>`, and the bot links that Telegram account to the code's profile. The code is the
 * proof: only that profile's session could make it, and it works once, for a quarter of an hour.
 *
 * From then on the bot sends that player's reminders as a private message (lib/notify/telegram.ts).
 * A bot can only write to someone who started it, which this `/start` is.
 *
 * - Nothing here is public: the link shows only in the player's own profile.
 * - The answers follow the house copy rules (tests/telegram-link.test.ts).
 */
import { plainName, type TgMessage } from "./telegram";
import { consumeTelegramCode, linkTelegram, unlinkTelegramId } from "./db/telegramLinks";
import { shortAddress } from "./telegramCommands";

/** What the bot answers. */
export const LINK_REPLY = {
  linked: (account: string) =>
    `Linked to your Lexigotchi profile (${shortAddress(account)}). Your reminders will come here from now on.\n\nChoose which ones in your profile, in the game. Send /unlink to stop them.`,
  stale: "That link has expired, or was used already. Open your profile in the game and tap Link Telegram again.",
  failed: "I couldn’t link you just now. Please try again in a minute.",
  unlinked: "Unlinked. I won’t send reminders here any more.",
  notLinked: "This Telegram account isn’t linked to a profile. Open your profile in the game and tap Link Telegram.",
  privateOnly: "Send me that in a private chat.",
} as const;

/** A start link's code: what `createTelegramCode` makes, and nothing else is looked up. */
const CODE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * `/start <code>` in a private chat: link this Telegram account to the code's profile, and say so.
 * Null when there is no code (a plain `/start`: the caller greets). Never throws.
 */
export async function linkFromStart(m: TgMessage, args: string): Promise<string | null> {
  const code = args.trim();
  if (!code) return null;
  if (m.chat.type !== "private" || !m.from || m.from.is_bot) return LINK_REPLY.privateOnly;
  if (!CODE.test(code)) return LINK_REPLY.stale;
  try {
    const account = await consumeTelegramCode(code);
    if (!account) return LINK_REPLY.stale;
    await linkTelegram(account, m.from.id, plainName(m.from) ?? "Telegram");
    return LINK_REPLY.linked(account);
  } catch (err) {
    console.error("[telegram] linking failed:", String((err as Error)?.message ?? err).slice(0, 160));
    return LINK_REPLY.failed;
  }
}

/** `/unlink`: stop the reminders to this Telegram account. Never throws. */
export async function unlinkFrom(m: TgMessage): Promise<string> {
  if (m.chat.type !== "private" || !m.from || m.from.is_bot) return LINK_REPLY.privateOnly;
  try {
    return (await unlinkTelegramId(m.from.id)) ? LINK_REPLY.unlinked : LINK_REPLY.notLinked;
  } catch (err) {
    console.error("[telegram] unlinking failed:", String((err as Error)?.message ?? err).slice(0, 160));
    return LINK_REPLY.failed;
  }
}
