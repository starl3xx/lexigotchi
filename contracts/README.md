# Lexigotchi contracts

Foundry contracts for Lexigotchi on **Base**. They implement the v0.2 spec mechanics and are the
on-chain counterpart of the off-chain economy sim (`src/lib/sim`). **Phase 0 — code-complete and
unit-tested, NOT yet audited.** See the [pre-mainnet checklist](#pre-mainnet-checklist).

## Setup & test

OpenZeppelin is resolved from the repo's `node_modules`; `forge-std` is cloned. Populate both with:

```bash
npm install                 # at the repo root (installs @openzeppelin/contracts)
npm run contracts:setup     # clones forge-std + vendors OZ into contracts/lib (gitignored)
npm run contracts:build     # forge build
npm run contracts:test      # forge test  (54 tests)
npm run derive:contracts    # regenerate config/economy.json from the canonical dictionary
```

## Architecture

The whole economy flows through one accounting hub, mirroring the sim's four-bucket ledger.

```
                fees ($WORD)                          payouts ($WORD)
  Letters ─┐                                   ┌──► YieldDistributor ─► UPPERCASE stakers
  Words  ──┤                                   │      (pulls from pool, Merkle per epoch)
  Rolls  ──┼──►  FeeRouter  ──► pool ──────────┤
  Staking ─┤    (4 buckets)     jackpot ───────┼──► Jackpot ─► daily winner (AnswerChain word)
  Prestige ┘                    bounty (carve) ┼──► Bounty ─► theme winners (Merkle per period)
                                burn → 0x…dEaD  │
                                treasury → MS   └──  (pool/jackpot/bounty can never overpay)
```

| Contract | Role |
|---|---|
| **FeeRouter** | Splits every fee into pool/jackpot/burn/treasury (tunable bps). Holds the pool/jackpot/bounty buckets; `payFrom*` caps each payout at its balance → **solvency by construction**. The bounty carve diverts a slice of the pool share zero-sum. Owner-only `seed(bucket, amount)` tops up the Pool (0) or Bounty (2) by pulling $WORD from the owner (the only non-`route` inflow); the Jackpot (1) reverts — it self-funds from fees (lottery compliance). |
| **Letters** | 52-id ERC-1155 (lowercase `i`=`i`, uppercase `i`=`26+i`). 100%-lowercase demand-mirrored draws with per-letter caps; commit→server-signed reveal (no expiry, so fees are never forfeited). Pack-of-5 + a FREE FID-gated daily single + signer-issued free vouchers (free daily / one-time free-pack airdrop); $WORD-only at launch (an ETH auto-swap path exists, deferred). Clamped `priceKeeper` repeg. EIP-2981 royalty **signal** (2.5% → treasury, unenforced). `upgrade` (Rolls/Words only) burns a lowercase, mints its uppercase — conserving supply. |
| **Words** | One ERC-721 per dictionary word, `tokenId = keccak256(word)`; membership via Merkle proof. Escrows 5 uniform-case letters; **case is derived from the escrow, never stored**. In-place upgrade rolls; dissolve recovers letters + frees the name. `tokenURI` = owner-set base + decimal id (metadata is dynamic — case lives in escrow); EIP-2981 royalty **signal** (2.5% → treasury, unenforced). |
| **Rolls** | EGGS commit→**server-signed** reveal. Failure is an explicit no-op (asset untouched). Pity per `(beneficialOwner, letter)` — resolved through staking custody so escrowed-letter pity can't be shared/pumped. |
| **Staking** | Custodial Word staking + the hunger clock (feed = snack, 100% burned). Owns the eligibility truth (staked + not-hungry) read by Jackpot. |
| **Prestige** | Ascension of full-UPPERCASE staked Words (commit→signed reveal, monotonic level, fail = no-op). |
| **AnswerChain** | Lexigotchi's own pre-committed daily-word reverse hash-chain — the jackpot word is unsteerable and needs no LHAW dependency. |
| **Jackpot** | One `keccak256(word)` lookup against the day's AnswerChain word: exists + staked + not-hungry → pay the whole pot, else roll over. Case-agnostic. |
| **YieldDistributor / Bounty** | `MerkleEpochs` distributors: the keeper posts per-epoch share roots; funds are pulled from the FeeRouter bucket at open time, so a distributor can never pay more than was funded. |

## Trust model (documented seams)

These mirror the EGGS reference (`docs/reference/eggs/PATTERN.md`) and are intentional Phase-0 choices:

- **`signer` (rolls/prestige/daily-allowance + free vouchers)** — a backend key decides roll/prestige
  outcomes (EGGS `superHen`), authorizes the FID-gated daily, and signs the FREE daily + one-time
  free-pack vouchers (zero-cost mints; the Quick-Auth/Sybil gate is off-chain). Trusted for *fairness*,
  never for solvency or for harming an asset (failures are no-ops). Pity binding, single-use commit
  ids, KIND-tagged digests, and per-FID gates (`dailyUsed` / `freePackClaimed`) prevent replay.
- **`keeper` (AnswerChain / Jackpot / distributors)** — reveals the daily word and posts the
  yield/bounty Merkle roots computed off-chain (the weights — UPPERCASE/tier/prestige/hunger/theme —
  are impractical to iterate on-chain). Trusted for fairness of the share split; **never for
  solvency** — every payout is capped at funds actually pulled from a bucket.
- **`priceKeeper` (the 5 price contracts — a DISTINCT hot key)** — an automated peg keeper that nudges
  on-chain prices within an owner-set `±maxMoveBps` band (no owner action per update). Separate from
  the resolution `keeper` (smaller blast radius). **Solvency-irrelevant** — it only scales future fee
  sizes within the clamp, never moves funds, and can never cross zero (can't start charging the free
  daily, can't zero a live price). Defaults to `address(0)` = disabled until the owner wires it.
- **`owner` (a single EOA — a hardware wallet, NO multisig)** — tunes splits/prices/care/caps and wires
  the keeper roles. Used rarely; the unclamped price setters are the owner's override over the keeper.
- **All mint / roll / prestige randomness** uses the EGGS commit→server-signed reveal — there is no
  blockhash window, so a paid commit is always revealable and fees can't be stranded.

## Deploy

```bash
npm run derive:contracts   # writes config/economy.json (caps, weights, dictionaryRoot)
cd contracts
forge script script/Deploy.s.sol:Deploy --rpc-url $BASE_RPC --broadcast --verify
```

Required env: `WORD_TOKEN` (defaults to the live $WORD), `TREASURY` (the owner wallet), `SIGNER`,
`KEEPER`, `ANSWERCHAIN_HEAD` (the precomputed reverse-hash-chain head — see below). Optional:
`SWAP_ROUTER`, the `*_PRICE` / `*_FEE` overrides (in $WORD wei, set per the current USD peg),
`PECKISH_AFTER`/`HUNGRY_AFTER`, `PRESTIGE_MAX_LEVEL`, `BOUNTY_CARVE_BPS`, `LETTERS_URI`, `WORDS_URI`,
`ROYALTY_BPS` (the EIP-2981 signal, default 250 = 2.5% → treasury; 0 = skip), `PRICE_KEEPER` (the
repeg hot key; omit = repeg disabled), `MAX_MOVE_BPS` (the repeg band, default 2000 = ±20%). The
script seeds the v0.2 fee-split table and wires every collector/payer. After deploy, transfer
ownership of each contract to the owner wallet — a hardware-wallet EOA, no multisig (`Ownable2Step`:
`transferOwnership` → `acceptOwnership`).

### The AnswerChain schedule (custody!)

`npm run answerchain:generate` (repo root) writes the full daily answer schedule to a gitignored
`*.secret.json` and prints `ANSWERCHAIN_HEAD`. Publish the head; the schedule file is **secret**
(leaking it makes every future jackpot front-runnable) and **irreplaceable** (once the chain is
live, `setHead` reverts `ChainLive` — losing the file bricks jackpot resolution with no on-chain
recovery). Back it up offline before deploying, and give the keeper service runtime access to it.
The terminal is pinned to `bytes32(0)` so an exhausted chain can be rotated with `setHead`.
`AnswerChainVector.t.sol` + `tests/answer-chain.test.ts` share a fixture that proves the
generator's encoding matches `AnswerChain.reveal` exactly.

## Pre-mainnet checklist

- [ ] Independent security audit (commit/reveal, escrow, FeeRouter accounting, Merkle distributors).
- [ ] Lottery/compliance review of the jackpot (no-purchase free entry, geo/age gating, official
      rules) — `seed.jackpot = 0`, operator never funds the prize (see `docs/pricing-review.md`).
- [ ] `owner`/`treasury` = a single hardware-wallet EOA (no multisig); separate hot keys for `signer`,
      `keeper`, and `priceKeeper`.
- [ ] Production `SwapRouter` adapter over a real Uniswap v3 / aggregator route (slippage-bounded).
- [ ] Fuzz/invariant campaign on FeeRouter solvency and letter-supply conservation.
- [ ] Publish the AnswerChain head + the dictionary Merkle root for independent verification
      (`npm run answerchain:generate`; back up the secret schedule offline — see above).
