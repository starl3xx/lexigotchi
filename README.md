# Lexigotchi

> Raise your letters. Spell your words. Own the dictionary.

A tamagotchi-style collection game for the **$WORD** / _Let's Have A Word!_ ecosystem on
Base. Mint animated rubber-hose letter characters, gamble them from lowercase to UPPERCASE,
assemble letters into permanent word claims from the canonical LHAW dictionary, and stake
those words to earn $WORD — with a daily jackpot that fires when a staked word is the day's
LHAW answer.

**This repo is the Phase 0 prototype** (spec roadmap): off-chain economy sim, parameterized
solvency model, the verified letter/rarity economy, three rubber-hose characters, and a
brand lockup — built to de-risk *fun* and *solvency* before any contracts. No Solidity yet.

## What's here

| Path | What |
|---|---|
| `src/lib/dictionary.ts` | Canonical 4,438-word claimable set (deduped from the vendored LHAW list). |
| `src/lib/economy.ts` | Letter slots/odds/caps + rarity tiers, derived from the dictionary. Reproduces spec Appendix A/B. |
| `src/lib/params.ts` | Every tunable economic parameter (prices, splits, odds, pity, hunger, distribution) — v0.2 values. |
| `src/lib/sim/` | Deterministic agent-based economy simulation + the four-bucket solvency ledger. |
| `src/app/` | Next.js App Router prototype: brand hero, Characters, Lexidex, Economy dashboard. |
| `src/components/characters/Rig.tsx` | The shared rubber-hose rig (1930s noodle-limb style) driving all 52 characters. |
| `data/guess_words_clean.ts` | Vendored source-of-truth dictionary (LHAW master list v7.1.0). |
| `docs/spec/` | The product specs (v0.1 + v0.2 changelog). |
| `docs/decisions.md` | Decisions, spec corrections, and what the sim found. |
| `docs/reference/eggs/` | The live $EGGS contract (commit/reveal template) + a pattern writeup. |

## Run it

```bash
npm install
npm run dev        # the prototype app at localhost:3000
npm run sim        # print the economy/solvency report (try: -- --days 365 --population 1500)
npm run derive     # regenerate docs/economy.md from the dictionary
npm test           # 21 tests: economy reproduces the spec + solvency invariants hold
```

## Status & roadmap

Phase 0 (this repo) → Phase 1 Mint & Claim → Phase 2 Roll & Shine (+ Showcase) →
Phase 3 Stake & Snack (+ jackpot + LHAW AnswerChain) → Phase 4 Deepen. Contracts will be
**Foundry** (OZ upgradeable proxies), mirroring the EGGS commit/reveal pattern (see
`docs/reference/eggs/PATTERN.md`).

Numbers in `params.ts` are placeholders — setting them is the job of the tokenomics sim.
