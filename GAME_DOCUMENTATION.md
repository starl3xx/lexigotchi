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
- **How the game talks about itself:** `docs/messaging.md` (decisions.md #24) is the source of truth
  for every player-facing word; this document describes mechanics, not copy.

---

## 1. The core loop

| Step | Action | Outcome |
|---|---|---|
| **Mint** | Pull lowercase letters — free for verified players (a pack of 5 plus 10 daily letters, once per profile: Farcaster, X, or a Coinbase-verified wallet) or packs of 5 | Letter NFTs (ERC-1155), 100% lowercase |
| **Raise** | Roll a lowercase letter toward UPPERCASE | A capital letter (40% base, pity to 85%); failure is harmless |
| **Claim** | Spell a dictionary word with 5 letters, any mix of cases | One Word NFT (ERC-721); the 5 letters are escrowed inside it |
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
  its share of all letter slots in the dictionary. The dictionary has **22,920 slots** (= 5 × 4,584
  words). Common letters (S, E, A, …) are frequent; **Q, Z, X, J** are the grails. A letter that has
  sold out leaves the draw, and the others rise. The Mint tab lists every letter's odds, A to Z, from
  the weights the draw itself uses (`src/lib/letterOdds.ts`, decisions.md #33).
- **Per-letter supply caps** = `floor(slots × 3.0)` (the demand multiple, 3.0 since decisions.md #21;
  Sepolia's deployed Letters keeps 2.5×). They sum to a global cap of **68,760 letters**. The sim
  (1,500 players, a year) shows 99% of the dictionary claimed around day 50 and all letters minted
  out around day 59; after that the durable economy runs on rolls + snacks, not minting.

Most common → rarest letter order: **S E A … J Q**.

---

## 3. Minting

| Path | Cadence | Price (USD target) | Notes |
|---|---|---|---|
| **Daily single** | 1 per identity per UTC day — a Farcaster **FID**, or a **Coinbase-verified wallet** (EAS attestation, KYC-backed) | **Free** | The zero-friction habit loop. Both identities resolve off-chain (Quick-Auth JWT / mainnet attestation read) into a backend-signed allowance; verified wallets use a disjoint `2^160 + address` key namespace in the same on-chain gate. |
| **Pack of 5** | Unlimited, anytime | **$1.00** (~4.22M $WORD) | The volume loop. $0.20/letter — the only paid mint path (the daily single is free). |

- **Payment:** **$WORD-only at launch** — ETH-only players buy $WORD first (the in-app swap +
  DexScreener). The contracts also carry an **ETH auto-swap** mint path (Uniswap v3 / aggregator,
  slippage-bounded), deferred until $WORD liquidity is deeper. All internal accounting is in $WORD.
- **Free vouchers:** besides the paid paths, the backend signer can authorize **zero-cost** mints for
  every verified profile (Farcaster, X older than 90 days, or a Coinbase-verified wallet;
  decisions.md #21): a **one-time free 5-pack** and **10 free daily letters** (at most one a chain
  day), from a **30,000-letter budget** (`FREE_LETTER_BUDGET`), stopping when the dictionary is about
  **95% claimed**. Enforced by the server (`free_claims`, migration 0015), not the contracts: both
  vouchers take any `uint256` key. Both skip fees entirely and reveal the same demand-mirrored draw.
- **Randomness:** the EGGS commit→server-signed reveal (same model as rolls). The buyer commits +
  pays, then the backend signer reveals a fair demand-mirrored draw; per-letter caps are enforced
  on-chain. There is no expiry window, so a paid commit is always revealable — a fee is never
  forfeited and the buyer can't grind the draw by aborting an unfavorable one.
- **Supply is reserved at commit** (`Letters.unreservedSupply` = Σ(cap − minted) − letters owed to
  open commits). A commit that asks for more than is left reverts `SoldOut` before any fee moves, so
  a sell-out never strands a paid commit (internal audit, 2026-11-21).

---

## 4. Rolls (raising letters)

The single value-bearing upgrade. Capitals are **raised, never pulled**.

- **Odds:** **40% base**, **+15 percentage points** per consecutive failure on that `(owner, letter)`
  pair, **capped at 85%**, **reset to base on success**. Expected ~**2 rolls** (1.97) per success; the
  worst realistic drought is ~5.
- **Failure is an explicit no-op** — the letter is never burned or downgraded (hard compliance rule).
  Only the pity streak advances.
- **Price:** **$0.25** per roll (~1.06M $WORD) — the core durable sink. ~$0.48 per UPPERCASE letter
  at expectation.
- **On-chain:** EGGS-style commit→**server-signed** reveal (the trusted "superHen" signer decides the
  fair outcome on the live pity-adjusted odds). Pity is keyed on the **beneficial owner**, resolved
  through staking custody — so a letter escrowed inside a staked Word can't share or pump a counter.
- **One open roll per `(owner, letter)`** (`Rolls.rollOpen`). Pity is snapshotted at commit and reset
  only by a success reveal, so several open rolls would let a player reveal the misses, hold the
  signed successes, and keep every later roll at the 85% cap. A new roll on that letter reverts
  `RollOpen` until the open one is revealed (by anyone: the reveal is permissionless).

---

## 5. Words & claiming

- **One ERC-721 per dictionary word**, for the word's lifetime: `tokenId = uint256(keccak256(word))`.
  The "who owns CRANE if lowercase and UPPERCASE have different owners?" problem is **unrepresentable**.
- **Claim** by escrowing **exactly 5 letters, each in either case** (any mix: all lowercase, all
  uppercase, or Mixed; the claim names each letter's case, decisions.md #17) that spell a word
  proven to be in the canonical dictionary (a Merkle proof against the published root).
- **Case is derived, never stored:** 5 lowercase = `lowercase`, 5 uppercase = `UPPERCASE`, anything in
  between = `Mixed`. Upgrade rolls mutate the escrow in place, walking a word lowercase → Mixed →
  UPPERCASE.
- **Claim fee:** **$0.50** (~2.11M $WORD). Claims are permanent.
- **Dissolution:** burn the Word, recover its 5 escrowed letters (in their current case), and free the
  name for re-claim. Trophy history persists by word. The only liquidity escape hatch for a claim you
  regret — so people claim boldly.
- The canonical claimable set is **4,584 words** (deduped): Let’s Have A Word’s list, re-vendored
  2026-11-21 after its round-36 additions (146 words, none removed).

---

## 6. Rarity tiers

Each word's rarity score is `−Σ log₁₀(letterFrequency)` over its 5 letters (rarer letters → higher
score). Words are ranked ascending and cut at floor percentiles, with an alphabetical tiebreak.

| Tier | Percentile cut | Count | Stake weight |
|---|---|---|---|
| Common | ≤ 50% | 2,292 | 1 |
| Uncommon | ≤ 80% | 1,375 | 2 |
| Rare | ≤ 95% | 687 | 3 |
| Legendary | ≤ 99% | 184 | 5 |
| Mythic | top 1% | 46 | 8 |

(Each count is exact at the `floor(4,584 × p)` cuts, and `npm test` pins all five. The spec's
Appendix B was written for 4,438 words.) **JAZZY** is
the apex crown — the only word combining two distinct ultra-rares with a double letter.

---

## 7. Staking & yield

- Stake a Word (it's custodied by the staking contract). **Daily yield is UPPERCASE-only**, paid from
  the **Rewards Pool** and weighted by tier (Common 1 … Mythic 8) × prestige (1.10^level), with
  peckish words at half.
- **Yield is a self-scaling fraction of the pool** — `pool × dailyDistributionRate` with
  `dailyDistributionRate = 1%`. It finds an equilibrium `pool* ≈ dailyInflow / rate` and never drains.
- **Paid automatically** (decisions.md #16). Each day at 00:05 UTC the keeper opens the day's
  yield epoch (one Merkle share per earning word), then its `payout` job sends every unpaid share's
  `claim` itself, batched through Multicall3. `claim` is permissionless and always pays the share's
  baked-in account, so players never sign, pay gas, or race the 90-day claim window. A share the
  keeper misses waits for the next run, and the player can collect it from the Earnings sheet.
- **Shared like a word** (decisions.md #38): the Earnings sheet's Share posts `/e/<token>`, a
  picture of the player's top word's card beside a tag with what their words have earned. The
  amounts come from a snapshot the earnings route signs (`src/lib/earningsShareToken.ts`), never
  from the link.
- **Shown everywhere a word is** (`/api/rewards/earnings`, `components/game/earnings.ts`): the
  Earnings sheet (each word's total and latest payout, and what would make it earn more), a line
  under the Today stage and the Bag's words, the featured word's Earns mark (its three status marks
  are Fed, Jackpot, Earns: `components/game/stageMarks.ts`), the word sheet, the Bag card's marks, the
  balance sheet, and a toast once per payout.
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

- **Feed** a snack to reset the clock. **Snacks are 100% burned**. One **free snack per day per
  profile** (a retention hook), however many of the profile's wallets stake: the server signs a
  voucher for it (`Staking.feedWithSnack`), because only the server knows which wallets share a
  profile; a plain `feed` always pays. Snack price: **$0.02** (~84K $WORD).
- **The clock keeps running while a word is unstaked.** Only a word's first stake after it is
  claimed starts fed (`Words.claimedAt`: a word dissolved and claimed again is a new word, but one
  passed to another wallet is not); after that only `feed` resets the clock, so unstake + stake can't stand in for a snack (internal
  audit, 2026-11-21). A paused clock was tried first and failed: staking for a few minutes around
  the daily snapshot never accrued any hunger.
- Hunger is a first-order faucet gate: a held-but-hungry word is jackpot-ineligible, which keeps the
  pot escalating even at saturation.

---

## 9. The daily jackpot

- Lexigotchi picks **one secret word per day from its own pre-committed sequence** — an on-chain
  reverse **hash-chain** (`AnswerChain`), so the answer can't be steered by anyone, including the team.
  This is **decoupled from LHAW** (which runs on irregular rounds, not days), removing the old Phase-3
  dependency: the game runs the jackpot on its own clock.
- **A word is drawn at most once, ever** (decisions.md #20): the committed list holds every word in
  the frozen pool once (4,584 days), and `AnswerChain` refuses to reveal a word it has revealed
  before (`wasRevealed`), even in a list rotated in later.
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

## 11. Prestige / ascension: the word ladder (renewable loop #2)

- A **full-UPPERCASE staked Word** climbs **5 stages**: Gilded 1–4, then **Holographic** (the gold
  turns to iridescent foil). ON at launch (decisions.md #19). Each stage multiplies that word's
  **yield and bounty weight by 1.10** (gentle, to cap whale concentration).
- Each stage is harder and costs more: first-try odds **40 / 35 / 30 / 25 / 20%**, then **+10pp per
  miss** on that word (cap 85%); a stage-N attempt costs **N × $0.50** ($0.50 … $2.50,
  `Prestige.stageFee`) plus a burned snack. About 12 attempts and $20 from UPPERCASE to Holographic.
  **Success** bumps the stage (monotonic, never decremented); **failure is a no-op** — stage, case,
  and letters untouched. One open attempt per word (`Prestige.attemptOpen`), for the same reason as
  rolls; each commit records its stage, so the signer draws at that stage's odds.
- It's solvency-neutral: an ascended word takes a bigger slice of the **same** fixed yield pot, never
  enlarging it. A finite depth sink (5 stages × your maxed words) for the UPPERCASE cohort.

---

## 12. Cards, Sharing, the Market, Dissolution

- **Word cards:** every owned word is a card (`src/components/cards/`): the word standing in its
  scene on the front, and a back in its rarity's material, turned over by the button in the top
  right corner. The back tells the word's story: its rarity (one of N) and dictionary number, its
  case and ascension stage, "Yours since" (the day it reached the player's profile; moves between
  their own wallets keep it), staked and mood, what it has earned, earns a day, and costs to make,
  its points, "Found by" (the first player ever to claim it, kept through a dissolve and re-spell),
  whether the jackpot has drawn it, and its token. The two history facts come from the word's own
  Claimed and Transfer events (`/api/words/story`, `src/lib/cardFacts.ts`); staking's moves aren't
  changes of hands. The Bag opens on Words, as a grid of still cards; the Today stage and an opened
  word are the cards that move.
- **Sharing:** open one of your own words and tap Share under its card, to post it on X first or
  cast it on Farcaster, or to save its picture. Each share links to `/s/<word>?scene=<scene>`,
  whose picture is the word's card, in that scene, on a dark table (1200×630 for X's large card,
  3:2 for the Farcaster embed). The page and card draw dictionary words only, never free text (decisions.md
  #15). Offchain, read-only vanity: no NFT, no fee. The primary organic growth loop (every shared
  word is an ad). The Showcase screen that did this folded into the cards.
- **Scenes and the card's front** (decisions.md #34): a word's card is an object: its own paper,
  its scene in a window, a frame in the rarity's ink with the rarity's mark in its corners, and a
  ribbon ("one of one", the card's number, the rarity). It shows on the Today stage, in the Bag,
  and on the share picture (`src/lib/scenes.ts`, `src/lib/cardArt/`, `src/components/scenes/`).
  Every word starts on the stock card (grey, the rarity as an overtone); the Stage is free for
  everyone too; the Trophy Case and Spring unlock once a player has held 3 words, and stay
  unlocked. Picture Day, Summer, Fall, and Winter are retired. The Bookshelf and Outer Space are the Shop's
  (decisions.md #41): drawn and ready, a player's only once their profile buys one, and not listed yet.
  A scene is a still engraving and
  never moves; the card in focus catches a faint light and leans a little toward a pointer.
  A scene greys and fills with fog as its word gets hungry. Cosmetic and offchain: each word's pick
  is saved in the browser, and to the player's profile when they're signed in (table `word_scenes`,
  keyed by the wallet holding the word; decisions.md #15).
- **The Market** (decisions.md #18, #30): words and letters sell for $WORD through Seaport orders
  (`src/lib/onchain/wordSale.ts`, `letterSale.ts`), each with a **10% fee to the Rewards Pool**
  (`SaleFees` → the `ROYALTY` split); OpenSea stays open. A letter listing holds several of one letter
  at a price each, and a buyer takes any number of them. The old one-for-one letter swap is retired.
  Recent sales are read from the chain (`src/lib/market/sales.ts`). The Market suggests prices and
  picks listings for each player (`src/lib/market/deals.ts`). A purchase celebrates once it shows: a
  bought word in its scene (`sheets/CelebrateSheet`), bought letters over the word they newly finish
  (`sheets/BoughtLettersSheet`). The sell form and
  each listing show the word's **cost to make** (`src/lib/wordCost.ts`: letters at
  `pack ÷ 5 ÷ (26 × odds)`, the expected rolls for each UPPERCASE letter, the claim, and the expected
  attempts at each ascension stage reached, at the live prices), what it would earn a day staked from
  today's pot, and whether the jackpot has already drawn it.
- **Dissolution:** see §5.

---

## 13. Fees & the four-bucket ledger

Every $WORD fee splits into four buckets. **Solvency is by construction:** the pool / jackpot / bounty
buckets can never pay out more than they hold; burn and treasury shares leave immediately.

| Source | Pool | Jackpot | Burn | Treasury |
|---|---|---|---|---|
| Pack mint | 75% | 10% | 10% | 5% |
| Daily mint | 75% | 10% | 10% | 5% |
| Roll | 75% | 10% | 10% | 5% |
| Claim | 75% | 10% | 10% | 5% |
| Prestige (ascension) | 75% | 10% | 10% | 5% |
| Snack | 0% | 0% | **100%** | 0% |
| Royalty (the 10% word-sale fee, SaleFees) | 100% | 0% | 0% | 0% |

**Rewards first** (decisions.md #19): every paid action sends 75% to the Rewards Pool, whose daily
yield is the one reward that needs the whole loop (buy, raise, stake, feed). The jackpot keeps its
**10%** (operator-rake minimization for lottery compliance, #3). The treasury takes 5% and never
sells. The **bounty carve** (15%, on at launch) diverts a slice of the *pool* share into the bounty
bucket. Each week's bounty pays when the week ends, to every staked, not-hungry word matching that
week's theme. Burn comes from snacks (100%) plus 10% of every paid action, about 39% of all spending
in the simulation.

---

## 14. Pricing

- **USD-pegged, auto-repegged.** Prices are USD targets; an automated **`priceKeeper`** hot key
  re-sets the on-chain $WORD amounts within a clamped `±maxMoveBps` band as the peg moves (no
  multisig; the owner keeps an unclamped override, and the keeper can never cross zero). The sim runs
  in USD; `priceWord(usd)` converts at the live peg.
- **$WORD:** ERC-20 on Base, `0x304e649e69979298bd1aee63e175adf07885fb4b`. ~100B supply, micro-cap
  (~$23.5K FDV, ~$21K liquidity as of June 2026), paired with WETH.
- **Price ladder:** daily **free** · pack **$1.00** · roll **$0.25** · claim **$0.50** · snack
  **$0.02** · ascension **$0.50 × the stage** ($0.50 … $2.50).
- **Treasury bootstrap:** seed the **Rewards Pool** only (~$240); **never the jackpot**. The other
  lever is LP depth, not a faucet seed.

---

## 15. Parameter reference (`src/lib/params.ts`)

Every value below is a storage variable behind the owner (a single hardware-wallet EOA — no multisig)
on-chain (the mechanic is fixed; the number can be tuned).

```
prices:   pack $1.00 · dailyMint $0 (free) · roll $0.25 · claim $0.50 · snack $0.02
roll:     baseSuccess 0.40 · pityStep +0.15 · pityCap 0.85
staking:  dailyDistributionRate 0.01 · yieldRequiresUppercase true
care:     peckishAfterDays 1 · hungryAfterDays 3 · peckishYieldFactor 0.5 · freeDailySnack true
jackpot:  eligibilityRequiresNotHungry true
supply:   demandMultiple 3.0  (→ 68,760 total cap; Sepolia's deployed caps stay at 2.5× → 57,294)
prestige: levels 5 · commitFee $0.50 × stage · baseByLevel 0.40/0.35/0.30/0.25/0.20 / +0.10 / cap 0.85 · 1.10× per stage  (sim lever OFF; game ON)
bounty:   periodDays 7 · carveFraction 0.15 · chaseProbability 0.5 · rarityWeight 1.0  (default OFF)
```

Prestige and bounty are default-off **sim levers** with experiments (`npm run loop-exp`). At launch the
bounty is on (`BOUNTY_CARVE_BPS=1500`, decisions.md #11) and ascension is on (`PRESTIGE_MAX_LEVEL=5`,
decisions.md #19).

---

## 16. Smart contracts (`contracts/`)

Foundry, OpenZeppelin, Solidity 0.8.28. See `contracts/README.md` for the architecture diagram, the
trust model, and the deploy + pre-mainnet checklist.

| Contract | Responsibility |
|---|---|
| `FeeRouter` | The four-bucket ledger: split fees, hold pool/jackpot/bounty, cap every payout at balance |
| `Letters` | 52-id ERC-1155: demand-mirrored capped draws, commit/reveal, FID daily + free vouchers (free daily / free-pack airdrop), ETH swap, clamped `priceKeeper` repeg, `upgrade` |
| `Words` | One ERC-721 per word, Merkle dictionary, letter escrow, case-as-state, dissolve, prestige level |
| `Rolls` | Commit→signed-reveal upgrades; fail no-op; pity per `(beneficialOwner, letter)` |
| `Staking` | Word custody + hunger clock + snack feed; the eligibility truth read by Jackpot |
| `Prestige` | Ascension of full-UPPERCASE staked words (signed reveal, monotonic, fail no-op) |
| `AnswerChain` | Pre-committed daily-word reverse hash-chain (unsteerable jackpot answer) |
| `Jackpot` | Single keccak(word) lookup → pay the staked, fed holder or roll over |
| `YieldDistributor` / `Bounty` | Per-epoch Merkle distributors funded from the pool / bounty buckets |

**Trust seams (Phase 0, documented):** a backend `signer` decides roll/prestige outcomes (EGGS model)
and authorizes the FID daily; a `keeper` reveals the daily word, posts the yield/bounty Merkle
roots, and pays every share out (its `payout` job; anyone may, since `claim` pays the leaf's account). Both are trusted for *fairness only* — never for solvency (every payout is bucket-capped) and
never to harm an asset (failures are no-ops). A distinct `priceKeeper` hot key may auto-repeg prices
within a clamped band (solvency-irrelevant, can't cross zero). The `owner` is a single hardware-wallet
EOA — **no multisig**.

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
- **Dictionary** — the in-app word browser (every claimable word + its tier + ownership).
