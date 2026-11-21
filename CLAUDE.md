# CLAUDE.md — Lexigotchi

Working notes for future sessions. Read `docs/spec/v0.2-changelog.md` first (it overrides
`docs/spec/v0.1.md` on any conflict), then `docs/decisions.md`.

## What this is

Phase 0 prototype of Lexigotchi — a standalone onchain $WORD collection game on Base: any wallet
plays on the web, and the same app runs as a Farcaster mini app. This repo de-risks fun +
solvency, ships the playable game, and now carries the full **Foundry contract suite** (code-complete + tested, not yet deployed/audited — `contracts/`).
Stack: Next.js App Router + TS + Tailwind + recharts; `@neynar/react` + `@farcaster/miniapp-sdk`
for the mini app; sim/economy core is **zero-runtime-dependency TS** (runs via `tsx`/`vitest`).
`/` is the landing page (`src/components/landing/LandingPage.tsx`, a server page with no wallet code); the game is **`/play`**, which is also the mini app's `homeUrl`. The four how-it-works steps live in `src/lib/howItWorks.ts`, shared by the landing page and the in-game onboarding.

## Commands

- `npm run dev` — the app; `/` is the landing page, `/play` is the game (and the mini app).
- `npm run sim -- --days 365 --population 1500 --seed 7` — economy/solvency report
- `npm run derive` — regenerate `docs/economy.md`; `npm run derive:contracts` — `contracts/config/economy.json`
- `npm test` — economy + solvency invariants (84 vitest tests)
- `npm run build` / `npm run typecheck`
- `npm run contracts:setup` (vendor deps) → `npm run contracts:build` / `npm run contracts:test` (62 forge tests)
- `npm run keeper -- [--resolve] [--yield] [--bounty] [--achievements] [--notify] [--dry]` — the
  daily operator pass, by hand. **Scheduled** by `/api/cron/keeper` (vercel.json, 00:05 UTC): same
  jobs (`src/lib/keeper/jobs.ts`, `createKeeper({ dry })`), the ones listed in `KEEPER_JOBS` (default
  `resolve,yield,repeg,notify`; bounty and achievements opt-in), strictly one at a time (one key, one
  nonce), and a failed job doesn't skip the rest. It needs `KEEPER_PRIVATE_KEY` and
  `ANSWER_CHAIN_SEED`/`ANSWER_CHAIN_DAYS` in Vercel; without a deployment or a key it does nothing.
  **`repeg`** is the price keeper (`src/lib/keeper/repeg.ts`, its own key `PRICE_KEEPER_PRIVATE_KEY`):
  moves each onchain price toward its USD target at the live GeckoTerminal price when it drifts
  ≥5%, clamped one bps inside the contract's `maxMoveBps` (and a 25%/run cap); never on the
  fallback price, never below a $5K pool, never a zero price. A no-op until the owner wires the
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
- The operator console is at **`/admin`** (no separate command; part of the app).

## Architecture

- `data/guess_words_clean.ts` — vendored dictionary (source of truth). Do not edit; if it
  updates upstream, re-vendor and re-run tests.
- `src/lib/dictionary.ts` → canonical **4,438** deduped words.
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
  via the RainbowKit modal or Base's official button in `SignInWithBase.tsx`; Farcaster an optional
  link — decisions.md #9), `useViewer.ts` (FID/identity),
  `useShare.ts` (composeCast), `screens/`, `sheets/` (incl. `FaqSheet.tsx`, `BalanceSheet.tsx`).
- `src/lib/site.ts` → mini-app manifest + `fc:miniapp` embed (served at `/.well-known/farcaster.json`,
  `/embed-image`, `/icon-image`). Identity/keys via env (`NEXT_PUBLIC_NEYNAR_CLIENT_ID`, `NEYNAR_API_KEY`).
- `contracts/` → Foundry suite mirroring the sim's 4-bucket ledger: `FeeRouter` (solvency hub),
  `Letters`/`Words`/`Rolls`/`Staking`/`Prestige`/`Jackpot`/`AnswerChain`/`YieldDistributor`/`Bounty`.
  Deps are gitignored — run `npm run contracts:setup`. Trust seams (signer/keeper) documented in
  `contracts/README.md`. Full mechanics reference: `GAME_DOCUMENTATION.md`; player FAQ: `FAQ.md`.
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
  through it. The game's writes are still mock; **`docs/web3-runtime-plan.md`** is the runtime build plan.

## v0.2 mechanics (the ones easy to get wrong)

- Mints are **100% lowercase**; uppercase exists **only** via rolls. Daily single is gated on
  **either** a Farcaster FID **or** a Coinbase-Verified wallet (EAS attestation on Base mainnet,
  checked server-side — `src/lib/onchain/verifications.ts`). Verified wallets get synthetic daily
  keys `2^160 | uint160(address)` — **always bigint, never a JS number** — in the same on-chain
  `dailyUsed` mapping (the contract never interprets the key; the namespace offset is what keeps
  synthetic keys from spending real FIDs' slots). Packs of 5 for everyone. ETH accepted via
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
- **Builder-code attribution is mandatory**: every on-chain action routes through
  `src/lib/onchain/builderCode.ts` (ERC-8021 suffix) or we silently forfeit Base builder rewards —
  the tx still sends, it's just uncredited. `tests/builder-code.test.ts` is the round-trip guardrail.

This codebase is yours: what it's for and how it's built are your call, and you'll keep building on it.
