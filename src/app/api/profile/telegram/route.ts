import { NextResponse } from "next/server";
import { clientIp } from "@/lib/auth/clientIp";
import { allow } from "@/lib/ratelimit";
import { sessionAccountOf } from "@/lib/profile/account";
import { profilesEnabled } from "@/lib/profile/session";
import { isMissingTable } from "@/lib/db/profiles";
import { createTelegramCode, telegramLinkOf, unlinkTelegram } from "@/lib/db/telegramLinks";
import { botUsername, telegramConfigured } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/** What the profile's Telegram card reads. */
export interface TelegramLinkState {
  ok: true;
  /** The Telegram account linked to this profile: its name there (no "@"), or null. */
  linked: { name: string } | null;
}

/**
 * A profile's Telegram account, for the profile's own Telegram card. Every method needs the
 * profile's session (lib/profile/session.ts) and acts on the session wallet's ACCOUNT, as every
 * profile route does. Dark (404) while profiles or the bot aren't set up here.
 *
 * - GET → `{ linked: { name } | null }`.
 * - POST → `{ url, expiresAt }`: a `t.me/<bot>?start=<code>` link carrying a single-use code. The
 *   player opens it and presses Start; the bot links whoever does (lib/telegramLink). The code is
 *   the proof, so it is made only here, under the session, and never returned by GET.
 * - DELETE → unlinks.
 *
 * Before migration 0020 runs, GET says nobody is linked and POST answers not_configured.
 */
function dark() {
  return !profilesEnabled() || !telegramConfigured();
}

export async function GET(req: Request) {
  if (dark()) return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  const account = await sessionAccountOf(req);
  if (!account) return NextResponse.json({ ok: false, error: "no_session" }, { status: 401 });
  const link = await telegramLinkOf(account);
  return NextResponse.json({ ok: true, linked: link ? { name: link.name } : null } satisfies TelegramLinkState, { headers: NO_STORE });
}

export async function POST(req: Request) {
  if (dark()) return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  const account = await sessionAccountOf(req);
  if (!account) return NextResponse.json({ ok: false, error: "no_session" }, { status: 401 });
  if (!(await allow("profile", clientIp(req)))) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  try {
    const { code, expiresAt } = await createTelegramCode(account);
    return NextResponse.json({ ok: true, url: `https://t.me/${botUsername()}?start=${code}`, expiresAt: expiresAt.toISOString() }, { headers: NO_STORE });
  } catch (err) {
    if (isMissingTable(err)) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
    throw err;
  }
}

export async function DELETE(req: Request) {
  if (dark()) return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  const account = await sessionAccountOf(req);
  if (!account) return NextResponse.json({ ok: false, error: "no_session" }, { status: 401 });
  if (!(await allow("profile", clientIp(req)))) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  try {
    await unlinkTelegram(account);
    return NextResponse.json({ ok: true, linked: null } satisfies TelegramLinkState, { headers: NO_STORE });
  } catch (err) {
    if (isMissingTable(err)) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
    throw err;
  }
}
