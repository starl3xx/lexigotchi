"use client";
/**
 * Client helpers for the authenticated `/api/campaign/*` routes. Each request is signed with a
 * Farcaster Quick Auth token via `sdk.quickAuth.fetch` (auto-attaches `Authorization: Bearer …`),
 * so these ONLY work inside a Farcaster client. Callers should gate on `environment === "farcaster"`;
 * outside it the token mint fails and these resolve to a no-op / null (they never throw).
 *
 * Note: we import the raw `@farcaster/miniapp-sdk` here because `quickAuth` isn't surfaced by
 * `@neynar/react`'s `useMiniApp()` hook the rest of the app uses.
 */
import sdk from "@farcaster/miniapp-sdk";
import { webAuthToken, hasWebSession } from "@/lib/auth/siwfWeb";

/**
 * Whether we're actually running inside a Farcaster host.
 *
 * Checked BEFORE touching `quickAuth`, not after. Wrapping the call in try/catch is not enough:
 * outside a host the SDK rejects a promise internally that nothing awaits, so the failure escapes as
 * an unhandled pageerror even though our own catch fires. Every web visitor hit that on load — the
 * page still rendered, so it looked harmless, but it filled the console with a stack pointing into
 * the SDK and would trip any error reporting the app ever gains.
 *
 * Cached because the answer cannot change within a page lifetime.
 */
let inMiniApp: Promise<boolean> | undefined;
function isFarcasterHost(): Promise<boolean> {
  inMiniApp ??= sdk.isInMiniApp().catch(() => false);
  return inMiniApp;
}

/**
 * Authenticated fetch, from either provenance.
 *
 * Inside a Farcaster host the SDK attaches the token. On the web we attach a Quick Auth JWT obtained
 * through SIWF (lib/auth/siwfWeb) — the server cannot tell the two apart, and does not need to: both
 * are the same asymmetrically-signed token with the same audience.
 *
 * The isInMiniApp() check stays FIRST and stays mandatory. Outside a host, sdk.quickAuth rejects a
 * promise internally that nothing awaits, which escaped as an unhandled pageerror on every web
 * visit. Never reorder these.
 */
async function authedFetch(path: string, init?: RequestInit): Promise<Response | null> {
  if (await isFarcasterHost()) {
    try {
      return await sdk.quickAuth.fetch(path, init);
    } catch (err) {
      console.error("[campaign] request failed:", path, err);
      return null;
    }
  }

  const token = webAuthToken();
  if (!token) return null; // not signed in on the web — callers treat this as a no-op
  try {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return await fetch(path, { ...init, headers });
  } catch (err) {
    console.error("[campaign] web request failed:", path, err);
    return null;
  }
}

/**
 * Can we obtain a signed voucher at all?
 *
 * Exists so a PAID commit can be refused BEFORE the fee is taken. The daily and the pack fetch a
 * voucher first, so they fail for free; a roll or an ascension pays first and only then needs a
 * signature, which on the web would strand the commit with the money already gone.
 */
export async function canSign(): Promise<boolean> {
  return (await isFarcasterHost()) || hasWebSession();
}

/**
 * Authenticated JSON POST for the signing routes (`/api/mint/*`, `/api/roll/*`, `/api/prestige/*`).
 *
 * These routes derive the FID from a verified Quick Auth JWT and 401 without one, so a plain
 * `fetch` can never reach them — not even inside a Farcaster client. The token is attached by
 * `sdk.quickAuth.fetch`, which is the ONLY way these get called.
 *
 * Returns `{ ok: false, error: "not_signed_in" }` when neither provenance is available, rather than
 * throwing, so callers can tell "you need to sign in" apart from a genuine server refusal.
 */
export async function authedPostJson<T = Record<string, never>>(
  path: string,
  body: unknown,
): Promise<({ ok: true; error?: undefined } & T) | { ok: false; error: string }> {
  // Either provenance will do. authedFetch picks the right token; this only guards against calling
  // a signing route with no credential at all, which would 401.
  if (!(await canSign())) return { ok: false, error: "not_signed_in" };
  const res = await authedFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res) return { ok: false, error: "request_failed" };
  try {
    return await res.json();
  } catch {
    return { ok: false, error: `http_${res.status}` };
  }
}

/**
 * JSON POST that attaches a Quick Auth token when one exists and goes in plain when none does.
 *
 * ONLY for routes that genuinely accept anonymous callers — today `/api/mint/free-daily` (which
 * falls back to the Coinbase-attestation identity) and `/api/mint/reveal` (buyer-bound and
 * idempotent, so auth was only ever a rate-limit key). Everything else keeps `authedPostJson`,
 * whose `not_signed_in` pre-flight is what stops a paid roll from committing before discovering
 * the reveal would 401.
 */
export async function maybeAuthedPostJson<T = Record<string, never>>(
  path: string,
  body: unknown,
): Promise<({ ok: true; error?: undefined } & T) | { ok: false; error: string }> {
  if (await canSign()) return authedPostJson<T>(path, body);
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (err) {
    console.error("[campaign] open request failed:", path, err);
    return { ok: false, error: "request_failed" };
  }
}

/** Persist that the player added the mini app (+ the notification token from `addMiniApp()`). */
export async function recordAdd(notif?: { token?: string; url?: string }): Promise<void> {
  await authedFetch("/api/campaign/record-add", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ notif: notif ?? null }),
  });
}

/** Persist that the player finished onboarding. */
export async function markOnboardedServer(): Promise<void> {
  await authedFetch("/api/campaign/onboarded", { method: "POST" });
}

export interface CampaignStatus {
  added: boolean;
  shared: boolean;
  onboarded: boolean;
  eligible: boolean;
}

/** Read the server-side campaign state for the current player (null if unauthenticated / offline). */
export async function fetchCampaignStatus(): Promise<CampaignStatus | null> {
  const res = await authedFetch("/api/campaign/status");
  if (!res?.ok) return null;
  try {
    const data = await res.json();
    if (!data?.ok) return null;
    return {
      added: !!data.added,
      shared: !!data.shared,
      onboarded: !!data.onboarded,
      eligible: !!data.eligible,
    };
  } catch {
    return null;
  }
}

/** Ask the server to verify the player's share cast via Neynar. Returns true once a proof is on
 *  file, false if not found yet (Neynar lag), null on error. */
export async function verifyShareCastServer(): Promise<boolean | null> {
  const res = await authedFetch("/api/campaign/verify-cast", { method: "POST" });
  if (!res?.ok) return null;
  try {
    const data = await res.json();
    return data?.ok ? !!data.shared : null;
  } catch {
    return null;
  }
}

/** Verify the share cast with a few retries to absorb Neynar's indexing lag after the player posts.
 *  Resolves true once the proof is recorded. (A launch-time reconcile is the eventual backstop.) */
export async function confirmShareCast(): Promise<boolean> {
  for (const delayMs of [0, 4000, 9000]) {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (await verifyShareCastServer()) return true;
  }
  return false;
}
