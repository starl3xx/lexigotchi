import { NextResponse } from "next/server";
import { isChainBacked } from "@/lib/onchain/gameMode";
import { sendMessage, sendPhoto, telegramConfigured } from "@/lib/telegram";
import { ALERTS_PER_RUN, alertMark, alertPost, readAlertClaims } from "@/lib/telegramAlerts";
import { nameOf } from "@/lib/telegramCommands";
import { claimMark, releaseMark } from "@/lib/db/reminderMarks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** The send-once mark's owner and kind in `reminder_marks`: one alert per claim. */
const MARK = { account: "telegram:group", kind: "mythic" };

/**
 * GET — the beta group's Mythic-word alert (lib/telegramAlerts), scheduled by vercel.json every
 * five minutes: each fresh claim of a Mythic word is announced once, with the word's card.
 *
 * It posts to real people, unasked, so it carries the daily recap's guards
 * (/api/cron/telegram-recap):
 * - **Production only.** A preview build or a local server holds the same secrets and never posts.
 * - **Once per claim:** the claim's mark is CLAIMED in `reminder_marks` before the send, so the
 *   next run (the claim is still fresh for half an hour) finds it taken. With no mark to claim (no
 *   table, or the write failed) nothing is posted.
 * - A send Telegram clearly refuses gives the mark back; after a timeout the post may be in the
 *   group, so the mark stays.
 * - At most `ALERTS_PER_RUN` posts a run; the rest are still fresh at the next one.
 *
 * `TELEGRAM_ALERTS=off` mutes it. Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`; fails
 * closed in production without it.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.error("[cron/telegram-alerts] CRON_SECRET not set: refusing in production");
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 401 });
  }

  const skip = (skipped: string) => NextResponse.json({ ok: true, skipped });
  if (process.env.NODE_ENV !== "production") return skip("not_production");
  if (process.env.TELEGRAM_ALERTS === "off") return skip("off");
  if (!telegramConfigured()) return skip("telegram_not_configured");
  if (!isChainBacked()) return skip("practice_mode");

  let claims;
  try {
    claims = await readAlertClaims();
  } catch (err) {
    // Nothing is lost: the claims are still fresh at the next run.
    console.error("[cron/telegram-alerts] couldn't read the claims:", String((err as Error)?.message ?? err).slice(0, 200));
    return NextResponse.json({ ok: false, error: "unread" }, { status: 503 });
  }

  const chatId = process.env.TELEGRAM_CHAT_ID!;
  const posted: string[] = [];
  let failed = 0;
  for (const claim of claims) {
    if (posted.length >= ALERTS_PER_RUN) break;
    const mark = alertMark(claim);
    if ((await claimMark(MARK.account, MARK.kind, mark)) !== "claimed") continue;
    const post = alertPost(claim, await nameOf(claim.owner));
    try {
      // The card, uploaded by us as the welcome's is; without it the words still go.
      const card = await fetch(post.photoUrl, { signal: AbortSignal.timeout(15_000) })
        .then((res) => (res.ok ? res.blob() : null))
        .catch(() => null);
      // A picture Telegram clearly refuses is not a reason to say nothing: the words go alone.
      // (Only on a clear refusal: after a timeout the picture may already be in the group.)
      const pictured = card
        ? await sendPhoto(chatId, card, post.text, { bold: post.bold }).then(
            () => true,
            (err) => {
              if (!(err instanceof Error && /Bad Request/i.test(err.message))) throw err;
              console.warn(`[cron/telegram-alerts] ${claim.word}: picture refused, sending the words alone:`, err.message);
              return false;
            },
          )
        : false;
      if (!pictured) await sendMessage(chatId, post.text, { bold: post.bold });
      posted.push(claim.word);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      // Telegram's own "no": nothing was posted, so the next run may try this claim again.
      if (/Bad Request|Forbidden|Unauthorized/i.test(why)) await releaseMark(MARK.account, MARK.kind, mark);
      console.error(`[cron/telegram-alerts] ${claim.word} not posted:`, why);
      failed++;
    }
  }
  return NextResponse.json({ ok: failed === 0, posted }, { status: failed === 0 ? 200 : 500 });
}
