import { NextResponse } from "next/server";
import { quickAuthDomain } from "@/lib/auth/quickAuth";
import { consumeLinkState, getProfile, linkX, walletForX } from "@/lib/db/profiles";
import { xKeyUsedToday } from "@/lib/onchain/dailyIdentity";
import { fetchXUser, redirectUri, stateReturn, xEnabled } from "@/lib/profile/x";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET — X sends the player back here with `code` and `state` (or `error`). The state row is taken
 * once (single use, ten minutes) and names the wallet that started the link, so nobody can attach
 * an X account to a wallet they haven't proven. The code is exchanged at once (X gives it 30
 * seconds), the account read once, and the token dropped.
 *
 * Lands back in the game (`/play?x=…`), or, when a Farcaster host opened X in another browser, on
 * a small page that says to go back to the game.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  const ret = stateReturn(state);
  const done = (result: "linked" | "canceled" | "failed" | "busy" | "held", username?: string) => finish(req, ret, result, username);

  if (!xEnabled()) return done("failed");
  if (!state || url.searchParams.get("error") || !code) {
    if (state) await consumeLinkState(state).catch(() => null); // a canceled attempt can't be reused
    return done(url.searchParams.get("error") === "access_denied" ? "canceled" : "failed");
  }
  try {
    const attempt = await consumeLinkState(state);
    if (!attempt) return done("failed");
    const user = await fetchXUser(code, attempt.codeVerifier, redirectUri(quickAuthDomain(req)));
    // Moving an X account that took today's letter on another wallet waits for tomorrow, or the old
    // wallet could pull again today on Farcaster or Coinbase (dailyIdentity.ts).
    const linkedTo = await walletForX(user.id);
    if (linkedTo && linkedTo !== attempt.address && (await xKeyUsedToday(user.id).catch(() => true))) return done("busy", user.username);
    // Replacing this wallet's own X with another would push out an account that took today's letter
    // the same way an unlink would (Bugbot on #138).
    const current = (await getProfile(attempt.address))?.xUserId;
    if (current && current !== user.id && (await xKeyUsedToday(current).catch(() => true))) return done("held", user.username);
    await linkX(attempt.address, user);
    return done("linked", user.username);
  } catch (err) {
    console.error("[x] link failed:", String((err as Error)?.message ?? err).slice(0, 120));
    return done("failed");
  }
}

const COPY = {
  linked: { title: "X is linked", body: "Your X account now shows next to your wallet in Lexigotchi." },
  canceled: { title: "Not linked", body: "You canceled on X. Nothing changed." },
  failed: { title: "Couldn’t link X", body: "Something went wrong. Go back to the game and try again." },
  busy: { title: "Not linked yet", body: "That X account took today’s free letter on another wallet. Link it here tomorrow." },
  held: { title: "Not changed yet", body: "Your current X account took today’s free letter. You can change it tomorrow." },
} as const;

function finish(req: Request, ret: "redirect" | "page", result: keyof typeof COPY, username?: string) {
  const origin = new URL(req.url).origin;
  if (ret === "redirect") {
    const back = new URL("/play", origin);
    back.searchParams.set("x", result);
    return NextResponse.redirect(back, 303);
  }
  const c = COPY[result];
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  const who = result === "linked" && username ? `<p class="who">@${esc(username)}</p>` : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${c.title} · Lexigotchi</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4ead2;color:#1b1714;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:16px}
main{max-width:360px;background:#fbf4e3;border:3px solid #1b1714;border-radius:20px;box-shadow:4px 4px 0 #1b1714;padding:24px;text-align:center}
h1{margin:0 0 6px;font-size:22px}.who{font-weight:800;margin:0 0 6px}p{margin:0 0 16px;color:#1b1714b3}
a{display:inline-block;background:#bd3d35;color:#fbf4e3;font-weight:800;text-decoration:none;border:3px solid #1b1714;border-radius:14px;padding:10px 18px}</style></head>
<body><main><h1>${c.title}</h1>${who}<p>${c.body} You can close this tab and go back to Lexigotchi.</p><a href="${origin}/play">Open the game</a></main></body></html>`;
  return new NextResponse(html, { status: result === "failed" ? 400 : 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
