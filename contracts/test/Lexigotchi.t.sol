// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {MockERC20} from "./mocks/MockERC20.sol";
import {MockSwapRouter} from "./mocks/MockSwapRouter.sol";
import {LettersHarness} from "./harness/LettersHarness.sol";

import {FeeRouter} from "../src/FeeRouter.sol";
import {Letters} from "../src/Letters.sol";
import {MerkleEpochs} from "../src/MerkleEpochs.sol";
import {Words} from "../src/Words.sol";
import {Rolls} from "../src/Rolls.sol";
import {Staking} from "../src/Staking.sol";
import {Prestige} from "../src/Prestige.sol";
import {AnswerChain} from "../src/AnswerChain.sol";
import {Jackpot} from "../src/Jackpot.sol";
import {YieldDistributor} from "../src/YieldDistributor.sol";
import {Bounty} from "../src/Bounty.sol";
import {IFeeRouter, FeeSource} from "../src/interfaces/IFeeRouter.sol";
import {ILetters} from "../src/interfaces/ILetters.sol";
import {IWords, CaseState} from "../src/interfaces/IWords.sol";
import {IStaking} from "../src/interfaces/IStaking.sol";

/// @notice Full-system integration tests for the Lexigotchi contracts. Deploys and wires every
///         contract exactly as the deploy script does, then exercises the load-bearing invariants:
///         four-bucket solvency, one-word-one-NFT + case-as-state, fail-is-a-no-op rolls, pity keyed
///         on the beneficial owner, hunger-gated jackpot, the pre-committed AnswerChain, monotonic
///         prestige, and the Merkle-epoch yield/bounty distributors.
contract LexigotchiTest is Test {
    MockERC20 word;
    MockSwapRouter swap;
    FeeRouter feeRouter;
    LettersHarness letters;
    Words words;
    Rolls rolls;
    Staking staking;
    Prestige prestige;
    AnswerChain answerChain;
    Jackpot jackpot;
    YieldDistributor yield_;
    Bounty bounty;

    uint256 constant SIGNER_PK = 0xA11CE;
    address signer;
    address keeper = makeAddr("keeper");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant PACK = 100e18;
    uint256 constant DAILY = 5e18;
    uint256 constant ROLL = 25e18;
    uint256 constant CLAIM = 50e18;
    uint256 constant SNACK = 2e18;
    uint256 constant PRESTIGE_FEE = 25e18;

    // 4 dictionary words → a 4-leaf Merkle tree (all-distinct letters, easy to fund).
    string[4] WORDS_ = ["CRANE", "MOTEL", "GRAPE", "BLAZE"];
    bytes32 dictRoot;
    bytes32[4] leaves;

    function setUp() public {
        signer = vm.addr(SIGNER_PK);
        word = new MockERC20();
        swap = new MockSwapRouter(word, 1e12);
        feeRouter = new FeeRouter(word, treasury, address(this));

        uint32[26] memory cap;
        for (uint8 i = 0; i < 26; i++) {
            cap[i] = 1000;
        }
        letters = new LettersHarness(word, feeRouter, cap, PACK, DAILY, signer, "ipfs://letters/", address(this));

        _buildTree();
        words = new Words(word, feeRouter, ILetters(address(letters)), dictRoot, CLAIM, address(this));
        rolls = new Rolls(word, feeRouter, ILetters(address(letters)), IWords(address(words)), ROLL, signer);
        staking = new Staking(word, feeRouter, IWords(address(words)), SNACK, 1 days, 3 days, address(this));
        prestige =
            new Prestige(word, feeRouter, IWords(address(words)), IStaking(address(staking)), 4, PRESTIGE_FEE, SNACK, signer);

        bytes32 head = keccak256(abi.encode("CRANE", keccak256("salt1"), bytes32(0)));
        answerChain = new AnswerChain(head, keeper, address(this));
        jackpot = new Jackpot(feeRouter, IWords(address(words)), IStaking(address(staking)), answerChain, keeper, address(this));
        yield_ = new YieldDistributor(word, feeRouter, keeper, address(this));
        bounty = new Bounty(word, feeRouter, keeper, address(this));

        // wiring
        feeRouter.setCollector(address(letters), true);
        feeRouter.setCollector(address(words), true);
        feeRouter.setCollector(address(rolls), true);
        feeRouter.setCollector(address(staking), true);
        feeRouter.setCollector(address(prestige), true);
        feeRouter.setPayers(address(yield_), address(jackpot), address(bounty));
        _setSplits();
        letters.setUpgrader(address(rolls), true); // loose-letter rolls
        letters.setUpgrader(address(words), true); // escrowed-letter rolls (burn/mint on escrow)
        letters.setSwapRouter(swap);
        words.setRolls(address(rolls));
        words.setPrestige(address(prestige));
        rolls.setStaking(IStaking(address(staking)));
        answerChain.setKeeper(address(jackpot)); // Jackpot reveals + resolves atomically

        word.mint(alice, 1e30);
        word.mint(bob, 1e30);
    }

    // ---------------------------------------------------------------------------------------------
    // FeeRouter — four-bucket split + solvency
    // ---------------------------------------------------------------------------------------------

    function test_FeeRouter_splitsAndSolvency() public {
        // deliver a fee as the (mock) PACK collector path: alice pays a pack, reveal not needed here
        _approveAll(alice);
        vm.prank(alice);
        letters.commitPack();

        // pack split = 40/10/20/30
        assertEq(feeRouter.poolBalance(), (PACK * 4000) / 10000, "pool");
        assertEq(feeRouter.jackpotBalance(), (PACK * 1000) / 10000, "jackpot");
        assertEq(word.balanceOf(treasury), (PACK * 3000) / 10000, "treasury");
        assertEq(word.balanceOf(feeRouter.BURN_ADDRESS()), (PACK * 2000) / 10000, "burn");

        // invariant: held $WORD >= sum of the live buckets
        assertGe(
            word.balanceOf(address(feeRouter)),
            feeRouter.poolBalance() + feeRouter.jackpotBalance() + feeRouter.bountyBalance(),
            "solvency"
        );
    }

    function test_FeeRouter_payoutsCapAtBucketBalance() public {
        _approveAll(alice);
        vm.prank(alice);
        letters.commitPack();
        uint256 pot = feeRouter.jackpotBalance();

        // jackpotPayer (the jackpot contract) is the only authorized caller; impersonate it
        vm.prank(address(jackpot));
        uint256 paid = feeRouter.payFromJackpot(bob, pot * 10); // ask for more than exists
        assertEq(paid, pot, "capped at balance");
        assertEq(feeRouter.jackpotBalance(), 0, "drained, not negative");
    }

    function test_FeeRouter_onlyCollectorCanRoute() public {
        word.mint(address(this), 1e18);
        word.transfer(address(feeRouter), 1e18);
        vm.expectRevert(FeeRouter.NotCollector.selector);
        feeRouter.route(FeeSource.ROLL, 1e18);
    }

    // ---------------------------------------------------------------------------------------------
    // Letters — pack mint commit/reveal, caps, daily FID gate
    // ---------------------------------------------------------------------------------------------

    function test_PackMint_commitReveal_mintsFiveLowercase() public {
        _approveAll(alice);
        vm.prank(alice);
        uint256 id = letters.commitPack();

        uint8[] memory draw = new uint8[](5);
        for (uint8 i = 0; i < 5; i++) {
            draw[i] = i; // the signer's demand-mirrored draw (A..E here)
        }
        letters.reveal(id, draw, _signPack(id, alice, draw));

        uint256 total;
        for (uint8 i = 0; i < 26; i++) {
            total += letters.balanceOf(alice, i); // lowercase ids 0..25
        }
        assertEq(total, 5, "five lowercase letters");
    }

    function test_PackReveal_badSignatureReverts() public {
        _approveAll(alice);
        vm.prank(alice);
        uint256 id = letters.commitPack();
        uint8[] memory draw = new uint8[](5);
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(address(letters), block.chainid, id, alice, draw))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBEEF, digest); // wrong key
        vm.expectRevert(Letters.BadSignature.selector);
        letters.reveal(id, draw, abi.encodePacked(r, s, v));
    }

    function test_DailyMint_fidGate() public {
        _approveAll(alice);
        uint256 fid = 6500;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signDaily(alice, fid, deadline);

        vm.prank(alice);
        letters.commitDaily(fid, deadline, sig);
        assertEq(letters.dailyUsed(fid), uint32(block.timestamp / 1 days) + 1, "marked used today");

        // second use same day reverts
        vm.prank(alice);
        vm.expectRevert(Letters.DailyAlreadyUsed.selector);
        letters.commitDaily(fid, deadline, sig);
    }

    function test_DailyMint_badSignatureReverts() public {
        _approveAll(alice);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signDaily(bob, 1, deadline); // signed for bob, used by alice
        vm.prank(alice);
        vm.expectRevert(Letters.BadSignature.selector);
        letters.commitDaily(1, deadline, sig);
    }

    // ---------------------------------------------------------------------------------------------
    // Words — claim (one-per-word, case derived), dissolve (recover + free name)
    // ---------------------------------------------------------------------------------------------

    function test_Claim_oneWordOneNFT_caseDerived() public {
        uint256 tokenId = _claimLower(alice, 0); // CRANE
        assertEq(words.ownerOf(tokenId), alice, "alice owns it");
        assertEq(uint8(words.caseOf(tokenId)), uint8(CaseState.Lowercase), "lowercase");
        assertEq(tokenId, uint256(keccak256(bytes("CRANE"))), "tokenId = keccak(word)");

        // claiming the same word again is unrepresentable
        _fundLower(bob, "CRANE");
        vm.startPrank(bob);
        word.approve(address(words), type(uint256).max);
        letters.setApprovalForAll(address(words), true);
        vm.expectRevert(Words.AlreadyClaimed.selector);
        words.claim("CRANE", false, _proof(0));
        vm.stopPrank();
    }

    function test_Claim_rejectsNonDictionaryWord() public {
        _fundLower(alice, "ZZZZZ");
        vm.startPrank(alice);
        word.approve(address(words), type(uint256).max);
        letters.setApprovalForAll(address(words), true);
        vm.expectRevert(Words.NotInDictionary.selector);
        words.claim("ZZZZZ", false, _proof(0)); // wrong proof / not a leaf
        vm.stopPrank();
    }

    function test_Dissolve_recoversLettersAndFreesName() public {
        uint256 tokenId = _claimLower(alice, 0); // CRANE
        vm.prank(alice);
        words.dissolve(tokenId, "CRANE");

        assertFalse(words.exists(tokenId), "burned");
        // the five lowercase letters are back
        assertEq(letters.balanceOf(alice, 2), 1, "C back");
        assertEq(letters.balanceOf(alice, 4), 1, "E back");
        // name is re-claimable
        _fundLower(bob, "CRANE");
        vm.startPrank(bob);
        word.approve(address(words), type(uint256).max);
        letters.setApprovalForAll(address(words), true);
        uint256 reId = words.claim("CRANE", false, _proof(0));
        vm.stopPrank();
        assertEq(words.ownerOf(reId), bob, "bob re-claimed");
    }

    // ---------------------------------------------------------------------------------------------
    // Rolls — fail is a no-op, pity keying, escrow mutation / case progression
    // ---------------------------------------------------------------------------------------------

    function test_LooseRoll_failIsNoop_thenSuccessUpgrades() public {
        _fundLower(alice, "AAAAA"); // 5 lowercase A (idx 0)
        _approveAll(alice);

        // commit + reveal FAIL → no upgrade, pity bumps, asset untouched
        vm.prank(alice);
        uint256 id0 = rolls.commitLooseRoll(0);
        rolls.reveal(id0, false, _signRoll(id0, alice, 0, false));
        assertEq(letters.balanceOf(alice, 0), 5, "still 5 lowercase A");
        assertEq(letters.balanceOf(alice, 26), 0, "no uppercase A");
        assertEq(rolls.pityOf(alice, 0), 1, "pity bumped");

        // commit + reveal SUCCESS → one A raised, pity reset
        vm.prank(alice);
        uint256 id1 = rolls.commitLooseRoll(0);
        rolls.reveal(id1, true, _signRoll(id1, alice, 0, true));
        assertEq(letters.balanceOf(alice, 0), 4, "one A consumed");
        assertEq(letters.balanceOf(alice, 26), 1, "one uppercase A");
        assertEq(rolls.pityOf(alice, 0), 0, "pity reset");
    }

    function test_Reveal_badSignatureReverts() public {
        _fundLower(alice, "AAAAA");
        _approveAll(alice);
        vm.prank(alice);
        uint256 id = rolls.commitLooseRoll(0);
        // sign with the wrong key
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(address(rolls), block.chainid, id, alice, uint8(0), true))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBEEF, digest);
        vm.expectRevert(Rolls.BadSignature.selector);
        rolls.reveal(id, true, abi.encodePacked(r, s, v));
    }

    function test_WordRoll_caseProgressionAndPityKeyedToBeneficialOwner() public {
        uint256 tokenId = _claimLower(alice, 0); // CRANE lowercase
        _approveAll(alice);

        // raise position 0 (C) — Mixed
        vm.prank(alice);
        uint256 id0 = rolls.commitWordRoll(tokenId, 0);
        rolls.reveal(id0, true, _signRoll(id0, alice, 2, true)); // C = idx 2
        assertEq(uint8(words.caseOf(tokenId)), uint8(CaseState.Mixed), "mixed after one");

        // stake it, then a word-roll must still be authorized by the BENEFICIAL owner (alice),
        // not the staking contract that now holds the NFT
        vm.startPrank(alice);
        words.approve(address(staking), tokenId);
        staking.stake(tokenId);
        vm.stopPrank();
        assertEq(words.ownerOf(tokenId), address(staking), "staking custodies the NFT");
        assertEq(rolls.beneficialOwnerOf(tokenId), alice, "alice is still the beneficial owner");

        vm.prank(bob);
        vm.expectRevert(Rolls.NotBeneficialOwner.selector);
        rolls.commitWordRoll(tokenId, 1); // bob can't roll alice's staked word

        // raise the remaining four to reach UPPERCASE
        uint8[4] memory pos = [uint8(1), 2, 3, 4];
        uint8[4] memory li = [uint8(17), 0, 13, 4]; // R,A,N,E
        for (uint256 k = 0; k < 4; k++) {
            vm.prank(alice);
            uint256 id = rolls.commitWordRoll(tokenId, pos[k]);
            rolls.reveal(id, true, _signRoll(id, alice, li[k], true));
        }
        assertEq(uint8(words.caseOf(tokenId)), uint8(CaseState.Uppercase), "fully raised");
    }

    // ---------------------------------------------------------------------------------------------
    // Staking + Jackpot + AnswerChain
    // ---------------------------------------------------------------------------------------------

    function test_Jackpot_paysStakedFedHolder_elseRollsOver() public {
        // fund the pot
        _approveAll(bob);
        vm.prank(bob);
        letters.commitPack(); // routes a jackpot share

        uint256 tokenId = _claimLower(alice, 0); // CRANE (the day's answer)
        vm.startPrank(alice);
        words.approve(address(staking), tokenId);
        staking.stake(tokenId);
        vm.stopPrank();

        uint256 pot = feeRouter.jackpotBalance();
        uint256 before = word.balanceOf(alice);
        // reveal + resolve today's word atomically
        vm.prank(keeper);
        bool won = jackpot.resolve("CRANE", keccak256("salt1"), bytes32(0));
        assertTrue(won, "staked + fed holder wins");
        assertEq(word.balanceOf(alice) - before, pot, "paid the full pot");
        assertEq(feeRouter.jackpotBalance(), 0, "pot emptied");
    }

    function test_Jackpot_rollsOverWhenHungry() public {
        _approveAll(bob);
        vm.prank(bob);
        letters.commitPack();

        uint256 tokenId = _claimLower(alice, 0);
        vm.startPrank(alice);
        words.approve(address(staking), tokenId);
        staking.stake(tokenId);
        vm.stopPrank();

        vm.warp(block.timestamp + 4 days); // unfed past the hungry threshold
        assertTrue(staking.isHungry(tokenId), "hungry");

        uint256 pot = feeRouter.jackpotBalance();
        vm.prank(keeper);
        bool won = jackpot.resolve("CRANE", keccak256("salt1"), bytes32(0));
        assertFalse(won, "hungry word can't win");
        assertEq(feeRouter.jackpotBalance(), pot, "pot rolls over intact");
    }

    function test_AnswerChain_badRevealReverts() public {
        // resolve advances the chain; a wrong word fails the hash-chain check and reverts
        vm.prank(keeper);
        vm.expectRevert(AnswerChain.BadReveal.selector);
        jackpot.resolve("MOTEL", keccak256("salt1"), bytes32(0));
    }

    function test_AnswerChain_setHeadLockedMidStream() public {
        bytes32 terminal = bytes32(0);
        bytes32 h2 = keccak256(abi.encode("MOTEL", keccak256("s2"), terminal));
        bytes32 h1 = keccak256(abi.encode("CRANE", keccak256("s1"), h2));
        AnswerChain ac = new AnswerChain(h1, address(this), address(this)); // keeper = this (reveal directly)

        ac.setHead(h1); // allowed before any reveal (initial setup)
        ac.reveal("CRANE", keccak256("s1"), h2); // day 1 → currentCommit = h2 (nonzero), mid-stream

        vm.expectRevert(AnswerChain.ChainLive.selector);
        ac.setHead(keccak256("evil")); // can't rewrite a live chain

        ac.reveal("MOTEL", keccak256("s2"), terminal); // day 2 → currentCommit = 0, exhausted
        ac.setHead(keccak256("rotated")); // rotation allowed once exhausted
    }

    // ---------------------------------------------------------------------------------------------
    // Prestige
    // ---------------------------------------------------------------------------------------------

    function test_Prestige_monotonic_failIsNoop() public {
        uint256 tokenId = _claimUpper(alice, 0); // CRANE, fully UPPERCASE
        _approveAll(alice);
        vm.startPrank(alice);
        words.approve(address(staking), tokenId);
        staking.stake(tokenId);
        vm.stopPrank();

        // fail → level unchanged, pity bumps
        vm.prank(alice);
        uint256 id0 = prestige.commitPrestige(tokenId);
        prestige.reveal(id0, false, _signPrestige(id0, tokenId, alice, false));
        assertEq(words.prestigeLevel(tokenId), 0, "still level 0 on fail");
        assertEq(prestige.prestigePity(tokenId), 1, "pity bumped");

        // success → level 1, pity reset
        vm.prank(alice);
        uint256 id1 = prestige.commitPrestige(tokenId);
        prestige.reveal(id1, true, _signPrestige(id1, tokenId, alice, true));
        assertEq(words.prestigeLevel(tokenId), 1, "level 1");
        assertEq(prestige.prestigePity(tokenId), 0, "pity reset");
    }

    function test_Prestige_requiresFullUppercase() public {
        uint256 tokenId = _claimLower(alice, 0);
        _approveAll(alice);
        vm.startPrank(alice);
        words.approve(address(staking), tokenId);
        staking.stake(tokenId);
        vm.expectRevert(Prestige.NotFullyRaised.selector);
        prestige.commitPrestige(tokenId);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------------------------------
    // Merkle epochs — yield + bounty (funding + solvency + double-claim guard)
    // ---------------------------------------------------------------------------------------------

    function test_Yield_merkleClaim_fundedFromPool() public {
        _approveAll(bob);
        vm.prank(bob);
        letters.commitPack(); // grows the pool
        uint256 pool = feeRouter.poolBalance();
        uint256 amount = pool / 2;

        // a single-leaf "tree": root == leaf, empty proof
        uint256 tokenId = 777;
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(tokenId, alice, amount))));

        vm.prank(keeper);
        yield_.openEpoch(1, leaf, amount, 0);
        assertEq(feeRouter.poolBalance(), pool - amount, "pulled from pool");

        bytes32[] memory empty = new bytes32[](0);
        uint256 before = word.balanceOf(alice);
        yield_.claim(1, tokenId, alice, amount, empty);
        assertEq(word.balanceOf(alice) - before, amount, "alice received yield");

        // double claim reverts
        vm.expectRevert(MerkleEpochs.AlreadyClaimed.selector);
        yield_.claim(1, tokenId, alice, amount, empty);
    }

    function test_Bounty_openEpochCannotExceedBucket() public {
        // bounty bucket is empty (carve is 0 by default) → opening any positive epoch underfunds
        vm.prank(keeper);
        vm.expectRevert(MerkleEpochs.Underfunded.selector);
        bounty.openEpoch(1, bytes32(uint256(1)), 1e18, 0);
    }

    function test_BountyCarve_divertsPoolShare() public {
        feeRouter.setBountyCarveBps(1500); // 15%
        _approveAll(alice);
        vm.prank(alice);
        letters.commitPack();

        uint256 grossPool = (PACK * 4000) / 10000;
        uint256 carve = (grossPool * 1500) / 10000;
        assertEq(feeRouter.bountyBalance(), carve, "carve to bounty");
        assertEq(feeRouter.poolBalance(), grossPool - carve, "pool reduced by carve");
    }

    function test_RecoverUnclaimed_gatedByClaimWindow() public {
        _approveAll(bob);
        vm.prank(bob);
        letters.commitPack(); // grow the pool
        uint256 amount = feeRouter.poolBalance() / 4;
        uint256 tokenId = 555;
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(tokenId, alice, amount))));
        vm.prank(keeper);
        yield_.openEpoch(2, leaf, amount, 0);

        // shrinking the global window can't retroactively unlock a live epoch (it's snapshotted at open)
        yield_.setClaimWindow(0);

        // the owner cannot pull funds out of a LIVE epoch (players may still hold valid proofs)
        vm.expectRevert(MerkleEpochs.ClaimWindowOpen.selector);
        yield_.recoverUnclaimed(2, treasury);

        // …only after the claim window elapses
        vm.warp(block.timestamp + 91 days);
        uint256 before = word.balanceOf(treasury);
        yield_.recoverUnclaimed(2, treasury);
        assertEq(word.balanceOf(treasury) - before, amount, "remainder swept after window");
    }

    // ---------------------------------------------------------------------------------------------
    // helpers
    // ---------------------------------------------------------------------------------------------

    function _setSplits() internal {
        feeRouter.setSplit(FeeSource.PACK_MINT, FeeRouter.Split(4000, 1000, 2000, 3000));
        feeRouter.setSplit(FeeSource.DAILY_MINT, FeeRouter.Split(4000, 1000, 2000, 3000));
        feeRouter.setSplit(FeeSource.ROLL, FeeRouter.Split(4000, 2500, 2000, 1500));
        feeRouter.setSplit(FeeSource.CLAIM, FeeRouter.Split(2500, 2500, 2500, 2500));
        feeRouter.setSplit(FeeSource.SNACK, FeeRouter.Split(0, 0, 10000, 0));
        feeRouter.setSplit(FeeSource.PRESTIGE, FeeRouter.Split(4000, 2500, 2000, 1500));
        feeRouter.setSplit(FeeSource.ROYALTY, FeeRouter.Split(0, 0, 0, 10000));
    }

    function _approveAll(address who) internal {
        vm.startPrank(who);
        word.approve(address(letters), type(uint256).max);
        word.approve(address(words), type(uint256).max);
        word.approve(address(rolls), type(uint256).max);
        word.approve(address(staking), type(uint256).max);
        word.approve(address(prestige), type(uint256).max);
        letters.setApprovalForAll(address(words), true);
        vm.stopPrank();
    }

    function _fundLower(address who, string memory w) internal {
        bytes memory b = bytes(w);
        for (uint256 k = 0; k < b.length; k++) {
            letters.mintLower(who, uint8(uint8(b[k]) - 65), 1);
        }
    }

    function _fundUpper(address who, string memory w) internal {
        bytes memory b = bytes(w);
        for (uint256 k = 0; k < b.length; k++) {
            letters.mintUpper(who, uint8(uint8(b[k]) - 65), 1);
        }
    }

    function _claimLower(address who, uint256 wordIndex) internal returns (uint256 tokenId) {
        _fundLower(who, WORDS_[wordIndex]);
        _approveAll(who);
        vm.prank(who);
        tokenId = words.claim(WORDS_[wordIndex], false, _proof(wordIndex));
    }

    function _claimUpper(address who, uint256 wordIndex) internal returns (uint256 tokenId) {
        _fundUpper(who, WORDS_[wordIndex]);
        _approveAll(who);
        vm.prank(who);
        tokenId = words.claim(WORDS_[wordIndex], true, _proof(wordIndex));
    }

    // --- Merkle (4 leaves, sorted-pair, matching OZ MerkleProof) ---

    function _buildTree() internal {
        for (uint256 i = 0; i < 4; i++) {
            leaves[i] = keccak256(bytes.concat(keccak256(abi.encode(WORDS_[i]))));
        }
        bytes32 n01 = _hashPair(leaves[0], leaves[1]);
        bytes32 n23 = _hashPair(leaves[2], leaves[3]);
        dictRoot = _hashPair(n01, n23);
    }

    function _proof(uint256 i) internal view returns (bytes32[] memory p) {
        p = new bytes32[](2);
        if (i == 0) {
            p[0] = leaves[1];
            p[1] = _hashPair(leaves[2], leaves[3]);
        } else if (i == 1) {
            p[0] = leaves[0];
            p[1] = _hashPair(leaves[2], leaves[3]);
        } else if (i == 2) {
            p[0] = leaves[3];
            p[1] = _hashPair(leaves[0], leaves[1]);
        } else {
            p[0] = leaves[2];
            p[1] = _hashPair(leaves[0], leaves[1]);
        }
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    // --- signatures ---

    function _signPack(uint256 id, address buyer, uint8[] memory letterIndexes) internal view returns (bytes memory) {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(address(letters), block.chainid, id, buyer, letterIndexes))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signDaily(address buyer, uint256 fid, uint256 deadline) internal view returns (bytes memory) {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(address(letters), block.chainid, buyer, fid, deadline))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signRoll(uint256 id, address owner, uint8 li, bool success) internal view returns (bytes memory) {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(address(rolls), block.chainid, id, owner, li, success))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signPrestige(uint256 id, uint256 tokenId, address owner, bool success)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(address(prestige), block.chainid, id, tokenId, owner, success))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, digest);
        return abi.encodePacked(r, s, v);
    }
}
