# Phase 0 — adversarial review outcome

A 5-agent review ran against the Phase 0 build: three independent solvency skeptics (each
told to *break* the model), a spec-completeness critic, and an art-direction critic.

## Headline: the solvency core is airtight

All three skeptics — auditing from distinct lenses (ledger arithmetic, spec/routing fidelity,
sim-modeling honesty) — **failed to find a single real solvency defect.** Independently
confirmed:

- Every fee split sums to 1.0 and routes to the four buckets exactly per v0.1 §6 / v0.2.
- `payFromPool` caps each payout at the balance; daily yield can never exceed `rate × pool`.
- `payJackpot` zeroes the pot atomically; only staked, non-hungry claims win, else rollover.
- No code path lets any bucket go negative; `assertSolvent()` runs every day.
- Hunger gating is correct: peckish (1–2d) → ×0.5 yield, still jackpot-eligible; hungry (3+d)
  → 0 yield and jackpot-ineligible. Order of operations (feed → distribute → jackpot) is right.
- Yield is UPPERCASE-only; jackpot eligibility is any-case-staked-non-hungry. Both correct.
- Demand-bounded external inflow does not hide insolvency; `earned` is not double-counted;
  claim uniqueness (first claim wins) holds; supply caps are hard-enforced per ID.

**Spec-completeness critic:** no correctness bugs. All v0.2 mechanics faithfully implemented;
showcase / ETH-swap / secondary-market are intentional, documented Phase-0 scope cuts.

## What we fixed in response

1. **Secondary-market royalty was a dead faucet** (low severity, real). The 2.5% royalty →
   Rewards Pool was declared in `params.ts` but never collected, since the sim models no
   secondary market. **Fixed:** royalty now accrues each day as a macro abstraction — daily
   secondary GMV ≈ `secondaryVolumeRatio` (0.35) × the day's primary fee GMV, with its 2.5%
   routed to the pool. Full per-letter resale (which would also redistribute letters to
   low-budget players) remains a deliberate next-iteration item — see below.

2. **Art craft (9 real findings, all implemented):** stronger squash-and-stretch with
   horizontal "breathing" (the #1 rubber-hose tell — was far too subtle); a much larger
   lowercase-kid → UPPERCASE-glow-up scale/typography gap so the upgrade reads from across
   the room; exaggerated pie-cut eyes with glints and tired-pupil peckish state; deeper
   grin/frown arcs; a punchier celebrate spin; gold hatband + monocle cord on glow-ups; a
   bigger earning coin; proportional shadow; and a new **`WordChorus`** component delivering
   the spec's chorus-line choreography (lowercase shuffle vs UPPERCASE kick, with trophy).

## Known limitation carried forward

The sim still models **no per-letter secondary trading** (only the macro royalty inflow). The
casual-shut-out finding (50% of players earn ~0% because high-budget archetypes win the claim
race) is real *as modeled* but overstated: real letter liquidity + the showcase let low-budget
players monetize and complete words. Adding a lightweight letter market is the highest-value
next sim iteration, and would let us properly test casual retention (Goal #3).

## Automated review (Cursor Bugbot) — 4 rounds, 8 findings, 0 false positives

The PR was then put through Cursor Bugbot, which re-reviews on every push. It surfaced **eight
genuine issues across four rounds** — all real, none spurious — hardening the sim's fidelity
(none touched the solvency *core*, which held throughout):

| # | Finding | Sev | Fix |
|---|---|---|---|
| 1 | Partial pack charged full price | Med | Pro-rata pricing (`pack × minted/5`) |
| 2 | `wantsUppercase` flag unread | Low | Wired into roll targeting |
| 3 | `yieldRequiresUppercase` ignored | Med | Made a real lever (v0.2/v0.1 yield toggle) |
| 4 | Demand-multiple defined twice | Med | Single source (`economy.DEMAND_MULTIPLE`) |
| 5 | `prices.singlePull` / `snacksPerWordPerDay` dead | — | Removed / wired (proactive audit) |
| 6 | All-UPPERCASE claims omitted | Med | `findClaimable`/`escrowClaim` handle uniform-case claims |
| 7 | Roster size ≠ population | Low | Largest-remainder apportionment |
| 8 | Churned stakers freeze hunger; care before staking | Med/Low | Global post-turn hunger tick + feed-after-stake |

**Finding #8 was the most consequential.** Before it, churned owners' staked words stayed
frozen-as-fed and drew yield + jackpot eligibility forever. Fixing it materially corrected the
headline dynamics: **yield-eligible words 2.76k → 1.71k** (≈37% belonged to neglectful/churned
owners) and **jackpot rollovers 29% → 53%** (neglected words become jackpot-ineligible, so the
day's answer is more often held-but-hungry). The lesson for the contracts: **player churn +
hunger are first-order faucet gates**, not flavor — neglect is what keeps the jackpot escalating.
Bugbot returned a clean pass on the final commit.
