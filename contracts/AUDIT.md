# Lexigotchi contracts — audit scope & readiness

Prepared for an external security audit. The suite is **code-complete, internally audited, and not yet
deployed**. Solidity 0.8.28, OpenZeppelin 5.x, Foundry. Target chain: Base (8453).

## Scope (in `contracts/src/`)

| Contract | Responsibility |
|---|---|
| `FeeRouter` | 4-bucket fee split (Pool/Jackpot/Burn/Treasury), solvency-capped payouts, **real `$WORD.burn()`** |
| `Letters` | ERC-1155 (52 ids); commit→signed-reveal mints, FID daily, **free vouchers** (free daily + one-time free-pack airdrop), ETH-swap path, `upgrade`, EIP-2981 signal |
| `Words` | ERC-721 per dictionary word, Merkle-gated claim, 5-letter escrow, case-as-state, dissolve, prestige level, base-URI `tokenURI`, EIP-2981 signal |
| `Rolls` | Commit→signed-reveal upgrades; fail = no-op; pity per `(beneficialOwner, letter)` |
| `Staking` | Word custody + hunger clock + snack feed; eligibility truth for Jackpot |
| `Prestige` | Ascension of full-UPPERCASE staked words (signed reveal, monotonic, fail = no-op) |
| `AnswerChain` | Pre-committed daily-word reverse hash-chain (unsteerable jackpot answer) |
| `Jackpot` | `keccak(word)` lookup → pay the staked, fed holder atomically, else roll over |
| `YieldDistributor` / `Bounty` | `MerkleEpochs` distributors funded from the Pool / Bounty buckets |
| Mixins | `FeeCollector` (fee pulls), `RepegKeeper` (clamped + cooldown-rate-limited price keeper), `MerkleEpochs` |

`$WORD` is an already-live ERC20Burnable (`ClankerToken`, `0x304e…fb4b`) — **out of scope**, but the
suite depends on its `burn()` + `transferFrom` semantics.

## Trust model (intentional Phase-0 seams — NOT bugs)

- **`owner`** — a single hardware-wallet EOA (no multisig). Tunes splits/prices/care/caps and wires the
  keeper roles. Fully trusted; can re-point payers, treasury, signer, etc.
- **`signer`** (hot key) — decides roll/prestige outcomes (EGGS `superHen`), authorizes the FID daily,
  and signs the free-daily / free-pack vouchers. Trusted for *fairness*, never for solvency (every
  payout is bucket-capped) or for harming an asset (failures are no-ops). Replay-bound by single-use
  commit ids, KIND-tagged digests, per-FID gates (`dailyUsed`, `freePackClaimed`), and now the UTC day.
- **`keeper`** (hot key) — reveals the daily word, posts the yield/bounty Merkle roots. Trusted for
  fairness of the split; never for solvency (payouts capped at funded).
- **`priceKeeper`** (distinct hot key) — auto-repegs prices within an `onlyPriceKeeper` clamp + a
  hardcoded per-contract cooldown. Solvency-irrelevant; can't cross zero; default-disabled.

## Core invariants (the audit should try to break these)

1. **Solvency.** `balanceOf(FeeRouter) >= poolBalance + jackpotBalance + bountyBalance` always. Every
   `payFrom*` is capped at its bucket balance. *(Fuzzed: `FeeRouterInvariant`, ~128k calls, 0 reverts.)*
2. **Letter-supply conservation.** Reveal mints never exceed `cap[idx]` (`mintedEver`); `upgrade` burns
   one lowercase + mints one uppercase (net per-letter supply conserved); free vouchers consume cap
   like paid mints.
3. **One word = one NFT.** `tokenId = keccak256(word)`; case derived from escrow, never stored wrong;
   claim escrows exactly 5 of uniform case; dissolve returns exactly those 5 + frees the name.
4. **Fail is a no-op.** A signed-but-stale roll/prestige success degrades to a no-op, never harming the
   asset or stranding the fee (no expiry on commits).
5. **Jackpot is self-funded.** `seed()` reverts on the jackpot bucket (`JackpotNotSeedable`); the chance
   pot is funded only by fee splits (lottery-compliance).
6. **Repeg is bounded.** A price moves at most `maxMoveBps` per `REPEG_COOLDOWN` window, never off/through
   zero — so a leaked `priceKeeper` can't compound a price in one tx.

## Internal audit (already done)

A 24-agent adversarial audit (8 security dimensions × find-then-refute) ran against this suite. 16
candidate findings → **2 confirmed**, both fixed; the other 14 were documented trust-seam or
non-exploitable. Confirmed + remediated:
- **Medium** — `RepegKeeper` clamp was per-call only; a leaked keeper could loop it in one tx. Fixed
  with a hardcoded per-contract cooldown + `maxMoveBps ≤ 100%` cap (PR #43).
- **Low** — daily voucher bound `deadline` but not the UTC day → cross-midnight replay. Fixed by
  binding the day into the digest (PR #42).
Plus: the burn share is now a real `$WORD.burn()` (PR #44), not a soft transfer to a dead address.

### Second internal audit (2026-11-21), the pre-mainnet pass

There will be no external audit and no legal review (starl3xx, 2026-11-21, verbatim: "there won't be
a security audit (you can find skills to look at this) or lawyer convo"). This pass is the
replacement: the `solidity-auditor` skill in DEEP mode, four vector scanners (170 attack vectors
between them) plus one adversarial reviewer that also read the signer routes, each finding then
checked by hand against the code. Four confirmed, all fixed with a test that is the exploit:
- **High** — unstake + restake set `lastFed = now`, so a hungry Word was "fed" for gas: no snack
  burned, yield and jackpot eligibility kept. All five reviewers found it. Fixed: the hunger clock
  pauses while unstaked and resumes on restake (`Staking.unfedCarry`).
- **Medium** — roll pity is snapshotted at commit and reset only by a success reveal the committer
  controls, so a player could open many rolls, reveal the misses, bank the signed successes, and keep
  every later roll at the 85% cap (~35% fewer roll fees over 50 letters). Fixed: one open roll per
  `(owner, letter)` (`Rolls.rollOpen`, reverts `RollOpen`).
- **Medium** — the same pattern on ascension (`Prestige.attemptOpen`, reverts `AttemptOpen`).
- **Medium** — commits took the fee without reserving supply; at sell-out (expected around day 56)
  the last buyers' paid commits could never be revealed (no expiry, no refund). Fixed: supply is
  reserved at commit (`Letters.unreservedSupply`, reverts `SoldOut` before any fee moves).

Checked and dropped: the AnswerChain terminal (it is `bytes32(0)`, so rotation works); reentrancy
(every hook-bearing path writes state first under `nonReentrant`); digest cross-replay across the six
signer layouts (none collide). Noted, not a code bug: `Rolls` and `Prestige` take `msg.sender` as
owner, like every contract the deploy script creates, so ownership must move to the hardware wallet
after deploy (`transferOwnership` → `acceptOwnership`). Backend follow-up (not in these contracts): a
pack's draw depends on the live supply, so one unrevealed commit can get a second valid draw when a
letter caps out; the reveal routes should keep the first draw while it stays valid.

## Suggested external focus

Commit-reveal + voucher signature surface (digest layouts, replay, the KIND tags); FeeRouter
accounting + the `route()` surplus/delivered check; Words escrow + case-state; the Merkle distributors
(funded-at-open vs claimed, claim-window recovery); the lottery-compliance jackpot; and the
`RepegKeeper` clamp/cooldown math.

## Status

`forge build` clean; **62 forge tests** (incl. the invariant campaign and a cross-language
AnswerChain vector — the schedule generator `scripts/generate-answer-chain.ts` and
`AnswerChain.reveal` share a verified fixture) + **84 vitest** (economy/solvency) green. Known gaps
for the audit/launch (see `README.md` checklist): the production swap-router adapter (deferred —
$WORD-only launch), and an external invariant/fuzz campaign beyond the FeeRouter one here.
