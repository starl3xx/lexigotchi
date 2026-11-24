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
- `npm test` — economy + solvency invariants (84 vitest tests)
- `npm run build` / `npm run typecheck`
- `npm run contracts:setup` (vendor deps) → `npm run contracts:build` / `npm run contracts:test` (65 forge tests)
- `npm run keeper -- [--resolve] [--yield] [--bounty] [--achievements] [--notify] [--dry]` — the
  daily operator pass, by hand. **Scheduled** by `/api/cron/keeper` (vercel.json, 00:05 UTC): same
  jobs (`src/lib/keeper/jobs.ts`, `createKeeper({ dry })`), the ones listed in `KEEPER_JOBS` (default
  `resolve,yield,bounty,repeg,notify`; achievements opt-in; the bounty settles each week on the first
  day of the next, `bountyPeriodToSettle`), strictly one at a time (one key, one
  nonce), and a failed job doesn't skip the rest. It needs `KEEPER_PRIVATE_KEY` and
  `ANSWER_CHAIN_SEED`/`ANSWER_CHAIN_DAYS` in Vercel; without a deployment or a key it does nothing.
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
- `npm run answerchain:generate` — the pre-committed jackpot answer schedule + `ANSWERCHAIN_HEAD`.
  Output is SECRET + irreplaceable (gitignored `*.secret.json`) — back it up offline; the keeper reads it daily.
  **Mainnet uses `--new-seed`**: the whole schedule re-derives from one 64-hex secret
  (`src/lib/answerChain.ts`), which the hosted keeper holds as `ANSWER_CHAIN_SEED` (+
  `ANSWER_CHAIN_DAYS`). The keeper checks each derived link against the onchain `currentCommit`
  before revealing (`src/lib/keeper/answerSchedule.ts`), so a wrong seed or a re-vendored dictionary
  stops the run. The seed is printed nowhere; it is in the file's `seed` field.
- `npm run db:generate` (schema → `drizzle/` migration) → `npm run db:migrate` (apply to Neon). Needs `DATABASE_URL*` in `.env.local`.
  Pull main first: a stale checkout stops at its own last migration. Jake runs production migrations.
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
  Formulas: caps = `floor(slots × 2.5)`; tiers = `floor` percentile cuts + alphabetical
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
  served for a pack commit (`c:<commitId>`) or an identity's daily (`d:<key>:<day>`) is served again
  while it can still be minted. A draw depends on which letters are uncapped, so without this a
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
  reducer + seeded RNG), `Providers.tsx` (Neynar MiniAppProvider + wagmi + RainbowKit; the
  connect modal is themed in `walletTheme.ts`), `ConnectPanel.tsx` (the web front door: wallet required,
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
  share links to `/s/<letters>` (the case in the path is each tile's case), whose `og:image` is
  `/s/<letters>/card` (1200×630 for X; `?ratio=3x2` for the `fc:miniapp` embed).
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
  that changes something testers would notice adds a `## Tester note` section right after Summary,
  one or two plain sentences in player language (house copy rules). It may use **bold**, `code`, and
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
  action's own, so an action abandoned with Hide can't drive a newer one's status). Claim, stake, unstake, and feed then **re-read the words until the change shows** (`sendAndSettle`, `src/lib/onchain/settle.ts`: reads at 0, 2, 5, 10, and 20 s) and announce it with the word; one read right after a send misses it, because a send returns when the wallet accepts and the words are a log scan. **Rolls are
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
  "claimed") if any was used today. An unclaimed day is lost: `dailyUsed` keeps only the last day.
  The free pack signs for a Quick Auth FID only, so X keys never reach `freePackClaimed`. Packs of 5 for everyone. ETH accepted via
  auto-swap → all accounting in $WORD.
- Rolls: **45% base, +10pp pity, cap 85%**, reset on success. Pity per `(owner, letterId)`.
  Failure never burns/downgrades the asset.
- Staking split: **yield is UPPERCASE-only**; **any** staked non-hungry word (any case) is
  **jackpot-eligible**. Hunger gates both: peckish (1–2d) halves yield; hungry (3+d) zeroes
  yield AND drops jackpot eligibility.
- One word = one NFT, `tokenId = keccak256(word)`, case **derived** from escrow (never stored).
- Snacks 100% burn. The `ROYALTY` FeeSource is the in-house swap fee → 100% Treasury; both token
  contracts also carry an ERC-2981 royalty **signal** (2.5% → Treasury, unenforced — open
  composability, decisions.md "Royalty & marketplace architecture").

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
