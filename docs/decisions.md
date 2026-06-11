# Lexigotchi — decisions & findings (Phase 0)

Running log of decisions made and things discovered during the Phase 0 build. Specs of
record: `docs/spec/v0.1.md` + `docs/spec/v0.2-changelog.md` (v0.2 wins on any conflict).

## Build decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Standalone repo, modern clean stack** — Next.js App Router, TypeScript, Tailwind, recharts. Not coupled to the LHAW pages-router codebase. | Owner's call; fresh tooling over copy-paste leverage. |
| D2 | **Foundry** for the eventual on-chain layer (not Hardhat like LHAW). | Invariant + fuzz testing is the right tool for the solvency math; the off-chain sim here already encodes the invariants to port. |
| D3 | **Sim/economy core is zero-runtime-dependency TypeScript.** | Runs and verifies via `tsx`/`vitest` independent of the app; the de-risking artifact must not depend on the UI building. |
| D4 | **Dictionary vendored + economy derived in code, asserted against the spec in tests.** | The published tables can never silently drift from the data. |
| D5 | **EGGS = commit + server-signed reveal** (not blockhash). Mirror for rolls/mints; *strengthen* for the jackpot (hash-chain). | See `docs/reference/eggs/PATTERN.md`. |

## Spec corrections found while reconciling Appendix A/B against the real dictionary

These are confirmations-with-footnotes — the spec is trustworthy; three figures needed a
precise reading. All are encoded + tested in `src/lib/economy.ts` / `tests/economy.test.ts`.

1. **Dedup is required and the vendored list is already unique.** The file's `WORDS` export
   (`[...categories].filter(notBanned).sort()`) evaluates to exactly **4,438 unique** words —
   the categories don't actually overlap. (An earlier text-parse suggesting 4,457/19-dupes
   was a regex artifact.) Our `Set()` pass is a defensive no-op. ✅ matches spec.
2. **Supply caps sum to 55,467, not 55,475.** The deployable per-ID caps are
   `floor(slots × 2.5)` and sum to **55,467** — which is exactly what the spec's own Appendix A
   per-letter column sums to. The prose headline "55,475" is the idealized `2.5 × 22,190`
   *before* per-letter flooring. Use 55,467 as the deployed total.
3. **Rarity tier cuts use `floor` percentiles + alphabetical tiebreak.** This reproduces the
   spec's anchor counts exactly (Common 2,219 / Epic 177 / Legendary 45 and the exact
   45-Legendary list). One word straddles the Uncommon/Rare score-tie boundary, so the
   computed split is 1,331/666 vs the spec's 1,330/667 — the **combined 1,997 is invariant**;
   the boundary word's tier is a documented tiebreak, immaterial to gameplay.

## What the Phase 0 sim revealed (v0.2 mechanics)

Run it: `npm run sim` (defaults: 270 days, 800 players, seed 1930). Findings are robust to
seed; **absolute magnitudes depend on player-budget assumptions** (placeholders) — read the
*relative* dynamics, not the exact numbers.

1. **Solvency is structural and holds.** Yield = `rate × pool` (≤ pool) and the jackpot pays
   only what it holds, so no bucket ever goes negative. Asserted every day in the ledger and
   in `tests/economy-model.test.ts`. The spec's "solvency by construction" is real.
2. **The mint sink is finite.** All 55,467 letters mint out (≈ day 130 at these assumptions),
   after which the one-time mint/claim revenue is gone and the economy runs **only on the
   recurring sinks — rolls + snacks**. This is the single most important long-run insight:
   the durable economy depends on roll volume and snack burn, not minting.
3. **The Rewards Pool finds an equilibrium**, not an ever-rising balance: `pool* ≈
   (daily pool inflow) / (daily distribution rate)`. With UPPERCASE-only yield, early payouts
   are tiny (few uppercase words) and the pool grows; as upgrades accumulate, outflow rises
   and the pool settles toward `pool*`.
4. **Jackpot escalation is driven by neglect, not just the early game.** The claim-rush window
   produces the first big rollovers; but after the churn+hunger fix (Bugbot finding #8), a
   *held-but-hungry* word is jackpot-ineligible, so rollovers stay high (~53% of days) even at
   saturation — neglected words can't claim the pot, so it keeps escalating. Player churn +
   hunger are first-order faucet gates, not flavor.
5. **Strongly deflationary.** Burn (snacks 100% + 20% of mints/rolls + 25% of claims) far
   exceeds treasury accrual — $WORD is net-burned over the run.
6. **Casual players (50% of the base) can be shut out of claiming** and earn ~0% because
   high-budget archetypes win the claim race for unclaimed words. **Caveat: the sim models no
   per-letter secondary trading** (only a macro royalty inflow, added after the Phase-0
   review — see `phase-0-review.md`). v0.2's marketplace (royalty → pool) and showcase (letter
   demand outside the dictionary) are exactly what give low-budget players an economic role.
   A real letter market is the highest-value next sim iteration; until then this is a retention
   flag, not a verdict.

The Phase 0 build was then put through a 5-agent **adversarial review** (3 solvency skeptics +
spec-completeness + art critics). The solvency core survived all three skeptics with **zero
real defects**; the one real (low) finding — a dead royalty faucet — is now fixed, and the art
findings are implemented. Full writeup: `docs/phase-0-review.md`.

## Open questions still owed (carried from spec)

- **Pricing** (daily/pack/roll/claim/snack in $WORD) — the sim is the tool; needs real
  daily-active estimates + a $WORD-liquidity reality check to set absolute numbers.
- **Cap multiple (2.5×)** — if realistic DAU implies mint-out < ~6 months, revisit before
  mainnet (v0.2 §5.5). The sim's mint-out-day output is the lever to watch.
- **Secondary-market modeling** — add a lightweight letter market to the sim to test the
  casual-player economic role properly.
- **Legal pass on the jackpot** (Phase 3) and **LHAW answer-chain migration** — unchanged.
