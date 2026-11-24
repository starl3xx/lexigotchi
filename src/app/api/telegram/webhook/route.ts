import { NextResponse } from "next/server";
import { showcaseCardUrl } from "@/lib/showcase";
import { sendPhoto, telegramConfigured, webhookSecretMatches, welcomeFor, type TgUpdate } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Telegram's webhook for @lexigotchi_bot (src/lib/telegram.ts). Today it does one thing: when
 * someone joins the beta testers' group, it greets them with the HEYOO card (the same picture a
 * Showcase of HEYOO shares, `/s/HEYOO/card`).
 *
 * Fails closed: without the token, the chat, and the secret it answers 404, and a request without
 * Telegram's secret header answers 401. After that it always answers 200, because Telegram retries
 * anything else and a retried join would greet twice; a failure is logged instead.
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
  if (!welcome) return NextResponse.json({ ok: true });

  try {
    // Upload the card ourselves rather than hand Telegram its URL: nothing then depends on
    // Telegram's servers fetching our site.
    const card = await fetch(showcaseCardUrl("HEYOO"));
    if (!card.ok) throw new Error(`HEYOO card: ${card.status}`);
    const png = await card.blob();
    try {
      await sendPhoto(chatId, png, welcome.caption, welcome.mentions);
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
