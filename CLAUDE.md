# CLAUDE.md — Lexigotchi

Working notes for future sessions. Read `docs/spec/v0.2-changelog.md` first (it overrides
`docs/spec/v0.1.md` on any conflict), then `docs/decisions.md`.

## What this is

Phase 0 prototype of Lexigotchi — a standalone onchain $WORD collection game on Base: any wallet
plays on the web, and the same app runs as a Farcaster mini app. This repo de-risks fun +
solvency, ships the playable game, and now carries the full **Foundry contract suite** (code-complete + tested, not yet deployed/audited — `contracts/`).
Stack: Next.js App Router + TS + Tailwind + recharts; `@neynar/react` + `@farcaster/miniapp-sdk`
for the mini app; sim/economy core is **zero-runtime-dependency TS** (runs via `tsx`/`vitest`).
`/` is the landing page (`src/components/landing/LandingPage.tsx`, a server page with no wallet code); the game is **`/play`**, which is also the mini app's `homeUrl`. `/play` is responsive by width only (`GameApp.tsx`): the portrait app below `md` (phones, and every mini-app host, which renders ~424px wide), and a desktop page from `md` (a side rail with every destination, the page title in the header, screens in `lg` two-column grids, sheets as centered dialogs). Never branch the layout on `useViewer().environment`: it reads "loading" first. The four how-it-works steps live in `src/lib/howItWorks.ts`, shared by the landing page and the in-game onboarding.

## Commands

- `npm run dev` — the app; `/` is the landing page, `/play` is the game (and the mini app).
- `npm run sim -- --days 365 --population 1500 --seed 7` — economy/solvency report
- `npm run derive` — regenerate `docs/economy.md`; `npm run derive:contracts` — `contracts/config/economy.json`
- `npm test` — the vitest suite: economy + solvency invariants, the game, the routes
- `npm run build` / `npm run typecheck`
- `npm run contracts:setup` (vendor deps) → `npm run contracts:build` / `npm run contracts:test` (forge)
- `npm run keeper -- [--resolve] [--fees] [--yield] [--bounty] [--payout] [--achievements] [--notify] [--dry]` — the
  daily operator pass, by hand. **Scheduled** by `/api/cron/keeper` (vercel.json, 00:05 UTC): same
  jobs (`src/lib/keeper/jobs.ts`, `createKeeper({ dry })`), the ones listed in `KEEPER_JOBS` (default
  `resolve,fees,yield,bounty,payout,repeg,notify`; `fees` flushes SaleFees into the pool just before
  `yield`; a KEEPER_JOBS that lists jobs must name `payout` and `fees` too;
  achievements opt-in; the bounty settles each week on the first
  day of the next, `bountyPeriodToSettle`), strictly one at a time (one key, one
  nonce), and a failed job doesn't skip the rest. It needs `KEEPER_PRIVATE_KEY` and
  `ANSWER_CHAIN_SEED`/`ANSWER_CHAIN_DAYS` in Vercel; without a deployment or a key it does nothing.
  **All three are set in production since 2026-11-25** (the Sepolia keeper key; a seeded answer list
  committed with `AnswerChain.setHead` at block 63,341,138, before any reveal, and re-committed at the
  full pool's 4,584 days at block 63,523,610, still before any reveal, so `ANSWER_CHAIN_DAYS=4584`; the seed is in the
  gitignored `contracts/answer-chain.sepolia-seed.secret.json`, so a local `--resolve` needs
  `ANSWER_CHAIN_SEED` from it). The rehearsal schedule FILE no longer matches the Sepolia chain, and
  the keeper refuses it.
  **`repeg`** is the price keeper (`src/lib/keeper/repeg.ts`, its own key `PRICE_KEEPER_PRIVATE_KEY`):
  moves each onchain price toward its USD target at the live GeckoTerminal price when it drifts
  ≥5%, clamped one bps inside the contract's `maxMoveBps` (and a 25%/run cap); never on the
  fallback price, never below $5K of $WORD in the pool (the oracle's `reserveUsd` is the $WORD side, about half the pool: so a ~$10K pool), never a zero price. A no-op until the owner wires the
  key with `setPriceKeeper` on all five contracts. Loads `.env.local` itself (`--env-file-if-exists`); without it the chain
  defaults to mainnet and dies on a missing deployment. `--notify` sends the hunger warning (Farcaster,
  then browser push for wallets Farcaster can't reach) and rides the same world scan as
  `--yield`/`--bounty`.
  `--yield`/`--bounty` store each epoch's claim proofs in the `reward_leaves` table (so they need
  `DATABASE_URL`, and never open an epoch without them) BEFORE `openEpoch`; `/api/rewards/claimable`
  serves a stored leaf only while the chain says its epoch is open with that same root. Rows are
  never deleted: a rerun's rebuilt tree is stored BESIDE the first (the root is in the key), because
  an openEpoch sent but unconfirmed may still land. The rows can't be rebuilt later (the scan reads
  the latest state), so back them up like operational data.
  **`payout`** pays every opened, unpaid share itself (decisions.md #16; `src/lib/keeper/payout.ts`):
  `claim` is permissionless and pays the leaf's account, so the keeper batches claims through
  Multicall3 (150 a transaction, per-call failure allowed, 90 s budget; the rest wait a run). Players
  never collect; earnings are SHOWN instead (`/api/rewards/earnings`, `src/lib/rewards/`, the
  Earnings sheet, `components/game/earnings.ts`). "Collect" (never "Claim") is the fallback for a
  share the keeper missed. Test it on an Anvil fork with a throwaway database, never on the real
  chain: run `scripts/keeper.ts` with `tsx` directly and explicit env, so `.env.local` stays out.
- `npm run answerchain:generate` — the pre-committed jackpot answer schedule + `ANSWERCHAIN_HEAD`.
  Output is SECRET + irreplaceable (gitignored `*.secret.json`) — back it up offline; the keeper reads it daily.
  **Mainnet uses `--new-seed`**: the whole schedule re-derives from one 64-hex secret
  (`src/lib/answerChain.ts`), which the hosted keeper holds as `ANSWER_CHAIN_SEED` (+
  `ANSWER_CHAIN_DAYS`). **Every list covers the whole frozen pool by default** (`FULL_SCHEDULE_DAYS`
  = 4,584, about 12.5 years): each word is drawn exactly once, so a drawn word is never drawn again
  (starl3xx, 2026-11-25). A shorter list would run out and need a new chain, which could repeat an old
  answer. The same seed lengthened keeps its first days' answers (a partial shuffle), which is how
  Sepolia went from 730 to the full pool before its first reveal. **The contract enforces it too**
  (mainnet's AnswerChain; Sepolia's predates it): `wasRevealed` remembers every revealed word, and
  `reveal` reverts `AlreadyRevealed` on a repeat, so a list rotated in after exhaustion must leave
  out every revealed word or the jackpot stalls at the repeat (decisions.md #20). The keeper checks each derived link against the onchain `currentCommit`
  before revealing (`src/lib/keeper/answerSchedule.ts`), so a wrong seed or a re-vendored dictionary
  stops the run. The seed is printed nowhere; it is in the file's `seed` field.
- `npm run db:generate` (schema → `drizzle/` migration) → `npm run db:migrate` (apply to Neon). Needs `DATABASE_URL*` in `.env.local`.
  Pull main first: a stale checkout stops at its own last migration. Jake runs production migrations.
  **A new migration must be dated after the last one** (its `when` in `drizzle/meta/_journal.json`):
  `migrate` skips an older-dated one and still says "applied successfully". Main's dates run ahead of
  the clock, so when `generate` stamps an earlier time, set `when` by hand just past the last entry.
  `tests/migrations.test.ts` fails on it. After a merge that renumbers one, check the table exists.
- **Redeploying production after a Vercel setting changes:** merge a PR to main (every merge builds;
  `vercel.json` skips nothing). The dashboard's Redeploy hasn't worked for the owner, and this Mac
  has no Vercel CLI. Check the result at `/api/profile/config` and similar switch endpoints.
- The operator console is at **`/admin`** (no separate command; part of the app).

## Architecture

- `data/guess_words_clean.ts` — vendored dictionary (source of truth). Do not edit; if it
  updates upstream, re-vendor and re-run tests.
- `src/lib/dictionary.ts` → canonical **4,584** deduped words (Let's Have A Word's list, re-vendored
  2026-11-21). A re-vendor moves the derived economy (`npm test` pins every number), the Merkle root
  (`npm run derive:contracts`), and, after a deploy, needs the owner's `Words.setDictionaryRoot`.
  The jackpot schedule does NOT move: it shuffles the frozen `src/lib/answerPool.ts`.
- `src/lib/economy.ts` → letter slots/odds/caps + rarity tiers. **Derived, never hardcoded.**
  Formulas: caps = `floor(slots × DEMAND_MULTIPLE)` (3.0 since decisions.md #21 → 68,760; Sepolia's
  deployed Letters keeps 2.5× → 57,294 until a redeploy); tiers = `floor` percentile cuts + alphabetical
  tiebreak. Tested against the spec.
- `src/lib/db/` → Drizzle + Neon Postgres — the **server-side** campaign / add-tracking backend
  (replaces the client's optimistic localStorage flags). `schema.ts` (users by FID, campaign cast
  proofs, the idempotent pack-grant ledger), `client.ts` (lazy pooled `getDb()`), `queries.ts`
  (write-once add/onboard, cast proof, status). Migrations in `drizzle/`; liveness `/api/health/db`.
- `src/app/api/campaign/` (`record-add` / `verify-cast` / `status` / `onboarded`) → the campaign API.
  Every route derives the FID from a **verified Quick Auth JWT** (`src/lib/auth/quickAuth.ts`,
  domain-pinned — never trusts a client-supplied fid). `verify-cast` confirms the share via Neynar
  (`src/lib/neynar.ts`, raw REST + `NEYNAR_API_KEY`). The client calls these through
  `src/components/game/campaignClient.ts` (`sdk.quickAuth.fetch`), wired into `useAddMiniApp` (add),
  `PreLaunchScreen` (status + share), and onboarding. The verified-share path needs `NEXT_PUBLIC_URL`'s
  host to match the manifest domain (the Quick Auth `aud`).
- `src/lib/notify/` → **Farcaster/Base push notifications**, Neynar-managed. `send.ts` (transport +
  the three guards: non-production hard-stops, `NOTIFICATIONS_ENABLED` must be `"true"`, missing key
  throws at import; an empty `targetFids` is `no-recipients`, NEVER a broadcast), `templates.ts`
  (copy — titles never interpolate so the 32-char cap is provable; variants rotate by epoch-day;
  ids are day-keyed for NUDGES and event-keyed for RECEIPTS), `triggers.ts` (pure targeting).
  `webhookUrl` in the manifest points at Neynar, **derived** from `NEXT_PUBLIC_NEYNAR_CLIENT_ID` —
  Neynar owns the whole token lifecycle, we store no tokens and send by FID. Nothing sends until
  `NOTIFICATIONS_ENABLED=true` in production.
  **Browser push** reaches wallet-only web players: `webPush.ts` (VAPID sender, its OWN switch
  `WEB_PUSH_ENABLED`, same three guards; prunes 404/410 endpoints), `webPushSubscription.ts`
  (validation: the endpoint must be a known push-service host, or the route is an SSRF hole),
  `src/lib/db/webPush.ts` + table `web_push_subscriptions` (one row per browser, keyed by wallet,
  ≤5 per wallet; a full wallet REFUSES a new browser, never evicts, since subscribing is unsigned), `/api/push/{subscribe,unsubscribe}`, `public/sw.js` (push + click only, no
  `fetch` handler), `useWebPush.ts` + `ReminderToggle.tsx` (More, and Home's hunger card). The
  `triggers.ts` `webPush*` helpers skip anyone Farcaster already reaches. iPhone needs the Home
  Screen app (`src/app/manifest.ts`). Dark until `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is set (no toggle
  without it, nor in the mock game) and `WEB_PUSH_ENABLED=true` in production (no sends without it).
  **Profile** (`sheets/ProfileSheet.tsx`, opened by the header picture; the balance pill keeps
  "Your $WORD"): linked accounts (Farcaster, Coinbase verification, X once switched on), the free
  daily letter, and the name and picture, which come ONLY from a linked account (`useProfile`'s
  `resolveIdentity`: the player's choice, else Farcaster, else X). Edits need a wallet session:
  `lib/profile/session.ts` (a SIWE challenge with an HMAC nonce, checked for contract wallets too,
  then a 30-day HMAC token in the `x-lexigotchi-session` header, never a cookie, because a host
  frame drops third-party cookies), `/api/profile/{config,challenge,session,me}`, `lib/db/profiles.ts`
  + tables `profiles`, `x_link_states`, `email_codes` (migration 0006). Dark until
  `PROFILES_ENABLED=true` + `PROFILE_SESSION_SECRET` (32+ chars); a missing table answers
  `not_configured`. The email is never public; no X token is kept.
  **Link X** (`lib/profile/x.ts`): OAuth 2.0 + PKCE; `/api/x/start` (session → a single-use state row
  with the verifier → X's consent URL), `/api/x/callback` (exchange within X's 30 s, read
  /2/users/me once, drop the token; lands on `/play?x=…`, or a "go back to the game" page when a
  Farcaster host opened X in another browser), `/api/x/unlink`. One X account names one wallet: a
  new link moves it. `/api/world` merges each wallet's chosen face (`mergePublicFaces`). Dark until
  `X_CLIENT_ID` + `X_CLIENT_SECRET`; callbacks must match the console exactly (127.0.0.1 locally).
  **Linked wallets** (`lib/db/walletLinks.ts`, tables `wallet_links` + `wallet_link_codes`, migration
  0008): several wallets as one account, named by its first wallet (≤5). One bag, one profile (the
  profile routes act on `sessionAccountOf`, the session wallet's account), one free daily letter
  (`relatedDailyKeys` walks the account's wallets; the daily is always signed under a FID, X, or a
  Coinbase-verified wallet's own key, so linking never adds a letter). Link: the account's session
  makes a single-use code (`/api/profile/wallets/code`), the joining wallet signs a link message
  naming the account with the code as its nonce (`…/message`, then `…/link`; a sign-in message never
  passes for a link or the reverse). Refused: a wallet in another account or heading one, a full
  account, a wallet with its own X or email (nothing is merged). Unlink (`DELETE /api/profile/wallets`)
  waits for tomorrow on a day the account took its letter (`accountClaimedToday`, fails closed).
  Links are public (the public view carries `wallets`), like X. Every read treats a missing table as
  "no links". Letters stay in the wallet that holds them: only the connected wallet acts. **Move
  here** (`lib/onchain/move.ts`, `moveToWallet` in the game API): the HOLDING wallet sends its loose
  letters (one `safeBatchTransferFrom`, all 52 ids) and held words (`safeTransferFrom` each) to a
  wallet in its account, the account read fresh at click time (never from a link or stored value);
  staked words stay; it waits while a loose roll on a moved letter is open (`readOpenRolls`). Account
  wide: the leaderboard sums an account into one row (`buildLeaderboards(…, accountOf)`), and
  reminders resolve by account (`loadLinkMap` reads every link once; `accountFidLookup`; the daily
  cron uses `relatedDailyKeysMany`, the same walk the daily route refuses on). **"You" is the
  player, everywhere** (starl3xx, 2026-11-24: "everything should be profile-based"): read
  `usePlayerWallets()` (connected + Farcaster-verified + profile wallets) for any "yours", total, or
  list; name a single wallet only for a verb only that wallet can do (sign, cancel, fill, move).
  Server lists of players resolve faces with `playerFaces` (lib/profile/faces.ts). **Farcaster
  wallets join on their own** (`lib/profile/farcasterWallets.ts`, migration 0009 `via`/`fid`;
  `POST /api/profile/farcaster` once per page load with a wallet session or Quick Auth): a wallet
  joins when one FID verified it AND a seed (the first wallet or a signature link); Farcaster rows
  never vouch (no chaining), never merge accounts, prune only on a positive Neynar answer and never
  on a claimed day; one advisory lock serializes writes. The core link reads never select `via`/`fid`,
  so a database without 0009 still resolves accounts. **Game wallet** (`lib/db/gameWallet.ts`, table
  `game_wallets`, migration 0010; its own table because `getProfile` selects every profiles column):
  the wallet the player keeps everything in; a stored wallet that left the account reads as none.
  `gameWalletAdvice` (pure, tested) decides the notice on Today and the Bag (GameWalletNotice);
  `useWalletHoldings` reads each wallet's letters and $WORD; Move can carry $WORD (opt-in).
  **Caretakers** (contracts: `Staking.setCaretaker`, design `docs/linked-wallets-onchain.md`): a
  staker names its other wallets, which may feed, roll, and ascend its STAKED words (the caller pays;
  the free snack is the staker's profile's; commits name the staker; only the staker unstakes). Game words carry
  `care` (the connected wallet cares for the staker); word rolls and ascensions look up commits by the
  staker; the Wallets card sets them per wallet (`readCaretakers`, `setCaretakerCalls`).
  **Free things, once per PROFILE** (`lib/db/freeClaims.ts`, table `free_claims`, migration 0013;
  starl3xx: "only one wallet per profile should get a free anything"): the free daily (kind "daily",
  per chain day) and the free pack (kind "pack", once) record the account and the key they sign
  under, first key wins, before signing; another key is refused unless the first voucher expired
  unused; a DB error refuses; no table = the onchain checks alone. daily-status adds the recorded key
  to its walk. **The free-letter policy** (decisions.md #21; `lib/freeLetters.ts` pure + tested,
  `lib/onchain/freeLedger.ts`, `lib/onchain/freeIdentity.ts`): every verified profile gets a free pack
  of 5 plus 10 free daily letters (params `freeLetters.freeDailyLimit`), all from one budget
  (`FREE_LETTER_BUDGET`, else params 30,000), and free grants stop at `freeStopClaimedFraction` 0.95
  of the dictionary claimed (`claimedWordCount`, the Claimed scan, cached 5 minutes). `free_claims`
  is the LEDGER (migration 0015: `letters`, `expires_at`, `used`): a grant counts from signing; once
  its voucher expires it is settled against the chain (`freePackClaimed` / `dailyUsed`), and an unused
  one gives its letters back and its day stops counting. Settle BEFORE reading the profile's own grant
  (a re-issue is only of a grant that still counts). **A FID counts only for a profile it belongs to**
  (`resolveFreeIdentity`): it verified one of the profile's wallets (Neynar; an outage counts), or the
  request carries that wallet's profile session (`x-lexigotchi-session`, sent by `openPostJson`).
  Otherwise the request falls through to the profile's X and Coinbase keys, then is refused
  `farcaster_wallet_unverified`. So every grant lives on the profile: no stranger can record on or hold
  someone else's letters, and nobody gets a second set under a key the profile never sees (Bugbot on
  #178 and #199; an `fid:` ledger with cross-wallet counting was tried and dropped for this). Both
  routes share `resolveFreeIdentity` (FID,
  then X, then Coinbase); the pack takes any `uint256` key, so no contract change. daily-status
  returns `dailyTaken`/`done`/`packTaken`/`stop`/`packStop`/`dictionaryFull` (GameApi
  `freeLetters`); the daily reminder skips finished profiles (`dailiesDone`) and everyone once free
  letters stop. A missing 0015 reads as "can't count" and those rules are skipped: run it at merge. **The free snack, once per profile** (live since Sepolia rehearsal #4, block 63,309,448):
  `Staking.feedWithSnack(ids, staker, profile, deadline, sig)` frees `ids[0]` when the signer vouched
  for (caller, staker, profile = the staker's account, UTC day) and `freeSnackDayPlusOne[profile]`
  isn't today; otherwise it pays, no revert. Plain `feed`/`feedMany` always pay. No database record:
  the onchain key is the cap. App: `POST /api/care/free-snack {wallet, staker}` signs it (no sign-in:
  the voucher is the caller's only), refusing `used_today` when the profile OR any of its wallets as
  a key used today (a wallet that joined after spending its own), and `try_again` on a DB error
  (`accountWalletsStrict` throws; `accountWallets` would read the staker as its own profile). The
  feed flows ask first and feed paid on null; approvals are always sized as if nothing were free.
  `accountClaimedToday` also holds Unlink and the Farcaster prune on a snack day.
  **Words for sale**, on the **Market** (the `swap` view, renamed for players 2026-11-25; decisions.md #18; `lib/onchain/wordSale.ts`, `/api/swap/words`, table
  `word_listings`, migration 0014): Seaport orders offering one Word for $WORD, 90% to the seller and
  10% (`params.market.wordSaleFee`, rounded up) to `SaleFees`, which the keeper's `fees` job flushes
  into the pool before `yield`. The route checks the SHAPE (`checkWordSaleOrder`: kind from content,
  fee ≥ 10% to SaleFees), the SIGNATURE (`verifyTypedData`, smart wallets too), ownership, a per-token
  approval, and the counter, and allows one live listing per word per seller (`cancel_first`). Rows
  that can't fill right now are hidden, not pruned: a signed order would fill again if the word came
  back approved, so listing again cancels them onchain in the same send as the approval
  (`prepareListingCalls`, `GET ?stale=maker:tokenId`). Buying approves exactly the price. Staked
  words can't be listed. Word state on the board is read live, never from the listing. A listed word is
  `useForSale()` (the board ∩ the bag): Next steps skip it (`nextSteps({ forSale })`), the Today stage
  shows it last in mood `forSale` ("…is for sale in the Market."), and its Bag card shows the price.
  The Bag's filters and sorts are `bagView.ts` (pure, tested), remembered per browser
  (`useStoredChoice`). **Cost to make** (`lib/wordCost.ts`, pure, tested; `WordValue.tsx`): the sell
  form and every listing show about what the word costs to build now at the live prices and average
  tries (letters at `pack ÷ 5 ÷ (26 × odds)`, so a pack's draws average its price; raises; the claim;
  each ascension stage reached), "Use this price" (3 significant figures), what it would earn a day
  (`/api/world`'s `yieldToday`: today's pot and the keeper's summed `yieldWeight`, the same weight
  `yieldLeaves` uses), and whether the jackpot already drew it (`drawn`, from `WordRevealed`). **Wallets sign
  `walletTypedDataJson(order)`, never `JSON.stringify(orderTypedData(order))`:** eth-sig-util wallets
  read a missing `EIP712Domain` as empty and sign another digest (every MetaMask listing failed
  bad_signature until #187); viem fills it in, so a viem-signed test can't catch this.
  **The Shop** (decisions.md #22; infrastructure only: no real item exists yet): cosmetics for USDC on
  Base, `contracts/src/Shop.sol` (registry EMPTY at deploy; a sale sends 80% straight to the revenue
  wallet and swaps the rest to $WORD through `adapters/UniV4UsdcWordAdapter` into ROYALTY, in the same
  transaction; a failed swap waits in the Shop for `sweep`, which the keeper's `fees` job runs; the
  floor reads Letters' `packPrice` peg; the adapter and the peg change only through `proposeRoute` →
  `acceptRoute` after 2 days; no withdraw path, pinned by `tests/shop-abi.test.ts`). Registry: the
  `shop` block of `config/deployments*.json` (`shopAddress`/`usdcAddress`), NOT in `contracts`, so
  `isSuiteDeployed` never waits on it; the admin keeps `SUITE_KEYS` apart from `CONTRACT_KEYS` the
  same way. App: **SHOP_ENABLED** = `NEXT_PUBLIC_SHOP_ENABLED=true` AND a test network AND the Shop
  deployed (`lib/shop/rules.ts` `shopOn`; mainnet is off whatever the setting says); `/api/shop` (the
  registry + `shop_items` metadata), `sheets/ShopSheet` (the rail's Collect group and More, no entry
  while off), `buyShopItem` (batched approve + buy where `wallet_getCapabilities` answers, else a USDC
  permit, typed data WITH `EIP712Domain`, else approve, wait, buy; never sponsored until the CDP policy
  covers the Shop). An item shows only with a `shop_items` row; on a test network one without shows as
  a plain "Test item" card (a rule about networks, never a stored name). **Wardrobe** = table
  `wardrobe` (migration 0016), one row per `Purchased` (idempotent on chain, tx, log index), read by
  profile: `/api/shop/record` right after a buy, and `lib/shop/indexer.ts` `catchUp` (wardrobe reads,
  the keeper) from `shop_index`'s cursor, halving its range when an RPC refuses a wide `getLogs` (the
  public Base RPCs allow 200 blocks). **Picks are per profile** (`word_picks`, `lib/db/wordPicks.ts`,
  migration 0016 copies `word_scenes` in under each wallet's account; `kind` "scene" today, a slot
  for "costume"): `/api/scenes` still speaks wallets and maps them to profiles; before 0016 it falls
  back to `word_scenes`; the keeper clears picks off words that left the profile (staking and Move
  keep them). The Market says "Scenes and costumes stay with the seller" only while SHOP_ENABLED.
  **Test USDC** (Base Sepolia only): `MockUSDC` (Circle's permit domain "USD Coin" / "2", 6 decimals),
  25 a profile a UTC day through a signer voucher (`/api/faucet/usdc`, `usdcFaucetDigest`, the free
  snack's pattern), "Get test USDC" beside "Get test $WORD" (`TestFaucets`: Your $WORD and the $WORD
  page), and in the Shop sheet when a tester can't afford an item; it never shows as dollars. The
  Sepolia route is `MockUsdcWordAdapter` (the peg's rate; it mints test $WORD, so it needs no
  funding; its owner can `setBroken` to exercise a deferred swap). Admin: the Shop tab (revenue to
  date, $WORD to the pool, waiting USDC, sales per item, settings, the transaction builders;
  `/api/admin/shop`) and the System switch list.
  **Email** (`lib/notify/email.ts`, Resend REST, no SDK; a User-Agent is required): a 6-digit code
  (HMAC stored, 10 min, 5 tries, 5 codes an hour per wallet) confirms the address
  (`/api/profile/email{,/verify}`), then hunger (keeper), daily-letter (notify-daily cron), and
  jackpot-win reminders go by email to opted-in wallets, each with RFC 8058 one-click unsubscribe
  (`/api/email/unsubscribe`, an HMAC of the wallet; GET shows a button, POST unsubscribes). The
  address is never public or logged. Dark until `EMAIL_ENABLED=true` + `RESEND_API_KEY` +
  `EMAIL_FROM`. Switched on in production 2026-11-24 with profiles and X; the landing page reads
  `xEnabled()`/`emailEnabled()` on the server, so its X door and "email optional" copy follow the
  switches, while `docs-site/` describes them as on.
- **Letter draws are sticky** (`src/lib/onchain/stickyDraw.ts` + table `letter_draws`): the first draw
  served for a pack commit (`c:<letters>:<commitId>`, the Letters address lowercased) or an identity's
  daily (`d:<key>:<day>`) is served again while it can still be minted. Every draw's HMAC also names
  the issuing contract (`signer.ts`): commit ids restart on a redeploy, and old outcomes are public. A draw depends on which letters are uncapped, so without this a
  cap-out could hand one unrevealed commit two valid signed draws. `/api/mint/reveal` and the
  free-daily bundle share the daily key. Fails open (plain draw) on a DB outage, so paid commits
  stay revealable.
- `src/lib/{redis,ratelimit}.ts` → Upstash Redis sliding-window rate limits on the campaign routes,
  keyed by the verified FID (applied after auth). **Fails open** if Upstash is unset/unreachable.
  Creds resolve from `KV_REST_API_*` / `UPSTASH_REDIS_REST_*` / Vercel's prefixed `lexigotchi_KV_*`.
- `src/app/api/cron/reconcile-campaign` (hourly via `vercel.json`; auth `CRON_SECRET`, fails closed in
  prod) → re-runs `verify-cast` for recent share-attempters whose proof missed the Neynar-lag window
  (`reconcileShares` in `queries.ts`, gated by `users.share_attempted_at`, set on a verify-cast miss).
  The campaign's eligibility backstop so nobody who shared is dropped.
- `src/lib/params.ts` → the **only** place to tune economics (prices/splits/odds/pity/hunger).
  Prices are placeholders; mechanics are v0.2-decided. `WORD_USD_PRICE` is now the **fallback**
  peg only — the live price comes from `src/lib/oracle/wordPrice.ts` (GeckoTerminal token
  endpoint, 60s cache) via `/api/oracle/word`, pushed into params' **call-time peg cell**
  (`currentWordUsd`/`setLiveWordUsd`, mounted via `useWordPrice` in GameApp + AdminConsole).
  USD↔$WORD conversions read the cell at call time; the **sim stays on the constant** for
  determinism. Never let the cell feed the sim.
- `src/lib/rng.ts` → seeded mulberry32 (determinism).
- `src/lib/sim/` → `ledger.ts` (4-bucket solvency core), `simulate.ts` (agents + day loop),
  `types.ts`. `runSim(config)` returns daily metrics + ROI + findings.
- `src/components/game/TileCharacter.tsx` → the vaudeville tile rig for all 52 characters (both cases + gild stages).
- `src/components/game/` → the playable mini app: `GameApp.tsx` (shell), `state.tsx` (mock store +
  reducer + seeded RNG), `Providers.tsx` (`MiniAppHost` + wagmi + RainbowKit; the
  connect modal is themed in `walletTheme.ts`). **A Farcaster host is one that answers**
  (`lib/miniAppHost.ts`): React Native wallet browsers (Rainbow, MetaMask Mobile) have the same
  `window.ReactNativeWebView` the SDK uses to reach the Farcaster and Base apps, but nobody answers
  there, and Neynar's MiniAppProvider rendered nothing while it waited, so /play was blank
  (2026-11-25). `MiniAppHost` waits 1 s, then plays as the web; a late answer still switches to the
  host. It mounts Neynar's provider only in a host, so read `useMiniApp()` from `./MiniAppHost`,
  never from `@neynar/react` (that one throws on the web). The Farcaster wallet connector has no
  provider outside a host (`farcasterWhereHosted`), or wagmi's reconnect waits on it forever.
  **A wallet on a network the screen can't use** gets `WalletNetworkNotice` above every screen
  (`lib/onchain/walletNetwork.ts`: the game's network, Base Sepolia now and Base at launch; on the
  $WORD page, whose swap is on Base mainnet, Base or the game's; the Market is the game's). Its Switch runs sendCalls' `ensureChain` (wagmi's `switchChain`
  never returns from a wallet that stays put); its Disconnect is wagmi's. RainbowKit's account
  modal, which held the only Disconnect, isn't offered on a network RainbowKit doesn't know, so
  Rainbow's browser on Base had no way out (2026-11-25). Disconnect also sits in the profile
  header and in Your $WORD. Known gap: RainbowKit asks for the switch during connect, and a wallet
  that accepts it and stays put never finishes connecting (wagmi waits for a change event).
  `ConnectPanel.tsx` (the web front door: wallet required,
  via the RainbowKit modal or "Sign in with Coinbase Wallet" in `SignInWithCoinbaseWallet.tsx`, our own button for the Base Account connector under Coinbase's new name, decisions.md #13; Farcaster an optional
  link — decisions.md #9), `useViewer.ts` (FID/identity),
  `useShare.ts` (`usePostToX` first, then composeCast), `screens/`, `sheets/` (incl. `BalanceSheet.tsx` and `CheatSheet.tsx`: the core loop on one screen, behind the rail's "Cheat sheet" on desktop and the header's "?" on phones; the docs and the intro replay are one tap inside it). The old in-game FAQ is gone: the player docs at lexigotchi.fun/docs (`docs-site/`) replace it, opened with `useOpenUrl` (`useShare.ts`; `DOCS_URL` in `site.ts`) so a mini-app host keeps the game.
- `/api/word` + `WordScreen` → the in-game **$WORD** page (rail: "$WORD universe", above LHAW): the
  real token on Base mainnet whatever NETWORK is (`lib/onchain/mainnet.ts`). Price and market cap from
  the app's oracle (one price source per page), supply and both kinds of burn (`lib/wordStats.ts`:
  destroyed = 100B minted − totalSupply; the dead address holds LHAW's old V2 "burns"), the deepest
  pool from GeckoTerminal (its token-level `total_reserve_in_usd` is only the $WORD side; the pool's
  `reserve_in_usd` is both), and LHAW's staked total and burn counter. `useBuyWord` is the shared Buy.
  **Swap** (`SwapCard`, web only; Farcaster uses the host's swapToken): KyberSwap quotes and calldata
  via `/api/swap/{quote,build,balances}` with the rules in `lib/swap/kyber.ts` (ETH/USDC ⇄ $WORD
  only, router pinned to `KYBER_ROUTER` and refused otherwise, recipient = sender, exact-amount
  approvals, no paymaster). Sent through `sendCallsAttributed(..., { network: BASE, sponsored: false })`
  so it carries the builder suffix and must be on Base mainnet even on a testnet build.
- `/api/lhaw` + `LhawScreen` → the in-game **Let's Have A Word!** page (rail: "$WORD universe"): LHAW's
  live round, last round, rounds played, and $WORD supply, read server-side from LHAW's public API
  (cached a minute), plus how to play (from LHAW's FAQ.md; keep in step if LHAW changes a rule).
  It, the Leaderboard, the Dictionary, and More are `PUBLIC_VIEWS` in GameApp: no wallet needed.
- `src/lib/world.ts` + `/api/world` → **the shared world** for the Leaderboard and the Dictionary's
  owners: every claimed word's beneficial owner (the keeper's scan), each wallet's loose letters
  rebuilt from the Letters transfer events (the game's own contracts excluded), jackpot wins
  (`JackpotWon`), and Farcaster names and pictures by address (`profilesByAddress`). Cached for a
  minute in memory and at the edge; it reads every event since deploy, so it moves to the indexer
  later (decisions.md #10). Client: `useWorld()` / `useMyWallets()` / `PlayerChip`.
- `docs-site/` → **the player docs** (Mintlify project `lexigotchi`, synced from this folder), served
  at **lexigotchi.fun/docs** by the Mintlify rewrites in `vercel.json` (proxy target
  `lexigotchi.mintlify.site`; `/_mintlify/*`, `/api/request`, and `/mintlify-assets/*` must stay at the
  root). They replace the old in-game FAQ and `FAQ.md`. Keep every number in step with `params.ts`
  and `economy.ts` (prices, odds, hunger days, splits, tier counts); the copy-rules test covers
  the pages, including the rule that a dollar sign in body text is written `\$` (Mintlify reads
  `$…$` as math). Pictures in `docs-site/images/` come from `npm run docs:art`
  (`scripts/docs-art.tsx`, the real character rig and `params.ts` splits): rerun it after changing
  either. Screenshots (`screen-*.jpg`) come from `npm run docs:shots` against a practice-mode dev
  server: never a wallet, so no real address is pictured. Separate from `docs/`, which is internal.
- `src/lib/showcase.ts` + `src/app/s/[text]/` → **Showcase shares, X first** (decisions.md #13): a
  share links to `/s/<word>?scene=<id>` (the case in the path is each tile's case), whose `og:image`
  is `/s/<word>/card` (1200×630 for X; `?ratio=3x2` for the `fc:miniapp` embed). **Only the player's
  own words** (decisions.md #15): the page and card draw dictionary words only (`parseShowcase`), plus
  `HOUSE_CARDS` (the Telegram HEYOO welcome); anything else is a 404, so a link can't put free text
  on the game's card. **X's composer shows no card for a link X hasn't read yet** (tested 2026-11-24:
  a never-posted link with a fast static image showed none either; a second paste later did). It is
  not our card's speed, so the Showcase says "X adds the picture once it reads the link." **Save
  image** (`useSaveImage` in `useShare.ts`, the same-origin `showcaseCardPath`) keeps the X card: the
  share sheet on phones (bytes fetched ahead, since iOS opens the sheet only from the tap itself), a
  download on computers, the browser (press and hold) in a host with no share sheet.
- **Scenes** (decisions.md #15; `src/lib/scenes.ts` = the list and the unlock, `SCENE_UNLOCK_WORDS`
  = 3 words ever held, so it stays open after a dissolve: `state.wordsEverHeld`, from
  `readWordsHeld`'s transfer scan; `src/components/scenes/`): each word's home on the Today stage
  (`TodayStage` → `SceneFrame`, 16:9), in the Showcase, in the scene sheet (`sheets/SceneSheet`, the
  palette button under the stage), and on the share card. The Today stage walks the player's words
  with ← and → (and swipe and arrow keys; `stageLineup`, staked neediest first, then unstaked), with
  the next three as cards and a My Bag tile. The scene greys and fogs as its word gets hungry
  (`toneOf`, `.scene-tone`/`.scene-fog` in globals.css: feTurbulence fog images drifting in three
  layers, over the word, under the bubble and arrows). One drawing per scene (`art/*.tsx`) serves
  the browser and Satori, so it keeps Satori's rules (`kit.tsx` says them; `tests/scenes.test.tsx`
  holds them): plain SVG elements only, called as functions (a component or fragment inside the
  `<svg>` crashes the card), no attribute left undefined (Satori writes "undefined", and a bad
  `transform` drops the group), no `<text>`. The feet stand `SCENE_FLOOR` units above the bottom in
  every scene and size (`layout.ts`, shared with the card). Motion is the `scn-` classes in
  globals.css, behind prefers-reduced-motion, only when `animated` (never on the card or
  thumbnails). **A pick is saved** in the browser always, and in table `word_scenes` (migration
  0011, `/api/scenes`, `lib/db/wordScenes.ts`, `lib/sceneSaves.ts`) under a profile session the
  player already has: keyed by the wallet holding the word, writable by any wallet in the session's
  profile account, never prompting a sign-in (`useWordScene`, `useSceneSync` uploads waiting picks);
  the newer pick wins. Dark with profiles; until migration 0011 runs, everything stays in the browser.
- **Rarity finishes** (decisions.md #23): tiers are Common, Uncommon, Rare, **Legendary** (was Epic),
  **Mythic** (was Legendary); `MYTHICS` replaced `LEGENDARIES`. Each tier above Common wears a
  material on its tiles (`lib/rarityFinish.ts` = the table; `components/game/TileFinish.tsx` = the
  layers; pass `tier` to `TileCharacter`/`TileWord`/`WordTiles`/`SceneFrame`). **Motion is moments,
  never loops** (`useFinishMoment` adds `.rf-moment` to the word's row every tier period; globals.css
  `rf-*`; `tests/rarity-finish.test.tsx` fails on an `rf-` animation outside `.rf-moment`, on
  `infinite`, or on a dash-offset animation): only full-size words, on screen, not hungry, not under
  reduced motion, Save-Data, or 2 GB memory. Never gate motion on `hardwareConcurrency` (iOS reports
  2). Measure a change with CPU throttled 4× before shipping it (looping finishes hit 99%). The share
  card draws the still in `app/_og/tile.tsx` with Satori's rules (plain elements, shared geometry
  from TileFinish). **No name on link cards; `?saved=1` adds the corner wordmark** (Save image, the
  Telegram welcome). Next steps (not built): scene cards with backs, the Showcase folded into the
  Bag, live backs with OGL, the share loop.
- **Today is the player's dashboard** (`screens/HomeScreen.tsx`; starl3xx, 2026-11-24): their words on
  stage (`TodayStage`) top left, their letters (`TodayLetters`: the free daily letter, loose letters
  UPPERCASE first to a limit, Spell, Mint) top right, the jackpot under the words, next steps under
  the letters, then the bounty and quick actions. Two free-flowing columns on lg; a phone stacks them
  in that order (`display: contents` column wrappers + `order`). Every card speaks to the player in
  front of it: the empty stage per `emptyStageCase` (loading, words only in a linked wallet, can
  spell, needs more letters, brand new), one loud "get letters" button at a time, the jackpot saying
  how to get in, and `state.wordsLoading` (chain store) so a returning player never sees the
  newcomer's invitation while their words load (Today, Showcase, Bag).
- **The Jackpot page carries the bounty** (starl3xx, 2026-11-25): one tab (the phone's "Win", the
  rail's "Jackpot"), the daily jackpot then the weekly bounty (`screens/BountySection.tsx`), side by
  side from `lg`. There is no `bounty` view. Today keeps both cards; its bounty card links with
  `nav("jackpot", "bounty")`, and GameApp scrolls `main` to that `data-section` (a section already
  near the top, as in the second column, leaves the page at its top). A new link into part of a
  screen adds a `ViewSection` the same way.
- **The game's X account is [@lexigotchi](https://x.com/lexigotchi)** (`X_HANDLE`/`X_URL` in `site.ts`): the
  landing footer, the docs footer, More, and `twitter:site` point at it. Posts go out through
  **Typefully social set 372033**, never the X API, and only with starl3xx's go-ahead for each post.
  **Every X share tags @lexigotchi and carries a card of what's shared** (starl3xx, 2026-11-24): the
  text names `@lexigotchi` (`showcaseXText`; `xIntentUrl` appends it to any text that doesn't, and a
  test holds it), and the shared `url` is a page whose og:image pictures the thing (a showcase's own
  letter card at `/s/<letters>/card`), never just the generic game card. Cast text never says
  "@lexigotchi" (on Farcaster that's someone else). A share with no card of its own (Swap) stays
  Farcaster-only until it gets one.
- **Beta testers' updates** (a private Telegram group; never put its invite link anywhere public): a PR
  that changes something testers would notice adds a `## Tester note (KIND)` section right after
  Summary, one or two plain sentences in player language (house copy rules). **KIND says what sort of
  update it is** (starl3xx, 2026-11-24), and the post opens with it: `new` (🆕 New feature), `fix`
  (🐛 Bug fix), `qol` (✨ Quality of life), `change` (🔄 Change, such as a price or a rule), or
  `heads-up` (⚠️ Heads up, such as a testnet reset). A note without a kind, or with one the formatter
  doesn't know, still posts, as 📣 Update, so always name one. The label says "New feature", so the
  note shouldn't open with "New:". It may use **bold**, `code`, and
  [links](https://…), which show as formatting in Telegram (`.github/scripts/tester-note.mjs` turns
  them into Telegram's HTML; anything else shows as typed, and a note Telegram can't read goes out as
  typed; notes too long for one message go out one by one). `.github/workflows/beta-updates.yml`
  posts it as @lexigotchi_bot when Vercel's Production deploy of that commit succeeds, then labels the
  PR `beta-posted` (no repost on a redeploy). No section, no post. Secrets `TELEGRAM_BOT_TOKEN` and
  `TELEGRAM_CHAT_ID`; "Run workflow" on it checks the bot can reach the group and the formatter
  loads, and never posts.
  **New members get a welcome**: Telegram calls `/api/telegram/webhook` (`src/lib/telegram.ts`), which
  greets anyone who joins by their @username (else their first name, as a mention of their account,
  so both notify) with the HEYOO card
  (`/s/HEYOO/card`, uploaded by the route) and a caption pointing at the pinned message. Vercel needs `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and
  `TELEGRAM_WEBHOOK_SECRET` (dark without them; the secret header is checked in constant time); the
  "Telegram webhook" workflow registers the URL and secret with Telegram. Rerun it after the token or
  secret changes. A basic group upgraded to a supergroup gets a new id; the route logs it.
- `src/lib/site.ts` → mini-app manifest + `fc:miniapp` embed (served at `/.well-known/farcaster.json`,
  `/embed-image`, `/icon-image`). Identity/keys via env (`NEXT_PUBLIC_NEYNAR_CLIENT_ID`, `NEYNAR_API_KEY`).
- `contracts/` → Foundry suite mirroring the sim's 4-bucket ledger: `FeeRouter` (solvency hub),
  `Letters`/`Words`/`Rolls`/`Staking`/`Prestige`/`Jackpot`/`AnswerChain`/`YieldDistributor`/`Bounty`.
  Deps are gitignored — run `npm run contracts:setup`. Trust seams (signer/keeper) documented in
  `contracts/README.md`. Full mechanics reference: `GAME_DOCUMENTATION.md`; player docs: `docs-site/`.
- `src/app/admin/` + `src/components/admin/` → the **operator console** (`/admin`), modeled on the
  Griddle admin UI in Lexigotchi's design language. Shell: `AdminConsole.tsx` (sectioned tabs) gated by
  `AdminGate.tsx`. Lib in `src/lib/admin/`: `metrics.ts` (memoized `runSim` → Pulse/Economy API payloads,
  served by `src/app/api/admin/{pulse,economy}`), `contracts.ts` (the typed operator surface — every
  owner/keeper fn + ctor, drives Parameters/Keeper/Access/Launch), `tx.ts` (`TxIntent` → `cast` cmd +
  Safe batch; **no wagmi/viem** — execution is plan-only in Phase 0), `deployments.ts` (address registry,
  baseline `config/deployments.json` + localStorage overrides), `auth.ts` (allowlist via
  `NEXT_PUBLIC_ADMIN_*`, dev-open when unset), `format.ts` (USD↔$WORD-wei peg). Tabs in
  `src/components/admin/tabs/`.
  **Live tabs.** Pulse and Treasury read the live game first (`/api/admin/live`: the FeeRouter's pots,
  the treasury, letters minted, words claimed, holders; public chain data, open and edge-cached) and
  label the sim below as "Projection"; Broadcast's templates quote the same live numbers and this
  week's bounty theme (`lib/themes.ts`), never the sim. **Players** (`/api/admin/players`, `lib/admin/playersData.ts`
  → pure `playerRows.ts`): every wallet seen, from the contracts' events since deploy (faucet on
  testnet only; packs and dailies from `Committed`'s count; reveals, claims, rolls, stakes, feeds),
  `scanWorld` holdings, and the database (sightings, profile flags, push browsers, swap listings,
  Farcaster users), plus the beta group's Telegram member count; a funnel and new-wallet counts that
  leave out the TEAM's wallets (the allowlist, `TEAM_WALLETS`, registry roles, server keys, and any
  wallet linked into a team account). **System** (`/api/admin/system`, `systemStatus.ts`): game mode,
  every server key as its public address (`serverKeys.ts`, never the key) with gas and onchain wiring,
  the keeper's last resolve, every feature switch with the setting NAMES it still needs
  (`switches.ts`, shared with Notifications), and applied migrations (drizzle's own table against the
  journal). Notifications shows all three reminder channels. **Players and System are GATED on the
  server** (`lib/admin/serverAuth.ts`): a wallet session (the profile's SIWE token) for a wallet in
  `NEXT_PUBLIC_ADMIN_WALLETS`, or a Quick Auth FID in `NEXT_PUBLIC_ADMIN_FIDS`; `NEXT_PUBLIC_ADMIN_OPEN`
  does NOT open them in production, and they're `no-store`. The client sends the session through
  `useAdminApi` and offers a sign-in on 401. Never import a server module (db, `systemStatus`) VALUE
  into a tab: types only, or the Postgres driver lands in the browser bundle.
- **Wallet sightings** (`lib/sightings.ts`, `lib/db/sightings.ts`, table `wallet_sightings`, migration
  0012): the game posts `/api/players/seen` once per wallet per UTC day (`useWalletSighting`, mounted
  in GameApp) so Players can count wallets that connect and do nothing onchain. Unsigned by design, so
  the count is labelled unverified; rate-limited by IP; a FID only from a verified Quick Auth token.
  Dark (503, no client retry storm: the day is marked only on success) until 0012 is applied.
- **`FeeRouter.seed(uint8 bucket, uint256 amount)`** (owner-only) was added so the admin can fund the
  Rewards Pool (bucket 0) / Bounty (bucket 2) — pulls $WORD from the owner, credits the bucket, solvency
  invariant intact. Jackpot (bucket 1) reverts (`JackpotNotSeedable`) — it self-funds (lottery
  compliance, `params.ts`). The only non-`route` way $WORD enters a bucket.
- `src/lib/onchain/network.ts` → **the chain single-source-of-truth** (id / hex / explorer / CAIP-2),
  selected by `NEXT_PUBLIC_CHAIN_ID`: Base mainnet (8453) when unset, Base Sepolia (84532) opt-in. An
  unrecognised id **throws at boot** rather than falling back — a silent fallback would point a signed
  tx at a chain nobody chose. Nothing may hardcode a chain id or explorer again. The deployment
  registry follows it (`config/deployments.json` / `config/deployments.base-sepolia.json`) and the
  admin's localStorage overrides are namespaced per chain. Deliberate exception: `BalanceSheet.tsx`
  stays pinned to mainnet — it's the buy funnel for the real $WORD token.
- `src/lib/onchain/builderCode.ts` → **Base Builder Code attribution (ERC-8021)**. Our code
  `bc_bu1cyzms` (base.dev) → `Attribution.toDataSuffix` (the `ox` lib) → a calldata suffix that credits
  our txs on Base. **Every on-chain write the app originates MUST carry it**: ERC-5792 wallets via
  `builderCapabilities()` on `wallet_sendCalls` (wagmi `useSendCalls` or the mini-app EIP-1193
  provider), raw `eth_sendTransaction` via `appendBuilderSuffix(data)`. The single write chokepoint that
  injects it is `src/lib/onchain/sendCalls.ts` (`sendCallsAttributed`) — every contract write routes
  through it. **Every player action also runs through the action gate**
  (`src/lib/onchain/actionGate.ts`, `track()` in `ChainGameProvider`): the BusyPill shows it from the
  tap (preparing → confirm in your wallet → waiting for the chain), and a second tap while one is in
  flight sends nothing. Wrap any new action in `track`, or its tap looks ignored during the
  proof/voucher/read work before the wallet opens, and send with the `run` it hands the flow (each
  action's own, so an action abandoned with Hide can't drive a newer one's status). Claim, stake, unstake, and feed then **re-read the words until the change shows** (`sendAndSettle`, `src/lib/onchain/settle.ts`: reads at 0, 2, 5, 10, and 20 s) and announce it with the word; one read right after a send misses it, because a send returns when the wallet accepts and the words are a log scan. The testnet **faucet**
  settles on the mint's OWN result, on the same schedule (`settleSend` in `src/lib/onchain/traceSend.ts`:
  the receipt on Base Sepolia, or `wallet_getCallsStatus` for a batch, whose "failed" beats a
  bundler receipt that succeeded), and names any other outcome: never reached Base Sepolia, another
  network, reverted, or pending. The balance is only the fallback for a send nobody can trace, from a
  fresh read (a cached baseline both missed real mints and passed off earlier ones). Every read is
  capped, since the action gate waits on them. "Sent" proved nothing: a tester's wallet said sent
  and broadcast nothing (2026-11-24). **Rolls are
  finished by the server** (decisions.md #14): `revealRoll` posts `{ relay: true }` and
  `/api/roll/reveal` sends `Rolls.reveal` from `RELAYER_PRIVATE_KEY` (`src/lib/onchain/relayer.ts`),
  so the wallet never previews the result; the answer's `relayed` field says what happened, and only
  "nothing broadcast" returns a signature for the wallet to send. **Which game runs** (`src/lib/onchain/gameMode.ts`): the chain store wherever this
  network's registry has the whole suite, the practice (mock) store otherwise. Mainnet's registry is
  empty until the deploy, so production flips to the real game in the same deploy that commits the
  mainnet addresses; `NEXT_PUBLIC_CHAIN_GAME=0` is the emergency brake back to practice. In the
  chain game the prototype buttons are gone (no skip-a-day; the faucet only on testnet), and
  ascension hides while `Prestige.maxLevel` is 0. **`docs/web3-runtime-plan.md`** is the launch runbook.

## v0.2 mechanics (the ones easy to get wrong)

- Mints are **100% lowercase**; uppercase exists **only** via rolls. Daily single is gated on
  a Farcaster FID, a linked X account older than 90 days (while X is switched on), **or** a
  Coinbase-Verified wallet (EAS attestation on Base mainnet), checked server-side in that order
  (`src/lib/onchain/verifications.ts`, `/api/mint/free-daily`). Key ranges in the one on-chain
  `dailyUsed` mapping (the contract never interprets the key; the offsets keep them apart): FIDs
  < 2^32, verified wallets `2^160 | uint160(address)`, Base Verify reserved at 2^161, X
  `2^162 | xUserId` — **always bigint, never a JS number**. **One letter a day per player**:
  `dailyKeysFor` lists every key a request can see, and the server refuses (and the client shows
  "claimed") if any was used today. 10 free dailies per profile in all (decisions.md #21), so a
  skipped day isn't lost. The free pack signs under the same three key namespaces (X and Coinbase keys
  reach `freePackClaimed`, which never reads the key). Packs of 5 for everyone. ETH accepted via
  auto-swap → all accounting in $WORD.
- Rolls: **40% base, +15pp pity, cap 85%** (decisions.md #19), reset on success. Pity per
  `(owner, letterId)`. Failure never burns/downgrades the asset.
- **Rewards first** (decisions.md #19): every paid action (pack, daily, roll, claim, ascension)
  splits **75% pool / 10% jackpot / 10% burn / 5% treasury**; snacks stay 100% burned. The admin
  console's split table derives from `params.ts`, and `Deploy.s.sol` sets the same table.
- **Ascension is the word ladder, ON at launch** (#19): Gilded 1–4, then **Holographic** (stage 5,
  iridescent foil in the tile rig). A stage-N attempt costs N × `prestigeFee` (`Prestige.stageFee`;
  `params.prestigeStageFeeUsd`) and draws at `prestige.baseByLevel[level]` (40/35/30/25/20%) + 10pp
  per miss; each commit records its `level`, which `/api/prestige/reveal` reads. Stage names and the
  fee multiple live in `src/lib/ascension.ts`; never write "Gilded L4"-style copy by hand.
- Staking split: **yield is UPPERCASE-only**; **any** staked non-hungry word (any case) is
  **jackpot-eligible**. Hunger gates both: peckish (1–2d) halves yield; hungry (3+d) zeroes
  yield AND drops jackpot eligibility.
- One word = one NFT, `tokenId = keccak256(word)`, case **derived** from escrow (never stored).
- **A claim may mix cases** (decisions.md #17): `Words.claim(word, uint8 upperMask, proof)` names
  each letter's case (bit k ⇒ position k UPPERCASE); in the app, `claim(word, cases)` with
  `claimCase` / `canSpellAs` / `caseMask` (`state.tsx`). Spell has one tray and no case switch: the
  rack claims exactly the tiles picked, and the word list and Today's next steps claim UPPERCASE
  first. The `Claimed` event that the bag (`onchain/reads.ts`) and the keeper (`keeper/scan.ts`)
  scan comes from the generated ABI (`getAbiItem`), never a hand copy: a copy kept the old `bool`
  shape, and a log filter on a changed signature silently matches nothing.
- Snacks 100% burn. The `ROYALTY` FeeSource is the word-sale fee (10%, `SaleFees.flush()`) → 100%
  Rewards Pool (decisions.md #18; the bounty carve applies); both token
  contracts also carry an ERC-2981 royalty **signal** (2.5% → Treasury, unenforced — open
  composability, decisions.md "Royalty & marketplace architecture").

## Copy and messaging

**`docs/messaging.md` is the source of truth for every word a player reads** (decisions.md #24):
Lexigotchi is a word-pet game: collect living letters, raise them, and spell words nobody else can
own. Read it before writing any copy (the app, the landing page, the docs, reminders, share text,
bot posts). The hard rules:

- **Never name Tamagotchi or Pokémon** in player-facing copy, nor near-quote them ("gotta spell 'em
  all", "Pokédex"). The comparison stays internal.
- **Say / instead of:** letters, words (not NFTs, tokens, assets); yours, one owner, onchain (not
  Web3, decentralized); raise, roll (not gamble, bet, upgrade); spell, claim a word (not mint a
  word); feed, snack, hungry (not maintain, upkeep); the daily word, the jackpot, in the running (not
  lottery, draw as a noun, ticket); earns $WORD every day (not yield, APR, returns, passive income);
  Dictionary (not Lexidex); the Market (not marketplace, exchange).
- **Never write:** price, pump, moon, invest, investment, "number go up", or a dollar figure for
  $WORD or the jackpot. USD prices of game actions ("a pack is $1") are fine, and so are the
  functional uses: a word's sale price on the Market and the $WORD page's own data.
- **The jackpot always carries "staked and fed".**
- **Lead with a pet, a word, or a rare letter, never with earning.** Letters are characters, written
  in their case ("your q is hungry"); a reminder names the letter or word ("FUNKY is peckish").
- **Numbers are derived, never typed** (`src/lib/howItWorks.ts`: `WORDS`, `TOP_TIER`,
  `RAREST_LETTER`, `FREE_PACK`/`FREE_DAILIES`/`FREE_TO_START`, `LADDER`, `days`). The top tier's name
  comes from `TIERS`, so a tier rename flows through on its own (it reads Mythic since #23).
- **`tests/copy-rules.test.ts` guards it**: the banned words fail the build in player-facing code
  (`src/components` except the operator console, `src/app`, and the copy-bearing `src/lib` files) and
  the player docs (except `contracts.mdx` and `fairness.mdx`, which keep token standards). An
  exception goes in `VOCAB_ALLOW` with its reason.

## Gotchas / conventions

- **`package.json` `overrides: { cuer: "0.0.4" }` is load-bearing.** RainbowKit 2.2.11 pins `cuer`
  0.0.3, which asks the `qr` library for `border: 0`. `qr` ≥ 0.6 (cuer allows `~0`) throws on that,
  so tapping WalletConnect crashed the page (`RangeError: invalid border=0`). cuer 0.0.4 asks for
  `border: 1` and trims it. Drop the override only once RainbowKit ships cuer ≥ 0.0.4.

- The sim's **absolute** numbers depend on placeholder budgets — trust the **relative**
  dynamics (see `docs/decisions.md` findings). Key insight: the mint sink is finite; the
  durable economy runs on rolls + snacks.
- The sim now models secondary letter trading as a **default-off lever** (enable it to study
  low-budget players' options); a rarity-tiered letter floor is still owed (`docs/decisions.md`).
  Don't draw casual-retention conclusions with the lever left off.
- Match the surrounding style; keep the economy derivation pure + tested. If you touch
  `economy.ts`, run `npm test` — the spec assertions are the guardrail.
- **Before adding code, ask whether it needs to exist.** In order: does the codebase already do
  this? the stdlib? the platform? a dependency we already ship? Prefer deleting over adding, and
  boring over clever. Jake gates builds on evidence, not enthusiasm — see `docs/decisions.md` on
  the swap primitive, which started as "build a marketplace" and ended as a swap escrow.
  **Two things this does NOT license cutting**, because both looked like surplus structure right
  up until they weren't: (1) guards, validation, and the tests that prove them — the empty-audience
  check in `src/lib/notify/send.ts` is three lines standing between us and pushing "your words are
  hungry" to every player; (2) the explanatory comments. In `contracts/` the NatSpec is an audit
  deliverable someone pays to read, and elsewhere the comment carrying the *why* is usually the
  part that stops the next person reintroducing the bug.
- **A feature change updates every surface that describes it, in the same PR** (starl3xx,
  2026-11-24: "update FAQ, cheat sheet, in-app UI, docs, etc on any feature changes"). #140 switched
  X on and updated the docs and the landing page but missed the cheat sheet and the connect panel.
  Search for the claim's words (e.g. `Coinbase`, `daily letter`, `no email`), not for files, across:
  `docs-site/` (every page, and `faq.mdx`), `sheets/CheatSheet.tsx`, `src/lib/howItWorks.ts` and
  `Onboarding.tsx`, the feature's own cards and sheets (`DailyUnlock`, `ProfileSheet`,
  `BalanceSheet`, `ConnectPanel`, `MoreScreen`, `NextSteps`, locked and empty states),
  `src/components/landing/LandingPage.tsx` (and its FAQ), `src/lib/notify/templates.ts` and
  `src/lib/notify/email.ts`, share/OG copy (`src/lib/showcase.ts`, `src/lib/site.ts`), and
  `CLAUDE.md`/`docs/web3-runtime-plan.md`. Copy about a switchable feature reads the switch
  (`usePublicProfile().xEnabled`/`emailEnabled` in the app, `xEnabled()`/`emailEnabled()` on the
  server) so it can't run ahead of production; `docs-site/` can't, so change it with the switch.
  Say in the PR which surfaces you checked. Refresh the screenshots (`npm run docs:shots -- <names>`)
  when a pictured screen changes.
- **Player-facing copy follows the house rules, and `tests/copy-rules.test.ts` enforces them** on
  every rendered string in `src/components/game`, `src/components/landing`, `howItWorks.ts`, and the
  notification templates: no em dashes (pick the mark the sentence needs: colon, comma, period, or
  brackets; a missing value shows an en dash "–"), curly apostrophes and quotes, and "onchain" as one
  word. Code comments are exempt.
- **The game's visual system (UI proposal, Nov 2026).** One meaning per color: teal = grow and care
  (claim, stake, feed), gold = chance (roll, jackpot), candy = spend (packs, Buy $WORD, connect),
  ink = "you are here" (active tab, switches, filters). Colored text uses the `-ink` shades and
  cream-labeled fills use `candy.deep` (tailwind.config.ts says why: contrast). `.cel` is for the one
  main card on a screen and for the player's own item in a list; repeated list items use `.cel-sm`.
  No decorative all-caps labels: capitals mean a raised letter in this game. Text floor is 12 px
  (`text-xs`), except compact chips and the header's balance line.
  Raised surfaces (cards, list tiles, ghost buttons, chips, inputs) use `bg-card`, a shade lighter
  than the paper page; the page, sheets, and full-screen overlays stay `bg-paper`.
- **Interaction and motion (globals.css).** Anything clickable answers the pointer: `.press` (a cel
  that lifts on hover and pushes into its shadow on press; `--sh` is its shadow size),
  `.press-icon`, `.tile-press` (letter characters hop), `.round-btn`, and `<Segmented>` (a sliding
  ink thumb). Sheets animate in and out (`SheetHost` keeps a closed sheet mounted for
  `SHEET_EXIT_MS`; Escape closes), screens cascade in (`.view-in`, not on first load), toasts have
  icons, hold on hover, and dismiss on click, and balances and pots count (`TweenNumber`). Hover
  styles are gated to real pointers (`hoverOnlyWhenSupported`), and all movement sits behind
  `prefers-reduced-motion: no-preference`: never cancel a transform under `reduce`, because that
  also clears resting transforms (the Segmented thumb's position, a selected tile's lift).
- **Builder-code attribution is mandatory**: every on-chain action routes through
  `src/lib/onchain/builderCode.ts` (ERC-8021 suffix) or we silently forfeit Base builder rewards —
  the tx still sends, it's just uncredited. `tests/builder-code.test.ts` is the round-trip guardrail.

This codebase is yours: what it's for and how it's built are your call, and you'll keep building on it.
