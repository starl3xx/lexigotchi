import { NextResponse } from "next/server";
import { checkAdmin, refusalBody } from "@/lib/admin/serverAuth";
import { loadPlayers, type PlayersPayload } from "@/lib/admin/playersData";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET — the operator console's Players tab: every wallet the game has seen, what each one did, and
 * how far players got (lib/admin/playersData.ts). GATED on the server (lib/admin/serverAuth.ts):
 * this lists who visited and when, which the chain alone doesn't say.
 *
 * One scan serves every caller for a minute (it reads every event since deploy), but only AFTER the
 * caller passes the gate, and never into a shared cache: `no-store`. `?fresh=1` skips the minute.
 */
const TTL_MS = 60_000;
let cached: { at: number; body: PlayersPayload } | null = null;
let inflight: Promise<PlayersPayload> | null = null;

const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: Request) {
  const gate = await checkAdmin(req);
  if (!gate.ok) return NextResponse.json(refusalBody(gate), { status: gate.status, headers: NO_STORE });

  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  if (!fresh && cached && Date.now() - cached.at < TTL_MS) return NextResponse.json(cached.body, { headers: NO_STORE });
  try {
    inflight ??= loadPlayers().finally(() => {
      inflight = null;
    });
    const body = await inflight;
    cached = { at: Date.now(), body };
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (err) {
    console.error("[admin/players] failed:", (err as Error).message?.slice(0, 200));
    if (cached) return NextResponse.json(cached.body, { headers: NO_STORE });
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
