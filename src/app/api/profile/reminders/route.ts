import { NextResponse } from "next/server";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { profilesEnabled } from "@/lib/profile/session";
import { sessionAccountOf } from "@/lib/profile/account";
import { isMissingTable } from "@/lib/db/profiles";
import { prefsOf, savePrefs } from "@/lib/db/reminderPrefs";
import { effectiveKinds, parseChoices } from "@/lib/notify/kinds";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * The player's choice of reminders (lib/notify/kinds.ts), for their whole account. Both verbs need a
 * session from any wallet in the account.
 *
 * GET: every kind, on or off (`kinds`), as the profile shows it.
 * PUT `{ kinds: { daily: false } }`: change some; the rest stay. Answers every kind again.
 *
 * Before migration 0018 a GET answers the defaults (nothing has been chosen) and a PUT answers
 * `not_configured`: a choice that can't be kept must not look saved.
 */
export async function GET(req: Request) {
  if (!profilesEnabled()) return json({ ok: false, error: "disabled" }, 404);
  const account = await sessionAccountOf(req);
  if (!account) return json({ ok: false, error: "no_session" }, 401);
  if (!(await allow("profile", clientIp(req)))) return json({ ok: false, error: "rate_limited" }, 429);
  try {
    return json({ ok: true, kinds: effectiveKinds(await prefsOf(account)) });
  } catch (err) {
    console.error("[profile/reminders] read failed:", String((err as Error)?.message ?? err).slice(0, 160));
    return json({ ok: false, error: "server_error" }, 500);
  }
}

export async function PUT(req: Request) {
  if (!profilesEnabled()) return json({ ok: false, error: "disabled" }, 404);
  const account = await sessionAccountOf(req);
  if (!account) return json({ ok: false, error: "no_session" }, 401);
  if (!(await allow("profile", clientIp(req)))) return json({ ok: false, error: "rate_limited" }, 429);
  const body = (await req.json().catch(() => null)) as { kinds?: unknown } | null;
  const changes = parseChoices(body?.kinds);
  if (!changes || Object.keys(changes).length === 0) return json({ ok: false, error: "bad_kinds" }, 400);
  try {
    return json({ ok: true, kinds: effectiveKinds(await savePrefs(account, changes)) });
  } catch (err) {
    if (isMissingTable(err)) return json({ ok: false, error: "not_configured" }, 503);
    console.error("[profile/reminders] save failed:", String((err as Error)?.message ?? err).slice(0, 160));
    return json({ ok: false, error: "server_error" }, 500);
  }
}
