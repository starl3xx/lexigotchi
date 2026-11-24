import { NextResponse } from "next/server";
import { clientIp } from "@/lib/auth/clientIp";
import { allow } from "@/lib/ratelimit";
import { isMissingTable } from "@/lib/db/profiles";
import { walletsOfAccount } from "@/lib/db/walletLinks";
import { saveScenes, scenesOf } from "@/lib/db/wordScenes";
import { sessionAccountOf } from "@/lib/profile/account";
import { profilesEnabled, sessionAddress } from "@/lib/profile/session";
import { parsePicks, parseWallets } from "@/lib/sceneSaves";

/**
 * Saved scenes (decisions.md #15, lib/db/wordScenes.ts): each word's scene, keyed by the wallet that
 * holds it, so a player's picks follow them to every device and host.
 *
 * GET `?wallets=a,b` — the scenes those wallets saved. Public, like a profile's public view: a scene
 * is cosmetic, and anyone can see it on a share card anyway.
 * PUT `{ picks: [{ word, scene, at, wallet? }] }` — save picks, under a profile session
 * (`x-lexigotchi-session`). A session may save for any wallet in its profile account, so one
 * sign-in covers a whole unified profile; a newer pick already saved is never overwritten.
 *
 * Dark with profiles (PROFILES_ENABLED, the secret, a database), and "not_configured" until
 * migration 0011 runs. The client then keeps every pick in the browser, as before.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(req: Request) {
  if (!profilesEnabled()) return json({ ok: false, error: "disabled" }, 404);
  const wallets = parseWallets(new URL(req.url).searchParams.get("wallets"));
  if (!wallets) return json({ ok: false, error: "bad_wallets" }, 400);
  if (!(await allow("scenes-read", clientIp(req)))) return json({ ok: false, error: "rate_limited" }, 429);
  try {
    const rows = await scenesOf(wallets);
    return json({ ok: true, scenes: rows.map((r) => ({ wallet: r.wallet, word: r.word, scene: r.scene, at: r.updatedAt.getTime() })) });
  } catch (err) {
    if (isMissingTable(err)) return json({ ok: false, error: "not_configured" }, 503);
    throw err;
  }
}

export async function PUT(req: Request) {
  if (!profilesEnabled()) return json({ ok: false, error: "disabled" }, 404);
  const wallet = sessionAddress(req);
  const account = await sessionAccountOf(req);
  if (!wallet || !account) return json({ ok: false, error: "no_session" }, 401);
  if (!(await allow("scenes", account))) return json({ ok: false, error: "rate_limited" }, 429);
  const picks = parsePicks(await req.json().catch(() => null), wallet);
  if (!picks) return json({ ok: false, error: "bad_request" }, 400);
  // Only the session's own profile: its account's wallets (just the session wallet until linked).
  const mine = new Set((await walletsOfAccount(account)).map((w) => w.toLowerCase()));
  mine.add(wallet.toLowerCase());
  if (picks.some((p) => !mine.has(p.wallet))) return json({ ok: false, error: "not_your_wallet" }, 403);
  try {
    const byWallet = new Map<string, typeof picks>();
    for (const p of picks) byWallet.set(p.wallet, [...(byWallet.get(p.wallet) ?? []), p]);
    for (const [w, ps] of byWallet) {
      if ((await saveScenes(w, ps)) === "full") return json({ ok: false, error: "full" }, 409);
    }
    return json({ ok: true });
  } catch (err) {
    if (isMissingTable(err)) return json({ ok: false, error: "not_configured" }, 503);
    throw err;
  }
}
