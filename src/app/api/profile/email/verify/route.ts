import { NextResponse } from "next/server";
import { sessionAccountOf } from "@/lib/profile/account";
import { clientIp } from "@/lib/auth/clientIp";
import { allow } from "@/lib/ratelimit";
import { confirmEmail, countCodeAttempt, getProfile, isMissingTable, liveEmailCodes, toView, accountView } from "@/lib/db/profiles";
import { CODE_MAX_ATTEMPTS, codeMatches, emailEnabled, normalizeEmail } from "@/lib/notify/email";
import { profileSecret } from "@/lib/profile/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * POST `{ email, code }` (wallet session) — confirm the address with its code and turn email
 * reminders on. A code works once, for ten minutes, with five tries.
 */
export async function POST(req: Request) {
  const secret = profileSecret();
  if (!emailEnabled() || !secret) return json({ ok: false, error: "disabled" }, 404);
  const address = await sessionAccountOf(req); // the profile is the account's (linked wallets)
  if (!address) return json({ ok: false, error: "no_session" }, 401);
  if (!(await allow("profile", clientIp(req)))) return json({ ok: false, error: "rate_limited" }, 429);
  const body = (await req.json().catch(() => null)) as { email?: unknown; code?: unknown } | null;
  const email = normalizeEmail(body?.email);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!email || !/^\d{6}$/.test(code)) return json({ ok: false, error: "bad_code" }, 400);
  try {
    const live = (await liveEmailCodes(address, email)).filter((c) => c.attempts < CODE_MAX_ATTEMPTS);
    if (live.length === 0) return json({ ok: false, error: "code_expired" }, 410);
    const hit = live.find((c) => codeMatches(secret, c.codeHash, address, email, code));
    if (!hit) {
      await countCodeAttempt(live.map((c) => c.id));
      const triesLeft = Math.max(0, CODE_MAX_ATTEMPTS - 1 - Math.min(...live.map((c) => c.attempts)));
      return json({ ok: false, error: "wrong_code", triesLeft }, 400);
    }
    if ((await confirmEmail(address, email, hit.id)) === "taken") return json({ ok: false, error: "email_taken" }, 409);
    return json({ ok: true, profile: await accountView(address) });
  } catch (err) {
    if (isMissingTable(err)) return json({ ok: false, error: "not_configured" }, 503);
    throw err;
  }
}
