# Pricing & launch-economics review (4-lens pressure-test)

> **Numbers as of the original $0.60-pack / $0.15-roll ladder (the version reviewed here).** The
> ladder was later revised (pack $1.00, roll $0.25, royalty→Treasury) and re-simulated 2026-06-11;
> see `docs/decisions.md` for current figures (demand ~$27K, ~8.8× pump, completion ~day 70). The
> *structural* findings below — compliance rework, the retention cliff, market-integrity — are
> ladder-independent and still stand.

A multi-lens review (tokenomics/market-structure, product/retention, compliance/legal,
GTM/market-integrity) of the proposed USD-pegged prices + treasury-seeded jackpot + the
"game as $WORD catalyst" strategy. Verdicts: tokenomics **ship-with-changes**, product
**ship-with-changes**, compliance **REWORK**, GTM **ship-with-changes**.

The price *ladder itself is fine* (product: "price is not the bottleneck; mint-out moves with
population, not price"). The risks are all **structural and around** the prices.

## The two findings that change decisions

### 1. Compliance: do NOT seed the jackpot from treasury (verdict: rework)
The jackpot meets the textbook three-element lottery test — **consideration** (paid
claim/roll/mint fees), **chance** (which dictionary word is the LHAW answer), **prize** (the
pot). Three operator choices make the worst possible characterization simultaneously:
the team **seeds** the prize from treasury, **takes a rake** (10–30% of fees), and **administers
price** via the multisig peg. The spec also self-labels it a "lottery / lottery ticket" 8×.

**This directly conflicts with the "bootstrap the jackpot" decision.** The reconciled path:
- **`seed.jackpot = 0`** — fund the pot exclusively from player fee splits (pari-mutuel; the
  operator is escrow agent, not contributor). Keep the **Rewards-Pool** seed (yield is not a
  chance-based prize, far lower risk) — so "bootstrap" still happens, just on the safe bucket.
- Add a **no-purchase free-entry path** (AMOE) to jackpot eligibility.
- **Geo-gate + age-gate** before launch; publish **Official Rules**; stop using "lottery".
- **Minimize the operator's draw rake** (e.g. roll/claim jackpot split 25%→10%, freed share to
  burn/pool).
- **Move the legal review from Phase 3 to a hard P0 gate before Phase 1.** Get counsel on
  lottery-vs-sweepstakes, MSB/money-transmitter status of the peg multisig, and Howey on $WORD.

### 2. The sim is USD-native and AMM-blind
It converts USD→$WORD at a flat peg, so it never prices slippage or the reflexive pump.
Constant-product reality (pool ≈ 45.5B of 100B supply; ex-pool float ≈ 54B):
- a **$1K buy ≈ +19%**, **$2.37K ≈ +49%**, the full **$20.6K one-directional ≈ ~8.5×**; after
  winner sell-back (~$4K) net demand ~$16.6K → **~5–6× pump**.
- So the headline numbers (8.5×, 42% burn, day-65 mint-out) are **directionally right but
  quantitatively unreliable** — burn in $WORD terms shrinks sharply as the token appreciates.

**Next sim iteration:** add a constant-product price-impact + winner-sell-back layer so
mint-out/recoup/burn are computed on the real price path. This is the highest-value model fix.

## Convergent recommendations (multiple lenses agree)

- **Liquidity is the binding constraint, not the jackpot.** Deploy treasury into **LP depth**
  (~$1–2K / 4–8B $WORD single-sided), and recycle a slice of treasury fee-take into LP weekly.
  Target depth ≥ trailing-30d buy volume so a normal day's flow stays < ~10% price impact.
  Gate "win real $WORD" marketing until liquidity ≥ ~2× projected peak daily demand (~$150/day).
- **Make the USD peg mechanical, not discretionary** (this is the market-integrity crux — an
  insider with a 10% bag hand-setting the conversion rate reads as manipulation): peg off a
  **multi-source 30-min TWAP**, repeg only when **|Δ| > 10–15%** or every **7 days**, with a hard
  **±25%/day** move cap. Publish the formula; the multisig can pause but not hand-pick the rate.
- **The collection completes ~day 64 → retention cliff** (active users 596 → 138). Raising the
  cap multiple does NOT help (completion is claim-race-gated, not supply-gated). Add a
  **renewable late-game loop**: UPPERCASE evolution stages / gilded traits, a rotating weekly
  featured-word bounty, or seasonal answer-chains.
- **Don't cut claim price for accessibility** (it hurts staker recoup). Fix casual access via
  the **secondary letter market** (which the sim still omits — model it before launch) and a
  more generous daily/free-snack cadence.
- **Re-cut KPIs to the funnel:** ~2,000 players → 1,000 *active*; ~4,500–5,000 → 1,000 *unique
  claimers* in 30 days. Define the day-30 goal precisely before committing it.
- **Market integrity disclosure** at launch: team holdings + lock/vesting schedule, the peg
  formula, seed tx links, a 48h-notice rule on any team $WORD sale, and a counsel-reviewed
  "this is a game; $WORD is a utility token, not an investment" statement. Reframe all external
  copy from price/demand to play/collection; never publish the sim's demand number.

## What stays as-is
- The **USD-pegged** decision (correct response to a micro-cap whose price will move).
- The **cheap price ladder** (daily $0.05 / pack $0.60 / roll $0.15 / claim $0.50 / snack $0.02).
- **Solvency by construction** (unanimously confirmed sound).
- Roll odds, hunger gating, UPPERCASE-yield split (product suggests *also* a small base yield
  for any staked+fed word at 0.25–0.5× — worth modeling, not required).

## Update — the AMM layer was built (`src/lib/sim/market.ts`, `npm run market`)

Finding #2's fix shipped. Running the game-sim's daily flows through a constant-product pool
makes the picture **more robust than the worst-case framing**:
- **~6.4× pump** (mcap $23.6K → ~$152K), but **gradual** over the day-60–90 mint rush, not the
  one-shot 8.5× spike. With ETH-paired LP it flattens ($5K → 5.1×, $10K → 4.2×).
- **Liquidity self-heals** $21K → ~$55K from accumulated buy pressure.
- **Cost-to-play stays ≤ ~1.1×** even on a *weekly* repeg — so peg-staleness is a minor concern
  for a gradual pump (the agent's +18–40%/week assumed a faster move). The mechanical peg works.
- **Burn ≈ 12% of supply**, not 42%.
- Decided: **`seed.jackpot = 0`** (compliance); Rewards-Pool seed kept; LP is the treasury lever.

Still open (carried): a real **secondary letter market** in the sim, and **demand-damping** by
cost-to-play in the market layer (minor while cost-to-play ≈ 1.1×).
