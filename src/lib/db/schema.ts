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
import { pgTable, integer, text, timestamp, serial, uniqueIndex, index, jsonb, boolean } from "drizzle-orm/pg-core";

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

/**
 * The first letter draw served for a pack commit or for one identity's daily, kept so every later
 * request gets the SAME letters (src/lib/onchain/stickyDraw.ts).
 *
 * Why: a draw is computed from the live supply (never a capped letter, or the reveal would revert).
 * Without this row, the same commit drawn again after some letter capped out could come back with
 * DIFFERENT letters, and the first signature would still be valid onchain: two signed draws to pick
 * from. With it, a new draw is made only when the stored one can no longer be minted, and then the
 * old signature can't be used either, so at most one valid draw exists at any time.
 *
 * `drawKey` is `c:<commitId>` for a pack, `d:<identityKey>:<day>` for a daily (the daily is drawn
 * BEFORE its commit exists, so it can't key on the commit). Not secret: a draw is shown to the
 * player as soon as it is signed.
 */
export const letterDraws = pgTable(
  "letter_draws",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    drawKey: text("draw_key").notNull(),
    letterIndexes: jsonb("letter_indexes").$type<number[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("letter_draws_key_idx").on(t.chainId, t.drawKey)],
);

/**
 * A wallet's profile: the X account it linked, which linked account names it (and gives its
 * picture), and an optional email for reminders. Keyed by lowercase wallet, because the wallet is
 * the account (decisions.md #9). Every write is made under a wallet session, which a signed
 * Sign-In-With-Ethereum message opens (lib/profile/session.ts), so nobody can edit a profile for a
 * wallet they don't control.
 *
 * PUBLIC by design (the player is told so when linking): the X username, name, and picture show
 * next to the wallet in the game. The email is NEVER public: only its own wallet session reads it.
 * No X tokens are kept: the link reads the X profile once and throws the token away.
 *
 * `xCreatedAt` is the X account's own creation date. The free daily letter needs an account older
 * than 90 days, checked at claim time, so a young account unlocks itself when it comes of age.
 */
export const profiles = pgTable(
  "profiles",
  {
    /** Lowercase wallet address. */
    address: text("address").primaryKey(),
    /** X's numeric user id (a string: it is 64-bit). One X account links to one wallet. */
    xUserId: text("x_user_id"),
    xUsername: text("x_username"),
    xName: text("x_name"),
    xPfpUrl: text("x_pfp_url"),
    xCreatedAt: timestamp("x_created_at", { withTimezone: true }),
    xLinkedAt: timestamp("x_linked_at", { withTimezone: true }),
    /** Which linked account names this wallet and gives its picture: "x", "farcaster", or null (automatic). */
    nameSource: text("name_source"),
    /** Lowercase. Set only after the player confirms it with a code. */
    email: text("email"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    emailReminders: boolean("email_reminders").notNull().default(false),
    /** Send-once markers (UTC day numbers): a retried cron or keeper run never emails the same reminder twice. */
    emailDailyDay: integer("email_daily_day"),
    emailHungerDay: integer("email_hunger_day"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("profiles_x_user_idx").on(t.xUserId), uniqueIndex("profiles_email_idx").on(t.email)],
);

export type Profile = typeof profiles.$inferSelect;

/**
 * One "Link X" attempt: the OAuth `state`, the wallet that started it, and the PKCE verifier. Kept
 * on the server, not in a cookie, because inside a Farcaster host the X page opens in another
 * browser that has no cookie of ours. Single use and short-lived (`usedAt`, `expiresAt`).
 */
export const xLinkStates = pgTable("x_link_states", {
  state: text("state").primaryKey(),
  address: text("address").notNull(),
  codeVerifier: text("code_verifier").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

/**
 * Linked wallets: several wallets, one account (one bag, one profile, one free daily letter).
 * The account is named by its first wallet (`account`), which has no row of its own; each other
 * wallet has one row pointing at it. A wallet belongs to at most one account (the primary key).
 * Letters and words stay in the wallet that holds them: only the connected wallet can act on its
 * own (lib/onchain/unionBag.ts). Links are public, like a linked X account.
 */
export const walletLinks = pgTable(
  "wallet_links",
  {
    /** The linked wallet, lowercase. */
    address: text("address").primaryKey(),
    /** The account's first wallet, lowercase. */
    account: text("account").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("wallet_links_account_idx").on(t.account)],
);

/**
 * One "Link another wallet" attempt: a code made under the account's session, then signed (inside a
 * Sign-In with Ethereum message that names the account) by the wallet joining. Kept on the server so
 * the second wallet can sign anywhere: the same browser after a wallet switch, another device, or a
 * Farcaster host. Single use and short-lived (`usedAt`, `expiresAt`).
 */
export const walletLinkCodes = pgTable("wallet_link_codes", {
  code: text("code").primaryKey(),
  account: text("account").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

/**
 * A 6-digit code sent to confirm an email address. Only the code's hash is stored. A code works
 * once, for a few minutes, with a capped number of tries.
 */
export const emailCodes = pgTable(
  "email_codes",
  {
    id: serial("id").primaryKey(),
    address: text("address").notNull(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [index("email_codes_address_idx").on(t.address)],
);
