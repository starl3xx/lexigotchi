/**
 * Profile rules shared by the server and the client. Pure, so the tests pin them.
 */

/** An X account must be older than this to unlock the free daily letter (Jake, 2026-11-23). */
export const X_MIN_AGE_DAYS = 90;

/** Is an X account created at `createdAt` old enough for the daily, at `now`? Unknown age is no. */
export function xOldEnough(createdAt: string | Date | null | undefined, now = Date.now()): boolean {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) && now - t >= X_MIN_AGE_DAYS * 86_400_000;
}

/** The day an X account becomes old enough, for "unlocks on …" copy. */
export function xEligibleOn(createdAt: string | Date): Date {
  return new Date(new Date(createdAt).getTime() + X_MIN_AGE_DAYS * 86_400_000);
}

export type NameSource = "x" | "farcaster";
export const isNameSource = (v: unknown): v is NameSource => v === "x" || v === "farcaster";

/**
 * A wallet's profile as anyone may read it (/api/profile/public): the linked X account is public by
 * design (the player is told so when linking), so the game can show a returning player's name and
 * picture, and know their X unlocks the daily, without asking for a signature first.
 */
export interface PublicProfileView {
  address: string;
  nameSource: NameSource | null;
  x: { id: string; username: string; name: string | null; pfpUrl: string | null; createdAt: string | null; linkedAt: string | null } | null;
}

/** What the owner's own profile route returns: the public view plus the email, which only its own session reads. */
export interface ProfileView extends PublicProfileView {
  email: { address: string; reminders: boolean } | null;
}

/** Which parts of the profile the server has switched on. */
export interface ProfileConfig {
  ok: true;
  profiles: boolean;
  x: boolean;
  email: boolean;
}

/** One wallet's public profile row (no email): what /api/world merges with Farcaster. */
export interface PublicProfileRow {
  address: string;
  xUsername: string | null;
  xPfpUrl: string | null;
  nameSource: string | null;
}

/** The public name and picture of a wallet, as other players see it. */
export interface PublicFace {
  username: string;
  pfpUrl: string | null;
  source?: NameSource;
}

/**
 * Merge Farcaster faces (Neynar, by address) with profile rows: the same rule the player sees for
 * themselves (useProfile's resolveIdentity). The wallet's choice wins while that account is still
 * linked; otherwise Farcaster, then X. A wallet with neither stays absent (a short address).
 */
export function mergePublicFaces(
  farcaster: Record<string, { username: string; pfpUrl: string | null }>,
  rows: readonly PublicProfileRow[],
): Record<string, PublicFace> {
  const out: Record<string, PublicFace> = {};
  for (const [a, f] of Object.entries(farcaster)) out[a.toLowerCase()] = { ...f, source: "farcaster" };
  for (const r of rows) {
    const a = r.address.toLowerCase();
    const x = r.xUsername ? { username: r.xUsername, pfpUrl: r.xPfpUrl, source: "x" as const } : null;
    if (!x) continue;
    const fc = out[a];
    if (r.nameSource === "x" || !fc) out[a] = x;
  }
  return out;
}
