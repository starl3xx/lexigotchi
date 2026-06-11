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
2. **The mint sink is finite.** All 55,467 letters mint out (≈ day 69 on the revised ladder;
   the whole dictionary claims out ~day 70), after which the one-time mint/claim revenue is gone
   and the economy runs **only on the recurring sinks — rolls + snacks**. This is the single most
   important long-run insight: the durable economy depends on roll volume and snack burn, not
   minting. (Higher per-letter prices push mint-out slightly later than the old $0.60-pack ladder,
   which completed ~day 64.)
3. **The Rewards Pool finds an equilibrium**, not an ever-rising balance: `pool* ≈
   (daily pool inflow) / (daily distribution rate)`. With UPPERCASE-only yield, early payouts
   are tiny (few uppercase words) and the pool grows; as upgrades accumulate, outflow rises
   and the pool settles toward `pool*`. (The printed `est. equilibrium` uses trailing-30-day
   inflow and assumes it holds — a post-mint-out shape shift can move the true level.)
4. **Jackpot escalation is driven by neglect, not just the early game.** The claim-rush window
   produces the first big rollovers; but after the churn+hunger fix (Bugbot finding #8), a
   *held-but-hungry* word is jackpot-ineligible, so rollovers stay high (~53% of days) even at
   saturation — neglected words can't claim the pot, so it keeps escalating (~57% of days on the
   revised ladder). Player churn + hunger are first-order faucet gates, not flavor.
5. **Strongly deflationary.** Burn (snacks 100% + 20% of mints/rolls + 25% of claims) far
   exceeds treasury accrual — $WORD is net-burned over the run.
6. **Casual players (50% of the base) can be shut out of claiming** and earn ~0% because
   high-budget archetypes win the claim race for unclaimed words. **Caveat: the sim models no
   per-letter secondary trading** (only a macro royalty inflow, added after the Phase-0
   review — see `phase-0-review.md`). v0.2's marketplace (royalty → pool) and showcase (letter
   demand outside the dictionary) are exactly what give low-budget players an economic role.
   A real letter market is the highest-value next sim iteration; until then this is a retention
   flag, not a verdict. **→ now modeled — see "Secondary letter market — sim experiment" below.**

The Phase 0 build was then put through a 5-agent **adversarial review** (3 solvency skeptics +
spec-completeness + art critics). The solvency core survived all three skeptics with **zero
real defects**; the one real (low) finding — a dead royalty faucet — is now fixed, and the art
findings are implemented. Full writeup: `docs/phase-0-review.md`.

## Pricing & launch economics (decided June 2026)

$WORD is **live** on Base — WORD/WETH pool `0xc5db…a275` (GeckoTerminal, as of 2026-06-11):
price **$2.357e-7**, **mcap/FDV ~$23.5K**, ~100B supply, **liquidity ~$21.2K**, **24h volume ~$0
(dormant)**. Paired with WETH (so the LP + every secondary trade are ETH-denominated). Team
treasury 10B+ $WORD (~$2,350).

- **USD-pegged pricing** (decision): prices are USD targets; the multisig re-sets the on-chain
  $WORD amounts as the price moves. The sim runs in USD; `priceWord()` converts. `WORD_USD_PRICE`
  is the live peg input.
- **Price ladder** (revised 2026-06-11): daily **$0.05** · pack **$1.00** · roll **$0.25** ·
  claim **$0.50** · snack **$0.02**. (Was pack $0.60 / roll $0.15; raised on owner's call.) Per
  letter: pack $0.20, daily $0.05 — the FID single is 4× cheaper/letter, sharpening the habit hook.
- **Fee routing change (2026-06-11):** secondary royalty now **100% Treasury** (was 100% Pool,
  v0.2 §8) — see "Royalty & marketplace architecture". External royalties modeled as ≈0 (open
  composability); the in-house swap fee is the only enforced royalty.
- **Treasury bootstrap** (decision: bootstrap; compliance-reconciled): seed the **Rewards Pool**
  ($240) only. **`seed.jackpot = 0`** — an operator-funded chance prize is the core lottery risk
  (compliance verdict: rework). The jackpot self-funds from fee splits. Treasury's other lever
  is **LP depth** (a market op, not a faucet seed).
- **Mechanical peg** (recommended): peg off a 30-min TWAP, repeg on |Δ|>10–15% or weekly, ±25%/day
  cap — NOT a discretionary multisig lever (market-integrity crux). The AMM layer shows a *weekly*
  repeg already holds cost-to-play within ~10%, so this is cheap to honor.

**What the AMM/market layer found** (`npm run market` — constant-product layer; revised ladder):
- The game drives **~$27.1K** of $WORD buy-demand (>mcap) → an **~8.8× price pump** (peak mcap
  ~$207K) over the day-60–90 mint rush. Bigger than the old $0.60-pack ladder's ~6.4× — raising
  prices raises cost-to-play, so more $WORD must be bought to play, a stronger (steeper) catalyst.
- **Liquidity self-heals**: buy pressure deepens the pool **$21K → ~$63K** organically.
- **Burn ≈ 11.3% of supply** (not the ~50% a flat-peg sim implies — each $WORD is worth more as
  it's burned).
- **Peg holds**: weekly repeg keeps cost-to-play within ~1.1× even through the pump.
- **LP depth is the pump lever** ($5K LP → 6.7×, $10K → 5.5×), but treasury (~$2.4K) only funds
  ~$1.5–2K of it; real flattening needs ETH-paired liquidity.

**Structural launch risks surfaced by the 4-lens review** (`docs/pricing-review.md`) — these
matter more than the prices:
- **Compliance: rework the jackpot + get counsel BEFORE Phase 1** (not Phase 3). Add no-purchase
  free entry, geo/age-gating, official rules; stop the "lottery" language; minimize operator rake.
- **Collection completes ~day 70 → retention cliff** (active 596→138). Raising the cap multiple
  does NOT help (claim-race-gated). Needs a **renewable late-game loop** (UPPERCASE evolution
  stages / weekly bounties / seasons).
- **Market-integrity**: publish a treasury lock/vesting policy, the peg formula, seed tx links,
  a 48h sell-notice; reframe all copy from price/demand to play/collection; never publish the
  demand number.

## Contract-design corrections (June 11, 2026)

Surfaced while walking the game loop; recorded so they don't drift into the contracts.

- **Dissolution was never dropped from the design** — it lives in `Words.sol` (claim/dissolve),
  v0.1 §5.4, and the P1/Phase-4 roadmap, reaffirmed in v0.2 §6. It *was* missing from the sim
  (claims were permanent — `claims.set` with no `delete`) and from one verbal walkthrough. The
  sim now models it as a lever (below). Dissolution is the only liquidity escape hatch for a bad
  claim; "permanent, no exit" would change how boldly people claim, so keep it firmly in P1.
- **Pity must key on the WORD-OWNER address for escrowed-letter rolls — not the token holder.**
  When a letter is escrowed, the 1155 is held by `Words.sol`; keying pity on the current holder
  would collapse every player's escrowed-letter pity onto the escrow contract's *shared* counter
  (pump it cheap, harvest near-cap upgrades on anyone's word). Key on `Words.ownerOf(tokenId)`.
  Documented in `docs/reference/eggs/PATTERN.md` (property #5 + the `Rolls.sol` row).
- **Swap primitive ≠ marketplace** (reconciles the "build a marketplace" instinct with v0.2 §8's
  "integrate, don't build"). **Build** a small two-sided swap-escrow contract ("my Q for your two
  Z's, or for N $WORD"), shareable as a Farcaster/X link/cast — it solves exact-match discovery
  and doubles as the P1 mutuals-gifting loop. **Integrate** standard 1155/721 marketplaces
  (OpenSea et al.) for open price discovery, deep-linked from the Lexidex. The swap is in-house;
  open price discovery is not.

## Royalty & marketplace architecture (June 11, 2026)

- **Open composability — NO on-chain royalty enforcement.** Both token contracts are standard,
  freely transferable 1155/721 with **EIP-2981 as a signal only**. We do NOT adopt ERC721-C /
  ERC1155-C. Rationale: permissionless transfer (showcases, the swap primitive, listing on any
  venue) is worth more than defending an optional royalty. ERC721-C would restrict sales to
  LimitBreak Payment-Processor marketplaces (OpenSea + Magic Eden only) and OpenSea's
  "earnings-matching" drops the rate to whatever a non-honoring venue charges anyway.
- **Secondary royalty → Treasury, 100%** (overrides v0.2 §8's pool routing). Marketplace
  royalties arrive in ETH; Treasury holds ETH without an ETH→$WORD swap, whereas pool routing
  would force a swap on every drip. Not a compliance issue (a sales royalty isn't chance-based);
  it shifts value player-rewards → team, which the ETH-handling rationale justifies.
- **The only ENFORCED secondary-revenue rail is the in-house swap primitive.** Because it's our
  contract, it takes the 2.5% at clearing unconditionally — no marketplace goodwill needed. So
  the swap gains a second rationale beyond casual recoup: it's the enforceable royalty channel.
  `params.market.royaltyRate` should be read as the **in-house swap fee**, not an external
  royalty we can rely on.
- **Modeling consequence (implemented 2026-06-11):** the macro-royalty proxy (the trading-OFF
  path) would route `grossGMV × secondaryVolumeRatio × royaltyRate` to Treasury *as if external
  royalties are collected* — under open composability they mostly aren't. So `secondaryVolumeRatio`
  is now set to **0** in `params.ts` (external royalty ≈ 0); the in-house swap fee (the `trading`
  lever) is the sole royalty → Treasury. Applied in the live-data re-sim.

## Secondary letter market — sim experiment (June 11, 2026)

Built the lever the gate demanded *before* committing to a swap-primitive build: a SIMPLE daily
clearing (surplus duplicate letters list at a floor; blocked claimers bid for letters toward
their nearest unclaimed word; P2P $WORD, only the 2.5% royalty leaks out — to Treasury) plus
DISSOLUTION (voluntary recycle of dead low-tier claims), as two independent, default-off toggles
in `params.ts`. Run: `npm run trade-exp`. Verified: 36 tests, a daily letter-conservation guard
(held + 5×words == minted, every day), determinism, and a 5-seed robustness sweep.

**Verdict: the economic case for the swap primitive is weak; build it (lightly) for the social
case, not the numbers.** Specifically, robust across seeds:
- **Claim velocity does NOT reliably improve.** Completion sits ~day 70 and trading's effect is
  mixed across seeds — it helps some (`d70→d64`, `d83→d66`) and *delays* others (`d67→d69`).
  Reason: letter supply (55,467) hugely exceeds demand (4,438×5),
  so completion is gated by claim-race *ordering*, not letter scarcity — and the one thing
  trading can't manufacture is more *rare* letters, which is the only real per-word bottleneck.
  The "let me buy the one Z I'm missing" story is true individually but doesn't move the aggregate
  because nobody has spare Z's to sell. *Caveat:* this rests on the **flat floor** — a rarity-tiered
  floor would price spare rare letters higher and might draw more onto the market, so don't
  over-read the scarcity verdict (the tiered floor is the next refinement). Dissolution alone can
  also leave the dictionary perpetually a few words short of 100% (some always mid-recycle);
  adding trading lets it re-complete, but late.
- **Casual recoup is real but small and stable: ~4.4–4.7% of casual spend** (≈ $0.38/casual over
  270d on the revised ladder; was ~3% at the $0.60 pack — it tracks the floor, which is derived
  from pack price). NOT a windfall — it's "pulling junk letters isn't a total loss." NB: measure
  recoup from the isolated `recoup` field, never total `earned` — earned is dominated by lumpy
  yield/jackpot and swings ±100% seed-to-seed, which nearly tricked this analysis.
- **Casuals get modestly more claims (+4–11%)** with trading (buying toward near-complete words).
- **Dissolution** mechanically churns ownership (gross claims +~85%, mostly re-grabs of recycled
  commons by *active* redeploy players) and bumps casual claims ~+16% (they pick up the freed
  names). It slightly *raises* jackpot rollover (≈59% vs 57% baseline) — dissolving a live word
  opens a brief unclaimed window before re-claim. Its *headline* value — de-risking claims so
  people claim more boldly, and gifting/re-claim drama — is **behavioral and invisible to a
  greedy-claim agent model**. Treat the dissolution columns as "mechanical churn only," not a
  verdict on the feature.

**Implication for the build:** a swap-escrow is cheap (one small contract) and the social/UX case
(exact-match discovery, mutuals gifting, a psychological floor under surplus) is genuinely good —
so build it *light*. Do NOT scope or justify it as a major economic/retention lever; the sim says
it isn't one. The day-70 completion cliff still needs a *renewable late-game loop*, which neither
trading nor dissolution addresses.

**Known model limits (don't over-read):** demand detection is a bounded "nearest unclaimed word"
scan (lowercase path, ≤64 words, ≤3 letters/day bid) — deliberately conservative, so it sets a
*lower* bound on blocked-claimer demand; the floor is flat (no rarity pricing — a rarity-tiered
floor would let scarce letters clear higher and is the obvious next refinement); dissolution can't
capture the de-risking benefit. **Most important — churn is exogenous, so literal re-engagement of
churned players cannot be modeled.** "Casual recoup / +claims" measures earnings *while active*,
NOT retention of lapsed players. So the original question — *"does a letter market move
retention?"* — is **not answered here**; the sim only shows active casuals claim slightly more. A
5–10% re-engagement rate among churned casuals would reshape the case and is invisible to this
model. Making churn endogenous (success → lower churn) is the way to actually test retention.

## Open questions still owed

- **Cap multiple (2.5×) / mint cadence** — mint-out is ~2 months at any real scale and is
  population-driven, not price-driven; pace it with cadence (waves), not price. (A bigger cap
  does not delay *dictionary completion* — that's claim-race-gated.)
- **Secondary letter market** — ✅ now modeled (see the experiment section above). Verdict: weak
  economic lever (~4.5% casual recoup, no reliable velocity gain), strong social case → build the
  swap primitive light. Refinement owed: a rarity-tiered floor (scarce letters should clear higher).
- **Demand damping in the market layer** — currently demand is held at the game-sim level; a
  fuller model would damp it by cost-to-play. (Minor while cost-to-play stays ~1.1×.)
- **LHAW answer-chain migration** — unchanged (Phase 3 dependency).
