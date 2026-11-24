/**
 * Wallet sightings (schema.ts `wallet_sightings`, migration 0010). Server-only.
 *
 * Callers treat a missing table (`isMissingTable`) as "not set up yet": the beacon route answers
 * not_configured and the Players tab says the migration is owed, so nothing breaks before the owner
 * applies 0010.
 */
import { sql } from "drizzle-orm";
import { getDb } from "./client";
import { walletSightings, type WalletSighting } from "./schema";
import { utcDay, type SightingVia } from "@/lib/sightings";

/**
 * Record one sighting. Idempotent within a day: a second call on the same UTC day moves
 * `last_seen_at` and nothing else. A verified FID replaces the stored one; a call without one keeps it.
 */
export async function recordSighting(opts: { address: string; via: SightingVia; fid: number | null; now?: number }): Promise<void> {
  const day = utcDay(opts.now);
  const address = opts.address.toLowerCase();
  await getDb()
    .insert(walletSightings)
    .values({ address, lastDay: day, firstVia: opts.via, lastVia: opts.via, fid: opts.fid })
    .onConflictDoUpdate({
      target: walletSightings.address,
      set: {
        lastSeenAt: sql`now()`,
        daysSeen: sql`${walletSightings.daysSeen} + case when ${walletSightings.lastDay} <> ${day} then 1 else 0 end`,
        lastDay: day,
        lastVia: opts.via,
        fid: sql`coalesce(excluded.fid, ${walletSightings.fid})`,
      },
    });
}

/** Every sighting, oldest first. A table of one row per wallet: small for a long time. */
export async function allSightings(): Promise<WalletSighting[]> {
  return getDb().select().from(walletSightings).orderBy(walletSightings.firstSeenAt);
}
