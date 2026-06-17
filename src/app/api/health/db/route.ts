import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic"; // never statically cache a liveness probe
export const runtime = "nodejs"; // postgres-js needs the Node runtime (not edge)

/** Lightweight DB liveness probe: `SELECT 1`. Returns `{ ok }` only — no schema or data leaked. */
export async function GET() {
  const started = Date.now();
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ ok: true, ms: Date.now() - started });
  } catch (err) {
    console.error("[health/db] connection failed:", err);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
