/**
 * "Link X": OAuth 2.0 Authorization Code with PKCE against X's API (docs.x.com, read 2026-11-23).
 *
 * - The app needs OAuth 2.0 turned on in the X Developer Console, as a confidential (Web App)
 *   client: X_CLIENT_ID and X_CLIENT_SECRET.
 * - The redirect URI must EXACTLY match one registered in the console (trailing slash included,
 *   at most 10). Locally X wants http://127.0.0.1, not localhost. A Vercel preview's own URL can't
 *   be registered, so linking is tested on 127.0.0.1 and production. X_REDIRECT_URI overrides the
 *   derived one.
 * - Scopes: users.read + tweet.read, which GET /2/users/me requires. No offline.access, so no
 *   refresh token exists, and the access token (two hours) is used once and dropped.
 * - The authorization code dies 30 seconds after X issues it, so the callback exchanges it first.
 * - Billing: the X API is prepaid pay-per-use; one /2/users/me read per link (about $0.01 a user).
 */
import { createHash, randomBytes } from "node:crypto";
import { profilesEnabled } from "./session";

export const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
export const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
export const X_ME_URL = "https://api.x.com/2/users/me?user.fields=created_at,profile_image_url,name,username";
export const X_SCOPES = "users.read tweet.read";
/** A link attempt's state row lives this long: enough to log in to X, not enough to linger. */
export const X_STATE_TTL_MS = 10 * 60_000;

export function xEnabled(): boolean {
  return profilesEnabled() && Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET);
}

const b64url = (b: Buffer) => b.toString("base64url");

/** A PKCE pair: the verifier stays on our server; X sees only the S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

/**
 * The state is the row's key. Its first letter says where to land after X: "r" back into the game
 * in the same tab (the web), "p" a small "you can close this tab" page (a Farcaster host opened X
 * in another browser, which can't return into the host's frame).
 */
export type XReturn = "redirect" | "page";
export function newState(ret: XReturn): string {
  return (ret === "page" ? "p" : "r") + b64url(randomBytes(24));
}
export const stateReturn = (state: string): XReturn => (state.startsWith("p") ? "page" : "redirect");

/** The registered callback for this request: X_REDIRECT_URI, else https://<domain>/api/x/callback (http on loopback). */
export function redirectUri(domain: string): string {
  if (process.env.X_REDIRECT_URI) return process.env.X_REDIRECT_URI;
  const loopback = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(domain);
  return `${loopback ? "http" : "https"}://${domain}/api/x/callback`;
}

export function authorizeUrl(opts: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: X_SCOPES,
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
  });
  return `${X_AUTHORIZE_URL}?${q.toString()}`;
}

export interface XUser {
  id: string;
  username: string;
  name: string | null;
  pfpUrl: string | null;
  createdAt: Date | null;
}

/** X serves a 48 px "_normal" picture by default; "_400x400" is the same image, sharp enough for a sheet. */
export function largerPfp(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/_normal(\.[a-z]+)$/i, "_400x400$1");
}

/** Parse X's /2/users/me body. Null unless it carries an id and a username. */
export function parseXMe(body: unknown): XUser | null {
  const d = (body as { data?: Record<string, unknown> } | null)?.data;
  if (!d || typeof d.id !== "string" || !/^\d{1,20}$/.test(d.id) || typeof d.username !== "string") return null;
  const created = typeof d.created_at === "string" ? new Date(d.created_at) : null;
  return {
    id: d.id,
    username: d.username,
    name: typeof d.name === "string" ? d.name : null,
    pfpUrl: largerPfp(typeof d.profile_image_url === "string" ? d.profile_image_url : null),
    createdAt: created && Number.isFinite(created.getTime()) ? created : null,
  };
}

/** Exchange the code (within X's 30 seconds) and read the account once. Throws on any failure. */
export async function fetchXUser(code: string, verifier: string, redirect: string): Promise<XUser> {
  const id = process.env.X_CLIENT_ID!, secret = process.env.X_CLIENT_SECRET!;
  const tokenRes = await fetch(X_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect, code_verifier: verifier, client_id: id }),
    signal: AbortSignal.timeout(8_000),
  });
  const token = (await tokenRes.json().catch(() => null)) as { access_token?: string } | null;
  if (!tokenRes.ok || !token?.access_token) throw new Error(`x_token_${tokenRes.status}`);
  const meRes = await fetch(X_ME_URL, { headers: { authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(8_000) });
  const user = parseXMe(await meRes.json().catch(() => null));
  if (!meRes.ok || !user) throw new Error(`x_me_${meRes.status}`);
  return user;
}
