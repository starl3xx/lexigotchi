import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { isAddress, getAddress } from "viem";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET `?wallets=0xa,0xb` — the union bag's earned achievements, read from the EAS indexer.
 *
 * Attestations are public composable state; this route just aggregates the bag's wallets and
 * dedupes to the best value per achievement. Only OUR schema and OUR attester count — anyone can
 * attest anything on EAS, so both filters are load-bearing.
 */
const INDEXER = "https://base-sepolia.easscan.org/graphql";

function registry(): { schema: string; attester: string } {
  const cfg = JSON.parse(readFileSync("config/deployments.base-sepolia.json", "utf8"));
  return { schema: cfg.easAchievementsSchema, attester: cfg.roles.keeper };
}

export async function GET(req: Request) {
  if (!(await allow("status", clientIp(req)))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const raw = new URL(req.url).searchParams.get("wallets") ?? "";
  const wallets = raw.split(",").map((w) => w.trim().toLowerCase()).filter((w) => isAddress(w, { strict: false }));
  if (wallets.length === 0) return NextResponse.json({ ok: false, error: "bad_wallets" }, { status: 400 });

  const { schema, attester } = registry();
  if (!schema) return NextResponse.json({ ok: true, achievements: [] });

  try {
    const res = await fetch(INDEXER, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `query($schema:String!,$attester:String!,$recipients:[String!]){ attestations(where:{schemaId:{equals:$schema},attester:{equals:$attester},revoked:{equals:false},recipient:{in:$recipients}},take:500){ recipient decodedDataJson }}`,
        // easscan stores recipients CHECKSUMMED — lowercase misses. Send both forms.
        variables: { schema, attester, recipients: [...new Set(wallets.flatMap((w) => [w, getAddress(w)]))] },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json();
    const best = new Map<number, number>();
    for (const a of data?.data?.attestations ?? []) {
      try {
        const fields = JSON.parse(a.decodedDataJson);
        const ach = Number(fields.find((f: { name: string }) => f.name === "achievement")?.value?.value ?? 0);
        const val = Number(fields.find((f: { name: string }) => f.name === "value")?.value?.value ?? 0);
        if (ach) best.set(ach, Math.max(best.get(ach) ?? 0, val));
      } catch { /* skip unparseable */ }
    }
    return NextResponse.json({
      ok: true,
      achievements: [...best.entries()].map(([achievement, value]) => ({ achievement, value })),
    });
  } catch (err) {
    console.error("[achievements] indexer failed:", err);
    return NextResponse.json({ ok: false, error: "indexer_unavailable" }, { status: 502 });
  }
}
