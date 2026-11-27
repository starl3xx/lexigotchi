import { NextResponse } from "next/server";
import { checkAdmin, refusalBody } from "@/lib/admin/serverAuth";
import { getReport } from "@/lib/db/testerReports";
import { telegramFile } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" };

/**
 * GET `?id=` — the screenshot a report was typed under, fetched from Telegram by the bot (only it
 * can: the file's address holds the bot's token, so it is never given to a browser). GATED like the
 * reports themselves (lib/admin/serverAuth.ts), and never cached: a tester's screenshot can show
 * their wallet or their chats.
 */
export async function GET(req: Request) {
  const gate = await checkAdmin(req);
  if (!gate.ok) return NextResponse.json(refusalBody(gate), { status: gate.status, headers: NO_STORE });
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400, headers: NO_STORE });
  const report = await getReport(id).catch(() => null);
  if (!report?.photoFileId) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers: NO_STORE });
  const file = await telegramFile(report.photoFileId);
  if (!file) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 502, headers: NO_STORE });
  return new Response(file.bytes, { headers: { ...NO_STORE, "content-type": file.type, "x-content-type-options": "nosniff" } });
}
