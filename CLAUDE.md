# CLAUDE.md — Lexigotchi

Working notes for future sessions. Read `docs/spec/v0.2-changelog.md` first (it overrides
`docs/spec/v0.1.md` on any conflict), then `docs/decisions.md`.

## What this is

Phase 0 prototype of Lexigotchi — a $WORD collection game on Base (Farcaster mini app +
web). This repo de-risks fun + solvency before contracts. **No Solidity yet** (Foundry, when
it comes). Stack: Next.js App Router + TS + Tailwind + recharts; sim/economy core is
**zero-runtime-dependency TS** so it runs via `tsx`/`vitest` regardless of the app.

## Commands

- `npm run dev` — prototype app (Home / Characters / Lexidex / Economy)
- `npm run sim -- --days 365 --population 1500 --seed 7` — economy/solvency report
- `npm run derive` — regenerate `docs/economy.md` from the dictionary
- `npm test` — economy reproduces spec Appendix A/B + solvency invariants hold (21 tests)
- `npm run build` / `npm run typecheck`

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
- `src/components/characters/Rig.tsx` → shared rubber-hose rig for all 52 characters.

## v0.2 mechanics (the ones easy to get wrong)

- Mints are **100% lowercase**; uppercase exists **only** via rolls. Daily single (FID-gated)
  + packs of 5. ETH accepted via auto-swap → all accounting in $WORD.
- Rolls: **45% base, +10pp pity, cap 85%**, reset on success. Pity per `(owner, letterId)`.
  Failure never burns/downgrades the asset.
- Staking split: **yield is UPPERCASE-only**; **any** staked non-hungry word (any case) is
  **jackpot-eligible**. Hunger gates both: peckish (1–2d) halves yield; hungry (3+d) zeroes
  yield AND drops jackpot eligibility.
- One word = one NFT, `tokenId = keccak256(word)`, case **derived** from escrow (never stored).
- Snacks 100% burn. Secondary royalty 2.5% → Rewards Pool.

## Gotchas / conventions

- The sim's **absolute** numbers depend on placeholder budgets — trust the **relative**
  dynamics (see `docs/decisions.md` findings). Key insight: the mint sink is finite; the
  durable economy runs on rolls + snacks.
- The sim currently **omits secondary letter trading** — a known limitation that understates
  low-budget players' options. Add a letter market before drawing casual-retention conclusions.
- Match the surrounding style; keep the economy derivation pure + tested. If you touch
  `economy.ts`, run `npm test` — the spec assertions are the guardrail.
