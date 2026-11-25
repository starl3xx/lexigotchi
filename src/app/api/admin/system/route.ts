import { NextResponse } from "next/server";
import { checkAdmin, refusalBody } from "@/lib/admin/serverAuth";
import { loadSystem } from "@/lib/admin/systemStatus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET — the operator console's System tab (lib/admin/systemStatus.ts): the game mode, every server
 * key as its public address with its gas and onchain wiring, the keeper's progress, every feature
 * switch, and the applied migrations. Gated (lib/admin/serverAuth.ts) and never cached: it is a map
 * of this deployment's keys and switches. Setting names only, never a value.
 */
export async function GET(req: Request) {
  const headers = { "cache-control": "no-store" };
  const gate = await checkAdmin(req);
  if (!gate.ok) return NextResponse.json(refusalBody(gate), { status: gate.status, headers });
  try {
    return NextResponse.json(await loadSystem(), { headers });
  } catch (err) {
    console.error("[admin/system] failed:", (err as Error).message?.slice(0, 200));
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503, headers });
  }
}
