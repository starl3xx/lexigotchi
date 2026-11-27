# Lexigotchi contracts — audit scope & readiness

Prepared for an external security audit. The suite is **code-complete, internally audited, and not yet
deployed**. Solidity 0.8.28, OpenZeppelin 5.x, Foundry. Target chain: Base (8453).

## Scope (in `contracts/src/`)

| Contract | Responsibility |
|---|---|
| `FeeRouter` | 4-bucket fee split (Pool/Jackpot/Burn/Treasury), solvency-capped payouts, **real `$WORD.burn()`** |
| `Letters` | ERC-1155 (52 ids); commit→signed-reveal mints, FID daily, **free vouchers** (free daily + one-time free-pack airdrop), ETH-swap path, `upgrade`, EIP-2981 signal |
| `Words` | ERC-721 per dictionary word, Merkle-gated claim, 5-letter escrow, case-as-state, dissolve, prestige level, base-URI `tokenURI`, EIP-2981 signal, **the first-day gate** (`gatedUntil`, `setGate`, a voucher `claim`; decisions.md #51) |
| `Rolls` | Commit→signed-reveal upgrades; fail = no-op; pity per `(beneficialOwner, letter)` |
| `Staking` | Word custody + hunger clock + snack feed; eligibility truth for Jackpot; **caretakers** (a staker's other wallets may feed, roll, and ascend its staked Words) |
| `Prestige` | Ascension of full-UPPERCASE staked words (signed reveal, monotonic, fail = no-op) |
| `AnswerChain` | Pre-committed daily-word reverse hash-chain (unsteerable jackpot answer) |
| `Jackpot` | `keccak(word)` lookup → pay the staked, fed holder atomically, else roll over |
| `YieldDistributor` / `Bounty` | `MerkleEpochs` distributors funded from the Pool / Bounty buckets |
| Mixins | `FeeCollector` (fee pulls), `RepegKeeper` (clamped + cooldown-rate-limited price keeper), `MerkleEpochs` |
| `Shop` (decisions.md #22) | Cosmetics for USDC at fixed prices; 80% to the revenue wallet, the rest swapped to $WORD and routed through ROYALTY in the same transaction (a self-only try/catch frame, so a failed swap waits for `sweep`); floor from Letters' peg; route changes behind a 2-day delay; no withdraw path |
| `adapters/UniV4UsdcWordAdapter` | The Shop's route: USDC → WETH (v3 0.05%) → $WORD (v4, Clanker's hook) in one Universal Router call; no owner, holds nothing |

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
- **`claimSigner`** (Words; the same hot key as `signer`) — vouches for a claim of a GATED word (the
  first day after a reserved set's release, decisions.md #51). Trusted for *fairness of the first
  day* only: it can hand out more vouchers than the one-per-profile the server counts, and nothing
  else. The `owner` sets gates (at most `MAX_GATE` = 7 days ahead a call, never on a claimed word)
  and already decides which words the dictionary root admits, so the gate gives the owner no power
  over unclaimed words it didn't have. Neither can reach a claimed Word, its escrow, or any $WORD.
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
   claim escrows exactly 5, each in the case the claim names (any mix, decisions.md #17); dissolve
   returns exactly those 5 + frees the name.
4. **Fail is a no-op.** A signed-but-stale roll/prestige success degrades to a no-op, never harming the
   asset or stranding the fee (no expiry on commits).
5. **Jackpot is self-funded.** `seed()` reverts on the jackpot bucket (`JackpotNotSeedable`); the chance
   pot is funded only by fee splits (lottery-compliance).
6. **Repeg is bounded.** A price moves at most `maxMoveBps` per `REPEG_COOLDOWN` window, never off/through
   zero — so a leaked `priceKeeper` can't compound a price in one tx.
7. **A jackpot word is revealed at most once.** `AnswerChain.wasRevealed` (keyed `keccak256(bytes(word))`,
   never cleared) makes `reveal` revert `AlreadyRevealed` on any repeat, in one list or a list rotated
   in after exhaustion (decisions.md #20). A repeating list stalls at that day by design; `setHead`
   stays closed mid-stream, so the stall can't become a way to rewrite future words.

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
  the Letters address (`c:<letters>:<commitId>`). The daily's draw hashes the Letters address too,
  while its stored row stays keyed by identity and day (`d:<key>:<day>`), which the X daily gate reads.
  The test is the exploit: `tests/signer-draw.test.ts` "every draw is bound to the contract", which
  fails on the old hash. Mainnet launch is a first deploy, so there was nothing to replay there.
  On Sepolia, the deploy of this fix changes the draw for whatever is unrevealed at that moment: an
  open roll or ascension, an unrevealed pack (its stored row sits under the old key, so it gets a
  second valid draw), and today's daily for anyone without a stored row. It is a testnet, so this is
  accepted, not engineered around.
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

### Fourth internal pass (2026-11-25): the Shop

`Shop.sol` and `adapters/UniV4UsdcWordAdapter.sol` are new (decisions.md #22). The `solidity-auditor`
skill ran in DEEP mode on them and the Base Sepolia mocks (`MockUSDC`, `MockUsdcWordAdapter`): four
vector scanners (170 vectors) and the adversarial reviewer, with FeeCollector, FeeRouter, and
SaleFees as read-only context. The local skill is version 1; upstream is 4.1. The adversarial
reviewer checked the adapter's Universal Router and v4 encoding against the published constants and
found no error, and the Base fork test runs the real route (`test/ShopFork.t.sol`, skipped without
`BASE_RPC_URL`: a $0.20 swap got 99.34% of the two pools' mid price).

- **Medium, fixed: a permissionless `sweep` could be sandwiched in one transaction** (two
  scanners and the adversarial reviewer). An attacker pushes the $WORD pool, calls `sweep(0)`, and
  unwinds, so the waiting USDC fills at the floor. Fixed: a sweep swaps at most `maxSweepUsdc` ($100
  by default, owner-set within $1–$1,000) and runs once a block, so one transaction can take at most
  the floor's gap on one chunk, and moving a ~$19K pool that far costs more in its own fees. Anyone
  may still sweep (the spec). The keeper passes a minimum from the live price, above the floor.
- **Medium, fixed: `sweep` was all or nothing**, so a backlog whose own price impact passed the floor's
  margin could never clear. The same chunks drain it (`test_sweep_chunksDrainABacklogTheFloorCantTakeAtOnce`).
- **Medium, fixed: `setPeg` moved the floor at once**, which made the slippage cap and the adapter
  delay moot (an owner could set a near-zero floor, then sandwich). The peg now moves only with the
  route: `proposeRoute(adapter, pegSource, pegPackUsdc)` → `acceptRoute` after `ROUTE_DELAY` (2 days),
  in public (`test_pegChangeWaitsTheDelayToo`).
- **Before a mainnet Shop: re-scan the fixes.** The route delay (`proposeRoute`/`acceptRoute`) and the
  sweep cap were written after this pass's scan, from its findings; they are tested but have not been
  scanned themselves. Run the skill again on `Shop.sol` before the mainnet deploy.
- **Before a mainnet Shop: measure the sweep-sandwich claim on a fork.** That a $100 sweep is not worth
  sandwiching (the attacker's own pool fees outweigh the gap to the floor) is argued from the pool's
  depth (~$19K) and the hook's fees, not measured. Measure it on a Base fork against the live pool
  (push the price, sweep $100, unwind) and set `maxSweepUsdc` from the result before mainnet.
- **Accepted: the floor trusts a peg with no freshness check.** The price keeper moves Letters'
  `packPrice` only on a 5% drift, so its age says nothing about its accuracy, and a stale peg can sit
  up to that much (plus the price keeper's lag) off the market. Too high, and swaps wait (safe). Too
  low, and a sandwich gets more room, bounded by the sweep chunk above and by the buyer's own price on
  a purchase. A compromised price-keeper key can lower the peg within Letters' clamp (20% per 5 minutes),
  which loosens the floor but can never change the route. The mainnet price keeper key must be set.
- **Low, not fixed: `buy` has no maximum price.** A price raise can land before a buy that rides a
  standing allowance. The app approves the exact price, so only a wallet that pre-approved more is
  exposed, and the owner sets the prices.

Checked and dropped: reentrancy through the adapter or router (one `nonReentrant` lock on every entry,
and `swapAndRoute` is self-only; tests re-enter both ways), the try/catch frame (a revert undoes the
adapter's pull and the routing together; a starved frame only defers), the measured `$WORD` delta (an
adapter that lies about its output delivers nothing and the frame reverts), permit front-running (the
allowance stands), the v3 leg's zero minimum (the v4 leg and two balance checks cover the whole route),
and the mocks' vouchers (they bind contract, chain, caller, profile, and day).

### Fifth internal pass (2026-11-26): the first-day gate in Words

`Words.sol` gained the gate (decisions.md #51): `gatedUntil`, `MAX_GATE`, `setGate`, `claimSigner`,
`setClaimSigner`, and a second `claim` that takes a voucher; the old `claim` was split into
`_checkClaim` and `_finishClaim` so both forms share one path. The `solidity-auditor` skill ran on
`Words.sol` (with `FeeCollector` and `RepegKeeper` as read-only context): four vector scanners, all
170 vectors classified. The local skill is version 1; upstream is 4.1. No adversarial reviewer this
pass (the default mode; run DEEP before mainnet, see below).

- **No finding at or above the confidence threshold (80).**
- **Below the threshold (70), handled off-chain: a voucher has no nonce.** The same wallet can
  claim the gated word, dissolve it, and claim it again with the same voucher until its deadline.
  That is one wallet and one word (`test_Gate_voucherReuseIsTheSameWalletAndWordOnly`), so nothing
  is taken on the chain. It would break the one-word-per-profile limit only if the server counted
  words HELD. It doesn't: it counts vouchers issued, and gives a slot back only when the chain's
  `Claimed` history shows the voucher expired unused (`lib/sets/voucher.ts`, `tests/set-vouchers`,
  `scripts/sets-db-check.ts`). A nonce in the contract would cost a storage write on every gated
  claim to enforce what the count already holds.
- **Checked and dropped:** a gate bypass (both `claim` forms run `_checkClaim`, and `_finishClaim`
  is the only mint path; the token id is the keccak of the same bytes the Merkle leaf and the A–Z
  check use); cross-contract and cross-chain replay (the digest names this contract, the chain id,
  and a kind tag: `test_Gate_noOtherVoucherPassesForOne`, `test_Gate_voucherIsForThisChainOnly`);
  a mempool copy (the digest names the caller); signature malleability and a zero signer (OZ
  `ECDSA.recover`; the signer is never zero); reentrancy (one `nonReentrant` lock on both claims
  and `dissolve`, the escrow written before `_safeMint`); the check order (unchanged for an
  ungated word: `test_Gate_ungatedClaimIsUnchanged` sends the old selector by raw call); `setGate`
  with duplicate ids, on a claimed word, or past the cap.
- **Operational, not a code bug: the order of a release.** `setGate` must land BEFORE the
  `setDictionaryRoot` that releases the words, or there is a moment when one is claimable without
  its gate. The release builder emits them in that order as one batch
  (`test_Gate_releaseSetsTheGateBeforeTheRoot`; `lib/sets/server.ts` `planRelease`), and leaves
  out any word somebody already holds, since `setGate` reverts on one.
- **Seen by two scanners, older than this change, not fixed:** `dissolve(tokenId, word_)` emits the
  caller's `word_` in `Dissolved` without checking it against `tokenId`. An owner can log a wrong
  label for their own token. Nothing in the app reads that string (it keys on the indexed
  `tokenId`). A one-line check would close it, and Words is redeployed for the gate anyway: the
  owner's call.
- **Before mainnet:** run the skill in DEEP mode (the adversarial reviewer) on the final
  `Words.sol`, with the current skill version.

### Sixth internal pass (2026-11-27): the owner's metadata refresh in Words

`Words.sol` gained `refreshMetadata(uint256[])` and `refreshAllMetadata()` (decisions.md #53; the
owner, 2026-11-27: "Metadata refresh function"), and the event `BatchMetadataUpdate`. Both are
owner-only and only emit ERC-4906 events: they read and write no storage and touch no token. The
`solidity-auditor` skill ran on `Words.sol` again: four vector scanners, all 170 vectors
classified. The local skill is still version 1 (upstream 4.1), and this was the default mode.

- **No finding at or above the confidence threshold (80), and none in the new functions.** The
  scanners checked them for access control (`onlyOwner` on both), an unbounded loop (the owner's
  own calldata bounds it: self-inflicted at worst), and duplicate ids (an event twice, nothing
  else).
- **Below the threshold (70), the same finding as the fifth pass, still not fixed:**
  `dissolve(tokenId, word_)` logs the caller's `word_` without checking it against `tokenId`. The
  owner was asked on 2026-11-27 and did not choose the one-line check. Nothing in the app reads
  that string.
- **Tests:** `test_MetadataRefresh_emitsForEachWordAndChangesNothing` (one event per id in order,
  no other event, no state moved, an empty list is quiet, a holder can't send it) and
  `test_MetadataRefresh_allWordsAtOnce`. `forge test`: 154 pass. Words is 15,337 bytes.
- **Before mainnet:** unchanged. Run the skill in DEEP mode on the final `Words.sol`, with the
  current skill version.

### Seventh internal pass (2026-11-27): the claim fee by rarity in Words

`Words.sol` charges a claim by the word's tier (decisions.md #60): each dictionary leaf is
(word, tier) (`keccak256(bytes.concat(keccak256(abi.encode(word, tier))))`, OZ leaf types
`["string","uint8"]`), both `claim` overloads take the tier, `claimFee(tier)` = `claimPrice ×
tierMultiplierBps[tier] / 10,000`, `setTierMultiplier` (owner, 1× to 20×, `TierMultiplierSet`), and
`ClaimFeePaid(tokenId, payer, tier, fee)` beside an unchanged `Claimed`. The `solidity-auditor`
skill ran on `Words.sol` in filename mode, focused on this diff: four vector scanners, all 170
vectors classified. The local skill is still version 1 (upstream 4.1).

- **No finding at or above the confidence threshold (80).** The scanners traced the tier through
  both overloads (a wrong or out-of-range tier fails before any transfer: `BadTier`, then the
  proof), the leaf encoding (a double hash of `abi.encode`, so an inner node can't pass as a leaf),
  reentrancy around the fee and the mint (one `nonReentrant` lock, escrow written before
  `_safeMint`), the multiplier bounds and casts, and rounding (`claimFee` multiplies first; the
  floor loses under one wei and favors the claimer).
- **Below the threshold (55), accepted, not fixed:** neither `claim` takes a maximum fee, so a
  price-keeper repeg (clamped, once per 5 minutes) or an owner `setTierMultiplier` / `setClaimPrice`
  that lands first raises what an already-signed claim pays, up to the claimer's allowance. Every
  mover is privileged, the base had the same property before, and the app keeps max $WORD
  approvals by the owner's ruling (decisions.md #14). The ladder makes a base move up to 8× larger
  in $WORD for a Mythic word.
- **Noted by two scanners, handled off chain:** the contract can't check that the root holds each
  word once; a root with a word under two tiers would let a claimer pick the cheaper leaf. The
  tree builder (`lib/onchain/dictionaryTree`) throws on a duplicate word, and every root is built
  there.
- **The fifth pass's note stands:** `dissolve(tokenId, word_)` still logs an unchecked `word_`.
- **Tests:** `test_ClaimFee_*` (each tier's fee and event, a wrong tier fails the proof, the
  multiplier and the base both move the fee, the bounds and owner-only, the constructor refuses a
  bad ladder, a repeg scales every tier, a gated claim pays the tier's fee, dissolve and re-claim
  pays it again, the split is unchanged), with a tree built by `@openzeppelin/merkle-tree` in
  TypeScript as their fixture, so the leaf can't drift from the app's. `forge test`: 162 pass.
  Words is 16,214 bytes (the limit is 24,576).
- **Before mainnet:** unchanged. Run the skill in DEEP mode on the final `Words.sol`, with the
  current skill version.

## Suggested external focus

Commit-reveal + voucher signature surface (digest layouts, replay, the KIND tags); FeeRouter
accounting + the `route()` surplus/delivered check; Words escrow + case-state; the Merkle distributors
(funded-at-open vs claimed, claim-window recovery); the lottery-compliance jackpot; and the
`RepegKeeper` clamp/cooldown math.

## Status

`forge build` clean; **153 forge tests** (2026-11-26, with the gate's 10 and the Shop's 49 and its 4 fork tests; incl. the invariant campaign and a cross-language
AnswerChain vector — the schedule generator `scripts/generate-answer-chain.ts` and
`AnswerChain.reveal` share a verified fixture) + **857 vitest** (economy, solvency, signer draws, and the app) green. Known gaps
for the audit/launch (see `README.md` checklist): the production swap-router adapter (deferred —
$WORD-only launch), and an external invariant/fuzz campaign beyond the FeeRouter one here.
