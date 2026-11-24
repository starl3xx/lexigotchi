import { NextResponse } from "next/server";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { getAuthedFid } from "@/lib/auth/quickAuth";
import { profilesEnabled, sessionAddress } from "@/lib/profile/session";
import { syncFarcasterWallets } from "@/lib/profile/farcasterWallets";
import { accountView } from "@/lib/db/profiles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST — bring the player's Farcaster wallets into their profile (lib/profile/farcasterWallets.ts).
 *
 * Needs a sign-in: a wallet session (`x-lexigotchi-session`: start from that wallet's account) or a
 * Farcaster sign-in (`Authorization: Bearer`, Quick Auth, in a host or through SIWF on the web: start
 * from the account its verified wallets build). With both, the wallet session decides the account,
 * and the FID only joins wallets Farcaster verified alongside one of the account's own: two
 * sign-ins in one browser are not proof that they are one player.
 *
 * Called once per page load by the client. Answers `{ changed }` so the client refreshes only when
 * the profile moved.
 */
export async function POST(req: Request) {
  if (!profilesEnabled()) return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  const wallet = sessionAddress(req);
  const fid = await getAuthedFid(req).catch(() => null);
  if (!wallet && !fid) return NextResponse.json({ ok: false, error: "no_session" }, { status: 401 });
  if (!(await allow("profile", clientIp(req)))) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  const r = await syncFarcasterWallets({ wallet: wallet ?? undefined, fid: fid ?? undefined });
  if (!r) return NextResponse.json({ ok: true, changed: false }, { headers: { "Cache-Control": "no-store" } });
  const changed = r.adopted.length + r.pruned.length > 0;
  return NextResponse.json(
    {
      ok: true,
      changed,
      account: r.account,
      adopted: r.adopted.length,
      pruned: r.pruned.length,
      // The signed-in wallet's own profile, when there is one to refresh.
      ...(wallet && changed ? { profile: await accountView(r.account) } : {}),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
