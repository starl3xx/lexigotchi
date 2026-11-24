import { NextResponse } from "next/server";
import { isHex } from "viem";
import { quickAuthDomain } from "@/lib/auth/quickAuth";
import { clientIp } from "@/lib/auth/clientIp";
import { allow } from "@/lib/ratelimit";
import { getPublicClient } from "@/lib/onchain/reads";
import { getMainnetClient } from "@/lib/onchain/mainnet";
import { checkLinkMessage, linkStatement, profilesEnabled, verifyWalletSignature } from "@/lib/profile/session";
import { getProfile, isMissingTable } from "@/lib/db/profiles";
import { accountOf, consumeLinkCode, linkRefusal, linkWallet, peekLinkCode, walletsOfAccount, withLinkLock } from "@/lib/db/walletLinks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST `{ message, signature }` → `{ account, wallets }`: the joining wallet's signed link message
 * (/api/profile/wallets/message) adds it to the account its code names.
 *
 * Refused when: the message isn't a link message (a sign-in message never passes, and the statement
 * must name the code's account), the signature isn't the wallet's, the code was used or expired, the
 * wallet is in another account or heads one of its own, the account is full, or the wallet has its
 * own X link or email (unlink or remove them in that wallet's profile first: nothing is merged or
 * deleted here). Linking adds no daily key, so it can't add a letter (lib/onchain/dailyIdentity.ts).
 */
export async function POST(req: Request) {
  if (!profilesEnabled()) return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  if (!(await allow("profile", clientIp(req)))) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { message?: string; signature?: string } | null;
  if (typeof body?.message !== "string" || typeof body.signature !== "string" || !isHex(body.signature)) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const msg = checkLinkMessage(body.message, quickAuthDomain(req));
  if (!msg.ok) return NextResponse.json({ ok: false, error: msg.reason }, { status: 401 });
  const refuse = (error: string, status = 409) => NextResponse.json({ ok: false, error }, { status });
  try {
    const live = await peekLinkCode(msg.code);
    if (!live) return refuse("stale_code", 410);
    if (msg.statement !== linkStatement(live.account)) return refuse("bad_message", 401);
    if (!(await verifyWalletSignature(msg.address, body.message, body.signature, [getPublicClient(), getMainnetClient()]))) {
      return refuse("bad_signature", 401);
    }
    // Check and write under the lock every link writer takes (withLinkLock), so this link and a
    // Farcaster sync can't cross (A→B while B→A) or overfill the account.
    const linked = await withLinkLock(async () => {
      // The code's account must still head its own account: if it has since joined another, this
      // link would chain (B → A while A → C). The wallet signed for A, not C, so refuse (Bugbot on #158).
      if ((await accountOf(live.account)) !== live.account.toLowerCase()) return refuse("stale_code", 410);
      const address = msg.address.toLowerCase();
      const [addressAccount, accountList] = await Promise.all([accountOf(address), walletsOfAccount(live.account)]);
      const refusal = linkRefusal({
        account: live.account,
        address,
        addressAccount,
        addressAccountSize: (await walletsOfAccount(addressAccount)).length,
        accountSize: accountList.length,
      });
      if (refusal && refusal !== "already") return refuse(refusal);
      if (refusal !== "already") {
        const own = await getProfile(address);
        if (own?.xUserId || own?.emailVerifiedAt) return refuse("has_profile");
      }
      if (!(await consumeLinkCode(msg.code))) return refuse("stale_code", 410);
      if (refusal !== "already") await linkWallet(live.account, address);
      return null;
    });
    if (linked) return linked;
    return NextResponse.json(
      { ok: true, account: live.account, wallets: await walletsOfAccount(live.account) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (isMissingTable(err)) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
    throw err;
  }
}
