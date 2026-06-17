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

async function authedFetch(path: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await sdk.quickAuth.fetch(path, init);
  } catch (err) {
    console.error("[campaign] request failed:", path, err);
    return null;
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
