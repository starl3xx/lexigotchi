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
import { and, eq } from "drizzle-orm";
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
