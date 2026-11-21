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
import { pgTable, integer, text, timestamp, serial, uniqueIndex, index, jsonb } from "drizzle-orm/pg-core";

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
  /** Set when the player posts a share cast we couldn't verify on the spot (Neynar indexing lag) —
   *  the launch-reconcile cron retries exactly these. A user leaves the cron's population the moment
   *  a `campaign_cast_proofs` row lands for them. */
  shareAttemptedAt: timestamp("share_attempted_at", { withTimezone: true }),
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

/**
 * The letter-swap orderbook — signed Seaport 1.6 orders, letter-for-letter (decisions.md "swap
 * primitive, light"). The DB stores and serves orders; it is NEVER the truth about validity —
 * Seaport is: fills and cancels happen on-chain, and the read path drops anything
 * getOrderStatus says is spent. Losing this table loses open listings, not assets.
 */
export const swapOrders = pgTable(
  "swap_orders",
  {
    id: serial("id").primaryKey(),
    /** Lowercase maker address. */
    maker: text("maker").notNull(),
    /** 0–51 letter ids (26 lower + 26 upper). */
    giveId: integer("give_id").notNull(),
    wantId: integer("want_id").notNull(),
    /** The full Seaport OrderComponents, JSON, exactly as signed. */
    orderJson: text("order_json").notNull(),
    signature: text("signature").notNull(),
    /** keccak order hash — the on-chain status key; unique = one row per order. */
    orderHash: text("order_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("swap_orders_hash_idx").on(t.orderHash)],
);

/**
 * Browser push subscriptions — how a player with no Farcaster account hears that a staked word is
 * getting hungry. Keyed by WALLET, because the wallet is the account (decisions.md #9).
 *
 * One row per browser (`endpoint` is unique, and it is the push service's capability URL for that
 * browser). A browser follows ONE wallet: subscribing again from the same browser with another
 * wallet moves the row. `fid` is set only when the browser subscribed while signed in with
 * Farcaster (a verified Quick Auth JWT, never a client claim); it lets the daily reminder read the
 * FID's daily slot and lets the senders skip anyone Farcaster already notifies.
 *
 * Nothing here is secret beyond the endpoint itself, and the messages only ever describe onchain
 * state that is public anyway. Losing the table loses reminders, not assets.
 */
export const webPushSubscriptions = pgTable(
  "web_push_subscriptions",
  {
    id: serial("id").primaryKey(),
    /** Lowercase wallet address. */
    address: text("address").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    fid: integer("fid"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("web_push_endpoint_idx").on(t.endpoint),
    index("web_push_address_idx").on(t.address),
  ],
);

export type WebPushSubscription = typeof webPushSubscriptions.$inferSelect;

/**
 * Reward claim data: one row per leaf of a yield or bounty epoch's Merkle tree, proof included.
 *
 * The keeper writes an epoch's rows BEFORE it calls openEpoch, and refuses to open the epoch if the
 * write fails, so an open epoch always has its proofs here. Rows are NEVER deleted or replaced: a
 * run whose openEpoch was sent but not confirmed may still land, so a rerun's rebuilt tree is
 * stored BESIDE the first (the root is part of the key). The claim route (/api/rewards/claimable)
 * serves a row only while the chain says that epoch is open with this exact `root`, so the trees
 * that never opened are inert.
 *
 * Proofs are public by design (a leaf pays its baked-in account, whoever submits it), so nothing
 * here is secret, but the rows are NOT rebuildable later: the keeper's scan reads the latest chain
 * state, so a re-run builds a different tree. Back the table up like any operational record (the
 * keeper also leaves a keeper-output/ copy where it can). `chainId` keeps a testnet and mainnet
 * sharing one database apart.
 */
export const rewardLeaves = pgTable(
  "reward_leaves",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    /** "yield" (YieldDistributor, epoch = UTC day) or "bounty" (Bounty, epoch = UTC week). */
    stream: text("stream").notNull(),
    /** uint256 epoch id, as a decimal string. */
    epochId: text("epoch_id").notNull(),
    /** The tree root this leaf belongs to. One epoch may hold several trees; the chain picks one. */
    root: text("root").notNull(),
    /** uint256 word token id, as a decimal string. One leaf per (epoch, tree, word). */
    tokenId: text("token_id").notNull(),
    /** Lowercase payee address. */
    account: text("account").notNull(),
    /** $WORD wei, as a decimal string. */
    amount: text("amount").notNull(),
    proof: jsonb("proof").$type<`0x${string}`[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reward_leaves_leaf_idx").on(t.chainId, t.stream, t.epochId, t.root, t.tokenId),
    index("reward_leaves_account_idx").on(t.chainId, t.account),
  ],
);

export type RewardLeafRow = typeof rewardLeaves.$inferSelect;
