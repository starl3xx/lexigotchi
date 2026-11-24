import { NextResponse } from "next/server";
import { clientIp } from "@/lib/auth/clientIp";
import { allow } from "@/lib/ratelimit";
import { clearEmail, codesSentSince, createEmailCode, getProfile, isMissingTable, toView } from "@/lib/db/profiles";
import { CODES_PER_HOUR, CODE_TTL_MS, codeEmail, emailEnabled, hashCode, newCode, normalizeEmail, sendEmail } from "@/lib/notify/email";
import { profileSecret, sessionAddress } from "@/lib/profile/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * POST `{ email }` (wallet session) — send a 6-digit code to confirm the address. Only the code's
 * HMAC is stored. At most five codes an hour per wallet, on top of the per-IP limit.
 */
export async function POST(req: Request) {
  const secret = profileSecret();
  if (!emailEnabled() || !secret) return json({ ok: false, error: "disabled" }, 404);
  const address = sessionAddress(req);
  if (!address) return json({ ok: false, error: "no_session" }, 401);
  if (!(await allow("profile", clientIp(req)))) return json({ ok: false, error: "rate_limited" }, 429);
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = normalizeEmail(body?.email);
  if (!email) return json({ ok: false, error: "bad_email" }, 400);
  try {
    if ((await codesSentSince(address, new Date(Date.now() - 3_600_000))) >= CODES_PER_HOUR) return json({ ok: false, error: "too_many_codes" }, 429);
    const code = newCode();
    await createEmailCode(address, email, hashCode(secret, address, email, code), CODE_TTL_MS);
    const sent = await sendEmail(codeEmail(email, code));
    if (!sent.ok) return json({ ok: false, error: "send_failed" }, 502);
    return json({ ok: true });
  } catch (err) {
    if (isMissingTable(err)) return json({ ok: false, error: "not_configured" }, 503);
    throw err;
  }
}

/** DELETE (wallet session) — remove the email; reminders by email stop at once. */
export async function DELETE(req: Request) {
  if (!emailEnabled()) return json({ ok: false, error: "disabled" }, 404);
  const address = sessionAddress(req);
  if (!address) return json({ ok: false, error: "no_session" }, 401);
  try {
    await clearEmail(address);
    return json({ ok: true, profile: toView(address, await getProfile(address)) });
  } catch (err) {
    if (isMissingTable(err)) return json({ ok: false, error: "not_configured" }, 503);
    throw err;
  }
}
