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
npm run contracts:test      # forge test  (21 tests)
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
| **FeeRouter** | Splits every fee into pool/jackpot/burn/treasury (tunable bps). Holds the pool/jackpot/bounty buckets; `payFrom*` caps each payout at its balance → **solvency by construction**. The bounty carve diverts a slice of the pool share zero-sum. |
| **Letters** | 52-id ERC-1155 (lowercase `i`=`i`, uppercase `i`=`26+i`). 100%-lowercase demand-mirrored draws with per-letter caps; commit→server-signed reveal (no expiry, so fees are never forfeited). Pack-of-5 + FID-gated daily single (backend-signed allowance); $WORD or ETH (auto-swap). `upgrade` (Rolls/Words only) burns a lowercase, mints its uppercase — conserving supply. |
| **Words** | One ERC-721 per dictionary word, `tokenId = keccak256(word)`; membership via Merkle proof. Escrows 5 uniform-case letters; **case is derived from the escrow, never stored**. In-place upgrade rolls; dissolve recovers letters + frees the name. |
| **Rolls** | EGGS commit→**server-signed** reveal. Failure is an explicit no-op (asset untouched). Pity per `(beneficialOwner, letter)` — resolved through staking custody so escrowed-letter pity can't be shared/pumped. |
| **Staking** | Custodial Word staking + the hunger clock (feed = snack, 100% burned). Owns the eligibility truth (staked + not-hungry) read by Jackpot. |
| **Prestige** | Ascension of full-UPPERCASE staked Words (commit→signed reveal, monotonic level, fail = no-op). |
| **AnswerChain** | Lexigotchi's own pre-committed daily-word reverse hash-chain — the jackpot word is unsteerable and needs no LHAW dependency. |
| **Jackpot** | One `keccak256(word)` lookup against the day's AnswerChain word: exists + staked + not-hungry → pay the whole pot, else roll over. Case-agnostic. |
| **YieldDistributor / Bounty** | `MerkleEpochs` distributors: the keeper posts per-epoch share roots; funds are pulled from the FeeRouter bucket at open time, so a distributor can never pay more than was funded. |

## Trust model (documented seams)

These mirror the EGGS reference (`docs/reference/eggs/PATTERN.md`) and are intentional Phase-0 choices:

- **`signer` (rolls/prestige/daily-allowance)** — a backend key decides roll/prestige outcomes (EGGS
  `superHen`) and authorizes the FID-gated daily. Trusted for *fairness*, never for solvency or for
  harming an asset (failures are no-ops). Pity binding + single-use commit ids prevent replay.
- **`keeper` (AnswerChain / Jackpot / distributors)** — reveals the daily word and posts the
  yield/bounty Merkle roots computed off-chain (the weights — UPPERCASE/tier/prestige/hunger/theme —
  are impractical to iterate on-chain). Trusted for fairness of the share split; **never for
  solvency** — every payout is capped at funds actually pulled from a bucket.
- **`owner` (multisig)** — tunes splits/prices/care/caps (spec: "storage behind admin/multisig").
- **All mint / roll / prestige randomness** uses the EGGS commit→server-signed reveal — there is no
  blockhash window, so a paid commit is always revealable and fees can't be stranded.

## Deploy

```bash
npm run derive:contracts   # writes config/economy.json (caps, weights, dictionaryRoot)
cd contracts
forge script script/Deploy.s.sol:Deploy --rpc-url $BASE_RPC --broadcast --verify
```

Required env: `WORD_TOKEN` (defaults to the live $WORD), `TREASURY` (multisig), `SIGNER`, `KEEPER`,
`ANSWERCHAIN_HEAD` (the precomputed reverse-hash-chain head). Optional: `SWAP_ROUTER`, the `*_PRICE`
/ `*_FEE` overrides (in $WORD wei, set per the current USD peg), `PECKISH_AFTER`/`HUNGRY_AFTER`,
`PRESTIGE_MAX_LEVEL`, `BOUNTY_CARVE_BPS`, `LETTERS_URI`. The script seeds the v0.2 fee-split table and
wires every collector/payer. After deploy, transfer ownership of each contract to the multisig
(`Ownable2Step`: `transferOwnership` → `acceptOwnership`).

## Pre-mainnet checklist

- [ ] Independent security audit (commit/reveal, escrow, FeeRouter accounting, Merkle distributors).
- [ ] Lottery/compliance review of the jackpot (no-purchase free entry, geo/age gating, official
      rules) — `seed.jackpot = 0`, operator never funds the prize (see `docs/pricing-review.md`).
- [ ] Multisig as `owner`/`treasury`; separate hot keys for `signer` and `keeper`.
- [ ] Production `SwapRouter` adapter over a real Uniswap v3 / aggregator route (slippage-bounded).
- [ ] Fuzz/invariant campaign on FeeRouter solvency and letter-supply conservation.
- [ ] Publish the AnswerChain head + the dictionary Merkle root for independent verification.
