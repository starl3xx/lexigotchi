"use client";
/**
 * Sign In With Farcaster, on the open web — exchanged for a Quick Auth JWT.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────────────
 * Sign In With Neynar retires 2026-08-14, and it was the only way a web visitor could tell us who
 * they were. Inside a Farcaster client, `sdk.quickAuth` handles this; on the web its host handshake
 * posts messages to a host that never answers.
 *
 * ── Why it grants more than an avatar ─────────────────────────────────────────────────────────
 * Quick Auth is BUILT ON SIWF: getToken() is (1) fetch a nonce, (2) get a SIWF message+signature
 * from the host, (3) POST it to /verify-siwf for a JWT. Only step 2 needs a host. So we do step 2
 * ourselves via the SIWF relay — QR on desktop, deeplink on mobile — and the JWT that comes back is
 * indistinguishable from a host-minted one. `getAuthedFid` accepts it unchanged.
 *
 * ── Three gates, all confirmed against the live service ───────────────────────────────────────
 *  - the nonce must come from Quick Auth's pool and is STRICTLY SINGLE-USE (replay → invalid_nonce)
 *  - the message domain must match the domain we pass server-side (mismatch → Invalid domain)
 *  - the SIWF message must carry a `farcaster://fid/<fid>` resource line
 *
 * ── Caveat worth keeping in view ──────────────────────────────────────────────────────────────
 * This web path is undocumented and carries no compatibility promise. Farcaster could add a
 * host-origin check and it would not count as a breaking change. The blast radius is contained to
 * the web funnel — the mini-app path never touches this file — and callers must keep their
 * "no Farcaster host" branch alive as the graceful degradation.
 */
import { createAppClient, viemConnector } from "@farcaster/auth-client";
import { decodeJwt } from "@farcaster/quick-auth";

const SESSION_KEY = "lexigotchi:webAuth";
/** Treat a token as expired slightly early, mirroring the SDK's own margin. */
const EXPIRY_MARGIN_SECONDS = 15;

export interface WebSession {
  token: string;
  fid: number;
  /** Unix seconds. */
  expiresAt: number;
}

let session: WebSession | null = null;

function readStored(): WebSession | null {
  if (typeof window === "undefined") return null;
  try {
    // sessionStorage, NOT localStorage: this is a bearer credential for routes that mint real
    // assets, so it should not outlive the tab.
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WebSession;
    return parsed?.token && parsed?.fid ? parsed : null;
  } catch {
    return null;
  }
}

function store(next: WebSession | null) {
  session = next;
  if (typeof window === "undefined") return;
  try {
    if (next) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable — the in-memory copy still works for this page */
  }
}

function isFresh(s: WebSession | null): s is WebSession {
  if (!s) return false;
  return s.expiresAt - EXPIRY_MARGIN_SECONDS > Math.floor(Date.now() / 1000);
}

/** The current web session, or null when absent/expired. */
export function webSession(): WebSession | null {
  if (!session) session = readStored();
  if (!isFresh(session)) {
    if (session) store(null); // expired — clear rather than hand out a token that will 401
    return null;
  }
  return session;
}

/** The bearer token for an authed request, or null. */
export function webAuthToken(): string | null {
  return webSession()?.token ?? null;
}

export function hasWebSession(): boolean {
  return webSession() !== null;
}

export function clearWebSession() {
  store(null);
}

export interface SignInHandle {
  /** Show this as a QR on desktop; it is also the mobile deeplink. */
  url: string;
  /** Resolves when the user approves in their Farcaster app, or rejects on timeout/failure. */
  completed: Promise<WebSession>;
}

/**
 * Begin web sign-in. Returns immediately with a URL to display, plus a promise that settles when the
 * user approves in their Farcaster app.
 *
 * A FRESH nonce is minted per call. Do not memoise this — a reused nonce fails at the very last step
 * with `invalid_nonce`, which is a confusing place to discover a caching mistake.
 */
export async function beginWebSignIn(): Promise<SignInHandle> {
  const nonceRes = await fetch("/api/auth/nonce", { method: "POST" }).then((r) => r.json());
  if (!nonceRes?.ok) throw new Error(`Could not start sign-in: ${nonceRes?.error ?? "unknown"}`);

  const app = createAppClient({ ethereum: viemConnector() });
  const domain = window.location.host;

  const { data: channel } = await app.createChannel({
    siweUri: window.location.origin,
    domain,
    nonce: nonceRes.nonce,
  });
  if (!channel?.url || !channel?.channelToken) throw new Error("The sign-in relay did not return a channel.");

  const completed = (async () => {
    const status = await app.watchStatus({ channelToken: channel.channelToken, timeout: 300_000 });
    const { message, signature } = status.data ?? {};
    if (!message || !signature) throw new Error("Sign-in was not completed.");

    const verified = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, signature }),
    }).then((r) => r.json());
    if (!verified?.ok) throw new Error(`Sign-in rejected: ${verified?.error ?? "unknown"}`);

    // Read the FID and expiry from the token itself rather than trusting the relay's echo — the
    // JWT is what the server will actually verify.
    const claims = decodeJwt(verified.token) as { sub?: string | number; exp?: number };
    const fid = Number(claims.sub);
    if (!Number.isFinite(fid) || fid <= 0) throw new Error("Signed in, but the token carried no FID.");

    const next: WebSession = { token: verified.token, fid, expiresAt: Number(claims.exp ?? 0) };
    store(next);
    return next;
  })();

  return { url: channel.url, completed };
}
