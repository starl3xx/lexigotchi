/**
 * Database schema (Drizzle / Postgres) — the campaign + add-tracking backend.
 *
 * This is the server-side source of truth that replaces the optimistic `localStorage` flags the
 * client uses today (the pre-launch splash + the post-mint "add the app" nudge). Keyed by Farcaster
 * FID, mirroring LHAW's proven shape. Phase-0 scope: just what the campaign needs — adds,
 * onboarding, server-verified share proofs, and an idempotent reward ledger.
 *
 * Migrations: `npm run db:generate` (writes ./drizzle) → `npm run db:migrate` (applies to Neon).
 */
import { pgTable, integer, text, timestamp, serial, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Players, keyed by Farcaster FID (the identity the whole game hangs off).
 * `addedMiniAppAt` + the notification token come from the Farcaster `frame_added` webhook (and the
 * `record-add` client fallback); `onboardedAt` is the server-side version of the onboarding flag.
 */
export const users = pgTable("users", {
  fid: integer("fid").primaryKey(),
  addedMiniAppAt: timestamp("added_mini_app_at", { withTimezone: true }),
  /** Farcaster notification token + URL handed to us when the player adds the app. */
  notifToken: text("notif_token"),
  notifUrl: text("notif_url"),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Pre-launch campaign: one row per FID whose share-cast we've SERVER-VERIFIED via Neynar (the
 * client can't be trusted to assert it). Presence of a row = the "shared a cast" step is complete.
 */
export const campaignCastProofs = pgTable("campaign_cast_proofs", {
  fid: integer("fid").primaryKey(), // one proof per player
  castHash: text("cast_hash").notNull(),
  castUrl: text("cast_url"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Reward ledger — the idempotent record of packs owed/granted (e.g. the pre-launch 5-pack).
 * `UNIQUE(fid, kind)` makes "grant once" safe to retry; `txHash` is filled when the on-chain
 * airdrop lands (null until the contracts are live and the keeper sends it).
 */
export const packGrants = pgTable(
  "pack_grants",
  {
    id: serial("id").primaryKey(),
    fid: integer("fid").notNull(),
    kind: text("kind").notNull(), // e.g. "prelaunch_5pack"
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    txHash: text("tx_hash"),
  },
  (t) => [uniqueIndex("pack_grants_fid_kind_unique").on(t.fid, t.kind)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type CampaignCastProof = typeof campaignCastProofs.$inferSelect;
export type PackGrant = typeof packGrants.$inferSelect;
