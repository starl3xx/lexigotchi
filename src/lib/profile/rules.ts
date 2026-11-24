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

/** What the owner's own profile route returns. The email appears only here, never publicly. */
export interface ProfileView {
  address: string;
  nameSource: NameSource | null;
  x: { username: string; name: string | null; pfpUrl: string | null; createdAt: string | null; linkedAt: string | null } | null;
  email: { address: string; reminders: boolean } | null;
}

/** Which parts of the profile the server has switched on. */
export interface ProfileConfig {
  ok: true;
  profiles: boolean;
  x: boolean;
  email: boolean;
}
