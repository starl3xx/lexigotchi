# Lexigotchi — Game Documentation

A complete, self-contained reference to Lexigotchi: every mechanic, every number, the economy, and
the on-chain architecture. Written to be fed to an LLM (or a new contributor) as ground truth.

- **What it is:** a tamagotchi-style $WORD collection game on **Base**, a Farcaster Mini App + web
  app, in the *Let's Have A Word!* (LHAW) ecosystem.
- **Status:** Phase 0 prototype. The playable app runs on a faithful in-memory mock; the Solidity
  suite is written + tested but not yet deployed or audited. The off-chain economy sim
  (`src/lib/sim`) de-risks solvency and fun before mainnet.
- **Specs of record:** `docs/spec/v0.1.md` + `docs/spec/v0.2-changelog.md` (v0.2 wins any conflict),
  with decisions logged in `docs/decisions.md`. Economy values are **derived in code** from the
  vendored dictionary and asserted against the spec in tests — they never drift.

---

## 1. The core loop

| Step | Action | Outcome |
|---|---|---|
| **Mint** | Pull lowercase letters — a free daily single (FID-gated) or packs of 5 | Letter NFTs (ERC-1155), 100% lowercase |
| **Raise** | Roll a lowercase letter toward UPPERCASE | A capital letter (45% base, pity to 85%); failure is harmless |
| **Claim** | Spell a dictionary word with 5 uniform-case letters | One Word NFT (ERC-721); the 5 letters are escrowed inside it |
| **Stake & Snack** | Stake a Word to earn; feed it snacks | UPPERCASE words draw yield; any staked, fed word is a jackpot ticket |
| **Win** | Hold the day's secret word, staked & fed | The whole jackpot pot |

Two renewable late-game loops sit on top: a **weekly theme bounty** (broad, casual-reachable) and
**prestige/ascension** (deep, for maxed words).

---

## 2. Letters & the letter economy

- Letters are an **ERC-1155** with **52 ids**: lowercase letter `i` is id `i` (0–25), uppercase
  letter `i` is id `26 + i`. The 26 lowercase ids are the only ones ever minted; uppercase ids only
  appear via a successful roll, which **burns the lowercase and mints the uppercase**, conserving
  total per-letter supply.
- **Mint odds are demand-mirrored** (spec Appendix A): a letter's probability of being pulled equals
  its share of all letter slots in the dictionary. The dictionary has **22,190 slots** (= 5 × 4,438
  words). Common letters (S, E, A, …) are frequent; **Q, Z, X, J** are the chase.
- **Per-letter supply caps** = `floor(slots × 2.5)` (the demand multiple). They sum to a global cap
  of **55,467 letters**. The sim shows all letters mint out around day 69 at scale; after that the
  durable economy runs on rolls + snacks, not minting.

Most common → rarest letter order: **S E A … J Q**.

---

## 3. Minting

| Path | Cadence | Price (USD target) | Notes |
|---|---|---|---|
| **Daily single** | 1 per Farcaster **FID** per UTC day | **Free** | The zero-friction habit loop. Requires an FID (off-chain Quick-Auth/Sybil gate → a backend-signed allowance). |
| **Pack of 5** | Unlimited, anytime | **$1.00** (~4.22M $WORD) | The volume loop. $0.20/letter — the only paid mint path (the daily single is free). |

- **Payment:** $WORD directly, **or ETH auto-swapped to $WORD** at mint time (Uniswap v3 /
  aggregator, slippage-bounded). All internal accounting is in $WORD; the Treasury never holds ETH
  from mints.
- **Randomness:** the EGGS commit→server-signed reveal (same model as rolls). The buyer commits +
  pays, then the backend signer reveals a fair demand-mirrored draw; per-letter caps are enforced
  on-chain. There is no expiry window, so a paid commit is always revealable — a fee is never
  forfeited and the buyer can't grind the draw by aborting an unfavourable one.

---

## 4. Rolls (raising letters)

The single value-bearing upgrade. Capitals are **raised, never pulled**.

- **Odds:** **45% base**, **+10 percentage points** per consecutive failure on that `(owner, letter)`
  pair, **capped at 85%**, **reset to base on success**. Expected ~**1.9 rolls** per success; the
  worst realistic drought is ~5.
- **Failure is an explicit no-op** — the letter is never burned or downgraded (hard compliance rule).
  Only the pity streak advances.
- **Price:** **$0.25** per roll (~1.06M $WORD) — the core durable sink. ~$0.48 per UPPERCASE letter
  at expectation.
- **On-chain:** EGGS-style commit→**server-signed** reveal (the trusted "superHen" signer decides the
  fair outcome on the live pity-adjusted odds). Pity is keyed on the **beneficial owner**, resolved
  through staking custody — so a letter escrowed inside a staked Word can't share or pump a counter.

---

## 5. Words & claiming

- **One ERC-721 per dictionary word**, for the word's lifetime: `tokenId = uint256(keccak256(word))`.
  The "who owns CRANE if lowercase and UPPERCASE have different owners?" problem is **unrepresentable**.
- **Claim** by escrowing **exactly 5 letters of uniform case** (all lowercase or all uppercase) that
  spell a word proven to be in the canonical dictionary (a Merkle proof against the published root).
- **Case is derived, never stored:** 5 lowercase = `lowercase`, 5 uppercase = `UPPERCASE`, anything in
  between = `Mixed`. Upgrade rolls mutate the escrow in place, walking a word lowercase → Mixed →
  UPPERCASE.
- **Claim fee:** **$0.50** (~2.11M $WORD). Claims are permanent.
- **Dissolution:** burn the Word, recover its 5 escrowed letters (in their current case), and free the
  name for re-claim. Trophy history persists by word. The only liquidity escape hatch for a claim you
  regret — so people claim boldly.
- The canonical claimable set is **4,438 words** (deduped).

---

## 6. Rarity tiers

Each word's rarity score is `−Σ log₁₀(letterFrequency)` over its 5 letters (rarer letters → higher
score). Words are ranked ascending and cut at floor percentiles, with an alphabetical tiebreak.

| Tier | Percentile cut | Count | Stake weight |
|---|---|---|---|
| Common | ≤ 50% | 2,219 | 1 |
| Uncommon | ≤ 80% | ~1,331 | 2 |
| Rare | ≤ 95% | ~666 | 3 |
| Epic | ≤ 99% | 177 | 5 |
| Legendary | top 1% | 45 | 8 |

(The Uncommon/Rare boundary straddles a score tie; the combined 1,997 is the invariant.) **JAZZY** is
the apex grail — the only word combining two distinct ultra-rares with a double letter.

---

## 7. Staking & yield

- Stake a Word (it's custodied by the staking contract). **Daily yield is UPPERCASE-only**, paid from
  the **Rewards Pool** and weighted by tier (Common 1 … Legendary 8) × prestige (1.10^level), with
  peckish words at half.
- **Yield is a self-scaling fraction of the pool** — `pool × dailyDistributionRate` with
  `dailyDistributionRate = 1%`. It finds an equilibrium `pool* ≈ dailyInflow / rate` and never drains.
- Separately, **any staked word of any case** (as long as it's not hungry) is a **jackpot ticket**.
- Early on, with few UPPERCASE words, payouts are tiny and the pool grows; as upgrades accumulate,
  outflow rises and the pool settles. This is intended — no "top-ups."

---

## 8. Hunger & snacks

A staked word's care state is a function of days since last fed:

| State | Days unfed | Yield | Jackpot ticket |
|---|---|---|---|
| Fed | 0 | full | yes |
| Peckish | 1–2 | ×0.5 | yes |
| Hungry | 3+ | 0 | **no** |

- **Feed** a snack to reset the clock. **Snacks are 100% burned**. One **free snack per day** (a
  retention hook). Snack price: **$0.02** (~84K $WORD).
- Hunger is a first-order faucet gate: a held-but-hungry word is jackpot-ineligible, which keeps the
  pot escalating even at saturation.

---

## 9. The daily jackpot

- Lexigotchi picks **one secret word per day from its own pre-committed sequence** — an on-chain
  reverse **hash-chain** (`AnswerChain`), so the answer can't be steered by anyone, including the team.
  This is **decoupled from LHAW** (which runs on irregular rounds, not days), removing the old Phase-3
  dependency: the game runs the jackpot on its own clock.
- **Resolution is a single lookup:** does `keccak256(todaysWord)` exist, is it staked, and is it not
  hungry? If yes → its owner wins the **entire pot**. If no → it **rolls over** and grows. **Case is
  irrelevant** to the jackpot (only to yield).
- **Funding:** the jackpot bucket fills only from fee splits. The operator never seeds it
  (`seed.jackpot = 0`) — an operator-funded chance prize is the core lottery-compliance risk.
- **LHAW bonus (soft tie-in):** when an LHAW round resolves, a player who simply **owns** that winning
  word wins a separate bonus (ownership-only, no stake/feed gate). Read-only; if LHAW is down, the core
  jackpot is unaffected.

---

## 10. The weekly bounty (renewable loop #1)

- Every **7-day period** features a **theme/category** of words — e.g. *contains a rare letter*, *has a
  double letter*, *ends in -ING*, *starts with a vowel*, *ends in Y*.
- At period end, every player holding a **staked + not-hungry matching word** shares a bounty pool
  **pro-rata**, weighted `tierWeight^rarityWeight × prestige`. `rarityWeight = 1.0` (tier-proportional)
  by default; `0` = flat (max casual reach).
- **Funding is zero-sum:** a `carveFraction` (default **15%**) of the day's *pool* inflow is skimmed
  into a side bounty bucket — a redistribution from passive yield to the active goal, never touching
  jackpot/burn/treasury. An unsatisfied period rolls forward.
- It's the casual-reachable loop: ~18–21% of bounty payouts reach casual players (vs ~0% of UPPERCASE
  yield) in the sim, with ~220 words eligible per period.

---

## 11. Prestige / ascension (renewable loop #2)

- A **full-UPPERCASE staked Word** ascends through **4 Gilded stages**. Each level multiplies that
  word's **yield and bounty weight by 1.10** (gentle, to cap whale concentration).
- Each attempt pays the roll fee (**$0.25**) + burns a snack, and succeeds on the same pity ramp as
  rolls. **Success** bumps the level (monotonic, never decremented); **failure is a no-op** — level,
  case, and letters untouched.
- It's solvency-neutral: a prestiged word takes a bigger slice of the **same** fixed yield pot, never
  enlarging it. A finite depth sink (4 levels × your maxed words) for the UPPERCASE cohort.

---

## 12. Showcase, Swap, Dissolution

- **Showcase:** arrange any letters you own into any string (2–8 chars, no dictionary check) and cast
  it. Off-chain, read-only vanity — no NFT, no fee. The primary organic growth loop (every showcase is
  an ad) and a source of letter demand *outside* the dictionary.
- **Swap:** a direct two-sided letter escrow ("my Q for your two Z's, + N $WORD"), shareable as a
  Farcaster/X cast. It solves exact-match discovery and doubles as a gifting loop. **Not a
  marketplace** — open price discovery stays on standard 1155/721 venues; a 2.5% fee on in-house swaps
  routes to the Treasury.
- **Dissolution:** see §5.

---

## 13. Fees & the four-bucket ledger

Every $WORD fee splits into four buckets. **Solvency is by construction:** the pool / jackpot / bounty
buckets can never pay out more than they hold; burn and treasury shares leave immediately.

| Source | Pool | Jackpot | Burn | Treasury |
|---|---|---|---|---|
| Pack mint | 40% | 10% | 20% | 30% |
| Daily mint | 40% | 10% | 20% | 30% |
| Roll | 40% | 25% | 20% | 15% |
| Claim | 25% | 25% | 25% | 25% |
| Snack | 0% | 0% | **100%** | 0% |
| Prestige | 40% | 25% | 20% | 15% |
| Royalty (in-house swap) | 0% | 0% | 0% | 100% |

The **bounty carve** (default 15%, off until enabled) diverts a slice of the *pool* share into the
bounty bucket. The economy is **strongly deflationary**: burn (snacks 100% + 20% of mints/rolls + 25%
of claims) exceeds treasury accrual.

---

## 14. Pricing

- **USD-pegged.** Prices are USD targets; the multisig re-sets the on-chain $WORD amounts as the peg
  moves. The sim runs in USD; `priceWord(usd)` converts at the live peg.
- **$WORD:** ERC-20 on Base, `0x304e649e69979298bd1aee63e175adf07885fb4b`. ~100B supply, micro-cap
  (~$23.5K FDV, ~$21K liquidity as of June 2026), paired with WETH.
- **Price ladder:** daily **free** · pack **$1.00** · roll **$0.25** · claim **$0.50** · snack
  **$0.02** · prestige **$0.25**.
- **Treasury bootstrap:** seed the **Rewards Pool** only (~$240); **never the jackpot**. The other
  lever is LP depth, not a faucet seed.

---

## 15. Parameter reference (`src/lib/params.ts`)

Every value below is a storage variable behind the multisig on-chain (the mechanic is fixed; the
number can be tuned).

```
prices:   pack $1.00 · dailyMint $0 (free) · roll $0.25 · claim $0.50 · snack $0.02
roll:     baseSuccess 0.45 · pityStep +0.10 · pityCap 0.85
staking:  dailyDistributionRate 0.01 · yieldRequiresUppercase true
care:     peckishAfterDays 1 · hungryAfterDays 3 · peckishYieldFactor 0.5 · freeDailySnack true
jackpot:  eligibilityRequiresNotHungry true
supply:   demandMultiple 2.5  (→ 55,467 total cap)
prestige: levels 4 · commitFee $0.25 · base 0.45 / +0.10 / cap 0.85 · 1.10× yield & bounty per level  (default OFF)
bounty:   periodDays 7 · carveFraction 0.15 · chaseProbability 0.5 · rarityWeight 1.0  (default OFF)
```

Prestige and bounty are default-off **sim levers** with experiments (`npm run loop-exp`); they're
recommended to ship but gated behind their flags.

---

## 16. Smart contracts (`contracts/`)

Foundry, OpenZeppelin, Solidity 0.8.28. See `contracts/README.md` for the architecture diagram, the
trust model, and the deploy + pre-mainnet checklist.

| Contract | Responsibility |
|---|---|
| `FeeRouter` | The four-bucket ledger: split fees, hold pool/jackpot/bounty, cap every payout at balance |
| `Letters` | 52-id ERC-1155: demand-mirrored capped draws, commit/reveal, FID daily, ETH swap, `upgrade` |
| `Words` | One ERC-721 per word, Merkle dictionary, letter escrow, case-as-state, dissolve, prestige level |
| `Rolls` | Commit→signed-reveal upgrades; fail no-op; pity per `(beneficialOwner, letter)` |
| `Staking` | Word custody + hunger clock + snack feed; the eligibility truth read by Jackpot |
| `Prestige` | Ascension of full-UPPERCASE staked words (signed reveal, monotonic, fail no-op) |
| `AnswerChain` | Pre-committed daily-word reverse hash-chain (unsteerable jackpot answer) |
| `Jackpot` | Single keccak(word) lookup → pay the staked, fed holder or roll over |
| `YieldDistributor` / `Bounty` | Per-epoch Merkle distributors funded from the pool / bounty buckets |

**Trust seams (Phase 0, documented):** a backend `signer` decides roll/prestige outcomes (EGGS model)
and authorizes the FID daily; a `keeper` reveals the daily word and posts the yield/bounty Merkle
roots. Both are trusted for *fairness only* — never for solvency (every payout is bucket-capped) and
never to harm an asset (failures are no-ops). The `owner` is a multisig.

---

## 17. What the off-chain sim proved

Run `npm run sim` (and `npm test` for the spec assertions + solvency invariants). Key findings:

1. **Solvency is structural** — yield is a fraction of the pool, the jackpot pays only what it holds;
   no bucket goes negative. Asserted every simulated day.
2. **The mint sink is finite** — all letters mint out ~day 69; the dictionary claims out ~day 70. The
   durable economy then runs on **rolls + snacks**.
3. **The Rewards Pool finds an equilibrium**, not an ever-rising balance.
4. **Jackpot escalation is driven by neglect** — held-but-hungry words can't win, so the pot keeps
   rolling over (~57% of days at saturation).
5. **Strongly deflationary** — net $WORD burned over a run.
6. **Casual reach is the open risk** — high-budget archetypes win the claim race; the bounty + a real
   letter market are what give casuals an economic role. Retention itself is unmeasured (churn is
   exogenous) — a live cohort is the honest artifact for it.

---

## 18. Glossary

- **$WORD** — the game's ERC-20 on Base; all accounting is denominated in it.
- **Pity** — a per-`(owner, letter)` streak that raises roll odds after each failure.
- **Case-as-state** — a Word's case is derived from its escrowed letters, never stored.
- **Escrow** — the 5 letters locked inside a Word NFT when claimed.
- **AnswerChain** — the pre-committed daily-word hash-chain that makes the jackpot unsteerable.
- **Carve** — the zero-sum slice of pool inflow diverted to the bounty bucket.
- **superHen / signer** — the trusted backend key that signs fair roll/prestige outcomes (EGGS term).
- **Keeper** — the operator role that reveals the daily word and posts yield/bounty Merkle roots.
- **Lexidex** — the in-app dictionary browser (every claimable word + its tier + ownership).
