/**
 * Profile reads and writes (schema.ts `profiles`). Server-only. Every write here is made for a
 * wallet the caller has proven with a session (lib/profile/session.ts); these helpers don't check.
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "./client";
import { profiles, type Profile } from "./schema";
import type { NameSource, ProfileView, PublicProfileView } from "@/lib/profile/rules";

/**
 * Postgres "relation does not exist": the owner hasn't applied migration 0006 yet. Drizzle wraps
 * the driver's error ("Failed query: …"), so the code is on `cause`, not on the error itself.
 */
export function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "42P01" || e?.cause?.code === "42P01";
}

export async function getProfile(address: string): Promise<Profile | null> {
  const rows = await getDb().select().from(profiles).where(eq(profiles.address, address.toLowerCase())).limit(1);
  return rows[0] ?? null;
}

export async function setNameSource(address: string, source: NameSource | null): Promise<void> {
  const a = address.toLowerCase();
  await getDb()
    .insert(profiles)
    .values({ address: a, nameSource: source })
    .onConflictDoUpdate({ target: profiles.address, set: { nameSource: source, updatedAt: sql`now()` } });
}

/** The public view: everything but the email. */
export function toPublicView(address: string, p: Profile | null): PublicProfileView {
  const { email: _email, ...rest } = toView(address, p);
  return rest;
}

export function toView(address: string, p: Profile | null): ProfileView {
  return {
    address: address.toLowerCase(),
    nameSource: p?.nameSource === "x" || p?.nameSource === "farcaster" ? p.nameSource : null,
    x: p?.xUserId && p.xUsername
      ? {
          id: p.xUserId,
          username: p.xUsername,
          name: p.xName,
          pfpUrl: p.xPfpUrl,
          createdAt: p.xCreatedAt?.toISOString() ?? null,
          linkedAt: p.xLinkedAt?.toISOString() ?? null,
        }
      : null,
    email: p?.email && p.emailVerifiedAt ? { address: p.email, reminders: p.emailReminders } : null,
  };
}
