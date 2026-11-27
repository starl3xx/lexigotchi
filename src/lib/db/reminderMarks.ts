/**
 * Send-once marks (`reminder_marks`, migration 0018): "this account was sent this kind for this
 * thing". A sender CLAIMS the mark before it sends, so two passes that find the same thing can't
 * both send it; a send that then fails gives the mark back.
 *
 * With no table (the migration hasn't run) nothing can be claimed, and the answer says so: a kind
 * that needs a mark is not sent until it can keep one. That is the opposite of the choices'
 * missing table (lib/db/reminderPrefs.ts), on purpose: there, "nobody chose" is a true reading;
 * here, "nobody was sent" would be a guess.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./client";
import { reminderMarks } from "./schema";
import { isMissingTable } from "./profiles";

export type MarkClaim = "claimed" | "taken" | "unavailable";

/** Take the mark. "taken": it was sent before. "unavailable": no table yet, or the write failed. */
export async function claimMark(account: string, kind: string, mark: string): Promise<MarkClaim> {
  try {
    const rows = await getDb().insert(reminderMarks).values({ account: account.toLowerCase(), kind, mark }).onConflictDoNothing().returning({ mark: reminderMarks.mark });
    return rows.length > 0 ? "claimed" : "taken";
  } catch (err) {
    if (!isMissingTable(err)) console.error("[reminders] couldn't keep a send-once mark:", String((err as Error)?.message ?? err).slice(0, 160));
    return "unavailable";
  }
}

/**
 * Take a mark that may be taken AGAIN once it is old enough: "this account was told this, and not
 * in the last `everySeconds`". For a nudge that may repeat, but not often (the deal alert:
 * lib/notify/deals.ts). One statement, so two passes at once can't both take it. "taken": told
 * within the time. "unavailable": no table yet, or the write failed.
 */
export async function claimMarkEvery(account: string, kind: string, mark: string, everySeconds: number): Promise<MarkClaim> {
  try {
    const rows = await getDb()
      .insert(reminderMarks)
      .values({ account: account.toLowerCase(), kind, mark })
      .onConflictDoUpdate({
        target: [reminderMarks.account, reminderMarks.kind, reminderMarks.mark],
        set: { at: sql`now()` },
        // The database's own clock on both sides, never a JS Date (a Date parameter shifts by the server's offset).
        setWhere: sql`${reminderMarks.at} < now() - make_interval(secs => ${everySeconds})`,
      })
      .returning({ mark: reminderMarks.mark });
    return rows.length > 0 ? "claimed" : "taken";
  } catch (err) {
    if (!isMissingTable(err)) console.error("[reminders] couldn't keep a send-once mark:", String((err as Error)?.message ?? err).slice(0, 160));
    return "unavailable";
  }
}

/**
 * Whether a mark is taken, without taking it: true, false, or null when that can't be told (no
 * table, or the read failed). For a sender that has work to do before it claims (a picture to
 * draw): it skips what was already sent, and still CLAIMS before it sends. Never a reason to send.
 */
export async function hasMark(account: string, kind: string, mark: string): Promise<boolean | null> {
  try {
    const rows = await getDb()
      .select({ mark: reminderMarks.mark })
      .from(reminderMarks)
      .where(and(eq(reminderMarks.account, account.toLowerCase()), eq(reminderMarks.kind, kind), eq(reminderMarks.mark, mark)))
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    if (!isMissingTable(err)) console.error("[reminders] couldn't read a send-once mark:", String((err as Error)?.message ?? err).slice(0, 160));
    return null;
  }
}

/** Give a mark back: the send it was claimed for didn't happen. Never throws. */
export async function releaseMark(account: string, kind: string, mark: string): Promise<void> {
  try {
    await getDb()
      .delete(reminderMarks)
      .where(and(eq(reminderMarks.account, account.toLowerCase()), eq(reminderMarks.kind, kind), eq(reminderMarks.mark, mark)));
  } catch (err) {
    console.error("[reminders] couldn't give a send-once mark back:", String((err as Error)?.message ?? err).slice(0, 160));
  }
}
