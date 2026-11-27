import { NextResponse } from "next/server";
import { profilesEnabled } from "@/lib/profile/session";
import { xEnabled } from "@/lib/profile/x";
import { emailEnabled } from "@/lib/notify/email";
import type { ProfileConfig } from "@/lib/profile/rules";
import { telegramConfigured } from "@/lib/telegram";
import { telegramLinksReady } from "@/lib/db/telegramLinks";

export const dynamic = "force-dynamic";

/** GET — which parts of the profile are switched on, so the sheet shows only what works. */
export async function GET() {
  const profiles = profilesEnabled();
  // Telegram: the bot is set up here AND its tables exist (the one database read here, kept once it says yes).
  const telegram = profiles && telegramConfigured() && (await telegramLinksReady());
  const body: ProfileConfig = { ok: true, profiles, x: xEnabled(), email: emailEnabled(), telegram };
  return NextResponse.json(body, { headers: { "Cache-Control": "public, s-maxage=60" } });
}
