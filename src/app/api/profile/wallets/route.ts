import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { clientIp } from "@/lib/auth/clientIp";
import { allow } from "@/lib/ratelimit";
import { sessionAccountOf } from "@/lib/profile/account";
import { profilesEnabled } from "@/lib/profile/session";
import { accountView, isMissingTable } from "@/lib/db/profiles";
import { unlinkWallet, walletsOfAccount } from "@/lib/db/walletLinks";
import { accountClaimedToday } from "@/lib/onchain/dailyIdentity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * DELETE `{ address }` (with a session for any wallet in the account) → the account's profile view:
 * takes a wallet out of the account. Not the account's first wallet (unlink the others instead), and
 * not on a day the account took its free letter: a wallet that leaves takes its keys out of the
 * account's one-letter check and could pull again today. Fails closed if the chain can't say.
 */
export async function DELETE(req: Request) {
  if (!profilesEnabled()) return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  const account = await sessionAccountOf(req);
  if (!account) return NextResponse.json({ ok: false, error: "no_session" }, { status: 401 });
  if (!(await allow("profile", clientIp(req)))) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { address?: string } | null;
  if (!body?.address || !isAddress(body.address)) return NextResponse.json({ ok: false, error: "bad_address" }, { status: 400 });
  const target = body.address.toLowerCase();
  try {
    const wallets = await walletsOfAccount(account);
    if (!wallets.includes(target)) return NextResponse.json({ ok: false, error: "not_linked" }, { status: 409 });
    if (target === account) return NextResponse.json({ ok: false, error: "first_wallet" }, { status: 409 });
    let claimed: boolean;
    try {
      claimed = await accountClaimedToday(account);
    } catch (err) {
      console.error("[wallets] couldn't check today's daily:", err instanceof Error ? err.message : err);
      return NextResponse.json({ ok: false, error: "try_again" }, { status: 503 });
    }
    if (claimed) return NextResponse.json({ ok: false, error: "claimed_today" }, { status: 409 });
    await unlinkWallet(account, target);
    return NextResponse.json({ ok: true, profile: await accountView(account) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (isMissingTable(err)) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
    throw err;
  }
}
