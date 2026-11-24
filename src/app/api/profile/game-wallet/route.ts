import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { profilesEnabled } from "@/lib/profile/session";
import { sessionAccountOf } from "@/lib/profile/account";
import { walletsOfAccount } from "@/lib/db/walletLinks";
import { setGameWallet } from "@/lib/db/gameWallet";
import { accountView, isMissingTable } from "@/lib/db/profiles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST `{ wallet }` — choose the account's game wallet (lib/db/gameWallet.ts). Needs a session
 * from any wallet in the account, and the chosen wallet must be in it. Answers the account view.
 */
export async function POST(req: Request) {
  if (!profilesEnabled()) return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  const account = await sessionAccountOf(req);
  if (!account) return NextResponse.json({ ok: false, error: "no_session" }, { status: 401 });
  if (!(await allow("profile", clientIp(req)))) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { wallet?: string } | null;
  if (!body?.wallet || !isAddress(body.wallet, { strict: false })) return NextResponse.json({ ok: false, error: "bad_wallet" }, { status: 400 });
  const wallet = body.wallet.toLowerCase();
  if (!(await walletsOfAccount(account)).includes(wallet)) return NextResponse.json({ ok: false, error: "not_linked" }, { status: 409 });
  try {
    await setGameWallet(account, wallet);
  } catch (err) {
    if (isMissingTable(err)) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
    throw err;
  }
  return NextResponse.json({ ok: true, profile: await accountView(account) }, { headers: { "Cache-Control": "no-store" } });
}
