import { NextResponse } from "next/server";
import { isChainBacked } from "@/lib/onchain/gameMode";
import { sendMessage, telegramConfigured } from "@/lib/telegram";
import { readRecap, recapPost } from "@/lib/telegramRecap";
import { claimMark, releaseMark } from "@/lib/db/reminderMarks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** The send-once mark's owner and kind in `reminder_marks`: one recap per chain day. */
const MARK = { account: "telegram:group", kind: "recap" };

/**
 * GET — the beta group's daily recap (lib/telegramRecap), scheduled by vercel.json at 00:20 UTC,
 * after the keeper's 00:05 draw, and again at 02:20 for a day the draw ran late.
 *
 * It posts to real people, unasked, so every way of posting twice or by mistake is closed first:
 * - **Production only.** A preview build or a local server holds the same secrets and never posts.
 * - **Once a day:** the chain day's mark is CLAIMED in `reminder_marks` before the send (the second
 *   run finds it taken). With no mark to claim (no table, or the write failed) nothing is posted:
 *   "nobody was sent this" would be a guess.
 * - **Only after today's draw.** No draw yet: skipped, with nothing claimed, so the later run posts.
 * - A send Telegram clearly refuses gives the mark back; after a timeout the post may be in the
 *   group, so the mark stays.
 *
 * `TELEGRAM_RECAP=off` mutes it. Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`; fails
 * closed in production without it.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.error("[cron/telegram-recap] CRON_SECRET not set: refusing in production");
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 401 });
  }

  const skip = (skipped: string) => NextResponse.json({ ok: true, skipped });
  if (process.env.NODE_ENV !== "production") return skip("not_production");
  if (process.env.TELEGRAM_RECAP === "off") return skip("off");
  if (!telegramConfigured()) return skip("telegram_not_configured");
  if (!isChainBacked()) return skip("practice_mode");

  const recap = await readRecap();
  if (!recap.ok) {
    console.log(`[cron/telegram-recap] no recap yet: ${recap.why}`);
    return skip(recap.why);
  }

  const mark = String(recap.day);
  const claim = await claimMark(MARK.account, MARK.kind, mark);
  if (claim !== "claimed") return skip(claim === "taken" ? "already_posted" : "no_mark");

  const post = recapPost(recap.facts);
  try {
    await sendMessage(process.env.TELEGRAM_CHAT_ID!, post.text, { bold: post.bold });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    // Telegram's own "no" (a bad request, the bot removed): nothing was posted, so today can be tried again.
    if (/Bad Request|Forbidden|Unauthorized/i.test(why)) await releaseMark(MARK.account, MARK.kind, mark);
    console.error("[cron/telegram-recap] not posted:", why);
    return NextResponse.json({ ok: false, error: "send_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, posted: recap.day });
}
