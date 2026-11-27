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
import { pgTable, integer, text, timestamp, serial, uniqueIndex, index, jsonb, boolean, primaryKey, bigint, numeric } from "drizzle-orm/pg-core";

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
 * `drawKey` is `c:<letters>:<commitId>` for a pack (the Letters address, lowercase: commit ids
 * restart on a redeploy, and an old contract's row must never be served for the new one's commit), `d:<identityKey>:<day>` for a daily (the daily is drawn
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
 * Every wallet the game has seen connected, for the operator console's Players tab: when it first
 * and last connected, on how many UTC days, and from where (the web or a Farcaster host). Written by
 * `/api/players/seen`, which the game calls once per wallet per day (lib/sightings.ts).
 *
 * UNVERIFIED by design: the call is unsigned, so the console labels this a count of wallets seen,
 * not proof that each was connected. Asking every visitor to sign just to be counted would be a
 * wallet popup for nothing. `fid` is set only from a verified Quick Auth token, never a client claim.
 *
 * Not secret (a wallet address is public), and never shown outside the gated admin route. Losing the
 * table loses the history of visits, not anything a player owns.
 */
export const walletSightings = pgTable(
  "wallet_sightings",
  {
    /** Lowercase wallet address. */
    address: text("address").primaryKey(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /** How many distinct UTC days the wallet was seen on. */
    daysSeen: integer("days_seen").notNull().default(1),
    /** The UTC day number (Unix days) of the last sighting: a second call that day adds no day. */
    lastDay: integer("last_day").notNull(),
    /** "web" or "farcaster", at the first sighting and at the last. */
    firstVia: text("first_via").notNull(),
    lastVia: text("last_via").notNull(),
    /** The verified FID seen with this wallet most recently, if any. */
    fid: integer("fid"),
  },
  (t) => [index("wallet_sightings_first_seen_idx").on(t.firstSeenAt)],
);

export type WalletSighting = typeof walletSightings.$inferSelect;

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
    /**
     * How it joined (migration 0009): "signature" (Link another wallet: the wallet signed) or
     * "farcaster" (a Farcaster account verified both it and a wallet the account already had by
     * signature; it leaves when that verification goes). The core link reads never select this, so a
     * database without 0009 keeps working.
     */
    via: text("via").notNull().default("signature"),
    /** For a "farcaster" link: the FID whose verification vouches for it. */
    fid: integer("fid"),
  },
  (t) => [index("wallet_links_account_idx").on(t.account)],
);

/**
 * The player's game wallet (migration 0010): the one wallet they choose to keep their letters,
 * words, and $WORD in, because every onchain action uses the connected wallet's own holdings. One
 * row per account (its first wallet). A wallet that has left the account reads as no choice.
 * Its own table, not a `profiles` column: profile reads select every column, so a new one there
 * would break them on a database that hasn't migrated yet.
 */
export const gameWallets = pgTable("game_wallets", {
  account: text("account").primaryKey(),
  wallet: text("wallet").notNull(),
  chosenAt: timestamp("chosen_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A player's choice of reminders (lib/notify/kinds.ts; migration 0018): which kinds they changed
 * from the defaults, keyed by ACCOUNT (linked wallets are one player). A table of its own, never
 * columns on `profiles`: `getProfile` selects every profiles column, so a column the database
 * doesn't have yet would break every profile read until the migration ran (as for `game_wallets`).
 * A missing table reads as "nobody changed anything".
 */
export const reminderPrefs = pgTable("reminder_prefs", {
  account: text("account").primaryKey(),
  /** Only the kinds the player changed: `{ "daily": false }`. A kind not here follows its default. */
  kinds: jsonb("kinds").$type<Record<string, boolean>>().notNull().default({}),
  /** How email comes: null for each reminder as it happens. (A weekly digest is planned.) */
  emailCadence: text("email_cadence"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Send-once marks for reminders that have no column of their own (migration 0018): one row says
 * "this account was sent this kind for this thing" (`mark`: a sale's fill, a payout day, a deal).
 * The two oldest email reminders keep their columns on `profiles` (`emailDailyDay`,
 * `emailHungerDay`); every later kind marks here, so a new kind never needs a new column.
 */
export const reminderMarks = pgTable(
  "reminder_marks",
  {
    account: text("account").notNull(),
    kind: text("kind").notNull(),
    mark: text("mark").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.account, t.kind, t.mark] })],
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

/**
 * Each word's scene (lib/scenes), as the wallet holding it chose it: the Today stage, the Showcase,
 * and the share card stand the word there. Saved on the server so a choice follows the player to
 * every device and host (decisions.md #15); the browser keeps its own copy, so a pick works offline
 * and before sign-in.
 *
 * Keyed by the wallet that held the word, not the profile account: the session proves that wallet,
 * the bag already knows every word's holder, and linking or unlinking wallets later moves nothing. A
 * word that changes hands starts on the Stage for its new holder. Cosmetic and public: a wallet may
 * save a scene for any dictionary word, and a row only changes what that wallet's own words show.
 * `updatedAt` is when the player picked it (their browser's clock, kept within the last 30 days),
 * so a pick made before sign-in and uploaded later still sorts by when it was made.
 */
export const wordScenes = pgTable(
  "word_scenes",
  {
    /** Lowercase wallet address. */
    wallet: text("wallet").notNull(),
    /** UPPERCASE dictionary word. */
    word: text("word").notNull(),
    /** A SceneId (lib/scenes). */
    scene: text("scene").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.wallet, t.word] })],
);

/**
 * Free things, once per PROFILE (migration 0013; starl3xx: "only one wallet per profile should get a
 * free anything"). A free route records the account (its first wallet) and the key it signs under,
 * first write wins, so the profile's other wallets are refused whatever key they'd sign under:
 * - kind "daily", period = the UTC chain day: one free daily letter a day. Backs up the onchain
 *   `dailyUsed` walk (relatedDailyKeys), which needs Farcaster's lookups and fails open.
 * - kind "pack", period 0: the one free pack. Backs up `freePackClaimed[fid]`, which is per Farcaster
 *   account, and a profile can hold more than one.
 */
export const freeClaims = pgTable(
  "free_claims",
  {
    chainId: integer("chain_id").notNull(),
    account: text("account").notNull(),
    kind: text("kind").notNull(),
    period: integer("period").notNull(),
    /** The key the voucher was signed under (decimal string: a daily key can exceed 2^160). */
    claimKey: text("claim_key").notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * The free-letter ledger (migration 0015, decisions.md #21): how many letters this grant gave (1
     * for a daily, 5 for the pack), when its voucher stops being spendable, and whether it reached
     * the chain. `used` null = not settled yet (it counts); false = expired unused, so its letters
     * go back to the budget and its day doesn't count toward the 10.
     */
    letters: integer("letters").notNull().default(1),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    used: boolean("used"),
  },
  (t) => [uniqueIndex("free_claims_account_kind_period").on(t.chainId, t.account, t.kind, t.period)],
);

/**
 * Words for sale on the in-game board (decisions.md #18, migration 0014): Seaport orders that offer
 * one Word for $WORD, 10% to SaleFees. Like `swap_orders`, a bulletin board, never the truth: the
 * route checks every row against Seaport and the Words contract on read. A row whose order can no
 * longer fill (filled, cancelled, expired, or superseded by a counter bump) is pruned. A row whose
 * word just isn't fillable right now (moved, staked, approval gone, re-claimed) is kept but hidden,
 * because its signed order would fill again if the word came back approved: listing the word again
 * cancels those rows onchain first.
 */
export const wordListings = pgTable(
  "word_listings",
  {
    id: serial("id").primaryKey(),
    /** Lowercase seller address (the order's offerer). */
    maker: text("maker").notNull(),
    /** The Word's token id, decimal (keccak256 of the word: wider than any SQL integer). */
    tokenId: text("token_id").notNull(),
    /** The word, UPPERCASE (tokenId is its hash, checked on listing). */
    word: text("word").notNull(),
    /** What the buyer pays, $WORD wei, decimal. */
    priceWei: text("price_wei").notNull(),
    /** Words.claimedAt when listed: a different value later means the word was dissolved and re-claimed. */
    claimedAt: bigint("claimed_at", { mode: "number" }).notNull(),
    /** The full Seaport OrderComponents, JSON, exactly as signed. */
    orderJson: text("order_json").notNull(),
    signature: text("signature").notNull(),
    orderHash: text("order_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("word_listings_hash_idx").on(t.orderHash), index("word_listings_token_idx").on(t.tokenId)],
);

/**
 * Per-word picks, keyed by PROFILE (migration 0016; decisions.md #22, the Customization Spec: "taste
 * stays with the player"). Replaces `word_scenes`, which was keyed by the wallet holding the word:
 * a pick now follows the player's profile (the account's first wallet, or the wallet itself when
 * unlinked) across every wallet in it, and comes off the word when the word leaves the profile
 * (the keeper clears those rows; a staked word or a Move between the profile's wallets keeps it).
 * `kind` leaves a slot for what letters wear later (e.g. "costume"); only "scene" is written today.
 * Migration 0016 copies every `word_scenes` row in, under its wallet's account; `word_scenes` stays
 * for a rollback, and the code reads it only while this table is missing.
 */
export const wordPicks = pgTable(
  "word_picks",
  {
    /** The profile: its account's first wallet, lowercase. */
    profile: text("profile").notNull(),
    /** UPPERCASE dictionary word (its id: tokenId = keccak256(word)). */
    word: text("word").notNull(),
    /** "scene", or "case" (lib/db/wordCases.ts: the word is in a case). */
    kind: text("kind").notNull(),
    /** What was picked: a SceneId for kind "scene"; the case's style for kind "case". */
    value: text("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.profile, t.word, t.kind] })],
);

/**
 * The wardrobe (migration 0016; decisions.md #22): one row per Shop purchase, from the Shop's
 * `Purchased` event, so it is idempotent on (chain, transaction, log index). Ownership is a database
 * record keyed by profile, so every linked wallet shares it, and not tradeable. `recipient` is kept so
 * the profile can be resolved again later (a wallet may join a profile after buying); `profile` is the
 * recipient's account when the row was written. `shop` is in the key's neighbors because item ids
 * restart when a Shop is redeployed.
 */
export const wardrobe = pgTable(
  "wardrobe",
  {
    chainId: integer("chain_id").notNull(),
    /** The Shop's address, lowercase. */
    shop: text("shop").notNull(),
    itemId: integer("item_id").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: bigint("block_number", { mode: "number" }).notNull(),
    /** Lowercase wallets. */
    buyer: text("buyer").notNull(),
    recipient: text("recipient").notNull(),
    profile: text("profile").notNull(),
    /** USDC units (6 decimals). */
    priceUsdc: bigint("price_usdc", { mode: "number" }).notNull(),
    toStudio: bigint("to_studio", { mode: "number" }).notNull(),
    /** $WORD wei routed to the pool in the purchase, decimal (0 when the swap waited). */
    wordToPool: text("word_to_pool").notNull(),
    deferredUsdc: bigint("deferred_usdc", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.txHash, t.logIndex] }),
    index("wardrobe_recipient_idx").on(t.chainId, t.shop, t.recipient),
    index("wardrobe_profile_idx").on(t.chainId, t.shop, t.profile),
  ],
);

/**
 * What each Shop item IS (migration 0016): its name, kind, and art. Starts EMPTY, and nothing seeds
 * it: real items get a row when they're added. The app never shows an item without one, except on a
 * test network, where it is a plain "Test item" card (lib/shop/rules.ts).
 */
export const shopItems = pgTable(
  "shop_items",
  {
    chainId: integer("chain_id").notNull(),
    shop: text("shop").notNull(),
    itemId: integer("item_id").notNull(),
    name: text("name").notNull(),
    /** An ItemKind (lib/shop/rules.ts). */
    kind: text("kind").notNull(),
    /** A reference to its art (a scene id, an asset path); null until it has art. */
    art: text("art"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.shop, t.itemId] })],
);

/** How far the wardrobe has read each Shop's `Purchased` events (migration 0016). */
export const shopIndex = pgTable(
  "shop_index",
  {
    chainId: integer("chain_id").notNull(),
    shop: text("shop").notNull(),
    /** The last block whose events are in `wardrobe`. */
    lastBlock: bigint("last_block", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.shop] })],
);

/**
 * Letters for sale on the Market (decisions.md #30; migration 0017): one Seaport order per row,
 * offering `qty` of one letter id at a $WORD price each. A buyer takes any number of them, so the
 * row stays until the order is sold out, cancelled, or expired; how many are left is Seaport's to
 * say (`getOrderStatus`), never this table's. `unitPriceWei` is numeric so the cheapest of a letter
 * is one index read, however many are listed.
 */
export const letterListings = pgTable(
  "letter_listings",
  {
    id: serial("id").primaryKey(),
    /** Lowercase seller address (the order's offerer). */
    maker: text("maker").notNull(),
    /** 0-51: 26 lowercase, then 26 UPPERCASE. */
    letterId: integer("letter_id").notNull(),
    /** How many letters the order offered when it was signed. */
    qty: integer("qty").notNull(),
    /** What a buyer pays for one letter, $WORD wei. */
    unitPriceWei: numeric("unit_price_wei", { precision: 78, scale: 0 }).notNull(),
    /** The full Seaport OrderComponents, JSON, exactly as signed. */
    orderJson: text("order_json").notNull(),
    signature: text("signature").notNull(),
    orderHash: text("order_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("letter_listings_hash_idx").on(t.orderHash),
    index("letter_listings_book_idx").on(t.letterId, t.unitPriceWei),
    index("letter_listings_maker_idx").on(t.maker),
  ],
);

/**
 * Sales on the Market (decisions.md #30; migration 0017): one row per Seaport `OrderFulfilled` that
 * sold a Word or letters and paid the sale fee. Read from the chain (lib/market/sales.ts), so it is
 * a copy of public history, idempotent on (chain, transaction, log index). `shop_index` holds how
 * far it has read, under the SaleFees address.
 */
export const marketSales = pgTable(
  "market_sales",
  {
    chainId: integer("chain_id").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: bigint("block_number", { mode: "number" }).notNull(),
    soldAt: timestamp("sold_at", { withTimezone: true }).notNull(),
    /** "word" or "letter". */
    kind: text("kind").notNull(),
    orderHash: text("order_hash").notNull(),
    seller: text("seller").notNull(),
    buyer: text("buyer").notNull(),
    /** A word sale: the word, UPPERCASE, and its rarity tier (so recent sales group by tier). */
    word: text("word"),
    tier: text("tier"),
    /** A letter sale: the letter id (0-51). */
    letterId: integer("letter_id"),
    /** Letters sold in this fill (1 for a word). */
    qty: integer("qty").notNull(),
    /** Everything the buyer paid, $WORD wei, and the part of it that was the fee. */
    priceWei: numeric("price_wei", { precision: 78, scale: 0 }).notNull(),
    feeWei: numeric("fee_wei", { precision: 78, scale: 0 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.txHash, t.logIndex] }),
    index("market_sales_recent_idx").on(t.chainId, t.soldAt),
    index("market_sales_letter_idx").on(t.chainId, t.letterId, t.soldAt),
    index("market_sales_word_idx").on(t.chainId, t.word, t.soldAt),
  ],
);

/**
 * A beta tester's report, filed with the Telegram bot's `/bug` (lib/telegramReports.ts, migration
 * 0019). One row per report: its words, who typed it and where (to answer there when it is fixed),
 * and whether it is open, fixed, or closed.
 *
 * PRIVATE. These are a tester's own words from a private group, with their Telegram name: shown
 * only behind the admin gate (`/api/admin/reports`), and never put in a public GitHub issue with a
 * name on it (the repository is public; the console's "open as an issue" leaves the reporter out).
 * Losing the table loses the list of reports, not anything a player owns.
 */
export const testerReports = pgTable(
  "tester_reports",
  {
    id: serial("id").primaryKey(),
    /** The chat the report was typed in (the beta group, or a private chat with the bot) and its message there. */
    chatId: bigint("chat_id", { mode: "number" }).notNull(),
    messageId: bigint("message_id", { mode: "number" }),
    /** The reporter's Telegram id, and their name as it was then: a username (no "@"), else a first name. */
    reporterId: bigint("reporter_id", { mode: "number" }).notNull(),
    reporterName: text("reporter_name").notNull(),
    text: text("text").notNull(),
    /** Telegram's id of the screenshot the report was typed under, if any (the bot can fetch it). */
    photoFileId: text("photo_file_id"),
    /** "open", "fixed" (the reporter was told), or "closed" (not a bug, a duplicate: nobody is told). */
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tester_reports_created_idx").on(t.createdAt)],
);
export type TesterReport = typeof testerReports.$inferSelect;

/**
 * A profile's Telegram account (lib/db/telegramLinks.ts, migration 0020): where @lexigotchi_bot
 * sends that player's reminders, as a private message. One Telegram account names one profile, and
 * a profile has one: a new link replaces the old one on both sides.
 *
 * `telegramId` is the person's Telegram id, which is also the id of their private chat with the
 * bot. A bot can only write to someone who started it, which the link's own `/start` does.
 * `name` is theirs as it was at linking (a username without the "@", else a first name), for the
 * profile to say which account is linked. Never public: no route but the player's own gives it.
 */
export const telegramLinks = pgTable(
  "telegram_links",
  {
    /** The profile's account (its first wallet), lowercase. */
    account: text("account").primaryKey(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
    name: text("name").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("telegram_links_telegram_id_idx").on(t.telegramId)],
);
export type TelegramLink = typeof telegramLinks.$inferSelect;

/**
 * One "Link Telegram" attempt: a code made under the profile's session, carried to the bot inside
 * a `t.me/<bot>?start=<code>` link, and used up by the bot's `/start`. Single use and short-lived.
 */
export const telegramLinkCodes = pgTable("telegram_link_codes", {
  code: text("code").primaryKey(),
  account: text("account").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

/**
 * Reserved word sets (decisions.md, "Reserved word sets"; migration 0021): themed groups of
 * dictionary words held back from the game and released later. `status` goes draft → revealed →
 * released, and only forward (lib/sets/rules.ts says what may change in each).
 *
 * PRIVATE until a set is revealed: this repository is public, so a set's name and words live here
 * and nowhere in the code. Nothing but `publicSets` (lib/sets/rules.ts) decides what a player's
 * browser is told, and no row of a draft set is ever logged.
 */
export const wordSets = pgTable(
  "word_sets",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    name: text("name").notNull(),
    /** "draft" | "revealed" | "released". */
    status: text("status").notNull().default("draft"),
    /** When the set shows its name and words by itself. Null: only by hand. */
    revealAt: timestamp("reveal_at", { withTimezone: true }),
    /** The planned release. The release itself is the owner's transaction. */
    releaseAt: timestamp("release_at", { withTimezone: true }),
    /** The first-day gate's length (0 = no gate). */
    gateHours: integer("gate_hours").notNull().default(24),
    /** Words of this set one player may claim while the gate is up. */
    perPlayerLimit: integer("per_player_limit").notNull().default(1),
    sort: integer("sort").notNull().default(0),
    revealedAt: timestamp("revealed_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    /** When the gate lifts, read from the chain at release. Null: no gate was set. */
    gateUntil: timestamp("gate_until", { withTimezone: true }),
    /** The block the chain was first seen holding the set's words. */
    releaseBlock: bigint("release_block", { mode: "number" }),
    /**
     * The root last BUILT to release this set (lowercase 0x…), or null when none was. A set is
     * marked released only once one exists: a release can be built only while the chain holds every
     * word of the set back, so "a release was built, and the chain now holds none of them back"
     * means the release landed. Kept here, on the set, because one root can be built for two
     * reasons (a release that returns the chain to an earlier reserve root).
     */
    releaseRoot: text("release_root"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("word_sets_chain_idx").on(t.chainId, t.sort)],
);

/**
 * A set's words. The key is the word, so a word is in ONE set at most, whatever two requests do at
 * once. Whether a word is in the dictionary is the code's to check (lib/sets/rules.ts).
 */
export const setWords = pgTable(
  "set_words",
  {
    chainId: integer("chain_id").notNull(),
    /** UPPERCASE, as the dictionary writes it. */
    word: text("word").notNull(),
    setId: integer("set_id")
      .notNull()
      .references(() => wordSets.id, { onDelete: "cascade" }),
    headliner: boolean("headliner").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.word] }), index("set_words_set_idx").on(t.setId)],
);

/**
 * Every dictionary root this server has BUILT, with the words that root leaves out (migration 0021).
 *
 * `Words.claim` checks a proof against the root the chain holds, so proofs must come from the tree
 * behind THAT root, not from whatever the sets table says this minute: a draft edit changes the
 * sets at once and the chain only when the owner sends `setDictionaryRoot`. A row is written BEFORE
 * its transaction is shown (as `reward_leaves` is before `openEpoch`), and never deleted: a root
 * sent but unconfirmed may still land. No row is needed for the full dictionary's root.
 *
 * `held` is the private list itself. Never log a row, and never send one to a browser.
 */
export const dictionaryRoots = pgTable(
  "dictionary_roots",
  {
    chainId: integer("chain_id").notNull(),
    /** Lowercase 0x…, the root as the contract stores it. */
    root: text("root").notNull(),
    /** The dictionary words this root leaves out, A to Z. */
    held: jsonb("held").$type<string[]>().notNull(),
    /** What first built it, for a person reading the table: "reserve", or "release:<set id>". No rule reads it. */
    note: text("note").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.root] })],
);

/**
 * Vouchers for the first-day gate (decisions.md, "Reserved word sets"; migration 0022). For the
 * first day after a set's release, `Words.claim` takes one of its words only with a voucher this
 * server signs, and a PROFILE gets vouchers for at most `word_sets.per_player_limit` different
 * words of the set, across all its wallets.
 *
 * A row is written BEFORE its voucher is signed, and it counts from that moment. `used` is read
 * from the chain's own history once the voucher can no longer be spent: true when the wallet
 * claimed the word (the slot is spent for good, whatever happened to the word afterwards: the
 * voucher carries no nonce, so "who holds it now" must never be what is counted), false when it
 * expired unused (the slot is free again). Null: not settled yet, and it counts.
 */
export const setVouchers = pgTable(
  "set_vouchers",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    setId: integer("set_id")
      .notNull()
      .references(() => wordSets.id),
    /** The profile's account (its first wallet), lowercase, as it was when the voucher was signed. */
    account: text("account").notNull(),
    /** The wallet the voucher names (the claim's msg.sender), lowercase. */
    wallet: text("wallet").notNull(),
    /** UPPERCASE. A released set's word: public by now. */
    word: text("word").notNull(),
    /** The voucher's last valid second. */
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    used: boolean("used"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One row per profile per word of a set: asking again for the same word renews it.
    uniqueIndex("set_vouchers_account_word").on(t.chainId, t.setId, t.account, t.word),
    index("set_vouchers_wallet_idx").on(t.chainId, t.setId, t.wallet),
  ],
);
