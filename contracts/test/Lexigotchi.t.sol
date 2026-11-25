// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC20Errors, IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

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
import {SaleFees} from "../src/SaleFees.sol";
import {RepegKeeper} from "../src/RepegKeeper.sol";
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
    address priceKeeperHot = makeAddr("priceKeeper");

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
        staking = new Staking(word, feeRouter, IWords(address(words)), SNACK, 1 days, 3 days, signer, address(this));
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
        uint256 supplyBefore = word.totalSupply();
        vm.prank(alice);
        letters.commitPack();

        // pack split = 40/10/20/30
        assertEq(feeRouter.poolBalance(), (PACK * 4000) / 10000, "pool");
        assertEq(feeRouter.jackpotBalance(), (PACK * 1000) / 10000, "jackpot");
        assertEq(word.balanceOf(treasury), (PACK * 3000) / 10000, "treasury");
        assertEq(supplyBefore - word.totalSupply(), (PACK * 2000) / 10000, "burned (totalSupply drop)");

        // invariant: held $WORD >= sum of the live buckets
        assertGe(
            word.balanceOf(address(feeRouter)),
            feeRouter.poolBalance() + feeRouter.jackpotBalance() + feeRouter.bountyBalance(),
            "solvency"
        );
    }

    /// The word-sale fee: Seaport pays it to SaleFees as a plain transfer; flush() routes it to the pool.
    function test_SaleFees_flushRoutesSaleFeesToThePool() public {
        SaleFees sf = new SaleFees(word, feeRouter);
        uint256 fee = 5e18;
        vm.prank(alice);
        word.transfer(address(sf), fee); // what a Seaport fill does with the fee item

        // Not a collector yet: flush reverts and the fee waits.
        vm.expectRevert(FeeRouter.NotCollector.selector);
        sf.flush();
        assertEq(word.balanceOf(address(sf)), fee, "the fee waits until the router registers SaleFees");

        feeRouter.setCollector(address(sf), true);
        uint256 pool0 = feeRouter.poolBalance();
        uint256 treasury0 = word.balanceOf(treasury);
        vm.prank(bob); // anyone may flush
        assertEq(sf.flush(), fee);
        assertEq(feeRouter.poolBalance() - pool0, fee, "all of it reaches the Rewards Pool");
        assertEq(word.balanceOf(treasury), treasury0, "none to Treasury");
        assertEq(word.balanceOf(address(sf)), 0, "nothing left behind");
        assertEq(sf.flush(), 0, "an empty flush is a no-op");

        // With the bounty carve on, the pool share is carved like any other.
        feeRouter.setBountyCarveBps(1500);
        vm.prank(alice);
        word.transfer(address(sf), 1e18);
        uint256 bounty0 = feeRouter.bountyBalance();
        sf.flush();
        assertEq(feeRouter.bountyBalance() - bounty0, 0.15e18, "15% carve to the bounty");
        assertEq(feeRouter.poolBalance() - pool0 - fee, 0.85e18, "85% to the pool");
    }

    function test_FeeRouter_rollAndClaimRakeIs10Pct() public {
        // Launch decision (2026-06): jackpot rake on ROLL + CLAIM cut 25%->10%, freed 15pp split
        // evenly to burn + pool (treasury flat). Pin both so the rake can't silently drift back.
        feeRouter.setCollector(address(this), true);
        uint256 amt = 1e18;

        // ROLL split = 47.5 / 10 / 27.5 / 15
        word.mint(address(this), amt);
        word.transfer(address(feeRouter), amt);
        uint256 jp = feeRouter.jackpotBalance();
        uint256 pool = feeRouter.poolBalance();
        uint256 supply = word.totalSupply();
        uint256 tre = word.balanceOf(treasury);
        feeRouter.route(FeeSource.ROLL, amt);
        assertEq(feeRouter.jackpotBalance() - jp, (amt * 1000) / 10000, "roll jackpot 10%");
        assertEq(feeRouter.poolBalance() - pool, (amt * 4750) / 10000, "roll pool 47.5%");
        assertEq(supply - word.totalSupply(), (amt * 2750) / 10000, "roll burn 27.5% (supply drop)");
        assertEq(word.balanceOf(treasury) - tre, (amt * 1500) / 10000, "roll treasury 15%");

        // CLAIM split = 32.5 / 10 / 32.5 / 25
        word.mint(address(this), amt);
        word.transfer(address(feeRouter), amt);
        jp = feeRouter.jackpotBalance();
        pool = feeRouter.poolBalance();
        supply = word.totalSupply();
        tre = word.balanceOf(treasury);
        feeRouter.route(FeeSource.CLAIM, amt);
        assertEq(feeRouter.jackpotBalance() - jp, (amt * 1000) / 10000, "claim jackpot 10%");
        assertEq(feeRouter.poolBalance() - pool, (amt * 3250) / 10000, "claim pool 32.5%");
        assertEq(supply - word.totalSupply(), (amt * 3250) / 10000, "claim burn 32.5% (supply drop)");
        assertEq(word.balanceOf(treasury) - tre, (amt * 2500) / 10000, "claim treasury 25%");
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

    function test_FeeRouter_seedPoolAndBounty() public {
        // owner (this test contract) tops up the Pool and Bounty buckets directly.
        word.mint(address(this), 10e18);
        word.approve(address(feeRouter), type(uint256).max);

        feeRouter.seed(0, 3e18); // Rewards Pool
        assertEq(feeRouter.poolBalance(), 3e18, "pool seeded");
        feeRouter.seed(2, 2e18); // Bounty
        assertEq(feeRouter.bountyBalance(), 2e18, "bounty seeded");

        // solvency invariant preserved: held >= sum of live buckets
        assertGe(
            word.balanceOf(address(feeRouter)),
            feeRouter.poolBalance() + feeRouter.jackpotBalance() + feeRouter.bountyBalance(),
            "solvency"
        );

        // seed() must NOT make seeded $WORD claimable as an unaccounted fee through route():
        // it raised both balanceOf and accounted by `amount`, so the surplus check is untouched.
        feeRouter.setCollector(address(this), true);
        vm.expectRevert(FeeRouter.FeeNotDelivered.selector);
        feeRouter.route(FeeSource.ROLL, 1e18);

        // the jackpot is intentionally NOT seedable (lottery-compliance: it self-funds from fees)
        vm.expectRevert(FeeRouter.JackpotNotSeedable.selector);
        feeRouter.seed(1, 1e18);
        // any other invalid bucket id reverts distinctly
        vm.expectRevert(FeeRouter.BadBucket.selector);
        feeRouter.seed(5, 1e18);

        // owner-only — pin the exact access-control revert (not a stray transfer/allowance revert)
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        feeRouter.seed(0, 1e18);
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
    // Letters — free campaign vouchers (free daily + one-time free pack), signer-gated, zero cost
    // ---------------------------------------------------------------------------------------------

    function test_FreeDaily_mintsFreeAndSharesGate() public {
        uint256 fid = 6500;
        uint256 deadline = block.timestamp + 1 hours;
        uint256 poolBefore = feeRouter.poolBalance();

        vm.prank(alice);
        uint256 id = letters.commitDailyFree(fid, deadline, _signFreeDaily(alice, fid, deadline));

        assertEq(feeRouter.poolBalance(), poolBefore, "no fee routed (free)");
        assertEq(word.balanceOf(address(letters)), 0, "no residual $WORD");
        assertEq(letters.dailyUsed(fid), uint32(block.timestamp / 1 days) + 1, "daily gate marked");

        // the unchanged reveal still draws exactly one capped lowercase
        uint8[] memory draw = new uint8[](1);
        draw[0] = 2; // 'c'
        letters.reveal(id, draw, _signPack(id, alice, draw));
        assertEq(letters.balanceOf(alice, 2), 1, "one lowercase minted");

        // shares the one-per-FID-per-day gate with the PAID daily (either path reverts the same day)
        vm.prank(alice);
        vm.expectRevert(Letters.DailyAlreadyUsed.selector);
        letters.commitDailyFree(fid, deadline, _signFreeDaily(alice, fid, deadline));
        vm.prank(alice);
        vm.expectRevert(Letters.DailyAlreadyUsed.selector);
        letters.commitDaily(fid, deadline, _signDaily(alice, fid, deadline));
    }

    function test_FreeDaily_rejectsWrongWalletKindAndExpiry() public {
        uint256 fid = 6500;
        uint256 deadline = block.timestamp + 1 hours;

        // voucher signed for bob, redeemed by alice
        vm.prank(alice);
        vm.expectRevert(Letters.BadSignature.selector);
        letters.commitDailyFree(fid, deadline, _signFreeDaily(bob, fid, deadline));

        // a PAID daily voucher cannot be replayed onto the free path (kind-tag separation)
        vm.prank(alice);
        vm.expectRevert(Letters.BadSignature.selector);
        letters.commitDailyFree(fid, deadline, _signDaily(alice, fid, deadline));

        // expired deadline
        vm.warp(deadline + 1);
        vm.prank(alice);
        vm.expectRevert(Letters.AllowanceExpired.selector);
        letters.commitDailyFree(fid, deadline, _signFreeDaily(alice, fid, deadline));
    }

    function test_FreePack_mintsFiveOnceFree() public {
        uint256 fid = 6500;
        uint256 deadline = block.timestamp + 1 hours;
        uint256 poolBefore = feeRouter.poolBalance();

        vm.prank(alice);
        uint256 id = letters.commitPackFree(fid, 1, deadline, _signFreePack(alice, fid, 1, deadline));

        assertEq(feeRouter.poolBalance(), poolBefore, "no fee routed (free)");
        assertTrue(letters.freePackClaimed(fid), "claimed flag set");

        uint8[] memory draw = new uint8[](5);
        for (uint8 i = 0; i < 5; i++) {
            draw[i] = i;
        }
        letters.reveal(id, draw, _signPack(id, alice, draw));
        uint256 total;
        for (uint8 i = 0; i < 26; i++) {
            total += letters.balanceOf(alice, i);
        }
        assertEq(total, 5, "five lowercase minted");

        // one-time: a second claim reverts even with a fresh nonce
        vm.prank(alice);
        vm.expectRevert(Letters.FreePackAlreadyClaimed.selector);
        letters.commitPackFree(fid, 2, deadline, _signFreePack(alice, fid, 2, deadline));
    }

    function test_FreePack_killSwitchKindAndWallet() public {
        uint256 fid = 7000;
        uint256 deadline = block.timestamp + 1 hours;

        // setFreePackOpen is owner-only
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        letters.setFreePackOpen(false);

        // a closed campaign rejects claims; re-opening restores them
        letters.setFreePackOpen(false);
        vm.prank(alice);
        vm.expectRevert(Letters.FreePackClosed.selector);
        letters.commitPackFree(fid, 1, deadline, _signFreePack(alice, fid, 1, deadline));
        letters.setFreePackOpen(true);

        // voucher signed for bob, redeemed by alice
        vm.prank(alice);
        vm.expectRevert(Letters.BadSignature.selector);
        letters.commitPackFree(fid, 1, deadline, _signFreePack(bob, fid, 1, deadline));

        // a free-DAILY voucher cannot be replayed as a free-PACK (kind-tag separation)
        vm.prank(alice);
        vm.expectRevert(Letters.BadSignature.selector);
        letters.commitPackFree(fid, 1, deadline, _signFreeDaily(alice, fid, deadline));
    }

    // ---------------------------------------------------------------------------------------------
    // Letters — ETH auto-swap mint paths (v0.2 §4): swap ETH→$WORD, route the price, refund excess
    // ---------------------------------------------------------------------------------------------

    function test_PackMintETH_swapsRefundsAndRoutes() public {
        // rate is 1e12 $WORD/wei; 1.5e8 wei → 150e18 out, packPrice 100e18, so 50e18 refunds.
        uint256 value = 15e7; // 1.5e8 wei
        uint256 out = value * swap.rate();
        assertEq(out, 150e18, "mock swap output");

        uint256 before = word.balanceOf(alice); // alice pays ETH, not $WORD
        vm.deal(alice, 1 ether);
        uint256 supplyBefore = word.totalSupply();
        vm.prank(alice);
        uint256 id = letters.commitPackETH{value: value}(PACK, block.timestamp + 1 hours); // minWordOut = packPrice

        // the swap mints $WORD to the collector; only the surplus over packPrice is refunded
        assertEq(word.balanceOf(alice) - before, out - PACK, "excess $WORD refunded to buyer");
        // packPrice routed through the PACK_MINT split (40/10/20/30 = pool/jackpot/burn/treasury)
        assertEq(feeRouter.poolBalance(), (PACK * 4000) / 10000, "pool");
        assertEq(feeRouter.jackpotBalance(), (PACK * 1000) / 10000, "jackpot");
        assertEq(word.balanceOf(treasury), (PACK * 3000) / 10000, "treasury");
        // burn reduces supply; supply also rose by the swap mint `out`, so isolate the burn
        assertEq(supplyBefore + out - word.totalSupply(), (PACK * 2000) / 10000, "burned (supply drop)");
        // nothing stranded in the collector, and a real pack commit was created
        assertEq(word.balanceOf(address(letters)), 0, "no residual $WORD held");
        assertEq(letters.commitCount(), id + 1, "commit recorded");
    }

    function test_PackMintETH_exactOutputNoRefund() public {
        // out == packPrice → the `if (refund > 0)` branch is skipped, buyer gets nothing back
        uint256 value = 1e8; // → 100e18 out == packPrice
        uint256 before = word.balanceOf(alice);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        letters.commitPackETH{value: value}(PACK, block.timestamp + 1 hours);
        assertEq(word.balanceOf(alice), before, "no refund on an exact swap");
        assertEq(feeRouter.poolBalance(), (PACK * 4000) / 10000, "pool funded");
        assertEq(word.balanceOf(address(letters)), 0, "no residual $WORD held");
    }

    function test_PackMintETH_insufficientOutputReverts() public {
        // out (50e18) < packPrice (100e18) → Letters reverts after the looser router slippage check
        uint256 value = 5e7; // → 50e18 out
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(Letters.InsufficientSwapOutput.selector);
        letters.commitPackETH{value: value}(0, block.timestamp + 1 hours); // minWordOut = 0 so the mock doesn't revert first
    }

    function test_PackMintETH_forwardsMinWordOut() public {
        // minWordOut is passed straight to the router; an unmeetable bound reverts inside the swap
        uint256 value = 1e8; // → 100e18 out
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(bytes("slippage"));
        letters.commitPackETH{value: value}(200e18, block.timestamp + 1 hours); // demand more than the swap yields
    }

    function test_PackMintETH_expiredDeadlineReverts() public {
        // a stale ETH-pack tx past its deadline reverts rather than swapping at a later, stale price
        uint256 value = 1e8; // → 100e18 out == packPrice (would otherwise succeed)
        vm.deal(alice, 1 ether);
        uint256 deadline = block.timestamp;
        vm.warp(block.timestamp + 1); // now one second past the deadline
        vm.prank(alice);
        vm.expectRevert(Letters.AllowanceExpired.selector);
        letters.commitPackETH{value: value}(PACK, deadline);
    }

    function test_DailyMintETH_swapsRefundsRoutesAndGatesFid() public {
        uint256 fid = 6500;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signDaily(alice, fid, deadline);

        uint256 value = 8e6; // → 8e18 out, dailyPrice 5e18, so 3e18 refunds
        uint256 before = word.balanceOf(alice);
        vm.deal(alice, 1 ether);

        vm.expectEmit(true, true, false, true, address(letters));
        emit Letters.DailyMinted(fid, alice, uint32(block.timestamp / 1 days));
        vm.prank(alice);
        letters.commitDailyETH{value: value}(fid, deadline, sig, DAILY);

        assertEq(letters.dailyUsed(fid), uint32(block.timestamp / 1 days) + 1, "FID marked used today");
        assertEq(word.balanceOf(alice) - before, (value * swap.rate()) - DAILY, "excess $WORD refunded");
        assertEq(feeRouter.poolBalance(), (DAILY * 4000) / 10000, "pool funded via daily split");
        assertEq(word.balanceOf(address(letters)), 0, "no residual $WORD held");

        // a second ETH daily for the same FID on the same day is still gated
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(Letters.DailyAlreadyUsed.selector);
        letters.commitDailyETH{value: value}(fid, deadline, sig, DAILY);
    }

    function test_DailyMintETH_insufficientOutputReverts() public {
        uint256 fid = 42;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signDaily(alice, fid, deadline);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(Letters.InsufficientSwapOutput.selector);
        letters.commitDailyETH{value: 2e6}(fid, deadline, sig, 0); // → 2e18 out < dailyPrice
    }

    function test_SetSwapRouter_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        letters.setSwapRouter(swap);
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
        words.claim("CRANE", 0, _proof(0));
        vm.stopPrank();
    }

    function test_Claim_rejectsNonDictionaryWord() public {
        _fundLower(alice, "ZZZZZ");
        vm.startPrank(alice);
        word.approve(address(words), type(uint256).max);
        letters.setApprovalForAll(address(words), true);
        vm.expectRevert(Words.NotInDictionary.selector);
        words.claim("ZZZZZ", 0, _proof(0)); // wrong proof / not a leaf
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
        uint256 reId = words.claim("CRANE", 0, _proof(0));
        vm.stopPrank();
        assertEq(words.ownerOf(reId), bob, "bob re-claimed");
    }

    // A word may be claimed in any mix of cases (decisions.md, "Mixed-case claims"). CRANE with its
    // C and A raised: mask bits 0 and 2.
    uint8 internal constant C_A_RAISED = 0x05;

    function _fundCraneMixed(address who) internal {
        letters.mintUpper(who, 2, 1); // C
        letters.mintLower(who, 17, 1); // r
        letters.mintUpper(who, 0, 1); // A
        letters.mintLower(who, 13, 1); // n
        letters.mintLower(who, 4, 1); // e
    }

    function test_Claim_mixedCase_escrowsEachLetterInItsCase() public {
        _fundCraneMixed(alice);
        _approveAll(alice);
        uint256 id = uint256(keccak256(bytes("CRANE")));
        vm.expectEmit(true, true, false, true, address(words));
        emit Words.Claimed(id, alice, "CRANE", C_A_RAISED);
        vm.prank(alice);
        uint256 tokenId = words.claim("CRANE", C_A_RAISED, _proof(0));

        assertEq(uint8(words.caseOf(tokenId)), uint8(CaseState.Mixed), "starts Mixed");
        (uint8 c, bool cUp) = words.escrowLetter(tokenId, 0);
        (uint8 r, bool rUp) = words.escrowLetter(tokenId, 1);
        assertEq(c, 2, "C at 0");
        assertTrue(cUp, "C is raised");
        assertEq(r, 17, "r at 1");
        assertFalse(rUp, "r is not");
        // Each letter left in the case it was named in.
        assertEq(letters.balanceOf(address(words), 2 + 26), 1, "UPPERCASE C escrowed");
        assertEq(letters.balanceOf(address(words), 17), 1, "lowercase r escrowed");
        assertEq(letters.balanceOf(alice, 2 + 26) + letters.balanceOf(alice, 17), 0, "alice has neither");

        // Dissolving gives each one back in its case.
        vm.prank(alice);
        words.dissolve(tokenId, "CRANE");
        assertEq(letters.balanceOf(alice, 2 + 26), 1, "UPPERCASE C back");
        assertEq(letters.balanceOf(alice, 0 + 26), 1, "UPPERCASE A back");
        assertEq(letters.balanceOf(alice, 4), 1, "lowercase e back");
    }

    function test_Claim_mixedCase_needsEachLetterInItsNamedCase() public {
        _fundLower(alice, "CRANE"); // all lowercase: no UPPERCASE C to escrow
        _approveAll(alice);
        vm.prank(alice);
        vm.expectRevert();
        words.claim("CRANE", C_A_RAISED, _proof(0));
    }

    function test_Claim_rejectsMaskBeyondFivePositions() public {
        _fundLower(alice, "CRANE");
        _approveAll(alice);
        vm.prank(alice);
        vm.expectRevert(Words.BadCaseMask.selector);
        words.claim("CRANE", 0x20, _proof(0));
    }

    // ---------------------------------------------------------------------------------------------
    // Metadata + royalty signal — Words tokenURI (owner-set base), EIP-2981 on both token contracts
    // ---------------------------------------------------------------------------------------------

    function test_Words_tokenURI_ownerSetBase() public {
        uint256 tokenId = _claimLower(alice, 0); // CRANE
        assertEq(words.tokenURI(tokenId), "", "blank until the owner sets a base URI");

        words.setBaseURI("https://lexigotchi.fun/api/word/");
        assertEq(
            words.tokenURI(tokenId),
            string.concat("https://lexigotchi.fun/api/word/", Strings.toString(tokenId)),
            "baseURI + decimal tokenId"
        );

        // an unclaimed word has no token, hence no URI
        uint256 unclaimed = uint256(keccak256(bytes("BLAZE")));
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, unclaimed));
        words.tokenURI(unclaimed);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        words.setBaseURI("x");
    }

    function test_RoyaltySignal_bothTokenContracts() public {
        // as the deploy script wires it: 2.5% → treasury, a SIGNAL only (open composability)
        letters.setDefaultRoyalty(treasury, 250);
        words.setDefaultRoyalty(treasury, 250);

        (address rcv, uint256 amt) = words.royaltyInfo(uint256(keccak256(bytes("CRANE"))), 1000e18);
        assertEq(rcv, treasury, "Words royalty to treasury");
        assertEq(amt, 25e18, "2.5% of the sale price");
        (rcv, amt) = letters.royaltyInfo(0, 1000e18);
        assertEq(rcv, treasury, "Letters royalty to treasury");
        assertEq(amt, 25e18, "2.5% of the sale price");

        assertTrue(words.supportsInterface(type(IERC2981).interfaceId), "Words signals 2981");
        assertTrue(letters.supportsInterface(type(IERC2981).interfaceId), "Letters signals 2981");

        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        words.setDefaultRoyalty(alice, 250);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        letters.setDefaultRoyalty(alice, 250);
        vm.stopPrank();
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
        // A real date from the start: resolve is once per UTC day and foundry's default timestamp
        // is day 0, which the guard treats as spent — and staking's lastFed must be set in the
        // same era or the warp would make the word ancient-hungry.
        vm.warp(1755000000);
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

    function test_Staking_freeSnackComesOnlyWithAVoucher() public {
        uint256 t1 = _claimLower(alice, 0); // CRANE
        uint256 t2 = _claimLower(alice, 1); // MOTEL
        _stake(alice, t1);
        _stake(alice, t2);
        _approveAll(alice);

        uint256 supply0 = word.totalSupply();
        vm.prank(alice);
        staking.feed(t1); // a plain feed always pays, even on the day's first feed
        assertEq(supply0 - word.totalSupply(), SNACK, "plain feed is paid + burned");

        _feedFree(alice, alice, alice, _ids(t2)); // the profile's free snack
        assertEq(supply0 - word.totalSupply(), SNACK, "the voucher's feed is free");

        _feedFree(alice, alice, alice, _ids(t1)); // a second voucher the same day: paid, no revert
        assertEq(supply0 - word.totalSupply(), 2 * SNACK, "one free snack a day per profile");

        vm.warp(block.timestamp + 1 days);
        _feedFree(alice, alice, alice, _ids(t1)); // new day → free again
        assertEq(supply0 - word.totalSupply(), 2 * SNACK, "the free snack resets the next day");
    }

    /// The fix (starl3xx: "only one wallet per profile should get a free anything"): two staking
    /// wallets in one profile share one free snack. Keyed per wallet, they took two a day.
    function test_Staking_twoStakingWalletsInOneProfileShareOneFreeSnack() public {
        address dave = makeAddr("dave"); // alice's second wallet: same profile, named by alice
        uint256 t1 = _claimLower(alice, 0);
        uint256 t2 = _claimLower(alice, 1);
        _stake(alice, t1);
        vm.prank(alice);
        words.transferFrom(alice, dave, t2);
        _stake(dave, t2);
        word.mint(dave, 1e30);
        _approveAll(alice);
        _approveAll(dave);

        uint256 supply0 = word.totalSupply();
        _feedFree(alice, alice, alice, _ids(t1));
        _feedFree(dave, dave, alice, _ids(t2)); // dave's voucher names the same profile
        assertEq(supply0 - word.totalSupply(), SNACK, "one free snack between the profile's wallets");
        assertEq(staking.freeSnackDayPlusOne(alice), uint32(block.timestamp / 1 days) + 1, "the profile's snack is used");
        assertEq(staking.freeSnackDayPlusOne(dave), 0, "nothing is keyed on the second wallet");
    }

    function test_Staking_freeSnackVoucherChecks() public {
        uint256 t1 = _claimLower(alice, 0);
        uint256 t2 = _claimLower(bob, 1);
        _stake(alice, t1);
        _stake(bob, t2);
        _approveAll(alice);
        _approveAll(bob);
        uint256 dl = block.timestamp + 600;
        uint32 day = uint32(block.timestamp / 1 days);

        // A voucher for alice's Words can't feed bob's: the staker is named, and checked.
        bytes memory sig = _signSnack(bob, alice, alice, dl);
        vm.prank(bob);
        vm.expectRevert(Staking.WrongStaker.selector);
        staking.feedWithSnack(_ids(t2), alice, alice, dl, sig);
        // …and naming bob as the staker doesn't match what was signed.
        vm.prank(bob);
        vm.expectRevert(Staking.BadSignature.selector);
        staking.feedWithSnack(_ids(t2), bob, alice, dl, sig);

        // A voucher is the named caller's only: bob can't spend alice's.
        sig = _signSnack(alice, alice, alice, dl);
        vm.prank(bob);
        vm.expectRevert(Staking.BadSignature.selector);
        staking.feedWithSnack(_ids(t1), alice, alice, dl, sig);

        // A stranger with a voucher naming alice still can't feed alice's Word (not a caretaker).
        sig = _signSnack(bob, alice, alice, dl);
        vm.prank(bob);
        vm.expectRevert(Staking.NotStaker.selector);
        staking.feedWithSnack(_ids(t1), alice, alice, dl, sig);

        // Another key's signature, another profile than signed, an expired voucher, nothing to feed.
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(address(staking), block.chainid, keccak256("lexigotchi.staking.freeSnack"), alice, alice, alice, day, dl))
        );
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(0xBEEF, digest);
        vm.prank(alice);
        vm.expectRevert(Staking.BadSignature.selector);
        staking.feedWithSnack(_ids(t1), alice, alice, dl, abi.encodePacked(r, ss, v));
        sig = _signSnack(alice, alice, alice, dl);
        vm.prank(alice);
        vm.expectRevert(Staking.BadSignature.selector);
        staking.feedWithSnack(_ids(t1), alice, bob, dl, sig);
        vm.prank(alice);
        vm.expectRevert(Staking.NothingToFeed.selector);
        staking.feedWithSnack(new uint256[](0), alice, alice, dl, sig);

        // The voucher is good for the day it names only, even before its deadline.
        uint256 longDl = block.timestamp + 2 days;
        bytes memory todays = _signSnack(alice, alice, alice, longDl);
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        vm.expectRevert(Staking.BadSignature.selector);
        staking.feedWithSnack(_ids(t1), alice, alice, longDl, todays);
        vm.warp(longDl + 1);
        sig = _signSnack(alice, alice, alice, longDl);
        vm.prank(alice);
        vm.expectRevert(Staking.VoucherExpired.selector);
        staking.feedWithSnack(_ids(t1), alice, alice, longDl, sig);
    }

    function test_Staking_freeSnackEventAndToggle() public {
        uint256 t1 = _claimLower(alice, 0);
        _stake(alice, t1);
        _approveAll(alice);
        vm.expectEmit(true, true, false, true, address(staking));
        emit Staking.FreeSnackUsed(alice, t1, uint32(block.timestamp / 1 days));
        _feedFree(alice, alice, alice, _ids(t1));

        staking.setFreeDailySnack(false);
        vm.warp(block.timestamp + 1 days);
        uint256 supply0 = word.totalSupply();
        _feedFree(alice, alice, alice, _ids(t1)); // the toggle off: a voucher pays like any feed
        assertEq(supply0 - word.totalSupply(), SNACK, "no free snack while the toggle is off");
        assertEq(staking.freeSnackDayPlusOne(alice), uint32(block.timestamp / 1 days), "and none is spent");
    }

    function test_Staking_signerIsOwnerSetAndNeverZero() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        staking.setSigner(alice);
        vm.expectRevert(Staking.ZeroAddress.selector);
        staking.setSigner(address(0));
        staking.setSigner(bob);
        assertEq(staking.signer(), bob);
        vm.expectRevert(Staking.ZeroAddress.selector);
        new Staking(word, feeRouter, IWords(address(words)), SNACK, 1 days, 3 days, address(0), address(this));
    }

    function test_Staking_feedOnlyByStaker() public {
        uint256 t1 = _claimLower(alice, 0); // CRANE
        _approveAll(alice);
        vm.startPrank(alice);
        words.approve(address(staking), t1);
        staking.stake(t1);
        vm.stopPrank();

        // a non-staker cannot feed someone else's staked word (least authority)
        vm.prank(bob);
        vm.expectRevert(Staking.NotStaker.selector);
        staking.feed(t1);
    }

    function test_AnswerChain_badRevealReverts() public {
        // resolve advances the chain; a wrong word fails the hash-chain check and reverts
        vm.warp(1755000000); // past the once-per-day guard; the chain check is what must fire
        vm.prank(keeper);
        vm.expectRevert(AnswerChain.BadReveal.selector);
        jackpot.resolve("MOTEL", keccak256("salt1"), bytes32(0));
    }

    function test_Jackpot_oncePerUtcDay() public {
        // The cadence the game promises is the cadence the contract enforces: a second resolve in
        // the same UTC day reverts BEFORE touching the chain, and the guard stores the REAL UTC
        // day (block.timestamp / 1 days), not the chain's reveal ordinal.
        vm.warp(1755000000);
        vm.prank(keeper);
        jackpot.resolve("CRANE", keccak256("salt1"), bytes32(0));
        assertEq(jackpot.lastResolvedDay(), uint32(uint256(1755000000) / 1 days), "stores the real UTC day");

        // Same day again: the DAY guard fires first — before the chain is even consulted.
        vm.prank(keeper);
        vm.expectRevert(Jackpot.AlreadyResolvedToday.selector);
        jackpot.resolve("MOTEL", keccak256("salt2"), bytes32(0));

        // Next day the gate opens: the failure moves to the CHAIN check (this test chain is one
        // word deep, so the reveal itself rejects) — proving the day guard released.
        vm.warp(1755000000 + 1 days);
        vm.prank(keeper);
        vm.expectRevert(AnswerChain.BadReveal.selector);
        jackpot.resolve("MOTEL", keccak256("salt2"), bytes32(0));
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

    function test_Prestige_parallelCommitsCannotExceedMax() public {
        uint256 tokenId = _claimUpper(alice, 0);
        _approveAll(alice);
        vm.startPrank(alice);
        words.approve(address(staking), tokenId);
        staking.stake(tokenId);
        vm.stopPrank();

        // ascend to level 3 (maxLevel - 1) sequentially
        for (uint8 i = 0; i < 3; i++) {
            vm.prank(alice);
            uint256 id = prestige.commitPrestige(tokenId);
            prestige.reveal(id, true, _signPrestige(id, tokenId, alice, true));
        }
        assertEq(words.prestigeLevel(tokenId), 3, "at level 3");

        // a second attempt can't open while the first is unrevealed (the audit fix: no banking
        // signed successes at the capped odds), so parallel commits can't race past maxLevel either
        vm.prank(alice);
        uint256 a1 = prestige.commitPrestige(tokenId);
        vm.prank(alice);
        vm.expectRevert(Prestige.AttemptOpen.selector);
        prestige.commitPrestige(tokenId);
        prestige.reveal(a1, true, _signPrestige(a1, tokenId, alice, true));
        assertEq(words.prestigeLevel(tokenId), 4, "reached max");
        vm.prank(alice);
        vm.expectRevert(Prestige.MaxLevel.selector);
        prestige.commitPrestige(tokenId);
    }

    function test_Prestige_unstakedRevealIsNoop() public {
        uint256 tokenId = _claimUpper(alice, 1);
        _approveAll(alice);
        vm.startPrank(alice);
        words.approve(address(staking), tokenId);
        staking.stake(tokenId);
        uint256 id = prestige.commitPrestige(tokenId);
        staking.unstake(tokenId); // unstake after paying the fee, before reveal
        vm.stopPrank();
        prestige.reveal(id, true, _signPrestige(id, tokenId, alice, true));
        assertEq(words.prestigeLevel(tokenId), 0, "an unstaked word never ascends");
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
        feeRouter.setSplit(FeeSource.ROLL, FeeRouter.Split(4750, 1000, 2750, 1500));
        feeRouter.setSplit(FeeSource.CLAIM, FeeRouter.Split(3250, 1000, 3250, 2500));
        feeRouter.setSplit(FeeSource.SNACK, FeeRouter.Split(0, 0, 10000, 0));
        feeRouter.setSplit(FeeSource.PRESTIGE, FeeRouter.Split(4750, 1000, 2750, 1500));
        feeRouter.setSplit(FeeSource.ROYALTY, FeeRouter.Split(10000, 0, 0, 0)); // word-sale fee → pool
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
        tokenId = words.claim(WORDS_[wordIndex], 0, _proof(wordIndex));
    }

    function _claimUpper(address who, uint256 wordIndex) internal returns (uint256 tokenId) {
        _fundUpper(who, WORDS_[wordIndex]);
        _approveAll(who);
        vm.prank(who);
        tokenId = words.claim(WORDS_[wordIndex], 0x1F, _proof(wordIndex));
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

    // ---------------------------------------------------------------------------------------------
    // RepegKeeper — clamped onlyPriceKeeper auto-repeg (no multisig in the loop)
    // ---------------------------------------------------------------------------------------------

    function test_Repeg_clampBandAndKeeperAccess() public {
        rolls.setMaxMoveBps(2000); // ±20%
        rolls.setPriceKeeper(priceKeeperHot);
        uint256 p0 = rolls.rollPrice();

        // the owner is NOT the price keeper — owner uses the unclamped setter, never repeg
        vm.expectRevert(RepegKeeper.NotPriceKeeper.selector);
        rolls.repegRollPrice(p0 + 1);

        // +20% is in band and applies verbatim
        uint256 up = p0 + (p0 * 2000) / 10000;
        vm.prank(priceKeeperHot);
        rolls.repegRollPrice(up);
        assertEq(rolls.rollPrice(), up, "repegged within band");

        // subsequent repegs must respect the per-contract cooldown
        vm.warp(block.timestamp + 5 minutes);

        // a move past the band reverts, in both directions
        vm.prank(priceKeeperHot);
        vm.expectRevert(RepegKeeper.RepegTooLarge.selector);
        rolls.repegRollPrice(up + (up * 2000) / 10000 + 1);
        vm.prank(priceKeeperHot);
        vm.expectRevert(RepegKeeper.RepegTooLarge.selector);
        rolls.repegRollPrice(up - (up * 2000) / 10000 - 1);

        // an unchanged value is a silent no-op
        vm.prank(priceKeeperHot);
        rolls.repegRollPrice(up);
        assertEq(rolls.rollPrice(), up, "unchanged no-op");
    }

    function test_Repeg_disabledByDefaultAndOwnerOnlyConfig() public {
        // priceKeeper defaults to address(0) → repeg is disabled until the owner wires it
        uint256 target = rolls.rollPrice() + 1; // hoist the view call out of the pranked/expectRevert call
        vm.prank(priceKeeperHot);
        vm.expectRevert(RepegKeeper.NotPriceKeeper.selector);
        rolls.repegRollPrice(target);

        // setPriceKeeper / setMaxMoveBps are owner-only — the keeper can't widen its band or re-point
        vm.prank(priceKeeperHot);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, priceKeeperHot));
        rolls.setMaxMoveBps(9000);
        vm.prank(priceKeeperHot);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, priceKeeperHot));
        rolls.setPriceKeeper(alice);
    }

    function test_Repeg_zeroGuardProtectsFreeDaily() public {
        letters.setMaxMoveBps(2000);
        letters.setPriceKeeper(priceKeeperHot);
        // the owner sets the daily FREE (dailyPrice == 0); the keeper can never move it off zero
        letters.setPrices(letters.packPrice(), 0);
        assertEq(letters.dailyPrice(), 0, "daily free");

        uint256 pack0 = letters.packPrice();
        vm.prank(priceKeeperHot);
        vm.expectRevert(RepegKeeper.RepegTooLarge.selector);
        letters.repegPrices(pack0, 1); // trying to start charging for the free daily

        // pack repegs within band; the unchanged (zero) daily leg is skipped
        uint256 pack1 = pack0 + (pack0 * 1000) / 10000; // +10%
        vm.prank(priceKeeperHot);
        letters.repegPrices(pack1, 0);
        assertEq(letters.packPrice(), pack1, "pack repegged");
        assertEq(letters.dailyPrice(), 0, "daily stays free");

        // (respect the cooldown before the next repeg) the keeper also cannot zero a live price
        vm.warp(block.timestamp + 5 minutes);
        vm.prank(priceKeeperHot);
        vm.expectRevert(RepegKeeper.RepegTooLarge.selector);
        letters.repegPrices(0, 0);
    }

    function test_Repeg_stakingAndPrestigeTouchPriceOnly() public {
        // Staking: snack price moves, hunger thresholds are preserved
        staking.setMaxMoveBps(2000);
        staking.setPriceKeeper(priceKeeperHot);
        uint64 peck = staking.peckishAfter();
        uint64 hun = staking.hungryAfter();
        uint256 s0 = staking.snackPrice();
        vm.prank(priceKeeperHot);
        staking.repegSnackPrice(s0 + (s0 * 1000) / 10000);
        assertGt(staking.snackPrice(), s0, "snack repegged");
        assertEq(staking.peckishAfter(), peck, "peckish threshold preserved");
        assertEq(staking.hungryAfter(), hun, "hungry threshold preserved");

        // Prestige: fees move, maxLevel is preserved
        prestige.setMaxMoveBps(2000);
        prestige.setPriceKeeper(priceKeeperHot);
        uint8 ml = prestige.maxLevel();
        uint256 f0 = prestige.prestigeFee();
        uint256 sc0 = prestige.snackCost();
        vm.prank(priceKeeperHot);
        prestige.repegFees(f0 + (f0 * 1000) / 10000, sc0 + (sc0 * 1000) / 10000);
        assertEq(prestige.maxLevel(), ml, "maxLevel preserved");
        assertGt(prestige.prestigeFee(), f0, "fee repegged");
        assertGt(prestige.snackCost(), sc0, "snack cost repegged");
    }

    function test_Repeg_cooldownBlocksAtomicLoop() public {
        rolls.setMaxMoveBps(2000);
        rolls.setPriceKeeper(priceKeeperHot);
        uint256 p0 = rolls.rollPrice();
        uint256 up = p0 + (p0 * 2000) / 10000;

        vm.prank(priceKeeperHot);
        rolls.repegRollPrice(up); // first repeg succeeds

        // a second repeg in the SAME block/window reverts — can't loop the clamp to compound a move
        uint256 up2 = up + (up * 2000) / 10000;
        vm.prank(priceKeeperHot);
        vm.expectRevert(RepegKeeper.RepegTooSoon.selector);
        rolls.repegRollPrice(up2);

        // after the cooldown elapses, the next repeg works
        vm.warp(block.timestamp + 5 minutes);
        vm.prank(priceKeeperHot);
        rolls.repegRollPrice(up2);
        assertEq(rolls.rollPrice(), up2, "repeg after cooldown");
    }

    function test_Repeg_maxMoveBpsCapped() public {
        // a band > 100% is rejected; exactly 100% is the ceiling
        vm.expectRevert(RepegKeeper.BadMaxMoveBps.selector);
        rolls.setMaxMoveBps(10001);
        rolls.setMaxMoveBps(10000);
        assertEq(rolls.maxMoveBps(), 10000, "max band set");
    }

    function test_FreeDaily_voucherIsDayScoped() public {
        uint256 fid = 6500;
        uint256 deadline = block.timestamp + 3 days; // deliberately long deadline
        bytes memory sig = _signFreeDaily(alice, fid, deadline); // signed for today's UTC day

        vm.prank(alice);
        letters.commitDailyFree(fid, deadline, sig); // valid today

        // next UTC day: dailyUsed resets, but the day is bound into the digest, so the SAME signature
        // no longer verifies — the cross-day replay is closed.
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        vm.expectRevert(Letters.BadSignature.selector);
        letters.commitDailyFree(fid, deadline, sig);
    }

    // --- signatures ---

    function _signPack(uint256 id, address buyer, uint8[] memory letterIndexes) internal view returns (bytes memory) {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(address(letters), block.chainid, id, buyer, letterIndexes))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signSnack(address caller, address staker, address profile, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(
                abi.encode(
                    address(staking),
                    block.chainid,
                    keccak256("lexigotchi.staking.freeSnack"),
                    caller,
                    staker,
                    profile,
                    uint32(block.timestamp / 1 days),
                    deadline
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    /// `caller` feeds `ids` with a fresh voucher for `staker`'s profile `profile`.
    function _feedFree(address caller, address staker, address profile, uint256[] memory ids) internal {
        uint256 dl = block.timestamp + 600;
        bytes memory sig = _signSnack(caller, staker, profile, dl);
        vm.prank(caller);
        staking.feedWithSnack(ids, staker, profile, dl, sig);
    }

    function _ids(uint256 id) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = id;
    }

    function _signDaily(address buyer, uint256 fid, uint256 deadline) internal view returns (bytes memory) {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(address(letters), block.chainid, buyer, fid, uint32(block.timestamp / 1 days), deadline))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signFreeDaily(address buyer, uint256 fid, uint256 deadline) internal view returns (bytes memory) {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(address(letters), block.chainid, uint8(0), buyer, fid, uint32(block.timestamp / 1 days), deadline)) // uint8(0) = KIND_FREE_DAILY
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signFreePack(address buyer, uint256 fid, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(address(letters), block.chainid, uint8(1), buyer, fid, nonce, deadline)) // uint8(1) = KIND_FREE_PACK
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
    /// ERC-4906: marketplaces re-render a word when its look changes — raise and ascend both emit.
    function test_Words_metadataUpdateEvents() public {
        uint256 tokenId = _claimLower(alice, 0); // CRANE, all lowercase

        // raise position 0 via the Rolls path (words.applyUpgrade is rolls-only)
        vm.prank(address(rolls));
        vm.expectEmit(true, false, false, true, address(words));
        emit Words.MetadataUpdate(tokenId);
        words.applyUpgrade(tokenId, 0);

        vm.prank(address(prestige));
        vm.expectEmit(true, false, false, true, address(words));
        emit Words.MetadataUpdate(tokenId);
        words.bumpPrestige(tokenId);

        assertTrue(words.supportsInterface(bytes4(0x49064906)), "advertises ERC-4906");
    }

    // ---------------------------------------------------------------------------------------------
    // Audit fixes (2026-11-21 internal audit): each test is the exploit, now refused
    // ---------------------------------------------------------------------------------------------

    function _stake(address who, uint256 tokenId) internal {
        vm.startPrank(who);
        words.approve(address(staking), tokenId);
        staking.stake(tokenId);
        vm.stopPrank();
    }

    /// Unstake + restake used to set lastFed = now: a hungry Word was "fed" for gas, no snack burned.
    function test_Staking_restakeDoesNotFeed() public {
        vm.warp(1755000000);
        uint256 t = _claimLower(alice, 0);
        _stake(alice, t);
        assertEq(staking.hungerLevel(t), 0, "a first-ever stake starts fed");

        vm.warp(block.timestamp + 4 days);
        assertTrue(staking.isHungry(t), "hungry after 4 unfed days");

        vm.startPrank(alice);
        staking.unstake(t);
        words.approve(address(staking), t);
        staking.stake(t);
        vm.stopPrank();
        assertTrue(staking.isHungry(t), "restaking is not a meal");

        uint256 supply0 = word.totalSupply();
        _feedFree(alice, alice, alice, _ids(t)); // the free daily snack
        vm.prank(alice);
        staking.feed(t); // a second feed today: paid and burned, as before
        assertEq(supply0 - word.totalSupply(), SNACK, "feeding is still the only way back");
        assertEq(staking.hungerLevel(t), 0, "fed");
    }

    /// The advisor's attack on the pause rule: the jackpot and the yield snapshot read hunger at one
    /// public moment (00:05 UTC), so a player stakes just before it and unstakes just after, daily.
    /// The word must still go hungry without a snack.
    function test_Staking_snapshotDodgeStillGoesHungry() public {
        uint256 day0 = (1755000000 / 1 days) * 1 days; // a UTC midnight
        vm.warp(day0 + 4 minutes);
        uint256 t = _claimLower(alice, 0);
        bool sawHungry;
        for (uint256 d = 0; d < 10; d++) {
            vm.warp(day0 + d * 1 days + 4 minutes); // 00:04: stake
            vm.startPrank(alice);
            words.approve(address(staking), t);
            staking.stake(t);
            vm.stopPrank();
            vm.warp(day0 + d * 1 days + 5 minutes); // 00:05: the snapshot
            if (staking.isHungry(t)) sawHungry = true;
            vm.warp(day0 + d * 1 days + 7 minutes); // 00:07: unstake
            vm.prank(alice);
            staking.unstake(t);
        }
        assertTrue(sawHungry, "never fed for 10 days, yet never hungry at the snapshot");
    }

    /// The clock keeps running while a Word is out of staking: a restake is never a meal.
    function test_Staking_hungerClockRunsWhileUnstaked() public {
        vm.warp(1755000000);
        uint256 t = _claimLower(alice, 0);
        _stake(alice, t);
        vm.prank(alice);
        staking.unstake(t);
        vm.warp(block.timestamp + 4 days); // four days out of staking, never fed

        _stake(alice, t);
        assertTrue(staking.isHungry(t), "back in hungry: the time since the last meal is real");
        vm.prank(alice);
        staking.feed(t);
        assertEq(staking.hungerLevel(t), 0, "a snack is the way back");
    }

    /// Ids are the word's hash, so a dissolved word claimed again keeps its id. That new claim is a
    /// new Word and starts fed; it must not inherit the previous owner's hunger (Bugbot, #101).
    function test_Staking_reclaimedWordStartsFed() public {
        vm.warp(1755000000);
        uint256 t = _claimLower(alice, 0); // CRANE
        _stake(alice, t);
        vm.startPrank(alice);
        staking.unstake(t);
        vm.stopPrank();
        vm.warp(block.timestamp + 5 days); // long past hungry
        vm.prank(alice);
        words.dissolve(t, "CRANE");

        uint256 t2 = _claimLower(bob, 0); // the same word, claimed again by someone else
        assertEq(t2, t, "same id");
        _stake(bob, t2);
        assertEq(staking.hungerLevel(t2), 0, "a new claim starts fed");
    }

    /// Passing a word to another wallet is NOT a new claim: the clock keeps running.
    function test_Staking_transferKeepsTheClock() public {
        vm.warp(1755000000);
        uint256 t = _claimLower(alice, 0);
        _stake(alice, t);
        vm.prank(alice);
        staking.unstake(t);
        vm.warp(block.timestamp + 4 days);
        vm.prank(alice);
        words.transferFrom(alice, bob, t);
        _stake(bob, t);
        assertTrue(staking.isHungry(t), "a second wallet is no way around a snack");
    }

    /// With several rolls open on one letter, a player could reveal only the failures and bank the
    /// signed successes, keeping every later roll at the 85% cap.
    function test_Rolls_oneOpenRollPerLetter() public {
        _fundLower(alice, "AAAAA");
        _fundLower(alice, "B");
        _approveAll(alice);

        vm.prank(alice);
        uint256 id0 = rolls.commitLooseRoll(0);
        assertTrue(rolls.hasOpenRoll(alice, 0), "open");

        vm.prank(alice);
        vm.expectRevert(Rolls.RollOpen.selector);
        rolls.commitLooseRoll(0); // the same letter must resolve first

        vm.prank(alice);
        uint256 idB = rolls.commitLooseRoll(1); // another letter is independent
        rolls.reveal(idB, false, _signRoll(idB, alice, 1, false));

        // anyone can reveal (permissionless), which also frees the letter
        vm.prank(bob);
        rolls.reveal(id0, true, _signRoll(id0, alice, 0, true));
        assertFalse(rolls.hasOpenRoll(alice, 0), "resolved");
        assertEq(rolls.pityOf(alice, 0), 0, "a success resets pity before the next snapshot");

        vm.prank(alice);
        uint256 id1 = rolls.commitLooseRoll(0); // free again
        rolls.reveal(id1, false, _signRoll(id1, alice, 0, false));
        assertEq(rolls.pityOf(alice, 0), 1, "pity follows the curve");
    }

    /// A stale signed success (the letter is gone by reveal) is a no-op, and it still frees the letter.
    function test_Rolls_noopRevealStillClearsTheOpenRoll() public {
        _fundLower(alice, "A");
        _approveAll(alice);
        vm.prank(alice);
        uint256 id = rolls.commitLooseRoll(0);
        vm.prank(alice);
        letters.safeTransferFrom(alice, bob, 0, 1, ""); // spend the letter before the reveal
        rolls.reveal(id, true, _signRoll(id, alice, 0, true));
        assertFalse(rolls.hasOpenRoll(alice, 0), "cleared on the no-op path too");
    }

    function test_Prestige_noopRevealStillClearsTheOpenAttempt() public {
        uint256 tokenId = _claimUpper(alice, 1);
        _approveAll(alice);
        _stake(alice, tokenId);
        vm.startPrank(alice);
        uint256 id = prestige.commitPrestige(tokenId);
        staking.unstake(tokenId);
        vm.stopPrank();
        prestige.reveal(id, true, _signPrestige(id, tokenId, alice, true)); // no-op: unstaked
        assertFalse(prestige.attemptOpen(tokenId), "cleared on the no-op path too");
    }

    function _signPackFor(address l, uint256 id, address buyer, uint8[] memory idx) internal view returns (bytes memory) {
        bytes32 digest =
            MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encode(l, block.chainid, id, buyer, idx)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    /// Commits used to take the fee without reserving supply: at sell-out, the last buyers' paid
    /// commits could never be revealed (no expiry, no refund). Now the commit itself refuses.
    function test_Letters_soldOutRefusesBeforeTakingTheFee() public {
        uint32[26] memory tiny;
        for (uint8 i = 0; i < 26; i++) {
            tiny[i] = 1; // 26 letters in the whole game
        }
        LettersHarness l = new LettersHarness(word, feeRouter, tiny, PACK, DAILY, signer, "", address(this));
        feeRouter.setCollector(address(l), true);
        assertEq(l.unreservedSupply(), 26);

        vm.startPrank(alice);
        word.approve(address(l), type(uint256).max);
        uint256[] memory ids = new uint256[](5);
        for (uint256 k = 0; k < 5; k++) {
            ids[k] = l.commitPack(); // 25 letters promised
        }
        uint256 balBefore = word.balanceOf(alice);
        vm.expectRevert(Letters.SoldOut.selector);
        l.commitPack(); // only 1 letter left: refused, so no fee is taken
        vm.stopPrank();
        assertEq(word.balanceOf(alice), balBefore, "no fee for an unrevealable commit");
        assertEq(l.unreservedSupply(), 1);

        // every accepted commit is still revealable: 25 distinct uncapped letters exist
        for (uint256 k = 0; k < 5; k++) {
            uint8[] memory draw = new uint8[](5);
            for (uint8 j = 0; j < 5; j++) {
                draw[j] = uint8(k * 5 + j);
            }
            l.reveal(ids[k], draw, _signPackFor(address(l), ids[k], alice, draw));
        }
        assertEq(l.unreservedSupply(), 1, "reveals consume only what the commits reserved");
        uint256 minted;
        for (uint8 i = 0; i < 26; i++) {
            minted += l.mintedEver(i);
        }
        assertEq(minted, 25, "the books agree: cap 26 = 25 minted + 1 unreserved");
    }

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
        _feedFree(bob, alice, alice, _ids(t1)); // the staker's profile's free snack
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

        // bob and carol are in profiles of their own, but a voucher names the STAKER's profile.
        uint256 supply0 = word.totalSupply();
        _feedFree(bob, alice, alice, _ids(t1));
        _feedFree(carol, alice, alice, _ids(t2));
        assertEq(supply0 - word.totalSupply(), SNACK, "exactly one free snack between them");
    }

    /// In one feedMany, each staker's free snack covers one of its own words; the caller pays the rest.
    function test_Caretaker_feedWithSnackFreesOnlyTheFirst() public {
        uint256 t1 = _claimLower(alice, 0);
        uint256 t2 = _claimLower(alice, 1);
        uint256 t3 = _claimLower(bob, 2);
        _stake(alice, t1);
        _stake(alice, t2);
        _stake(bob, t3);
        _care(alice, bob);
        _approveAll(bob);

        uint256 bobBal = word.balanceOf(bob);
        uint256[] memory ids = new uint256[](3);
        ids[0] = t1; // alice's profile's free snack
        ids[1] = t2; // paid by bob
        ids[2] = t3; // paid by bob: its free snack is bob's profile's, on a voucher of its own
        _feedFree(bob, alice, alice, ids);
        assertEq(bobBal - word.balanceOf(bob), 2 * SNACK, "one free snack per voucher");
        _feedFree(bob, bob, bob, _ids(t3));
        assertEq(bobBal - word.balanceOf(bob), 2 * SNACK, "bob's profile's own free snack");

        vm.prank(bob);
        staking.feedMany(ids); // plain feedMany pays for all
        assertEq(bobBal - word.balanceOf(bob), 5 * SNACK, "feedMany always pays");
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
        uint256 t = words.claim("CRANE", 0, _proof(0));
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

    /// Without diff B, a caretaker cannot unstake: only the staker moves a Word out of Staking.
    function test_Caretaker_cannotUnstake() public {
        uint256 t = _claimLower(alice, 0);
        _stake(alice, t);
        _care(alice, bob);
        vm.prank(bob);
        vm.expectRevert(Staking.NotStaker.selector);
        staking.unstake(t);
    }

    /// Audit scan (2026-11-24): a Word sent straight to Staking (not through stake()) is refused, since
    /// it would get no staker and could never come back out. Staking still takes Words via stake().
    function test_Staking_refusesWordsSentDirectly() public {
        uint256 t = _claimLower(alice, 0);
        vm.prank(alice);
        vm.expectRevert(Staking.UnexpectedTransfer.selector);
        words.safeTransferFrom(alice, address(staking), t);
        assertEq(words.ownerOf(t), alice, "the Word stays with its owner");
        _stake(alice, t);
        assertEq(staking.stakerOf(t), alice, "stake() still works");
    }
}
