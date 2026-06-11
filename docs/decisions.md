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

## Pricing & launch economics (decided June 2026)

$WORD is **live** on Base (Uniswap `0x304e…fb4b`): price ~$0.0000002368, **mcap/FDV ~$23.6K**,
~100B supply, **liquidity ~$21.5K**, ~$10/day volume. Team treasury 10B+ $WORD (~$2,370).

- **USD-pegged pricing** (decision): prices are USD targets; the multisig re-sets the on-chain
  $WORD amounts as the price moves. The sim runs in USD; `priceWord()` converts. `WORD_USD_PRICE`
  is the live peg input.
- **Price ladder** (accessible/bootstrap — the review confirmed price is not the bottleneck):
  daily **$0.05** · pack **$0.60** · roll **$0.15** · claim **$0.50** · snack **$0.02**.
- **Treasury bootstrap** (decision: bootstrap; compliance-reconciled): seed the **Rewards Pool**
  ($240) only. **`seed.jackpot = 0`** — an operator-funded chance prize is the core lottery risk
  (compliance verdict: rework). The jackpot self-funds from fee splits. Treasury's other lever
  is **LP depth** (a market op, not a faucet seed).
- **Mechanical peg** (recommended): peg off a 30-min TWAP, repeg on |Δ|>10–15% or weekly, ±25%/day
  cap — NOT a discretionary multisig lever (market-integrity crux). The AMM layer shows a *weekly*
  repeg already holds cost-to-play within ~10%, so this is cheap to honor.

**What the AMM/market layer found** (`npm run market` — constant-product layer over the game sim):
- The game drives ~$20.6K of $WORD buy-demand (~87% of mcap) → a **~6.4× price pump** (mcap →
  ~$152K), but **gradual** over the day-60–90 mint rush, not a violent spike.
- **Liquidity self-heals**: buy pressure deepens the pool **$21K → ~$55K** organically.
- **Burn ≈ 12% of supply** (not the 42% the flat-peg sim implied — each $WORD is worth more as
  it's burned).
- **LP depth is the pump lever** ($5K LP → 5.1×, $10K → 4.2×), but treasury (~$2.4K) only funds
  ~$1.5–2K of it; real flattening needs ETH-paired liquidity.

**Structural launch risks surfaced by the 4-lens review** (`docs/pricing-review.md`) — these
matter more than the prices:
- **Compliance: rework the jackpot + get counsel BEFORE Phase 1** (not Phase 3). Add no-purchase
  free entry, geo/age-gating, official rules; stop the "lottery" language; minimize operator rake.
- **Collection completes ~day 64 → retention cliff** (active 596→138). Raising the cap multiple
  does NOT help (claim-race-gated). Needs a **renewable late-game loop** (UPPERCASE evolution
  stages / weekly bounties / seasons).
- **Market-integrity**: publish a treasury lock/vesting policy, the peg formula, seed tx links,
  a 48h sell-notice; reframe all copy from price/demand to play/collection; never publish the
  demand number.

## Open questions still owed

- **Cap multiple (2.5×) / mint cadence** — mint-out is ~2 months at any real scale and is
  population-driven, not price-driven; pace it with cadence (waves), not price. (A bigger cap
  does not delay *dictionary completion* — that's claim-race-gated.)
- **Secondary letter market** — still omitted from the sim; the highest-value next iteration
  (and the casual-accessibility case depends on it).
- **Demand damping in the market layer** — currently demand is held at the game-sim level; a
  fuller model would damp it by cost-to-play. (Minor while cost-to-play stays ~1.1×.)
- **LHAW answer-chain migration** — unchanged (Phase 3 dependency).
