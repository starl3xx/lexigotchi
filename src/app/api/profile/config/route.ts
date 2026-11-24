import { NextResponse } from "next/server";
import { profilesEnabled } from "@/lib/profile/session";
import { xEnabled } from "@/lib/profile/x";
import type { ProfileConfig } from "@/lib/profile/rules";

export const dynamic = "force-dynamic";

/** GET — which parts of the profile are switched on, so the sheet shows only what works. */
export async function GET() {
  const profiles = profilesEnabled();
  const body: ProfileConfig = { ok: true, profiles, x: xEnabled(), email: false };
  return NextResponse.json(body, { headers: { "Cache-Control": "public, s-maxage=60" } });
}
