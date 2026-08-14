/**
 * Typed query helpers for the campaign / add-tracking tables. All keyed by an FID that the caller
 * has ALREADY authenticated (see `getAuthedFid`). Writes are idempotent + write-once where it
 * matters (the add timestamp and onboarding are never overwritten once set).
 */
import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "./client";
import { verifyShareCast } from "@/lib/neynar";
import { users, campaignCastProofs } from "./schema";

/** Record that `fid` added the mini app (write-once), refreshing the notification token if supplied. */
export async function markAdded(fid: number, notif?: { token?: string; url?: string }): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .insert(users)
    .values({ fid, addedMiniAppAt: now, notifToken: notif?.token, notifUrl: notif?.url })
    .onConflictDoUpdate({
      target: users.fid,
      set: {
        // keep the first add time; prefer a freshly-supplied notif token, else keep the existing one
        addedMiniAppAt: sql`coalesce(${users.addedMiniAppAt}, excluded.added_mini_app_at)`,
        notifToken: sql`coalesce(excluded.notif_token, ${users.notifToken})`,
        notifUrl: sql`coalesce(excluded.notif_url, ${users.notifUrl})`,
        updatedAt: now,
      },
    });
}

/** Record that `fid` finished onboarding (write-once). */
export async function markOnboarded(fid: number): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .insert(users)
    .values({ fid, onboardedAt: now })
    .onConflictDoUpdate({
      target: users.fid,
      set: { onboardedAt: sql`coalesce(${users.onboardedAt}, excluded.onboarded_at)`, updatedAt: now },
    });
}

/** Store a server-verified share-cast proof for `fid` (one per FID). Ensures a users row exists. */
export async function recordCastProof(fid: number, castHash: string, castUrl: string): Promise<void> {
  const db = getDb();
  await db.insert(campaignCastProofs).values({ fid, castHash, castUrl }).onConflictDoNothing();
  await db.insert(users).values({ fid }).onConflictDoNothing();
}

/** Remember that `fid` posted a share cast we couldn't verify yet (write-once) so the reconcile
 *  cron retries it later, once Neynar has indexed the cast. */
export async function markShareAttempted(fid: number): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .insert(users)
    .values({ fid, shareAttemptedAt: now })
    .onConflictDoUpdate({
      target: users.fid,
      set: { shareAttemptedAt: sql`coalesce(${users.shareAttemptedAt}, excluded.share_attempted_at)`, updatedAt: now },
    });
}

/**
 * Launch-reconcile pass: for recent share-attempters who still lack a verified proof, re-run the
 * Neynar check (which has since indexed the cast) and record proofs for any that now match. Bounded
 * by `limit` per run and a recency window so the population stays small + self-draining. Returns
 * `{ checked, proven }`. Called by the cron.
 */
export async function reconcileShares(limit = 40, windowDays = 14): Promise<{ checked: number; proven: number }> {
  const db = getDb();
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  // attempters within the window who have NO cast proof yet
  const rows = await db
    .select({ fid: users.fid })
    .from(users)
    .leftJoin(campaignCastProofs, eq(users.fid, campaignCastProofs.fid))
    .where(and(isNotNull(users.shareAttemptedAt), gt(users.shareAttemptedAt, cutoff), isNull(campaignCastProofs.fid)))
    .limit(limit);

  let checked = 0;
  let proven = 0;
  for (const { fid } of rows) {
    checked++;
    const cast = await verifyShareCast(fid);
    if (cast) {
      await recordCastProof(fid, cast.castHash, cast.castUrl);
      proven++;
    }
  }
  return { checked, proven };
}

export interface CampaignStatus {
  added: boolean;
  shared: boolean;
  onboarded: boolean;
  eligible: boolean;
}

/** The campaign state for `fid`: added + (verified) shared + onboarded, and eligibility (added && shared). */
export async function getCampaignStatus(fid: number): Promise<CampaignStatus> {
  const db = getDb();
  const [u, proof] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.fid, fid), columns: { addedMiniAppAt: true, onboardedAt: true } }),
    db.query.campaignCastProofs.findFirst({ where: eq(campaignCastProofs.fid, fid), columns: { fid: true } }),
  ]);
  const added = !!u?.addedMiniAppAt;
  const shared = !!proof;
  return { added, shared, onboarded: !!u?.onboardedAt, eligible: added && shared };
}

/**
 * Every FID that added the mini app — the notification audience.
 *
 * Adding is the prerequisite for receiving anything: Neynar only holds tokens for players who
 * added and left notifications on. Players who since removed the app or disabled notifications
 * stay in this list and are silently dropped by Neynar at send time, which is the correct division
 * of labour — that lifecycle is exactly what we handed them.
 *
 * Wallet-only players never appear here and never can: mini-app push is a Farcaster-client feature,
 * so a Coinbase-Verified web player has no client to deliver one.
 */
export async function notifiableFids(): Promise<number[]> {
  const db = getDb();
  const rows = await db
    .select({ fid: users.fid })
    .from(users)
    .where(isNotNull(users.addedMiniAppAt));
  return rows.map((r) => r.fid).sort((a, b) => a - b);
}
