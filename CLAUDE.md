# CLAUDE.md — Lexigotchi

Working notes for future sessions. Read `docs/spec/v0.2-changelog.md` first (it overrides
`docs/spec/v0.1.md` on any conflict), then `docs/decisions.md`.

## What this is

Phase 0 prototype of Lexigotchi — a $WORD collection game on Base (Farcaster mini app +
web). This repo de-risks fun + solvency, ships the playable mini app, and now carries the full
**Foundry contract suite** (code-complete + tested, not yet deployed/audited — `contracts/`).
Stack: Next.js App Router + TS + Tailwind + recharts; `@neynar/react` + `@farcaster/miniapp-sdk`
for the mini app; sim/economy core is **zero-runtime-dependency TS** (runs via `tsx`/`vitest`).
The game is the front door: `/` redirects to **`/play`**.

## Commands

- `npm run dev` — the app; `/` → `/play` (the mini app).
- `npm run sim -- --days 365 --population 1500 --seed 7` — economy/solvency report
- `npm run derive` — regenerate `docs/economy.md`; `npm run derive:contracts` — `contracts/config/economy.json`
- `npm test` — economy + solvency invariants (70 vitest tests)
- `npm run build` / `npm run typecheck`
- `npm run contracts:setup` (vendor deps) → `npm run contracts:build` / `npm run contracts:test` (34 forge tests)
- The operator console is at **`/admin`** (no separate command; part of the app).

## Architecture

- `data/guess_words_clean.ts` — vendored dictionary (source of truth). Do not edit; if it
  updates upstream, re-vendor and re-run tests.
- `src/lib/dictionary.ts` → canonical **4,438** deduped words.
- `src/lib/economy.ts` → letter slots/odds/caps + rarity tiers. **Derived, never hardcoded.**
  Formulas: caps = `floor(slots × 2.5)`; tiers = `floor` percentile cuts + alphabetical
  tiebreak. Tested against the spec.
- `src/lib/params.ts` → the **only** place to tune economics (prices/splits/odds/pity/hunger).
  Prices are placeholders; mechanics are v0.2-decided.
- `src/lib/rng.ts` → seeded mulberry32 (determinism).
- `src/lib/sim/` → `ledger.ts` (4-bucket solvency core), `simulate.ts` (agents + day loop),
  `types.ts`. `runSim(config)` returns daily metrics + ROI + findings.
- `src/components/game/TileCharacter.tsx` → the vaudeville tile rig for all 52 characters (both cases + gild stages).
- `src/components/game/` → the playable mini app: `GameApp.tsx` (shell), `state.tsx` (mock store +
  reducer + seeded RNG), `Providers.tsx` (Neynar MiniAppProvider + SIWN), `useViewer.ts` (FID/identity),
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

## v0.2 mechanics (the ones easy to get wrong)

- Mints are **100% lowercase**; uppercase exists **only** via rolls. Daily single (FID-gated)
  + packs of 5. ETH accepted via auto-swap → all accounting in $WORD.
- Rolls: **45% base, +10pp pity, cap 85%**, reset on success. Pity per `(owner, letterId)`.
  Failure never burns/downgrades the asset.
- Staking split: **yield is UPPERCASE-only**; **any** staked non-hungry word (any case) is
  **jackpot-eligible**. Hunger gates both: peckish (1–2d) halves yield; hungry (3+d) zeroes
  yield AND drops jackpot eligibility.
- One word = one NFT, `tokenId = keccak256(word)`, case **derived** from escrow (never stored).
- Snacks 100% burn. The `ROYALTY` FeeSource is currently the in-house swap fee → 100% Treasury;
  an ERC-2981 secondary royalty → Rewards Pool is unbuilt design intent for the future marketplace.

## Gotchas / conventions

- The sim's **absolute** numbers depend on placeholder budgets — trust the **relative**
  dynamics (see `docs/decisions.md` findings). Key insight: the mint sink is finite; the
  durable economy runs on rolls + snacks.
- The sim now models secondary letter trading as a **default-off lever** (enable it to study
  low-budget players' options); a rarity-tiered letter floor is still owed (`docs/decisions.md`).
  Don't draw casual-retention conclusions with the lever left off.
- Match the surrounding style; keep the economy derivation pure + tested. If you touch
  `economy.ts`, run `npm test` — the spec assertions are the guardrail.
