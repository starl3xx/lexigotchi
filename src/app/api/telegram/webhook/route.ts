import { NextResponse } from "next/server";
import { showcaseCardUrl } from "@/lib/showcase";
import { commandOf, sendMessage, sendPhoto, telegramConfigured, webhookSecretMatches, welcomeFor, type TgMessage, type TgUpdate } from "@/lib/telegram";
import { answer } from "@/lib/telegramCommands";
import { afterResponse } from "@/lib/afterResponse";
import { allow } from "@/lib/ratelimit";
import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A command's answer is written after the response has gone (below), and reads the chain: each
// read has its own short wait (lib/telegramCommands), so this is far more than it should need.
export const maxDuration = 60;

/**
 * Telegram's webhook for @lexigotchi_bot (src/lib/telegram.ts). It does two things:
 *
 * - **Greets a new member** of the beta testers' group with the HEYOO card (`/s/HEYOO/card`, the
 *   Showcase card drawing; HEYOO isn't a dictionary word, so it is one of lib/showcase's HOUSE_CARDS).
 * - **Answers a command** (`/help`, `/status`, `/jackpot`, `/bounty`, `/word CRANE`:
 *   lib/telegramCommands), in the beta group or in a private chat with the bot, as a reply to the
 *   message that asked.
 *
 * The bot is an administrator of the group, so Telegram sends it every message there. Only a join
 * and a command are acted on; nothing else is read, and no message's words are ever logged.
 *
 * Fails closed: without the token, the chat, and the secret it answers 404, and a request without
 * Telegram's secret header answers 401. After that it always answers 200, because Telegram retries
 * anything else and a retried join would greet twice; a failure is logged instead. A command is
 * answered AFTER the 200 has gone: its reads can take seconds, and Telegram sends an update again
 * when the response is slow.
 */
export async function POST(req: Request) {
  if (!telegramConfigured()) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 404 });
  if (!webhookSecretMatches(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const update = (await req.json().catch(() => null)) as TgUpdate | null;
  const chatId = process.env.TELEGRAM_CHAT_ID!;
  if (update?.message?.migrate_to_chat_id) {
    // A basic group Telegram upgrades to a supergroup gets a new id; greetings stop until the
    // setting follows it.
    console.warn(`[telegram] the beta group moved: set TELEGRAM_CHAT_ID to ${update.message.migrate_to_chat_id}`);
  }
  const welcome = update ? welcomeFor(update, chatId) : null;
  if (!welcome) {
    const m = update?.message;
    const cmd = commandOf(m);
    if (m && cmd && commandAllowedIn(m, chatId)) afterResponse(() => answerCommand(update.update_id, m, cmd));
    return NextResponse.json({ ok: true });
  }

  try {
    // Upload the card ourselves rather than hand Telegram its URL: nothing then depends on
    // Telegram's servers fetching our site. It goes as a bare picture, with no link card around it,
    // so it is the saved picture: the one with the game's name in its corner (decisions.md #23).
    const card = await fetch(showcaseCardUrl("HEYOO", "x", undefined, true));
    if (!card.ok) throw new Error(`HEYOO card: ${card.status}`);
    const png = await card.blob();
    try {
      await sendPhoto(chatId, png, welcome.caption, { mentions: welcome.mentions });
    } catch (err) {
      // If Telegram won't make a mention of someone, greet them by name anyway rather than not at
      // all. Only on a clear refusal ("Bad Request"): after a timeout or a server error the photo
      // may already be in the group, and a second one would greet twice.
      if (welcome.mentions.length === 0 || !(err instanceof Error && /Bad Request/i.test(err.message))) throw err;
      console.warn("[telegram] welcome with mentions refused, sending without:", err instanceof Error ? err.message : err);
      await sendPhoto(chatId, png, welcome.caption);
    }
  } catch (err) {
    console.error("[telegram] welcome failed:", err instanceof Error ? err.message : err);
  }
  return NextResponse.json({ ok: true });
}

/**
 * Commands are answered in THE beta group and in a private chat with the bot, from a person. Not
 * in any other group the bot is added to, and never to a bot (two bots could answer each other
 * for ever).
 */
function commandAllowedIn(m: TgMessage, chatId: string): boolean {
  if (!m.from || m.from.is_bot) return false;
  return String(m.chat.id) === chatId || m.chat.type === "private";
}

/** How long an update's number is remembered: Telegram gives up on an update long before a day. */
const SEEN_FOR_S = 86_400;

/**
 * True the first time an update is seen. Telegram sends an update again when it gets no quick 200,
 * so the same command can arrive twice. Without Redis (or when it fails) every update is new: an
 * answer given twice is better than none.
 */
async function firstTime(updateId: number | undefined): Promise<boolean> {
  const redis = getRedis();
  if (!redis || updateId === undefined) return true;
  try {
    return (await redis.set(`tg:update:${updateId}`, 1, { nx: true, ex: SEEN_FOR_S })) !== null;
  } catch {
    return true;
  }
}

/**
 * Answer one command, as a reply to the message that asked. Never throws (it runs after the
 * response). Logs the command's NAME on a failure, never its words.
 */
async function answerCommand(updateId: number | undefined, m: TgMessage, cmd: { name: string; args: string }): Promise<void> {
  try {
    if (!(await firstTime(updateId))) return;
    // One person asking faster than they can read gets no answer, quietly: a "slow down" in the
    // group for each try would be the flood.
    if (!(await allow("telegram", m.from!.id))) return;
    const reply = await answer(cmd, { private: m.chat.type === "private" });
    if (!reply) return;
    const to = { replyTo: m.message_id };
    // The card, uploaded by us as the welcome's is. Without it (the picture is slow to draw, or
    // Telegram refuses it) the words still go.
    let card: Blob | null = null;
    if (reply.photoUrl) {
      try {
        const res = await fetch(reply.photoUrl, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(String(res.status));
        card = await res.blob();
      } catch (err) {
        console.warn(`[telegram] /${cmd.name}: no picture:`, err instanceof Error ? err.message : err);
      }
    }
    if (card) {
      try {
        return await sendPhoto(m.chat.id, card, reply.text, to);
      } catch (err) {
        // Only on a clear refusal: after a timeout or a server error the picture may already be
        // in the chat, and the words after it would answer twice.
        if (!(err instanceof Error && /Bad Request/i.test(err.message))) throw err;
        console.warn(`[telegram] /${cmd.name}: picture refused, sending the words alone:`, err.message);
      }
    }
    await sendMessage(m.chat.id, reply.text, to);
  } catch (err) {
    console.error(`[telegram] /${cmd.name} failed:`, err instanceof Error ? err.message : err);
  }
}
