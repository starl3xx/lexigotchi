import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { quickAuthDomain } from "@/lib/auth/quickAuth";
import { clientIp } from "@/lib/auth/clientIp";
import { allow } from "@/lib/ratelimit";
import { NETWORK } from "@/lib/onchain/network";
import { linkMessage, profilesEnabled } from "@/lib/profile/session";
import { isMissingTable } from "@/lib/db/profiles";
import { peekLinkCode } from "@/lib/db/walletLinks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST `{ code, address }` → `{ message, account }`: the link message for the joining wallet to sign,
 * naming the account the code belongs to. The code is only read here; /link uses it up.
 */
export async function POST(req: Request) {
  if (!profilesEnabled()) return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  if (!(await allow("profile", clientIp(req)))) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { code?: string; address?: string } | null;
  if (typeof body?.code !== "string" || !/^[0-9a-f]{24}$/.test(body.code) || !body.address || !isAddress(body.address)) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  try {
    const live = await peekLinkCode(body.code);
    if (!live) return NextResponse.json({ ok: false, error: "stale_code" }, { status: 410 });
    const message = linkMessage({ address: body.address, account: live.account, code: body.code, domain: quickAuthDomain(req), chainId: NETWORK.id });
    return NextResponse.json({ ok: true, message, account: live.account }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (isMissingTable(err)) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
    throw err;
  }
}
