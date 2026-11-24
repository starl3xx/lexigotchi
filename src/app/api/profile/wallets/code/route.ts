import { NextResponse } from "next/server";
import { clientIp } from "@/lib/auth/clientIp";
import { allow } from "@/lib/ratelimit";
import { sessionAccountOf } from "@/lib/profile/account";
import { profilesEnabled } from "@/lib/profile/session";
import { isMissingTable } from "@/lib/db/profiles";
import { MAX_ACCOUNT_WALLETS, createLinkCode, walletsOfAccount } from "@/lib/db/walletLinks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST (with the account's session) → `{ code, expiresAt, account }`: a single-use code the wallet
 * joining the account signs inside its link message (/api/profile/wallets/message, then /link). The
 * code can travel: the same browser after a wallet switch, another device, or a Farcaster host.
 */
export async function POST(req: Request) {
  if (!profilesEnabled()) return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  const account = await sessionAccountOf(req);
  if (!account) return NextResponse.json({ ok: false, error: "no_session" }, { status: 401 });
  if (!(await allow("profile", clientIp(req)))) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  try {
    if ((await walletsOfAccount(account)).length >= MAX_ACCOUNT_WALLETS) {
      return NextResponse.json({ ok: false, error: "too_many" }, { status: 409 });
    }
    const { code, expiresAt } = await createLinkCode(account);
    return NextResponse.json({ ok: true, code, expiresAt: expiresAt.toISOString(), account }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (isMissingTable(err)) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
    throw err;
  }
}
