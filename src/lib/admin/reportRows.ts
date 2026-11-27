/**
 * The Reports tab's rows: a beta tester's report (the bot's `/bug`: lib/telegramReports) as the
 * operator console shows it. Pure, so the tab can import the types and the tests the functions.
 */
import type { TesterReport } from "@/lib/db/schema";
import { REPORT_STATUSES, type ReportStatus } from "@/lib/db/testerReports";

/** A report as the console shows it. */
export interface ReportRow {
  id: number;
  at: string;
  reporter: string;
  text: string;
  status: ReportStatus;
  /** True when it was typed under a picture (`/api/admin/reports/photo?id=` serves it). */
  hasPhoto: boolean;
  /** Filed in a private chat with the bot, not in the group. */
  private: boolean;
  /** The report's message in Telegram, for a member of the group; null where Telegram has no link for it. */
  link: string | null;
}

export interface ReportsPayload {
  ok: true;
  /** False until migration 0019 has run: there is no table to read. */
  ready: boolean;
  reports: ReportRow[];
}

/** What marking a report answers with. `told`: whether its reporter was told (null: nobody to tell). */
export interface ReportMoved {
  ok: true;
  report: ReportRow;
  told: boolean | null;
  tellError?: string;
}

/**
 * A message's link, which Telegram makes only for a supergroup's messages (chat ids that start
 * "-100"): https://t.me/c/<the id without -100>/<message>. It opens for members of the group only.
 */
export function messageLink(chatId: number, messageId: number | null): string | null {
  const id = String(chatId);
  return messageId && id.startsWith("-100") ? `https://t.me/c/${id.slice(4)}/${messageId}` : null;
}

export function reportRow(r: TesterReport): ReportRow {
  return {
    id: r.id,
    at: r.createdAt.toISOString(),
    reporter: r.reporterName,
    text: r.text,
    status: (REPORT_STATUSES as readonly string[]).includes(r.status) ? (r.status as ReportStatus) : "open",
    hasPhoto: Boolean(r.photoFileId),
    // A private chat's id is the person's own, a positive number; a group's is negative.
    private: r.chatId > 0,
    link: messageLink(r.chatId, r.messageId),
  };
}

/**
 * The address that opens a report as a new issue on GitHub, filled in. The repository is PUBLIC, so
 * the issue carries the report's words and its number only: never the reporter's name.
 */
export function issueUrl(report: Pick<ReportRow, "id" | "text">, repo = "starl3xx/lexigotchi"): string {
  const title = Array.from(report.text.replace(/\s+/g, " ")).slice(0, 70).join("");
  const u = new URL(`https://github.com/${repo}/issues/new`);
  u.searchParams.set("title", title);
  u.searchParams.set("body", `${report.text}\n\nBeta report #${report.id}`);
  return u.toString();
}
