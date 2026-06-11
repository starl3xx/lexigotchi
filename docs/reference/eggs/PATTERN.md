# EGGS — the commit/reveal template for Lexigotchi contracts

Reference capture of the live $EGGS game on Base, which the spec names as the architectural
template for mint + roll randomness ("identical architecture to EGGS' Commit To Level Up →
Level Up Chicken"). Pulled from the verified source on Base (Blockscout), June 2026.

- **Proxy:** `0x712f43b21cf3e1b189c27678c0f551c08c01d150` — OZ `TransparentUpgradeableProxy`
  (EIP-1967). Confirms spec's "upgradeable proxies (the EGGS pattern), multisig admin."
- **Implementation:** `0xE7095FA602D39994b1Cb1Da582f7c8139D370eb7` — contract `Eggs`, an
  upgradeable ERC-20 (Votes + Permit + FlashMint + Pausable + Burnable) that *also* carries
  the game logic. Source vendored alongside this file (`Eggs.sol`, `EggsStaking.sol`,
  `IMegapot.sol`, `Eggs.abi.json`).

## The mechanism that matters: commit + server-signed reveal

This is the single most important finding. EGGS' "randomness" is **not** blockhash/VRF
commit-reveal — it is a **commit on-chain, then a backend-signed reveal**:

```solidity
function commitToLevelUpChicken(uint256 chickenId) public nonReentrant {
  require(chickenLevels[chickenId] < 4, "...max level");
  _transfer(msg.sender, address(this), chickenLevelPrices[chickenLevels[chickenId]]); // FEE TAKEN AT COMMIT
  chickenLevelCommitments[chickenId] = true;
}

function levelUpChicken(bytes calldata data, bytes32 r, bytes32 vs) public nonReentrant {
  // verify the payload was signed by `superHen` (the trusted backend signer)
  (address recovered, ECDSA.RecoverError err,) =
    ECDSA.tryRecover(MessageHashUtils.toEthSignedMessageHash(data), r, vs);
  require(err == ECDSA.RecoverError.NoError && recovered == superHen, "...wrong hen");

  (uint256 chickenId, uint256 chickenLevel, uint256 randomNumber) =
    abi.decode(data, (uint256, uint256, uint256));
  require(chickenLevelCommitments[chickenId], "...need to commit");
  require(chickenLevels[chickenId] == chickenLevel, "...level mismatch");

  if (randomNumber == 0) {
    emit ChickenLevelSetFailed(chickenId, chickenLevels[chickenId], randomNumber); // FAIL: asset untouched
  } else {
    chickenLevels[chickenId] += 1;
    emit ChickenLevelSet(chickenId, chickenLevels[chickenId], randomNumber);       // SUCCESS
  }
  chickenLevelCommitments[chickenId] = false;
  buyMegapotTicket();
}
```

Key properties to carry into `Rolls.sol` / pack mints:

1. **Fee is taken at commit**, outcome resolved at reveal. The fee is an *upgrade fee with
   probabilistic timing*, never a wager on principal — exactly the spec's compliance stance.
2. **Failure emits an explicit event and changes nothing** (`ChickenLevelSetFailed`). The
   asset never burns/downgrades. This is the on-chain proof of the spec's hard rule.
3. **Randomness authority is a trusted signer (`superHen`)**, set by the owner. The contract
   trusts the backend to produce a fair `randomNumber`. This is the part Lexigotchi should
   *strengthen*: for the pity system we can keep the signer model, but the **jackpot** must
   not rely on a trusted signer — the spec mandates an on-chain hash-chain pre-commit
   (`AnswerChain`) so no party can steer the draw.
4. **Level/state is read at reveal and checked against the commit** — prevents replaying a
   signature against a different state. Lexigotchi rolls must bind the signed payload to the
   exact `(owner, letterId, pityStreak)` so a stale signature can't be reused.
5. **Pity must key on the WORD-OWNER address for escrowed-letter rolls — never the token
   holder.** When a letter is escrowed inside a Word, the 1155 is held by `Words.sol`, not the
   player. If `Rolls.sol` keys pity on `msg.sender`-as-1155-holder (or on the current token
   holder), every player rolling escrowed letters collapses onto the **escrow contract's
   single shared counter** — a player could pump that shared streak with cheap rolls and then
   harvest near-cap-probability upgrades on anyone's escrowed word. Key pity on the Word
   owner's address (the beneficial owner), resolved from `Words.ownerOf(tokenId)`, for both
   loose and escrowed rolls. Document this explicitly in `Rolls.sol`.

## Jackpot in EGGS (and why Lexigotchi diverges)

`drawJackpot()` selects winners with `keccak256(block.prevrandao, i) % ticketCount`. That is
fine for EGGS' raffle but **insufficient for Lexigotchi**, where the **core daily jackpot** is
gated on Lexigotchi's OWN daily word and money rides on that word not being steerable.
`Jackpot.sol` resolves a *single* lookup — does `keccak256(dailyWord)` exist, staked, not hungry?
— and the *word* comes from Lexigotchi's own pre-committed `AnswerChain` (its own daily commit
cadence, **NOT LHAW-sourced**), not from `prevrandao`. A separate **ownership-only bonus** pays
out when an LHAW round's secret word happens to be owned by a player — a soft, read-only tie-in,
never a core dependency (see decisions.md "Jackpot architecture").

## Mapping to Lexigotchi contracts (Foundry, OZ upgradeable)

| EGGS surface | Lexigotchi contract | Notes |
|---|---|---|
| `commitToLevelUpChicken` / `levelUpChicken` + `superHen` signer | `Rolls.sol` | Same commit→signed-reveal; bind payload to `(owner,letterId,pityStreak)`; pity per `(owner,letterId)` (1155s are fungible) — and `owner` = the **Word owner** for escrowed rolls, not the escrow contract that holds the 1155 (see property #5). `*Failed` event on failure. |
| pack purchase commit→reveal | `Letters.sol` | 1155, 52 ids, per-id supply caps, demand-mirrored odds; ETH→$WORD auto-swap at mint (v0.2 §4). |
| `chickenLevels` as mutable state | `Words.sol` | Case derived from escrowed letters; `tokenId = keccak256(word)`; one NFT per word. |
| `stake`/`unstake` + `EggsStaking.sol` | `Staking.sol` | UPPERCASE-only yield, hunger accounting; expose feed-state read for Jackpot. |
| `drawJackpot` + Megapot | `Jackpot.sol` + `AnswerChain` (Lexigotchi's own daily-word commit) + LHAW bonus oracle | Core daily jackpot is self-contained (own hash-chain, NO LHAW dependency — no longer Phase-3-blocked); a separate ownership-only **bonus** triggers when an LHAW round's word is owned (soft, read-only). |
| `burnFees` | fee router | Splits in storage, tunable behind multisig (v0.2). |

**Toolchain decision:** Foundry (forge) for Lexigotchi — invariant/fuzz testing is the right
tool for the solvency math, and the off-chain sim in this repo already encodes the invariants
to port into Forge `invariant_` tests.
