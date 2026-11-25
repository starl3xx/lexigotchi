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
| `Staking` | Word custody + hunger clock + snack feed; eligibility truth for Jackpot; **caretakers** (a staker's other wallets may feed, roll, and ascend its staked Words) |
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
- **Caretakers** (`Staking.setCaretaker`, 2026-11-24; design: `docs/linked-wallets-onchain.md`) — a
  staker names its other wallets, which may then `feed`/`feedMany`, `Rolls.commitWordRoll`, and
  `Prestige.commitPrestige` its STAKED Words. The caller always pays (never the staker's allowance);
  the free snack is keyed on the staker (caretakers can't multiply it); prestige and word-roll commits
  name the staker; nothing ever moves to a caretaker, and only the staker unstakes. A caretaker is
  trusted only not to waste the staker's free snack or hold its open roll/ascension slot.

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
  burned, yield and jackpot eligibility kept. All five reviewers found it. Fixed: `lastFed` survives
  unstake and is set only on a Word's first stake since its claim (`Words.claimedAt`, so a word
  dissolved and claimed again starts fresh, while a transfer keeps the clock), so the clock keeps
  running while unstaked. (The
  first fix PAUSED the clock instead; the follow-up review showed that staking for three minutes
  around the public 00:05 UTC snapshot then never accrued hunger. `test_Staking_snapshotDodgeStillGoesHungry`.)
- **Medium** — roll pity is snapshotted at commit and reset only by a success reveal the committer
  controls, so a player could open many rolls, reveal the misses, bank the signed successes, and keep
  every later roll at the 85% cap (~35% fewer roll fees over 50 letters). Fixed: one open roll per
  `(owner, letter)` (`Rolls.rollOpen`, reverts `RollOpen`).
- **Medium** — the same pattern on ascension (`Prestige.attemptOpen`, reverts `AttemptOpen`).
- **Medium** — commits took the fee without reserving supply; at sell-out (expected around day 56)
  the last buyers' paid commits could never be revealed (no expiry, no refund). Fixed: supply is
  reserved at commit (`Letters.unreservedSupply`, reverts `SoldOut` before any fee moves).

Noted, not fixed: yield is not time-weighted, so a word staked for minutes around the keeper's
snapshot earns a full day's share. The keeper's off-chain scan could weight by staked time; there
is no onchain change to make.

Checked and dropped: the AnswerChain terminal (it is `bytes32(0)`, so rotation works); reentrancy
(every hook-bearing path writes state first under `nonReentrant`); digest cross-replay across the six
signer layouts (none collide). Noted, not a code bug: `Rolls` and `Prestige` take `msg.sender` as
owner, like every contract the deploy script creates, so ownership must move to the hardware wallet
after deploy (`transferOwnership` → `acceptOwnership`). Backend finding (outside these contracts),
fixed in PR #97: a pack's draw depends on the live supply, so one unrevealed commit could get a
second valid draw when a letter capped out. The reveal routes now keep the first draw while it
stays valid (`src/lib/onchain/stickyDraw.ts`).

### Third internal pass (2026-11-25): Prestige, the word ladder

`Prestige.sol` changed after the second pass (decisions.md #19, PR #191: a stage-N attempt pays
`prestigeFee × N`, and each commit records the stage it priced, so the signer draws at that stage's
odds). Decision #12 makes a pass due before mainnet, so this is it. **It is narrower than the
second pass:** the `solidity-auditor` skill in its file mode on `Prestige.sol` only (four vector
scanners, 170 attack vectors between them, and no adversarial reviewer), with its inherited
mixins, `Words`, `Staking`, the migration script, and the ascension reveal route as read-only
context. The local skill is version 1, while upstream is 4.1. Each finding was then checked by hand.
The roll and letter reveal routes were not in scope; the one real finding lives in the signer, and
its fix covers them too. A DEEP pass (with the adversarial reviewer) has not been run on this change.

- **Medium after any same-chain redeploy, nil at launch:** the signer's outcome draw was an HMAC of
  (chainId, namespace, commitId) under `SIGNER_DRAW_SECRET`, with no contract address. Commit ids
  restart at 0 when a contract is redeployed, and the retired contract's outcomes stay public in
  its events. So a redeployed Prestige or Rolls would repeat the old outcome for every id, and a
  redeployed Letters the old pack's letters. A contract caller (a staker, or a caretaker named on
  `Staking`) can pick its slot: `commitId = commits.length`, so it reverts unless the count is the
  one it wants. Two scanners found it. Their claim that Sepolia outcomes predict mainnet ones is
  false: the chain id was already in the hash. Fixed: every draw hashes the issuing contract's
  address (`signer.ts`, now a required, checked argument), and a pack's stored draw is keyed by
  the Letters address (`c:<letters>:<commitId>`). The daily stays keyed by identity and day.
  The test is the exploit: `tests/signer-draw.test.ts` "every draw is bound to the contract", which
  fails on the old hash. Mainnet launch is a first deploy, so there was nothing to replay there.
  On Sepolia, the deploy of this fix changes the draw for any attempt still open at that moment.
- **Low, not fixed (the owner's call):** `prestigePity` and `attemptOpen` are keyed by token, and
  `Words.dissolve` clears only the stage. A word dissolved with an attempt open, then claimed again,
  keeps that attempt and its pity. Nobody profits: in this path the stage can only fall, and pity
  only ever rises through paid misses. The open attempt doesn't block anyone, because the reveal is
  permissionless, the signer route serves any commit, and the game finishes an open attempt it
  finds on a word before charging for a new one. The game now says "Finished an earlier ascension"
  when that attempt belonged to another owner or stage, instead of announcing its outcome. Binding
  the state to `Words.claimedAt` (as `Staking` does) would close it, at the cost of a sixth commit
  field, a new ABI, and another Sepolia redeploy.
- **Low, operational:** the migration script (`DeployPrestigeLadder.s.sol`) retired the old Prestige
  as a collector only after the splits and the new deploy. A commit landing in that gap would be
  paid but never revealable once Words trusted the new contract. The Sepolia run stranded nothing:
  the old Prestige has 0 commits. The retirement is now the first transaction, Words trusts the new
  contract before it collects, and a `PRESTIGE_MAX_LEVEL` above 255 is refused instead of truncated.
  Mainnet launch uses `Deploy.s.sol`, not this script.

Checked and dropped: signature replay (the digest binds contract, chain, commit, token, owner, and
outcome, and `revealed` is set first), reentrancy (`nonReentrant`, flags written before every
external call), the stage fee's arithmetic (checked, and `level < maxLevel` at both commit and
reveal), and a stage moving between commit and reveal (one open attempt per word, and only its own
reveal can raise the stage). Noted for the operator: `params.prestige.baseByLevel` has five entries,
so raising `maxLevel` past 5 also needs a sixth stage's odds, or the signer falls back to 40%.
On Sepolia, a tester's word has climbed all five stages in 14 signed reveals: every miss raised its
pity by one, every hit reset it, and each commit recorded the stage it was paid at.

## Suggested external focus

Commit-reveal + voucher signature surface (digest layouts, replay, the KIND tags); FeeRouter
accounting + the `route()` surplus/delivered check; Words escrow + case-state; the Merkle distributors
(funded-at-open vs claimed, claim-window recovery); the lottery-compliance jackpot; and the
`RepegKeeper` clamp/cooldown math.

## Status

`forge build` clean; **89 forge tests** (2026-11-25; incl. the invariant campaign and a cross-language
AnswerChain vector — the schedule generator `scripts/generate-answer-chain.ts` and
`AnswerChain.reveal` share a verified fixture) + **857 vitest** (economy, solvency, signer draws, and the app) green. Known gaps
for the audit/launch (see `README.md` checklist): the production swap-router adapter (deferred —
$WORD-only launch), and an external invariant/fuzz campaign beyond the FeeRouter one here.
