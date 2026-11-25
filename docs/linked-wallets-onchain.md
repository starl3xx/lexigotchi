# Linked wallets onchain: letting a player's wallets act for each other

Status: design only. Nothing in the repository was changed. The diffs below were applied and tested in a scratch copy of `contracts/` only.

Date: 2026-11-24. Contracts read at the state of `contracts/src` on that date (the Base Sepolia rehearsal code; mainnet is not deployed).

## Summary

- The contracts act on `msg.sender`. The offchain account (`wallet_links`) gives no onchain power.
- Most of the goal needs **no contract change**. The holding wallet grants its sibling wallet the standard token approvals once (`setApprovalForAll` on Letters and Words, `approve` on $WORD). After that, the acting wallet can "pull then act": in one batch, it moves what it needs into itself, then runs the game action.
- One gap needs a contract change: **staked Words**. Only the wallet that staked a Word can feed it, roll its letters, ascend it, or unstake it (Staking.sol:83, Staking.sol:91, Rolls.sol:104, Prestige.sol:84). Approvals cannot help, because Staking holds the Word. Feeding is daily, so this is the main gap.
- **Recommendation:** add a "caretaker" list to Staking. A staker names a caretaker wallet. A caretaker can feed, roll, and ascend that staker's staked Words. It pays with its own $WORD and never receives a Word. The free snack moves from "per caller" to "per staker", so caretakers cannot multiply it.
- **Size:** diff A is 47 added and 12 removed lines in 4 files (Staking, IStaking, Rolls, Prestige). Optional diff B, which lets a caretaker unstake (always back to the staker), is 8 added and 3 removed lines in Staking.
- **Proof:** in a scratch copy, diff A plus 14 new tests gives 79 passing tests (65 existing + 14 new). With diff B, 80 pass. Seven deliberate mutations of the guards are each caught by at least one new test.
- **Timing:** the change must land before the mainnet deploy. Staking, Rolls, Prestige, and Jackpot redeploy (Jackpot holds Staking as an immutable). Mainnet has nothing deployed, so there is no migration. `script/Deploy.s.sol` needs no edit, because no constructor changes.
- **Top risks:** (1) the token approvals between wallets give each wallet full spending power over the other's approved assets, so one compromised wallet loses the account's letters, held Words, and approved $WORD; (2) the Farcaster wallet runs batches one call at a time, not as one unit, so "pull then act" can stop halfway (safe, but the client must expect it); (3) diff B, if taken, ends the rule that a staked Word is safe from every wallet but its staker.

## Terms

- **Holding wallet:** the wallet that holds a letter, a Word, or $WORD.
- **Acting wallet:** the wallet that is connected now and sends the transaction (`msg.sender`).
- **Staker:** the wallet that staked a Word (`Staking.stakerOf`). Jackpot, Rolls, and Prestige call it the beneficial owner.
- **Caretaker:** a wallet that a staker names in Staking (proposed `setCaretaker`). It may feed, roll, and ascend the staker's staked Words.
- **Pull then act:** one batch from the acting wallet. The first calls move what the action needs from the holding wallet into the acting wallet. The last call is the game action.
- **F and W:** the running example. F is the Farcaster in-app wallet, which works only inside Farcaster. W is the web wallet, which works only on the website. Both are in one account.

## 1. Inventory

Every check of `msg.sender`, owner, staker, or beneficial owner, and every fee collection, in `contracts/src` (interfaces, mocks, and tests excluded). The inherited OpenZeppelin checks that matter are at the end. "Acting wallet W" means a wallet that is not the holder or the staker.

### 1.1 Player paths

| Contract | Function | Check or collection | file:line | What W acting would break or need |
|---|---|---|---|---|
| Letters | `commitPack` | `_collect(msg.sender, packPrice, PACK_MINT)`; the commit's buyer is `msg.sender` | Letters.sol:129-130 | Nothing breaks. W pays from its own $WORD (it can pull $WORD first). The letters land in W at reveal. |
| Letters | `commitPackETH` | ETH from `msg.sender`; refund `word.safeTransfer(msg.sender, refund)`; buyer is `msg.sender` | Letters.sol:145-150 | Nothing breaks. ETH and the refund are W's. |
| Letters | `commitDaily`, `commitDailyETH` | `_verifyDaily` digest binds `msg.sender`; `dailyUsed[fid]`; `_collect(msg.sender, dailyPrice, DAILY_MINT)` or the ETH refund; buyer is `msg.sender` | Letters.sol:162-165, 175-182, 191, 194-195 | Nothing breaks. The server signs the voucher for the wallet that asks. One per FID per UTC day stays onchain. One per player stays a server rule. |
| Letters | `commitDailyFree` | digest binds `msg.sender` with `KIND_FREE_DAILY`; `dailyUsed[fid]`; buyer is `msg.sender` | Letters.sol:210-212, 234, 237-238 | Same as the paid daily. |
| Letters | `commitPackFree` | digest binds `msg.sender` with `KIND_FREE_PACK`; `freePackClaimed[fid]`; buyer is `msg.sender` | Letters.sol:223-225, 245, 248-249 | Same as the paid daily. |
| Letters | `reveal` | Anyone may send it. The digest binds `c.buyer`; `_mint(c.buyer, …)` | Letters.sol:263-264, 275 | Nothing breaks. Letters always go to the committer. |
| Words | `claim` | `letters.safeBatchTransferFrom(msg.sender, this, …)`; `_collect(msg.sender, claimPrice, CLAIM)`; `_safeMint(msg.sender, …)` | Words.sol:117, 118, 122 | Blocks spending another wallet's letters. W must hold the five letters, so it pulls them first (needs the holder's Letters approval). W pays the fee. The Word lands in W. |
| Words | `dissolve` | `_ownerOf(tokenId) != msg.sender` reverts `NotOwner`; letters go to `msg.sender` | Words.sol:133, 148 | W must own the Word, so it pulls it first (needs the holder's Words approval). The letters land in W. |
| Staking | `stake` | `words.safeTransferFrom(msg.sender, this, id)`; `stakerOf = msg.sender` | Staking.sol:67-68 | W must own the Word (pull first). W becomes the staker. The hunger clock keeps running (Staking.sol:78). |
| Staking | `unstake` | `stakerOf != msg.sender` reverts `NotStaker`; the Word goes to `msg.sender` | Staking.sol:83, 85-86 | **Blocks** W. Only diff B changes it, and then the Word must still go to the staker. |
| Staking | `feed`, `feedMany` | `NotStaked`; `stakerOf != msg.sender` reverts `NotStaker`; free snack keyed `freeSnackDayPlusOne[msg.sender]`; `_collect(msg.sender, snackPrice, SNACK)` | Staking.sol:90, 91, 94-95, 97, 103-107 | **Blocks** W. This is the main daily gap. A change must also re-key the free snack, or every extra wallet brings its own free snack. |
| Staking | `beneficialOwner` (view) | returns `stakerOf[tokenId]` | Staking.sol:112-114 | Read by Jackpot, Rolls, and Prestige. It stays the staker under every option. |
| Rolls | `commitLooseRoll` | `letters.balanceOf(msg.sender, li) == 0` reverts `NoSuchLetter`; `_collect(msg.sender, rollPrice, ROLL)`; the commit's owner (pity and open-roll key) is `msg.sender` | Rolls.sol:96-98 | W must hold the letter (pull first). Pity is per wallet, so a pulled letter rolls on W's own streak, not the holder's. |
| Rolls | `commitWordRoll` | `msg.sender != beneficialOwnerOf(tokenId)` reverts `NotBeneficialOwner`; `_collect(msg.sender, …)`; the commit's owner is the beneficial owner | Rolls.sol:103-104, 107-108 | **Blocks** W for a staked Word. For a held Word, W can pull it first. The fee and the pity key are already right for a caretaker (the caller pays; pity stays on the owner). |
| Rolls | `reveal` | Anyone may send it. The digest binds `c.owner`; a loose roll re-checks `letters.balanceOf(c.owner, li) > 0` | Rolls.sol:144-147, 155-160, 163 | A pull that takes a letter away from an open loose roll turns its signed success into a no-op, and the fee is spent. The client must never pull such a letter (test `test_LinkedWallet_pullUnderAnOpenRollVoidsTheSuccess`). |
| Rolls | `beneficialOwnerOf` (view) | `words.ownerOf`, then `staking.beneficialOwner` when Staking holds it | Rolls.sol:188-194 | Unchanged. |
| Prestige | `commitPrestige` | `staking.beneficialOwner(tokenId) != msg.sender` reverts `NotBeneficialOwner`; two `_collect(msg.sender, …)` (fee and snack); the commit's owner is `msg.sender` | Prestige.sol:84, 90-91, 95-96 | **Blocks** W. A change must store the staker as the commit's owner, because reveal re-checks it (next row). |
| Prestige | `reveal` | digest binds `c.owner`; it ascends only if `staking.beneficialOwner(c.tokenId) == c.owner` | Prestige.sol:105-106, 116-117 | The trap: if a caretaker's commit named the caretaker, every signed success would become a paid no-op. |
| Jackpot | `resolve` | `msg.sender != keeper` reverts; pays `staking.beneficialOwner(tokenId)` | Jackpot.sol:67, 78-79 | Keeper only. The pot always goes to the staker. Feeding by a caretaker keeps the Word eligible (test `test_Caretaker_feedingKeepsTheJackpotWithTheStaker`). |
| MerkleEpochs (YieldDistributor, Bounty) | `claim` | Anyone may send it. It pays the leaf's baked-in `account` | MerkleEpochs.sol:87-101 (leaf 94, transfer 100) | Nothing breaks. Any wallet can send the claim, and the money goes to the account in the leaf: the beneficial owner at the keeper's scan. The app already claims for every wallet in the bag (actions.ts:299-307). |
| FeeCollector | `_collect` | `word.safeTransferFrom(payer, feeRouter, amount)` | FeeCollector.sol:27-32 | Every fee. Every caller passes `msg.sender` as the payer. Players hold standing max allowances to the five collectors (allowances.ts:27-35), so no change may ever pass a payer other than `msg.sender`. |
| FeeCollector | `_routeHeld` | routes $WORD the contract already holds (ETH swap output) | FeeCollector.sol:35-40 | ETH paths only. |

### 1.2 Game-contract, keeper, and owner checks

| Contract | Function | Check | file:line | Effect of the change |
|---|---|---|---|---|
| Letters | `upgrade` | `isUpgrader[msg.sender]`; burns and mints on `holder` | Letters.sol:284-288 | A redeployed Rolls must be set as an upgrader (Deploy.s.sol:120). |
| Words | `applyUpgrade` | `msg.sender != rolls` | Words.sol:162 | A redeployed Rolls must be set with `Words.setRolls` (Deploy.s.sol:132). |
| Words | `bumpPrestige` | `msg.sender != prestige` | Words.sol:175 | A redeployed Prestige must be set with `Words.setPrestige` (Deploy.s.sol:133). |
| FeeRouter | `route` | `isCollector[msg.sender]`; the delivered-fee check | FeeRouter.sol:94, 99 | Each redeployed collector must be added (Deploy.s.sol:113-115). |
| FeeRouter | `payFromPool`, `payFromJackpot`, `payFromBounty` | `msg.sender` must be the payer for that bucket | FeeRouter.sol:125, 133, 141 | A redeployed Jackpot must become `jackpotPayer` (Deploy.s.sol:116). |
| FeeRouter | `seed` | `onlyOwner`; pulls from `msg.sender` | FeeRouter.sol:158, 161 | Unaffected. |
| AnswerChain | `reveal` | `onlyKeeper` (the keeper is Jackpot) | AnswerChain.sol:44-46, 50 | A redeployed Jackpot must become the keeper (Deploy.s.sol:138). |
| MerkleEpochs | `openEpoch`; `recoverUnclaimed`, `setKeeper`, `setClaimWindow` | keeper; `onlyOwner` | MerkleEpochs.sol:71, 107, 118, 125 | Unaffected. |
| RepegKeeper (mixin) | every `repeg*` | `onlyPriceKeeper` | RepegKeeper.sol:41-44; Letters.sol:361; Words.sol:254; Staking.sol:153; Rolls.sol:234; Prestige.sol:152 | Each redeployed price contract needs `setMaxMoveBps` and `setPriceKeeper` again (Deploy.s.sol:143-154). |
| All owned contracts | every setter | `onlyOwner` | Letters.sol:308-346, 375-381; Words.sol:217-249, 263-269; Staking.sol:137-147, 162-168; Rolls.sol:215-229, 243-249; Prestige.sol:135-146, 169-175; FeeRouter.sol:170-200; Jackpot.sol:87; AnswerChain.sol:62, 68 | Unaffected. |
| Rolls, Prestige | constructor | `Ownable(msg.sender)` | Rolls.sol:85; Prestige.sol:73 | After any redeploy the deployer owns them, and ownership must move to the hardware wallet (contracts/AUDIT.md notes this). |
| Ownable2Step (inherited) | `acceptOwnership` | `pendingOwner() != sender` reverts | lib/openzeppelin-contracts/access/Ownable2Step.sol:60-62 | Unaffected. |

### 1.3 Inherited token checks (OpenZeppelin 5.6.1)

| Contract | Function | Check | file:line | Why it matters |
|---|---|---|---|---|
| ERC1155 (Letters) | `safeTransferFrom`, `safeBatchTransferFrom` | `_checkAuthorized(_msgSender(), from)`: the owner, or an operator with `isApprovedForAll` | lib/openzeppelin-contracts/token/ERC1155/ERC1155.sol:99-121 | This is what makes a pull possible: after F calls `setApprovalForAll(W, true)`, W may move F's letters. `Words.claim` and the Seaport letter swaps rely on the same check. |
| ERC721 (Words) | `transferFrom`, `safeTransferFrom` | `_checkAuthorized`, then `_isAuthorized`: the owner, `isApprovedForAll`, or `getApproved` | lib/openzeppelin-contracts/token/ERC721/ERC721.sol:115-135, 164-186 | The same for held Words. `Staking.stake` relies on it. It does not reach a staked Word, because Staking is then the owner. |
| ERC20 ($WORD test mock) | `transferFrom` | `_spendAllowance(from, spender, value)` | lib/openzeppelin-contracts/token/ERC20/ERC20.sol:142-144 | An allowance from F to W lets W pull F's $WORD. The live token (ClankerToken) is out of scope here, as in contracts/AUDIT.md:21-22. |

## 2. Options

### 2.0 Baseline: the game wallet and Move (already in the app, no contract change)

The app now has a "game wallet": the one wallet where the player keeps everything (src/lib/db/gameWallet.ts:1-8; src/lib/profile/gameWalletAdvice.ts:1-18). "Move here" sends a wallet's loose letters, held Words, and, if the player asks, its $WORD to another wallet in the account (src/lib/onchain/move.ts:1-14).

What it leaves unsolved:
- Move must be sent by the holding wallet (move.ts:6-8). Inside Farcaster, only F is available. So the player cannot bring W's things into Farcaster from inside Farcaster.
- Inside Farcaster the wallet cannot be switched (gameWalletAdvice.ts:13-15). There the player can use only what F holds. To use W's things in Farcaster, the player must first Move them to F from the web, and then Move them back to play on the web. Every switch of place costs a Move.
- Staked Words stay with their staker. Only that wallet can feed them (gameWalletAdvice.ts:25; docs-site/profile.mdx:66). A Word staked from F goes hungry on days the player plays only on the web.

So the baseline fails the goal. The recommended change closes exactly these gaps.

### 2.1 Comparison

| Option | Contract diff | Client work | Security cost | UX | Verdict |
|---|---|---|---|---|---|
| (a) Standard approvals between the player's own wallets, plus a small Staking change for staked Words | Spending: none. Staked Words: diff A (+47/-12 lines, 4 files); optional diff B (+8/-3) | Grant screens in each wallet's own place; a pull planner; batch handling for wallets that are not atomic; verb gating; commit lookups by owner; revoke prompts on unlink | A compromised wallet can take whatever the other wallet approved to it. The caretaker list alone lets nothing be taken. | One-time grants per wallet pair (up to 3 approvals, plus one `setCaretaker` per staking wallet). Then both places play fully. Wallet security scanners may warn about approvals to a personal wallet. | **Recommended**, with the caretaker list (variant a2) |
| (a1) Same, but Staking trusts `Words.isApprovedForAll(staker, caller)` instead of a caretaker list | About 6 changed lines, no new storage or setter | Same as (a) | Every Words operator (a marketplace conduit, a phished approval) gets the staked-Word rights. With unstake included, staked Words lose their protection from approvals. | One grant fewer | Rejected: the rights leak beyond the player's wallets |
| (b) Onchain account registry contract | New contract (estimate 60 to 100 lines) plus account lookups in Words, Rolls, Staking, and Prestige; full redeploy, because Words is an immutable in Rolls, Staking, Prestige, and Jackpot | Mirror every database link onchain; each joining wallet must send a transaction; keep the two in step | A new root of trust. A wrong link or a registry bug gives one wallet everything the game contracts can reach in every linked wallet, including all $WORD through the standing max allowances. | Best after setup: no pulls, one-step actions | Rejected: largest diff, no external audit |
| (b') The existing Delegate Registry v2 (delegate.xyz) | About the size of diff A, but each check calls an external contract | A delegation screen that calls the registry | A wallet-wide delegation with empty rights passes every contract check and every rights value (verified in the registry source). A player's old, unrelated delegation (for example, for airdrop claims) would silently grant game rights. | Players may already know the tool | Compared, not recommended |
| (c) EIP-7702 or smart-account delegation | None | Not possible for the Farcaster wallet from the app | The delegate code controls the whole account: every asset, game or not, and its ETH | Depends on each wallet maker | Not available |
| (d) A recipient parameter on mints | Letters and Words (both hold assets and are immutables everywhere): full redeploy | Small | Low by itself, but a recipient that cannot accept ERC-1155 makes a paid commit's reveal revert forever | Outputs can land in the right wallet, but no wallet can spend another wallet's things, and feeding is not helped | Rejected: does not meet the goal |

### 2.2 Notes on each option

**(a) Approvals plus pull then act.** Each holding wallet signs three standard approvals to its sibling, once, in its own place (F inside Farcaster, W on the web): `Letters.setApprovalForAll(other, true)`, `Words.setApprovalForAll(other, true)`, and `$WORD.approve(other, amount)`. After that, every spending action works with today's contracts: the acting wallet pulls the needed letters, Word, or $WORD into itself, then acts. The scratch test `test_LinkedWallet_pullLettersAndWordThenClaim` runs this for a claim against unchanged Words and Letters code. Staked Words are the exception, because Staking holds them, so approvals do not reach them. Diff A adds the caretaker list for them.

**(a1) Reusing Words operator approval.** This is the smallest possible contract change, but it gives the staked-Word rights to every operator of the staker's Words. Honest marketplace conduits only run signed orders and cannot call Staking, so the practical exposure is a phished approval. For feeding alone that is harmless. With unstake, a phished Words approval would reach staked Words, which today are out of its reach. The scratch run checked this choice: swapping the caretaker check for `words.isApprovedForAll` makes 6 of the new tests fail (mutation 4 in section 3.5).

**(b) Registry.** It would key everything on the account, so it could give a real "one free snack per player". But the account is already sybil-able (anyone can make more wallets), so that gain is small. Every inventory row would change meaning, and every contract would redeploy. Without an external audit this is too much new surface.

**(b') Delegate Registry.** The registry is live at `0x00000000000000447e69651d841bD8D104Bed493` on Base and Base Sepolia (its docs list both; `cast code` returned 20,095 characters of hex on each, and `checkDelegateForContract` answered `false` for unused addresses). In its source, `checkDelegateForContract` first checks a wallet-wide delegation with empty rights and skips the rights-specific checks when that passes. So an old wallet-wide delegation counts for our contracts too. Tests would need the registry's bytecode put at its address in Foundry (`vm.etch`) or its source vendored.

**(c) EIP-7702.** Neither the Farcaster wallet guide nor ERC-5792 gives an app a way to ask a wallet to delegate its account to another key. MetaMask's docs say it upgrades an account only to its own MetaMask smart account, and it does not support batches for an account upgraded to a third-party contract. So the app cannot use this for F.

**(d) Recipient parameter.** `Letters.reveal` mints to `c.buyer` (Letters.sol:275), and OpenZeppelin's `_mint` runs the receiver check on a contract (lib/openzeppelin-contracts/token/ERC1155/ERC1155.sol:309-314, which calls `checkOnERC1155Received` at :220). A recipient contract without `onERC1155Received` would make every reveal of that commit revert. Commits have no expiry and no refund by design (Letters.sol:25-27), so the fee would be stranded. It also changes the two contracts that hold all the assets.

## 3. Recommendation

### 3.1 What to build

1. **Before mainnet, in the contracts:** diff A, the caretaker list in Staking, honored by `feed`, `feedMany`, `Rolls.commitWordRoll`, and `Prestige.commitPrestige`. The free snack is keyed by the staker. The caller always pays. Decide on diff B (caretaker unstake) as an owner question.
2. **In the app, any time (no contract change):** opt-in token approvals between the player's wallets and "pull then act" for claims, dissolves, stakes, packs, and loose rolls. This can ship after launch, and the app can drop it without touching the contracts.

Why this split: the caretaker list is the only part that needs a redeploy, and on its own it cannot move anyone's assets. The approvals carry the real risk, and they need no contract work, so the player can choose them, and the app can bound them (for example, a capped $WORD allowance).

Rules diff A keeps:
- A caretaker never receives a Word. The fee for every paid action comes from the caller (`msg.sender`), never from the staker's standing allowance.
- Pity, open-roll slots, and prestige commits stay keyed on the staker (the beneficial owner), whoever sends the call. The `PrestigeCommitted` event names the staker too, so the app finds the commit by the staker.
- A caretaker acts only on staked Words. A Word the owner merely holds moves with ordinary approvals (pull, then act).
- A Words operator is not a caretaker. Caretaker rights are one way (F naming W does not let F act for W).
- A caretaker of one staker is nobody else's caretaker.
- `beneficialOwner`, the jackpot winner, and every reward payee stay the staker.

### 3.2 Diff A (recommended, not applied)

```diff
--- a/contracts/src/Staking.sol
+++ b/contracts/src/Staking.sol
@@ -36,15 +36,22 @@
     mapping(uint256 tokenId => uint64) public lastFed;
     // (UTC day + 1) on which a player last used their free snack; default 0 means "never".
     mapping(address player => uint32 dayPlusOne) public freeSnackDayPlusOne;
+    /// @notice Wallets a staker lets care for its staked Words: feed them here, and roll and ascend
+    ///         them (Rolls, Prestige). A caretaker pays with its own $WORD and never receives a Word,
+    ///         so it can take nothing. This is separate from ERC-721 operator approval on purpose: a
+    ///         marketplace, or any other operator of the staker's Words, gets nothing here.
+    mapping(address staker => mapping(address wallet => bool)) public isCaretaker;
 
     event Staked(uint256 indexed tokenId, address indexed staker);
     event Unstaked(uint256 indexed tokenId, address indexed staker);
     event Fed(uint256 indexed tokenId, address indexed staker, uint64 at);
     event CareParamsSet(uint64 peckishAfter, uint64 hungryAfter, uint256 snackPrice);
     event FreeDailySnackSet(bool enabled);
+    event CaretakerSet(address indexed staker, address indexed wallet, bool allowed);
 
     error NotStaked();
     error NotStaker();
+    error BadCaretaker();
 
     constructor(
         IERC20 _word,
@@ -87,17 +94,23 @@
     }
 
     function feed(uint256 tokenId) public nonReentrant {
-        if (stakerOf[tokenId] == address(0)) revert NotStaked();
-        if (stakerOf[tokenId] != msg.sender) revert NotStaker(); // only the staker feeds their own word
+        address staker = stakerOf[tokenId];
+        if (staker == address(0)) revert NotStaked();
+        // The staker feeds, or a wallet the staker named with setCaretaker.
+        if (staker != msg.sender && !isCaretaker[staker][msg.sender]) revert NotStaker();
         // The first feed of the UTC day is free (the check-in hook); every other feed is paid + burned.
+        // The free snack is the STAKER's, whoever feeds. Keyed on the caller, every caretaker would
+        // bring its own, and one staker could name a wallet per Word to feed them all free each day.
         uint32 todayPlusOne = uint32(block.timestamp / 1 days) + 1;
-        if (freeDailySnack && freeSnackDayPlusOne[msg.sender] != todayPlusOne) {
-            freeSnackDayPlusOne[msg.sender] = todayPlusOne;
+        if (freeDailySnack && freeSnackDayPlusOne[staker] != todayPlusOne) {
+            freeSnackDayPlusOne[staker] = todayPlusOne;
         } else {
+            // The caller pays, never the staker: a staker keeps a standing allowance to this
+            // contract, so charging the staker would let a caretaker spend the staker's $WORD.
             _collect(msg.sender, snackPrice, FeeSource.SNACK); // snacks are 100% burned
         }
         lastFed[tokenId] = uint64(block.timestamp);
-        emit Fed(tokenId, stakerOf[tokenId], uint64(block.timestamp));
+        emit Fed(tokenId, staker, uint64(block.timestamp));
     }
 
     function feedMany(uint256[] calldata tokenIds) external {
@@ -106,6 +119,13 @@
         }
     }
 
+    /// @notice Let `wallet` feed, roll, and ascend the Words you stake, or stop it (`allowed` false).
+    function setCaretaker(address wallet, bool allowed) external {
+        if (wallet == address(0) || wallet == msg.sender) revert BadCaretaker();
+        isCaretaker[msg.sender][wallet] = allowed;
+        emit CaretakerSet(msg.sender, wallet, allowed);
+    }
+
     // --- views (read by Jackpot / YieldDistributor / Prestige) ------------------------------------
 
     /// @inheritdoc IStaking
--- a/contracts/src/interfaces/IStaking.sol
+++ b/contracts/src/interfaces/IStaking.sol
@@ -4,7 +4,7 @@
 /**
  * @title IStaking
  * @notice Word-NFT staking custody + hunger state. Read by Jackpot (eligibility) and
- *         Prestige/Rolls (beneficial owner of a staked token).
+ *         Prestige/Rolls (beneficial owner of a staked token, and the owner's caretakers).
  */
 interface IStaking {
     /// @return the address that staked `tokenId` (address(0) if not staked)
@@ -14,4 +14,6 @@
     function isHungry(uint256 tokenId) external view returns (bool);
     /// @return 0 = fed, 1 = peckish, 2 = hungry
     function hungerLevel(uint256 tokenId) external view returns (uint8);
+    /// @return true if `staker` named `wallet` to feed, roll, and ascend its staked Words
+    function isCaretaker(address staker, address wallet) external view returns (bool);
 }
--- a/contracts/src/Rolls.sol
+++ b/contracts/src/Rolls.sol
@@ -98,10 +98,18 @@
         commitId = _commit(msg.sender, letterIndex, KIND_LOOSE, 0, 0);
     }
 
-    /// @notice Roll the `pos`-th escrowed letter of a Word you beneficially own.
+    /// @notice Roll the `pos`-th escrowed letter of a Word you beneficially own, or of a staked Word
+    ///         whose staker named you its caretaker (Staking.setCaretaker).
     function commitWordRoll(uint256 tokenId, uint8 pos) external nonReentrant returns (uint256 commitId) {
         address bo = beneficialOwnerOf(tokenId);
-        if (msg.sender != bo) revert NotBeneficialOwner();
+        if (msg.sender != bo) {
+            // A caretaker may roll too, but only a STAKED Word (a held Word moves with ordinary
+            // approvals instead). The commit and its pity stay keyed on `bo` (below), so a caretaker
+            // never opens a second pity streak.
+            bool caretaker = address(staking) != address(0) && staking.isStaked(tokenId)
+                && staking.isCaretaker(bo, msg.sender);
+            if (!caretaker) revert NotBeneficialOwner();
+        }
         (uint8 li, bool isUp) = words.escrowLetter(tokenId, pos);
         if (isUp) revert AlreadyRaised();
         _collect(msg.sender, rollPrice, FeeSource.ROLL);
--- a/contracts/src/Prestige.sol
+++ b/contracts/src/Prestige.sol
@@ -79,9 +79,13 @@
         signer = _signer;
     }
 
-    /// @notice Begin an ascension attempt on a full-UPPERCASE staked Word you own.
+    /// @notice Begin an ascension attempt on a full-UPPERCASE Word you stake, or one whose staker
+    ///         named you its caretaker (Staking.setCaretaker).
     function commitPrestige(uint256 tokenId) external nonReentrant returns (uint256 commitId) {
-        if (staking.beneficialOwner(tokenId) != msg.sender) revert NotBeneficialOwner();
+        address bo = staking.beneficialOwner(tokenId);
+        // The staker ascends, or a wallet it named as caretaker on Staking. An unstaked Word has no
+        // staker (address(0)), and nobody can be address(0)'s caretaker, so it still reverts.
+        if (bo != msg.sender && !staking.isCaretaker(bo, msg.sender)) revert NotBeneficialOwner();
         if (words.caseOf(tokenId) != CaseState.Uppercase) revert NotFullyRaised();
         if (words.prestigeLevel(tokenId) >= maxLevel) revert MaxLevel();
         if (attemptOpen[tokenId]) revert AttemptOpen(); // finish (reveal) the open attempt first
@@ -92,8 +96,10 @@
 
         uint32 p = prestigePity[tokenId];
         commitId = commits.length;
-        commits.push(PrestigeCommit({tokenId: tokenId, owner: msg.sender, revealed: false, pityAtCommit: p}));
-        emit PrestigeCommitted(commitId, tokenId, msg.sender, p);
+        // The commit names the STAKER, not the caller: reveal re-checks beneficialOwner == owner, so a
+        // caretaker's commit naming itself would turn every signed success into a paid no-op.
+        commits.push(PrestigeCommit({tokenId: tokenId, owner: bo, revealed: false, pityAtCommit: p}));
+        emit PrestigeCommitted(commitId, tokenId, bo, p);
     }
 
     /// @notice Resolve an ascension with the backend's signed outcome.
```

### 3.3 Diff B: a caretaker may unstake (optional, not applied)

Apply on top of diff A. The Word always goes back to the staker. The staker is read before the `delete`.

```diff
--- a/contracts/src/Staking.sol
+++ b/contracts/src/Staking.sol
@@ -87,10 +87,15 @@
     }
 
     function unstake(uint256 tokenId) external nonReentrant {
-        if (stakerOf[tokenId] != msg.sender) revert NotStaker();
+        address staker = stakerOf[tokenId];
+        // The staker unstakes, or a caretaker it named. Read BEFORE the delete: the Word goes back to
+        // the staker, never to the caller, so a caretaker can't receive it.
+        if (staker == address(0) || (staker != msg.sender && !isCaretaker[staker][msg.sender])) {
+            revert NotStaker();
+        }
         delete stakerOf[tokenId]; // lastFed stays: unstake + stake is never a meal
-        words.safeTransferFrom(address(this), msg.sender, tokenId);
-        emit Unstaked(tokenId, msg.sender);
+        words.safeTransferFrom(address(this), staker, tokenId);
+        emit Unstaked(tokenId, staker);
     }
 
     function feed(uint256 tokenId) public nonReentrant {
```

What diff B adds and costs: from the web, the player can take a Word out of F's stake (to F). Then, if F approved W on Words, W can pull it and restake it, or dissolve it. The cost is in test `test_Caretaker_unstakePlusOperatorApprovalReachesStakedWords`: a wallet with both caretaker rights and Words operator approval can take a staked Word. Without diff B, a staked Word can leave Staking only by its staker's own transaction.

### 3.4 Foundry tests to add

Add to `contracts/test/Lexigotchi.t.sol`. First, widen one import:

```diff
-import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
+import {IERC20Errors, IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
```

Then append these tests inside `LexigotchiTest` (diff A):

```solidity
    // ---------------------------------------------------------------------------------------------
    // Linked wallets: caretakers (Staking.setCaretaker) and pull-then-act with standard approvals
    // ---------------------------------------------------------------------------------------------

    address carol = makeAddr("carol");

    function _care(address staker, address wallet) internal {
        vm.prank(staker);
        staking.setCaretaker(wallet, true);
    }

    /// A caretaker feeds with the STAKER's free snack, and pays for every other snack itself.
    function test_Caretaker_feedsWithTheStakersFreeSnack() public {
        uint256 t1 = _claimLower(alice, 0);
        uint256 t2 = _claimLower(alice, 1);
        _stake(alice, t1);
        _stake(alice, t2);
        _care(alice, bob);
        _approveAll(bob);

        uint256 aliceBal = word.balanceOf(alice);
        uint256 bobBal = word.balanceOf(bob);
        vm.prank(bob);
        staking.feed(t1); // the staker's free snack
        assertEq(word.balanceOf(bob), bobBal, "the free snack costs the caretaker nothing");
        assertEq(staking.freeSnackDayPlusOne(alice), uint32(block.timestamp / 1 days) + 1, "alice's free snack is used");
        assertEq(staking.freeSnackDayPlusOne(bob), 0, "bob's own free snack is untouched");

        vm.prank(bob);
        staking.feed(t2); // paid, by the caller
        assertEq(bobBal - word.balanceOf(bob), SNACK, "the caretaker pays the second snack");
        assertEq(word.balanceOf(alice), aliceBal, "the staker pays nothing");
        assertEq(staking.lastFed(t2), block.timestamp, "fed");
    }

    /// Two caretakers can't bring two free snacks: there is one per staker per UTC day.
    function test_Caretaker_cannotMultiplyFreeSnacks() public {
        uint256 t1 = _claimLower(alice, 0);
        uint256 t2 = _claimLower(alice, 1);
        _stake(alice, t1);
        _stake(alice, t2);
        _care(alice, bob);
        _care(alice, carol);
        _approveAll(bob);
        word.mint(carol, 1e30);
        _approveAll(carol);

        uint256 supply0 = word.totalSupply();
        vm.prank(bob);
        staking.feed(t1);
        vm.prank(carol);
        staking.feed(t2);
        assertEq(supply0 - word.totalSupply(), SNACK, "exactly one free snack between them");
    }

    /// In one feedMany, each staker's free snack covers one of its own words; the caller pays the rest.
    function test_Caretaker_feedManyUsesEachStakersFreeSnack() public {
        uint256 t1 = _claimLower(alice, 0);
        uint256 t2 = _claimLower(alice, 1);
        uint256 t3 = _claimLower(bob, 2);
        _stake(alice, t1);
        _stake(alice, t2);
        _stake(bob, t3);
        _care(alice, bob);

        uint256 bobBal = word.balanceOf(bob);
        uint256[] memory ids = new uint256[](3);
        ids[0] = t1; // alice's free snack
        ids[1] = t2; // paid by bob
        ids[2] = t3; // bob's own free snack
        vm.prank(bob);
        staking.feedMany(ids);
        assertEq(bobBal - word.balanceOf(bob), SNACK, "one paid snack for three words across two stakers");
    }

    /// A caretaker's paid snack never touches the staker's standing allowance to Staking.
    function test_Caretaker_neverSpendsTheStakersWord() public {
        uint256 t1 = _claimLower(alice, 0); // alice approved Staking for the max
        _stake(alice, t1);
        _care(alice, bob); // bob holds $WORD but approved nothing
        vm.prank(alice);
        staking.feed(t1); // alice uses her own free snack

        uint256 aliceBal = word.balanceOf(alice);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(staking), 0, SNACK));
        staking.feed(t1);
        assertEq(word.balanceOf(alice), aliceBal, "alice's allowance was never used");
    }

    /// Only named wallets feed. Words operator approval grants nothing on Staking, and revoking works.
    function test_Caretaker_onlyNamedWalletsAndRevocable() public {
        word.mint(carol, 1e30);
        uint256 t1 = _claimLower(alice, 0);
        uint256 t3 = _claimLower(carol, 2);
        _stake(alice, t1);
        _stake(carol, t3);
        _approveAll(bob);

        // a Words operator (a marketplace, or anyone alice approved) is not a caretaker
        vm.prank(alice);
        words.setApprovalForAll(bob, true);
        vm.prank(bob);
        vm.expectRevert(Staking.NotStaker.selector);
        staking.feed(t1);

        _care(alice, bob);
        vm.prank(bob);
        staking.feed(t1);

        // alice's caretaker is nobody else's
        vm.prank(bob);
        vm.expectRevert(Staking.NotStaker.selector);
        staking.feed(t3);

        vm.prank(alice);
        staking.setCaretaker(bob, false);
        vm.warp(block.timestamp + 1 days);
        vm.prank(bob);
        vm.expectRevert(Staking.NotStaker.selector);
        staking.feed(t1);
    }

    function test_Caretaker_setterRejectsZeroAndSelfAndEmits() public {
        vm.startPrank(alice);
        vm.expectRevert(Staking.BadCaretaker.selector);
        staking.setCaretaker(address(0), true);
        vm.expectRevert(Staking.BadCaretaker.selector);
        staking.setCaretaker(alice, true);
        vm.expectEmit(true, true, false, true, address(staking));
        emit Staking.CaretakerSet(alice, bob, true);
        staking.setCaretaker(bob, true);
        vm.stopPrank();
        assertTrue(staking.isCaretaker(alice, bob));
        assertFalse(staking.isCaretaker(bob, alice), "one way only");
    }

    /// A caretaker rolls a staked word: the caller pays; the commit, its open-roll slot, and pity stay the owner's.
    function test_Caretaker_rollsAStakedWordUnderTheOwnersPity() public {
        uint256 t = _claimLower(alice, 0); // CRANE
        _stake(alice, t);
        _care(alice, bob);
        _approveAll(bob);

        uint256 aliceBal = word.balanceOf(alice);
        uint256 bobBal = word.balanceOf(bob);
        vm.prank(bob);
        uint256 id0 = rolls.commitWordRoll(t, 0); // C = letter index 2
        (address owner,,,,,,) = rolls.commits(id0);
        assertEq(owner, alice, "the commit names the beneficial owner");
        assertEq(bobBal - word.balanceOf(bob), ROLL, "the caretaker pays");
        assertEq(word.balanceOf(alice), aliceBal, "the owner pays nothing");

        vm.prank(alice);
        vm.expectRevert(Rolls.RollOpen.selector);
        rolls.commitWordRoll(t, 0); // one open roll per (owner, letter), whichever wallet opened it

        rolls.reveal(id0, false, _signRoll(id0, alice, 2, false));
        assertEq(rolls.pityOf(alice, 2), 1, "a miss raises the owner's pity");
        assertEq(rolls.pityOf(bob, 2), 0, "the caretaker has no streak of its own");

        vm.prank(bob);
        uint256 id1 = rolls.commitWordRoll(t, 0);
        rolls.reveal(id1, true, _signRoll(id1, alice, 2, true));
        assertEq(uint8(words.caseOf(t)), uint8(CaseState.Mixed), "the escrowed C is raised");
        assertEq(words.ownerOf(t), address(staking), "the word never left Staking");
    }

    /// A caretaker acts only on STAKED words: a word the owner merely holds moves with approvals instead.
    function test_Caretaker_cannotRollAHeldWord() public {
        uint256 t = _claimLower(alice, 0); // held by alice, not staked
        _care(alice, bob);
        _approveAll(bob);
        vm.prank(bob);
        vm.expectRevert(Rolls.NotBeneficialOwner.selector);
        rolls.commitWordRoll(t, 0);
    }

    /// With Staking unset on Rolls, the caretaker branch is skipped cleanly (no call to address(0)).
    function test_Caretaker_rollsCheckSurvivesUnsetStaking() public {
        uint256 t = _claimLower(alice, 0);
        _care(alice, bob);
        _approveAll(bob);
        rolls.setStaking(IStaking(address(0)));
        vm.prank(bob);
        vm.expectRevert(Rolls.NotBeneficialOwner.selector);
        rolls.commitWordRoll(t, 0);
    }

    /// A caretaker ascends a staked word. The commit names the STAKER, so a signed success lands.
    function test_Caretaker_ascendsAndTheCommitNamesTheStaker() public {
        uint256 t = _claimUpper(alice, 0);
        _approveAll(bob);
        _care(alice, bob);

        vm.prank(bob);
        vm.expectRevert(Prestige.NotBeneficialOwner.selector);
        prestige.commitPrestige(t); // unstaked: nobody can ascend it, caretaker or not

        _stake(alice, t);
        uint256 bobBal = word.balanceOf(bob);
        vm.expectEmit(true, true, true, true, address(prestige));
        emit Prestige.PrestigeCommitted(0, t, alice, 0); // indexers find the commit by the staker
        vm.prank(bob);
        uint256 id = prestige.commitPrestige(t);
        (, address owner,,) = prestige.commits(id);
        assertEq(owner, alice, "the commit names the staker");
        assertEq(bobBal - word.balanceOf(bob), PRESTIGE_FEE + SNACK, "the caretaker pays the fee and the snack");
        prestige.reveal(id, true, _signPrestige(id, t, alice, true));
        assertEq(words.prestigeLevel(t), 1, "the signed success lands");

        vm.prank(carol);
        vm.expectRevert(Prestige.NotBeneficialOwner.selector);
        prestige.commitPrestige(t); // a stranger still can't
    }

    /// Fed only by a caretaker, the word stays in the jackpot, and the pot pays the staker.
    function test_Caretaker_feedingKeepsTheJackpotWithTheStaker() public {
        vm.warp(1755000000);
        _approveAll(bob);
        vm.prank(bob);
        letters.commitPack(); // funds the pot

        uint256 t = _claimLower(alice, 0); // CRANE, the day's answer
        _stake(alice, t);
        _care(alice, bob);
        for (uint256 d = 0; d < 4; d++) {
            vm.warp(block.timestamp + 1 days);
            vm.prank(bob);
            staking.feed(t);
        }
        assertFalse(staking.isHungry(t), "fed by the caretaker");

        uint256 pot = feeRouter.jackpotBalance();
        uint256 aliceBefore = word.balanceOf(alice);
        uint256 bobBefore = word.balanceOf(bob);
        vm.prank(keeper);
        assertTrue(jackpot.resolve("CRANE", keccak256("salt1"), bytes32(0)), "eligible");
        assertEq(word.balanceOf(alice) - aliceBefore, pot, "the staker wins the pot");
        assertEq(word.balanceOf(bob), bobBefore, "the caretaker gets nothing");
    }

    /// No contract change: with standard approvals, a second wallet pulls letters and $WORD, then claims.
    function test_LinkedWallet_pullLettersAndWordThenClaim() public {
        _fundLower(alice, "CRANE");
        vm.startPrank(alice);
        letters.setApprovalForAll(bob, true); // alice lets her other wallet move her letters
        word.approve(bob, CLAIM); // and a bounded amount of her $WORD
        vm.stopPrank();
        _approveAll(bob); // bob's own game approvals

        uint256[] memory ids = new uint256[](5);
        uint256[] memory amounts = new uint256[](5);
        bytes memory b = bytes("CRANE");
        for (uint256 k = 0; k < 5; k++) {
            ids[k] = uint8(b[k]) - 65;
            amounts[k] = 1;
        }
        uint256 bobBal = word.balanceOf(bob);
        vm.startPrank(bob);
        letters.safeBatchTransferFrom(alice, bob, ids, amounts, "");
        word.transferFrom(alice, bob, CLAIM);
        uint256 t = words.claim("CRANE", false, _proof(0));
        vm.stopPrank();
        assertEq(words.ownerOf(t), bob, "the word lands in the acting wallet");
        assertEq(word.balanceOf(bob), bobBal, "the fee came from alice's wallet, through bob");
        assertEq(letters.balanceOf(alice, 2), 0, "alice's letters were spent");
    }

    /// Pulling a letter away from an open loose roll turns that roll's signed success into a no-op.
    /// The client must never pull a lowercase letter while the source wallet has a roll open on it.
    function test_LinkedWallet_pullUnderAnOpenRollVoidsTheSuccess() public {
        _fundLower(alice, "C");
        _approveAll(alice);
        vm.prank(alice);
        uint256 id = rolls.commitLooseRoll(2);
        vm.prank(alice);
        letters.setApprovalForAll(bob, true);
        vm.prank(bob);
        letters.safeTransferFrom(alice, bob, 2, 1, "");
        rolls.reveal(id, true, _signRoll(id, alice, 2, true));
        assertEq(letters.balanceOf(bob, 2), 1, "still lowercase: the paid success did nothing");
        assertEq(letters.balanceOf(bob, 28) + letters.balanceOf(alice, 28), 0, "no UPPERCASE C anywhere");
    }
```

Keep this test only if diff B is NOT taken:

```solidity
    /// Without diff B, a caretaker cannot unstake: only the staker moves a Word out of Staking.
    function test_Caretaker_cannotUnstake() public {
        uint256 t = _claimLower(alice, 0);
        _stake(alice, t);
        _care(alice, bob);
        vm.prank(bob);
        vm.expectRevert(Staking.NotStaker.selector);
        staking.unstake(t);
    }
```

If diff B is taken, use these two in its place:

```solidity
    /// Diff B: a caretaker unstakes to the STAKER, never to itself, and the hunger clock keeps running.
    function test_Caretaker_unstakeReturnsToTheStaker() public {
        uint256 t = _claimLower(alice, 0);
        _stake(alice, t);
        _care(alice, bob);
        uint64 fedAt = staking.lastFed(t);
        vm.warp(block.timestamp + 1 hours);
        vm.expectEmit(true, true, false, false, address(staking));
        emit Staking.Unstaked(t, alice);
        vm.prank(bob);
        staking.unstake(t);
        assertEq(words.ownerOf(t), alice, "back to the staker");
        assertEq(staking.stakerOf(t), address(0), "no longer staked");
        assertEq(staking.lastFed(t), fedAt, "unstaking is never a meal");

        vm.prank(carol);
        vm.expectRevert(Staking.NotStaker.selector);
        staking.unstake(t); // not staked: still NotStaker, as before the change
    }

    /// Diff B's cost, pinned: a wallet with BOTH caretaker rights and Words operator approval can take
    /// a staked Word (unstake to the staker, then transfer it). Without diff B, staking protects it.
    function test_Caretaker_unstakePlusOperatorApprovalReachesStakedWords() public {
        uint256 t = _claimLower(alice, 0);
        _stake(alice, t);
        _care(alice, bob);
        vm.prank(alice);
        words.setApprovalForAll(bob, true);
        vm.startPrank(bob);
        staking.unstake(t);
        words.transferFrom(alice, bob, t);
        vm.stopPrank();
        assertEq(words.ownerOf(t), bob, "a staked Word is only as safe as the wallets holding both rights");
    }
```

What each test pins:

| Test | Pins |
|---|---|
| `test_Caretaker_feedsWithTheStakersFreeSnack` | The free snack is the staker's; the caretaker pays later snacks; the staker pays nothing. |
| `test_Caretaker_cannotMultiplyFreeSnacks` | Two caretakers share the staker's one free snack. |
| `test_Caretaker_feedManyUsesEachStakersFreeSnack` | A mixed `feedMany` uses one free snack per staker. The client's sizing must expect this. |
| `test_Caretaker_neverSpendsTheStakersWord` | A caretaker with no allowance reverts on a paid snack; the staker's max allowance is never used. |
| `test_Caretaker_onlyNamedWalletsAndRevocable` | A Words operator is not a caretaker; a caretaker of one staker can't feed another's Word; revoking works. |
| `test_Caretaker_setterRejectsZeroAndSelfAndEmits` | The setter refuses `address(0)` and self, emits `CaretakerSet`, and is one way. |
| `test_Caretaker_rollsAStakedWordUnderTheOwnersPity` | A caretaker's word roll is the owner's commit; the open-roll slot and pity are the owner's; the success lands in escrow. |
| `test_Caretaker_cannotRollAHeldWord` | A caretaker cannot roll a Word the owner holds but has not staked. |
| `test_Caretaker_rollsCheckSurvivesUnsetStaking` | With Staking unset on Rolls, the check reverts cleanly with `NotBeneficialOwner` and never calls `address(0)`. |
| `test_Caretaker_ascendsAndTheCommitNamesTheStaker` | The commit and the `PrestigeCommitted` event name the staker, so a signed success ascends and the app can find the commit; an unstaked Word still reverts; a stranger still reverts. |
| `test_Caretaker_feedingKeepsTheJackpotWithTheStaker` | Feeding only by a caretaker keeps the Word eligible, and the pot pays the staker. |
| `test_LinkedWallet_pullLettersAndWordThenClaim` | No contract change: approvals plus pull then act work for a claim. The Word lands in the acting wallet. |
| `test_LinkedWallet_pullUnderAnOpenRollVoidsTheSuccess` | The hazard the pull planner must avoid. |
| `test_Caretaker_cannotUnstake` (diff A only) | Without diff B, only the staker unstakes. |
| `test_Caretaker_unstakeReturnsToTheStaker` (diff B) | The Word goes to the staker, the event names the staker, and the hunger clock does not reset. |
| `test_Caretaker_unstakePlusOperatorApprovalReachesStakedWords` (diff B) | Pins diff B's cost, so nobody adds it by accident. |

Also update the comment in the existing `test_Staking_feedOnlyByStaker` (Lexigotchi.t.sol:756-768). It still passes, because Bob is not a caretaker there.

### 3.5 Proof in a scratch copy

`contracts/` was copied to the scratchpad (secret files and build output left out). The diffs and tests above were applied there. Forge 1.5.1, solc 0.8.28.

| Run | Result |
|---|---|
| Repository as it is, unchanged | 65 tests pass |
| Diff A + the 14 diff A tests | 79 tests pass |
| Diff A + diff B + the 13 shared tests + the 2 diff B tests | 80 tests pass |
| Mutation 1: free snack keyed on the caller again | 4 new tests fail |
| Mutation 2: the paid snack charged to the staker | 3 new tests fail |
| Mutation 3: the prestige commit names the caller | `test_Caretaker_ascendsAndTheCommitNamesTheStaker` fails |
| Mutation 4: Staking trusts Words operator approval instead of the caretaker list | 6 new tests fail |
| Mutation 5: the `PrestigeCommitted` event names the caller | `test_Caretaker_ascendsAndTheCommitNamesTheStaker` fails |
| Mutation 6: Rolls lets a caretaker roll a held Word (the staked check removed) | `test_Caretaker_cannotRollAHeldWord` fails |
| Mutation 7: Rolls calls Staking without the unset-Staking guard | `test_Caretaker_rollsCheckSurvivesUnsetStaking` fails |

The public `isCaretaker` mapping satisfies the new `IStaking.isCaretaker` function without an `override` keyword (it compiled). The repository's code is not formatter-clean today (`forge fmt --check` reports differences in the unchanged files), so the formatter is not a gate. No line added by the diffs is longer than the 110-character limit in foundry.toml.

### 3.6 Client work

For diff A (caretakers):
1. A "let my other wallets feed my staked words" control. Each staking wallet sends one `setCaretaker(other, true)` per sibling, in its own place (F inside Farcaster, W on the web). Read the grants back from `isCaretaker`, or from `CaretakerSet` events, and offer revoke.
2. Verb gating: today `mine` means "the connected wallet holds it" (src/lib/onchain/unionBag.ts:16-24, 63). A staked Word becomes actionable for feed, word roll, and ascend when `stakerOf == connected` or `isCaretaker(staker, connected)`. With diff B, also for unstake.
3. The free snack: read `freeSnackDayPlusOne[staker]` for each staker shown, not only the connected wallet (src/lib/onchain/reads.ts:254, 264). The batch sizing already assumes no free snack (`feedSizingFree = false`, src/components/game/ChainGameProvider.tsx:563), so sends stay safe. Only the "free feed" label needs the per-staker read.
4. Commit lookups: a caretaker's word roll and ascension name the owner, not the connected wallet. `waitForNewRollCommit`, `readOpenRollFor`, `readOpenRollCommits`, `readOpenPrestigeCommits`, and `waitForNewPrestigeCommit` filter by owner (reads.ts:457, 470, 491, 518, 531). Pass the staker. Read pity with `pityOf(staker, letter)`.
5. The caretaker pays, so the caretaker's own $WORD allowances to Staking, Rolls, and Prestige apply. The existing builders already size these from the connected wallet's state.
6. Unlinking in the database, or a Farcaster prune, revokes nothing onchain. When a wallet leaves the account, prompt each staking wallet to revoke it. Each wallet can revoke only in its own place.
7. Regenerate the ABIs (`npm run derive:abis`) and add `setCaretaker(address,bool)` to `contracts/erc7730/calldata-Staking.json` (for example, the intent "Let a wallet feed your staked words").

For the approvals (pull then act):
1. A one-time grant, per holding wallet, in its own place: Letters and Words `setApprovalForAll(sibling, true)`, and a **bounded** `$WORD.approve(sibling, amount)`. Prefer a capped allowance, or keep using Move for $WORD.
2. A pull planner in front of each action builder. It uses the connected wallet's own items first. It never pulls a lowercase letter with an open loose roll in the source wallet (`readOpenRolls`). It avoids letters promised in open Seaport swap offers, which stop working once the letters leave (docs-site/profile.mdx:76).
3. Batch handling: see section 4, question 1.
4. The approval target must come from a fresh read of the account (as Move does). A wrong account list would mean approving a stranger.

### 3.7 Docs and in-app copy to update in the same PR

The repository rule says a feature change updates every surface. These say today that only the staking wallet can feed:
- docs-site/profile.mdx:66 and :76
- src/components/game/GameWalletNotice.tsx:111
- src/components/game/sheets/WalletsCard.tsx:372
- src/lib/profile/gameWalletAdvice.ts:17 and :25
- src/lib/onchain/unionBag.ts:13-14 and src/lib/onchain/move.ts:12 (comments)
- CLAUDE.md (the linked-wallets paragraph) and docs/decisions.md (the 2026-11-24 amendment)
- contracts/AUDIT.md (trust model and test count) and GAME_DOCUMENTATION.md
- the hunger reminders (src/lib/notify/templates.ts, src/lib/notify/email.ts): "feed from any of your wallets"

## 4. Questions the design must answer

### 4.1 Does the batch path run atomically?

What the code does: `sendCallsAttributed` sends `wallet_sendCalls` with `atomicRequired: false` (src/lib/onchain/sendCalls.ts:136). A wallet without ERC-5792 gets one `eth_sendTransaction` per call, sent back to back without waiting for receipts (sendCalls.ts:148-152). The app already treats batches as not atomic and re-reads after each send (src/lib/onchain/actions.ts:9-12; src/components/game/useOnchain.ts:76-79).

Verified:
- **Farcaster wallet:** its guide says "Transactions execute sequentially, not atomically," that each transaction in a batch is "individually validated and scanned," and that there is "No paymaster support yet" (miniapps.farcaster.xyz/docs/guides/wallets).
- **MetaMask:** its docs say it supports only atomic batches. It may first ask to upgrade the account to a MetaMask smart account. It reports `atomic` as `supported` or `ready` in `wallet_getCapabilities` (docs.metamask.com, send batch transactions).
- **ERC-5792:** with `atomicRequired: false`, a wallet "MAY execute all calls sequentially without any atomicity/contiguity guarantees." With `true`, a wallet that cannot comply returns error 5760 ("Atomicity not supported").

Not verified:
- Whether the Farcaster wallet stops after a failed call or sends the rest.
- Whether the Farcaster wallet's scan refuses a batch whose later call would fail when simulated before the earlier call lands.
- Whether a wallet on the `eth_sendTransaction` fallback estimates the second call's gas before the first call lands. The 2026-11-23 test ran approve-then-act flows with a plain wallet, but the record does not say which send path that wallet took.
- The `atomic` status that Coinbase Wallet reports. The repository's own record shows Coinbase Wallet ran batched packs, claims, stakes, and feeds on 2026-11-23 (docs/web3-runtime-plan.md:46-49). Its docs show batches with `atomicRequired: true`. This research did not read its capability answer.

What happens when "pull then act" runs as separate transactions. The design rule is that every prefix of a batch must leave the player in a safe state. Pull then act passes:
- The pull lands and the action fails (the Word was claimed first, the price moved, or the player rejects the second prompt): the items now sit in the acting wallet, which is still in the account. No fee is taken, because the action reverted as a whole.
- The pull fails: the action then reverts too, for lack of letters or $WORD. Nothing moves.
- The one unsafe case is a pulled letter that has an open loose roll in its old wallet. The planner must skip it (section 1.1, Rolls `reveal`).

Unsafe patterns not to build: "unstake, pull, restake" in a batch that is not atomic. The Word could sit unstaked across the daily snapshot at 00:05 UTC. The caretaker list avoids this, because it feeds in place.

What the client should do:
1. Call `wallet_getCapabilities`. When `atomic` is `supported` or `ready`, send pull then act with `atomicRequired: true`.
2. Otherwise (the Farcaster wallet today), either send it as one batch and accept a partial result, or send the pull, wait for it with `wallet_getCallsStatus`, and then send the action. Test both on Base Sepolia inside Farcaster before choosing.
3. In the `eth_sendTransaction` fallback, wait for the pull's receipt before sending the action. Otherwise the wallet may estimate the action's gas before the pull lands, and that estimate may fail.

### 4.2 Who pays, and where do things land?

The acting wallet always pays its own fees (FeeCollector.sol:27-32 with `msg.sender` at every call site). It can first pull $WORD from a sibling that approved it. Gas is the acting wallet's too. The Farcaster wallet has no paymaster support, and the app now asks for sponsorship only on calls the policy is known to allow (sendCalls.ts:115-119).

| Call by acting wallet W | Who pays $WORD | Where things land |
|---|---|---|
| `Letters.commitPack`, `commitPackETH` | W | Letters go to W at reveal; the ETH refund goes to W |
| `Letters.commitDaily*`, `commitDailyFree`, `commitPackFree` | W (zero when free) | W |
| `Letters.reveal` (usually the server) | nobody | the committer |
| Pull: `Letters.safeBatchTransferFrom(F, W, …)` | nobody (gas only) | W |
| Pull: `Words.safeTransferFrom(F, W, id)` | nobody | W |
| Pull: `$WORD.transferFrom(F, W, amount)` | F's $WORD moves | W |
| `Words.claim` | W | the Word goes to W; the letters leave W |
| `Words.dissolve` (W owns the Word) | nobody | the letters go to W |
| `Staking.stake` (W owns the Word) | nobody | W becomes the staker |
| `Staking.feed`, `feedMany` (W is a caretaker) | the staker's free snack first, then W | nothing moves; `lastFed` updates |
| `Staking.unstake` (diff B, W is a caretaker) | nobody | **the staker (F)**, never W |
| `Rolls.commitLooseRoll` | W | the upgrade happens in W's own balance |
| `Rolls.commitWordRoll` (W is a caretaker) | W | the upgrade happens inside the Word's escrow; the commit names F |
| `Prestige.commitPrestige` (W is a caretaker) | W pays the fee and the snack | the Word's level rises; the commit names F |
| `Jackpot.resolve` (keeper) | nobody | the pot goes to the staker |
| `YieldDistributor.claim`, `Bounty.claim` (anyone) | nobody | the leaf's account |
| Move (existing) | nobody | the chosen wallet in the account |

### 4.3 The free snack: would approved feeding multiply it?

Yes, if it stayed keyed on the caller (Staking.sol:94-95). Each caretaker would bring its own free snack. A staker could name one wallet per Word and feed every Word free each day. Gas sponsorship would make the extra wallets cost nothing.

The fix in diff A: key the free snack on the staker (`freeSnackDayPlusOne[staker]`). Every feed of F's Words, from F or any caretaker, shares F's one free snack. Tests `test_Caretaker_cannotMultiplyFreeSnacks` and `test_Caretaker_feedsWithTheStakersFreeSnack` pin it.

What stays the same: there is one free snack per staking wallet per day, exactly as today. A player who stakes from both F and W gets two, as they can today. One per player is not possible onchain without option (b).

**Update (2026-11-24, Sepolia redeploy #4):** starl3xx ruled "only one wallet per profile should get a free anything", so the free snack is now one per PROFILE, without a registry. The server knows the profile, so it signs a voucher: `feedWithSnack(ids, staker, profile, deadline, sig)` names the caller, the staker of `ids[0]`, the staker's profile (its account), and the UTC day, and spends `freeSnackDayPlusOne[profile]`. A profile that already spent today's snack pays, with no revert. Plain `feed` and `feedMany` always pay. The snack stays the STAKER's profile's, whoever feeds, so caretakers in other profiles still can't multiply it. Tests: `test_Staking_twoStakingWalletsInOneProfileShareOneFreeSnack`, `test_Staking_freeSnackVoucherChecks`, `test_Caretaker_cannotMultiplyFreeSnacks`.

One side effect: `feed` has no "already fed" guard. A caretaker can use up the staker's free snack by feeding a Word that was just fed. That is a reason to keep feeding limited to named wallets, not open to anyone.

### 4.4 Words operator approval also reaches marketplaces. Is that acceptable?

For spending held Words (the pull), yes. That is the standard ERC-721 meaning of an operator, and it is already true today for any operator a player approves.

For staked Words, no. That is why diff A uses a separate caretaker list and not `Words.isApprovedForAll`. Test `test_Caretaker_onlyNamedWalletsAndRevocable` pins that a Words operator gets nothing on Staking. Mutation 4 shows the tests catch a switch to operator approval.

The players' existing operators: Staking is the Words operator of every staker (stake needs it). The letter swap approves Seaport on Letters, not on Words (src/lib/onchain/seaport.ts:6-16). A player who lists a Word on a marketplace approves that marketplace's conduit on Words. None of these can call Staking, and none becomes a caretaker.

### 4.5 Jackpot, yield, and bounty

- **Jackpot:** only the keeper resolves it (Jackpot.sol:67). It pays `staking.beneficialOwner(tokenId)`, the staker (Jackpot.sol:78-79). Feeding by a caretaker keeps the Word eligible (staked and not hungry), and the pot still pays the staker. A Word that W pulled and restaked pays W.
- **Yield and bounty:** the keeper writes each leaf with the beneficial owner as the account. Anyone may send the claim, and the money goes to that account (MerkleEpochs.sol:87-101). The app already claims for every wallet in the bag. Nothing breaks.
- **Eligibility:** both read only "staked and not hungry". Caretaker feeding counts.

### 4.6 What redeploys, and what refers to it

| Contract | Why | Referred to by (Deploy.s.sol) |
|---|---|---|
| Staking | its code changes | Prestige constructor, immutable (Prestige.sol:28; Deploy.s.sol:94-96); Jackpot constructor, immutable (Jackpot.sol:27; Deploy.s.sol:98-100); `Rolls.setStaking` (Deploy.s.sol:134); `FeeRouter.setCollector` (Deploy.s.sol:114); `setMaxMoveBps` and `setPriceKeeper` (Deploy.s.sol:146, 152) |
| Rolls | its code changes | `FeeRouter.setCollector` (Deploy.s.sol:113); `Letters.setUpgrader` (Deploy.s.sol:120); `Words.setRolls` (Deploy.s.sol:132); `setMaxMoveBps` and `setPriceKeeper` (Deploy.s.sol:145, 151) |
| Prestige | its code changes, and it holds Staking as an immutable | `FeeRouter.setCollector` (Deploy.s.sol:115); `Words.setPrestige` (Deploy.s.sol:133); `setMaxMoveBps` and `setPriceKeeper` (Deploy.s.sol:147, 153) |
| Jackpot | no code change, but it holds Staking as an immutable | `FeeRouter.setPayers` as `jackpotPayer` (Deploy.s.sol:116); `AnswerChain.setKeeper` (Deploy.s.sol:138) |
| FeeRouter, Letters, Words, AnswerChain, YieldDistributor, Bounty | unchanged | |

**Mainnet:** nothing is deployed, so the normal deploy uses the new code. `Deploy.s.sol` needs no edit, because no constructor changes.

**Base Sepolia:** a full redeploy is simpler and safer, as on 2026-11-21 (41 transactions; docs/web3-runtime-plan.md:30-35). A partial redeploy has traps:
- Reveal every open roll and ascension in the old Rolls and Prestige first. After `Words.setRolls` and `Words.setPrestige` move to the new contracts, the old ones' reveals revert (Words.sol:162, 175), and their fees are stranded.
- Keep the old Rolls as a Letters upgrader until its open loose rolls are revealed (Letters.sol:285).
- The new Jackpot starts with `lastResolvedDay = 0`, so it could resolve a second time on a UTC day the old one already resolved (Jackpot.sol:68-69).
- Words staked in the old Staking stay there. Their stakers must unstake from the old contract and stake again.
- Transfer ownership of the new Rolls and Prestige, which start owned by the deployer.

Offchain, either way: `config/deployments.base-sepolia.json` (addresses and `deployBlock`), `src/lib/onchain/abis.ts` (`npm run derive:abis`), `contracts/erc7730/calldata-Staking.json`, and the admin console's contract list (`src/lib/admin/contracts.ts`), if it lists player functions.

### 4.7 Security: what can a compromised linked wallet do?

| Setup | A compromised wallet can |
|---|---|
| Today (no change) | Only take what it holds itself. The database link gives no onchain power. |
| Diff A only (caretaker) | Annoy, not steal: use up the staker's free snack each day, and open word rolls and ascensions with its own $WORD, which hold the owner's open slot until revealed. It cannot move any asset. A failed roll or ascension never harms a Word. |
| Diff A + diff B | Also unstake the staker's Words, back to the staker. They lose jackpot and yield eligibility until restaked. Nothing is taken. |
| Approvals (pull then act) | Take every loose letter and held Word in each wallet that approved it, and $WORD up to the allowance (all of it with a max allowance). |
| Approvals + diff B | Also take staked Words (unstake to the staker, then transfer). |
| (b) Registry | Everything the game contracts can reach in every linked wallet, including all $WORD through the standing max allowances. A registry bug or a wrong link does the same for any account. |
| (b') Delegate Registry | The same as the caretaker setup, plus any wallet a player once delegated wallet-wide for another purpose. |
| (c) EIP-7702 | Everything in the account, game or not, including ETH. |
| (d) Recipient parameter | Only send its own outputs somewhere else. |

## 5. Open questions for the owner

1. **Diff B:** may a caretaker unstake (back to the staker)? It is convenient from the web. It ends the rule that a staked Word leaves Staking only by its staker's own transaction.
2. **Approvals:** should the app offer token approvals between the player's wallets at all? If yes: opt-in per wallet pair, and what cap for $WORD (or $WORD only through Move)?
3. **Caretaker setup:** offer it automatically for every linked wallet (one prompt per staking wallet per sibling), or only on request?
4. **Free snack:** ~~confirm "one free snack per staking wallet per day"~~ Ruled 2026-11-24: one per profile, on a signer voucher (see the update in §4.3).
5. **Held Words:** diff A limits caretakers to staked Words. Rolling a held Word from another wallet uses the approvals (pull, then roll). Should a caretaker also roll held Words? That would remove one condition in Rolls and one test.
6. **Unlink:** should Unlink wait until the onchain grants are revoked, or only warn? The database cannot revoke them.
7. **Base Sepolia:** a full redeploy (recommended) or a partial one?
8. **Grant targets:** may a wallet that joined the account through Farcaster (`via: farcaster`, src/lib/profile/farcasterWallets.ts) receive caretaker rights or approvals, or only wallets linked by signature and the account's first wallet?
9. **Before choosing the batch handling:** test on Base Sepolia inside Farcaster: a pull-then-claim batch, a failed middle call, and the wallet's security warnings for `setApprovalForAll` and `approve` to a personal wallet.

## Sources checked during this research

- Farcaster mini app wallet guide: miniapps.farcaster.xyz/docs/guides/wallets (batch execution, scanning, paymaster).
- MetaMask batch transactions: docs.metamask.com/wallet/how-to/send-transactions/send-batch-transactions/.
- ERC-5792: eips.ethereum.org/EIPS/eip-5792 (`atomicRequired`, status values, error 5760).
- Coinbase Wallet batch transactions: docs.cdp.coinbase.com/coinbase-wallet/improve-ux/batch-transactions.md (shows `atomicRequired: true`; no reported status read).
- Delegate Registry addresses: docs.delegate.xyz (contract addresses); source: github.com/delegatexyz/delegate-registry, `src/DelegateRegistry.sol`, `checkDelegateForContract`; onchain check with `cast code` and `cast call` against sepolia.base.org and mainnet.base.org.
