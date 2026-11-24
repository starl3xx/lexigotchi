import { NextResponse } from "next/server";
import { sessionAccountOf } from "@/lib/profile/account";
import { walletsOfAccount } from "@/lib/db/walletLinks";
import { clientIp } from "@/lib/auth/clientIp";
import { allow } from "@/lib/ratelimit";
import { profilesByAddress } from "@/lib/neynar";
import { getProfile, isMissingTable, setEmailReminders, setNameSource, toView, accountView } from "@/lib/db/profiles";
import { isNameSource } from "@/lib/profile/rules";
import { profilesEnabled } from "@/lib/profile/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/** GET — the session wallet's own profile, email included (only ever to its own session). */
export async function GET(req: Request) {
  if (!profilesEnabled()) return json({ ok: false, error: "disabled" }, 404);
  const address = await sessionAccountOf(req); // the profile is the account's (linked wallets)
  if (!address) return json({ ok: false, error: "no_session" }, 401);
  try {
    return json({ ok: true, profile: await accountView(address) });
  } catch (err) {
    if (isMissingTable(err)) return json({ ok: false, error: "not_configured" }, 503);
    throw err;
  }
}

/**
 * PATCH `{ nameSource: "x" | "farcaster" | null }` — which linked account names this wallet and
 * gives its picture. The source must really be linked: X on this profile, Farcaster by a Farcaster
 * account that has verified this wallet (Neynar), never the client's word.
 */
export async function PATCH(req: Request) {
  if (!profilesEnabled()) return json({ ok: false, error: "disabled" }, 404);
  const address = await sessionAccountOf(req); // the profile is the account's (linked wallets)
  if (!address) return json({ ok: false, error: "no_session" }, 401);
  if (!(await allow("profile", clientIp(req)))) return json({ ok: false, error: "rate_limited" }, 429);
  const body = (await req.json().catch(() => null)) as { nameSource?: unknown; emailReminders?: unknown } | null;
  try {
    // Email reminders on or off: only for a confirmed address.
    if (body && "emailReminders" in body) {
      if (typeof body.emailReminders !== "boolean") return json({ ok: false, error: "bad_request" }, 400);
      const p = await getProfile(address);
      if (!p?.emailVerifiedAt) return json({ ok: false, error: "no_email" }, 409);
      await setEmailReminders(address, body.emailReminders);
      return json({ ok: true, profile: await accountView(address) });
    }
  } catch (err) {
    if (isMissingTable(err)) return json({ ok: false, error: "not_configured" }, 503);
    throw err;
  }
  const source = body?.nameSource ?? null;
  if (source !== null && !isNameSource(source)) return json({ ok: false, error: "bad_source" }, 400);
  try {
    const current = await getProfile(address);
    if (source === "x" && !current?.xUserId) return json({ ok: false, error: "x_not_linked" }, 409);
    if (source === "farcaster") {
      // profilesByAddress answers {} both for "no account" and for a failed lookup, so a missing key
      // is the one failure that can be told apart; a Neynar outage reads as "not linked" (try again).
      if (!process.env.NEYNAR_API_KEY) return json({ ok: false, error: "cant_check_farcaster" }, 503);
      // Any wallet in the account counts: Farcaster may have verified a linked wallet, not the first.
      const wallets = await walletsOfAccount(address);
      const fc = await profilesByAddress(wallets);
      if (!wallets.some((w) => fc[w])) return json({ ok: false, error: "farcaster_not_linked" }, 409);
    }
    await setNameSource(address, source);
    return json({ ok: true, profile: await accountView(address) });
  } catch (err) {
    if (isMissingTable(err)) return json({ ok: false, error: "not_configured" }, 503);
    throw err;
  }
}
