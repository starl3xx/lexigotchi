import { NextResponse } from "next/server";
import { checkAdmin, refusalBody } from "@/lib/admin/serverAuth";
import { isMissingTable } from "@/lib/db/profiles";
import { listReports, REPORT_STATUSES, setReportStatus, type ReportStatus } from "@/lib/db/testerReports";
import { reportRow, type ReportMoved, type ReportsPayload } from "@/lib/admin/reportRows";
import { telegramConfigured } from "@/lib/telegram";
import { tellFixed } from "@/lib/telegramReports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" };

/**
 * GET — the beta testers' reports (the bot's `/bug`: lib/telegramReports), newest first. GATED on
 * the server (lib/admin/serverAuth.ts): these are testers' own words from a private group, with
 * their Telegram names. Never cached.
 */
export async function GET(req: Request) {
  const gate = await checkAdmin(req);
  if (!gate.ok) return NextResponse.json(refusalBody(gate), { status: gate.status, headers: NO_STORE });
  try {
    return NextResponse.json({ ok: true, ready: true, reports: (await listReports()).map(reportRow) } satisfies ReportsPayload, { headers: NO_STORE });
  } catch (err) {
    if (isMissingTable(err)) return NextResponse.json({ ok: true, ready: false, reports: [] } satisfies ReportsPayload, { headers: NO_STORE });
    console.error("[admin/reports] failed:", String((err as Error)?.message ?? err).slice(0, 200));
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}

/** The longest note the operator may add to a "fixed" reply. */
const NOTE_MAX = 500;

/**
 * POST `{ id, status, note? }` — mark a report fixed, closed, or open again. Same gate.
 *
 * Marking it FIXED tells its reporter: the bot replies to the report where it was filed (with the
 * operator's `note`, if any). Once: only the call that moves the report to "fixed" sends, so two
 * taps or two operators can't thank a tester twice. Closing or reopening tells nobody. The answer
 * says whether the reporter was told (`told`), and why not when the send failed: the report is
 * fixed either way.
 */
export async function POST(req: Request) {
  const gate = await checkAdmin(req);
  if (!gate.ok) return NextResponse.json(refusalBody(gate), { status: gate.status, headers: NO_STORE });

  const body = (await req.json().catch(() => null)) as { id?: unknown; status?: unknown; note?: unknown } | null;
  const id = typeof body?.id === "number" && Number.isInteger(body.id) && body.id > 0 ? body.id : null;
  const status = (REPORT_STATUSES as readonly unknown[]).includes(body?.status) ? (body!.status as ReportStatus) : null;
  if (id === null || status === null) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400, headers: NO_STORE });
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, NOTE_MAX) : "";

  let moved;
  try {
    moved = await setReportStatus(id, status);
  } catch (err) {
    console.error("[admin/reports] update failed:", String((err as Error)?.message ?? err).slice(0, 200));
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
  if (!moved) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers: NO_STORE });

  /** null: nobody to tell (not a move to "fixed"). */
  let told: boolean | null = null;
  let tellError: string | undefined;
  if (status === "fixed" && moved.changed) {
    if (!telegramConfigured()) {
      told = false;
      tellError = "The bot isn’t set up on this deployment.";
    } else {
      try {
        await tellFixed(moved.report, note);
        told = true;
      } catch (err) {
        told = false;
        tellError = err instanceof Error ? err.message.slice(0, 200) : "The message could not be sent.";
      }
    }
  }
  return NextResponse.json({ ok: true, report: reportRow(moved.report), told, tellError } satisfies ReportMoved, { headers: NO_STORE });
}
