import { NextResponse } from "next/server";
import { clientIp } from "@/lib/auth/clientIp";
import { allow } from "@/lib/ratelimit";
import { isMissingTable } from "@/lib/db/profiles";
import { walletsOfAccount } from "@/lib/db/walletLinks";
import { saveScenePicks, scenePicksFor } from "@/lib/db/wordPicks";
import { sessionAccountOf } from "@/lib/profile/account";
import { profilesEnabled, sessionAddress } from "@/lib/profile/session";
import { parsePicks, parseWallets } from "@/lib/sceneSaves";

/**
 * Saved scenes (decisions.md #15 and #22, lib/db/wordPicks.ts): each word's scene, keyed by the
 * PROFILE that holds it (its account's first wallet), so a pick follows the player to every device,
 * host, and wallet in their profile, and comes off when the word leaves the profile.
 *
 * GET `?wallets=a,b` — the scenes of those wallets' profiles, one row per wallet named. Public, like a
 * profile's public view: a scene is cosmetic, and anyone can see it on a share card anyway.
 * PUT `{ picks: [{ word, scene, at, wallet? }] }` — save picks, under a profile session
 * (`x-lexigotchi-session`), for words held by any wallet in the session's profile; a newer pick
 * already saved is never overwritten.
 *
 * Dark with profiles (PROFILES_ENABLED, the secret, a database), and "not_configured" until
 * migration 0011 runs (before 0016, picks are kept by wallet in word_scenes). The client then keeps
 * every pick in the browser, as before.
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
    const rows = await scenePicksFor(wallets);
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
    // Every wallet named is in the session's account, so the picks are that one profile's.
    if ((await saveScenePicks(account, picks, byWallet)) === "full") return json({ ok: false, error: "full" }, 409);
    return json({ ok: true });
  } catch (err) {
    if (isMissingTable(err)) return json({ ok: false, error: "not_configured" }, 503);
    throw err;
  }
}
