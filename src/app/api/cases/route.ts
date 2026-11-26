import { NextResponse } from "next/server";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { isWord } from "@/lib/dictionary";
import { casesFor, setCase } from "@/lib/db/wordCases";
import { isMissingTable } from "@/lib/db/profiles";
import { walletsOfAccount } from "@/lib/db/walletLinks";
import { sessionAccountOf } from "@/lib/profile/account";
import { profilesEnabled, sessionAddress } from "@/lib/profile/session";
import { parseWallets } from "@/lib/sceneSaves";
import { casesBoughtBy } from "@/lib/shop/owned";

/**
 * Words in cases (decisions.md #42; lib/shop/cases, lib/db/wordCases).
 *
 * GET `?wallets=a,b` — the cased words of those wallets' profiles, one row per wallet named. Public,
 * like saved scenes: a case is for showing.
 * PUT `{ word, on }` — put one word in a case, or take it out, under a profile session
 * (`x-lexigotchi-session`). A word goes in only while the profile has a case free: it has bought
 * more cases than it has words in them (409 `none_left` otherwise). The server is the one place
 * that counts, so a case is never saved from the browser alone.
 *
 * Like `/api/scenes`, this doesn't ask the chain who holds the word: a case on a word the profile
 * doesn't hold shows nowhere (the game only draws the player's own words), still uses up one of
 * the profile's own cases, and the keeper takes it off once another profile holds the word.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(req: Request) {
  if (!profilesEnabled()) return json({ ok: false, error: "disabled" }, 404);
  const wallets = parseWallets(new URL(req.url).searchParams.get("wallets"));
  if (!wallets) return json({ ok: false, error: "bad_wallets" }, 400);
  if (!(await allow("cases-read", clientIp(req)))) return json({ ok: false, error: "rate_limited" }, 429);
  try {
    const rows = await casesFor(wallets);
    return json({ ok: true, cases: rows.map((r) => ({ wallet: r.wallet, word: r.word, since: r.since.getTime() })) });
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
  if (!(await allow("cases", account))) return json({ ok: false, error: "rate_limited" }, 429);
  const body = (await req.json().catch(() => null)) as { word?: unknown; on?: unknown } | null;
  const word = typeof body?.word === "string" ? body.word.toUpperCase() : "";
  if (!isWord(word) || typeof body?.on !== "boolean") return json({ ok: false, error: "bad_request" }, 400);
  try {
    // Taking a word out needs no purchase to check. Putting one in counts the profile's cases: every
    // wallet in the profile shares one wardrobe. A wardrobe that can't be read refuses: a case is
    // never given on a guess.
    let bought = 0;
    if (body.on) {
      const mine = new Set((await walletsOfAccount(account)).map((w) => w.toLowerCase()));
      mine.add(wallet.toLowerCase());
      const n = await casesBoughtBy([...mine]).catch(() => null);
      if (n === null) return json({ ok: false, error: "try_again" }, 503);
      bought = n;
    }
    if ((await setCase(account, word, body.on, bought)) === "none_left") return json({ ok: false, error: "none_left" }, 409);
    return json({ ok: true });
  } catch (err) {
    if (isMissingTable(err)) return json({ ok: false, error: "not_configured" }, 503);
    throw err;
  }
}
