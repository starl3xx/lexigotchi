/**
 * `/bug`: a beta tester tells the team what went wrong, in the group or in a private chat with
 * @lexigotchi_bot (lib/telegram `commandOf`), and the bot answers the report there when the team
 * marks it fixed.
 *
 *   /bug the Roll button stays grey after a miss        (or typed under a screenshot)
 *
 * - **Reports are private.** They are a tester's own words from a private group, so they go to
 *   the database (`tester_reports`, lib/db/testerReports.ts) and the operator console's Reports
 *   tab, never to GitHub: the repository is public. The console can open a report as an issue, and
 *   leaves the reporter out when it does.
 * - **Only the words after the command are kept,** with the reporter's Telegram name and, if the
 *   report was typed under a picture, Telegram's id for it. Nothing else in the chat is read.
 * - **From a tester only.** In a private chat, where anyone on Telegram can type, the sender must
 *   be in the beta group now (`inBetaGroup`).
 * - **Never logged:** a failure logs that a report failed, not what it said.
 * - **House copy rules** (tests/telegram-reports.test.ts): curly apostrophes, no em dashes.
 */
import { inBetaGroup, plainName, sendMessage, type TgMessage } from "./telegram";
import { addReport, type NewReport } from "./db/testerReports";
import type { TesterReport } from "./db/schema";
import { allow } from "./ratelimit";

/** The most characters of a report that are kept. */
export const REPORT_MAX = 2000;

const cut = (s: string, max: number) => {
  const chars = Array.from(s);
  return chars.length > max ? `${chars.slice(0, max).join("").trimEnd()}…` : s;
};

/**
 * The report in a `/bug` message, or null when it says nothing after the command. `args` is the
 * command's own words (lib/telegram `commandOf`).
 */
export function reportOf(m: TgMessage, args: string): NewReport | null {
  // Control characters out (a line break and a tab stay): the words are shown in the console as typed.
  const text = args.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!text) return null;
  // A group admin who posts anonymously arrives as Telegram's stand-in bot: no person to name.
  const anonymous = Boolean(m.from?.is_bot);
  return {
    chatId: m.chat.id,
    messageId: m.message_id ?? null,
    reporterId: m.from?.id ?? m.chat.id,
    reporterName: (anonymous ? null : plainName(m.from)) ?? (anonymous ? "an admin" : "a tester"),
    text: cut(text, REPORT_MAX),
    // The largest size of the picture the report was typed under (Telegram lists them smallest first).
    photoFileId: m.photo?.at(-1)?.file_id ?? null,
  };
}

/** What the bot answers a `/bug` with. */
export const REPORT_REPLY = {
  saved: (id: number) => `Logged as report #${id}. Thank you! Only the team sees it.`,
  empty: "Tell me what went wrong, like this:\n/bug the Roll button stays grey after a miss",
  outsider: "Reports are for the beta testers. Ask in the group if you should be one.",
  busy: "That’s a lot of reports at once. Give me a few minutes, then send the next one.",
  failed: "I couldn’t save that just now. Please tell the team in the chat.",
} as const;

/**
 * File the report in a `/bug` message and give the bot's answer. Never throws: a report that
 * couldn't be saved says so, so the tester tells the team another way.
 */
export async function fileReport(m: TgMessage, args: string): Promise<string> {
  const report = reportOf(m, args);
  if (!report) return REPORT_REPLY.empty;
  if (m.chat.type === "private") {
    const member = await inBetaGroup(report.reporterId);
    if (member === false) return REPORT_REPLY.outsider;
    // Telegram didn't say: refuse to guess either way.
    if (member === null) return REPORT_REPLY.failed;
  }
  if (!(await allow("telegram-report", report.reporterId))) return REPORT_REPLY.busy;
  try {
    return REPORT_REPLY.saved(await addReport(report));
  } catch (err) {
    console.error("[telegram] a report was not saved:", String((err as Error)?.message ?? err).slice(0, 160));
    return REPORT_REPLY.failed;
  }
}

/** How much of a report is quoted back when it is fixed. */
const QUOTE_MAX = 60;

/**
 * What the bot tells a reporter when their report is marked fixed, as a reply to the report. The
 * quote is the reporter's own words, said in the same chat. `note` is the operator's, optional.
 */
export function fixedText(report: Pick<TesterReport, "id" | "text">, note?: string | null): string {
  const quote = cut(report.text.replace(/\s+/g, " "), QUOTE_MAX);
  const said = `Fixed: report #${report.id} (“${quote}”) is fixed in the latest update. Thank you for reporting it!`;
  const more = note?.trim();
  return more ? `${said}\n\n${more}` : said;
}

/** Tell the reporter, where they filed it. Throws with Telegram's own description on failure. */
export async function tellFixed(report: TesterReport, note?: string | null): Promise<void> {
  await sendMessage(report.chatId, fixedText(report, note), { replyTo: report.messageId ?? undefined });
}
