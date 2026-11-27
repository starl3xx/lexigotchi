/**
 * Beta testers' reports (schema.ts `tester_reports`, migration 0019), filed with the Telegram bot's
 * `/bug` (lib/telegramReports.ts). Server-only, and PRIVATE: read only behind the admin gate.
 *
 * A missing table (`isMissingTable`: the migration hasn't run) is "not set up yet" to every caller:
 * the bot says it couldn't save the report, and the console says the migration is owed.
 */
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { getDb } from "./client";
import { testerReports, type TesterReport } from "./schema";
import type { ReportStatus } from "@/lib/admin/reportRows";

export interface NewReport {
  chatId: number;
  messageId: number | null;
  reporterId: number;
  reporterName: string;
  text: string;
  photoFileId: string | null;
}

/** Save a report and give its number. Throws on a database error (a missing table included). */
export async function addReport(r: NewReport): Promise<number> {
  const rows = await getDb().insert(testerReports).values(r).returning({ id: testerReports.id });
  return rows[0].id;
}

/** The reports, newest first. Throws on a database error (a missing table included). */
export async function listReports(limit = 200): Promise<TesterReport[]> {
  return getDb().select().from(testerReports).orderBy(desc(testerReports.createdAt), desc(testerReports.id)).limit(limit);
}

export async function getReport(id: number): Promise<TesterReport | null> {
  const rows = await getDb().select().from(testerReports).where(eq(testerReports.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Move a report to `status`. Gives the report as it now stands, and whether THIS call moved it:
 * two operators (or two taps) marking one report fixed must tell its reporter once, so the change
 * is one statement that only the first of them wins. Null when there is no such report.
 */
export async function setReportStatus(id: number, status: ReportStatus): Promise<{ report: TesterReport; changed: boolean } | null> {
  const moved = await getDb()
    .update(testerReports)
    .set({ status, updatedAt: sql`now()` })
    .where(and(eq(testerReports.id, id), ne(testerReports.status, status)))
    .returning();
  if (moved[0]) return { report: moved[0], changed: true };
  const report = await getReport(id);
  return report ? { report, changed: false } : null;
}
