import { NextResponse } from "next/server";
import { checkAdmin, refusalBody } from "@/lib/admin/serverAuth";
import { MESSAGE_MAX, chatMemberCount, pollError, sendMessage, sendPoll, telegramConfigured } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" };

/** What the Broadcast tab reads before it offers to send. */
export interface TelegramBroadcastState {
  ok: true;
  /** The bot's token and the group are set on this deployment. */
  configured: boolean;
  /** How many members the group has (the bot and the operator included), or null. */
  members: number | null;
}

/**
 * GET — whether this deployment can post to the beta testers' Telegram group, and to how many.
 * GATED on the server (lib/admin/serverAuth.ts): the same gate as the POST below, so the tab offers
 * its sign-in before anyone has typed anything.
 */
export async function GET(req: Request) {
  const gate = await checkAdmin(req);
  if (!gate.ok) return NextResponse.json(refusalBody(gate), { status: gate.status, headers: NO_STORE });
  const configured = telegramConfigured();
  return NextResponse.json({ ok: true, configured, members: configured ? await chatMemberCount() : null } satisfies TelegramBroadcastState, { headers: NO_STORE });
}

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "");

/**
 * POST — send a message or a poll to the beta group AS THE BOT, from the operator console's
 * Broadcast tab:
 *   `{ kind: "message", text }`
 *   `{ kind: "poll", question, options: string[], named?, multiple? }`
 *
 * GATED on the server: this speaks to every tester in the game's name, so the route itself is the
 * boundary. A wallet session for an allowlisted wallet, or an allowlisted Farcaster FID;
 * `NEXT_PUBLIC_ADMIN_OPEN` does NOT open it in production (lib/admin/serverAuth.ts).
 *
 * The words go out as typed, with no parse mode and no link preview. Anything Telegram would
 * refuse is refused here first, with the reason. A send that fails answers 502 with Telegram's own
 * words; nothing is retried, because after a timeout the post may already be in the group.
 */
export async function POST(req: Request) {
  const gate = await checkAdmin(req);
  if (!gate.ok) return NextResponse.json(refusalBody(gate), { status: gate.status, headers: NO_STORE });
  const refuse = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
  if (!telegramConfigured()) return refuse("The bot isn’t set up on this deployment.", 503);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const chatId = process.env.TELEGRAM_CHAT_ID!;
  try {
    if (body?.kind === "message") {
      const text = clean(body.text);
      if (!text) return refuse("There is nothing to send.");
      if (text.length > MESSAGE_MAX) return refuse(`The message is ${text.length} characters (Telegram takes ${MESSAGE_MAX}).`);
      await sendMessage(chatId, text);
    } else if (body?.kind === "poll") {
      const poll = {
        question: clean(body.question),
        options: Array.isArray(body.options) ? body.options.map(clean) : [],
        named: body.named === true,
        multiple: body.multiple === true,
      };
      const why = pollError(poll);
      if (why) return refuse(why);
      await sendPoll(chatId, poll);
    } else {
      return refuse("Send a message or a poll.");
    }
  } catch (err) {
    // Telegram's own words (lib/telegram never puts the token in an error).
    return refuse(err instanceof Error ? err.message.slice(0, 200) : "The post could not be sent.", 502);
  }
  console.log(`[admin/telegram] ${gate.who} sent a ${body.kind} to the beta group`);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
