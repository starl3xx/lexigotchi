// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {MockERC20} from "./mocks/MockERC20.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockUsdcWordAdapter, IMintableWord} from "./mocks/MockUsdcWordAdapter.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {Shop, IPackPricePeg} from "../src/Shop.sol";
import {IFeeRouter, FeeSource} from "../src/interfaces/IFeeRouter.sol";
import {IUsdcSwapAdapter} from "../src/interfaces/IUsdcSwapAdapter.sol";

/// @dev Letters' pack price stand-in: the price keeper's peg ($WORD wei per $1 pack).
contract MockPeg is IPackPricePeg {
    uint256 public packPrice;

    constructor(uint256 p) {
        packPrice = p;
    }

    function set(uint256 p) external {
        packPrice = p;
    }
}

/// @dev Records the minWordOut the Shop asks for, then swaps at the peg rate like the mock.
contract SpyAdapter is IUsdcSwapAdapter {
    IERC20 public immutable usdc;
    MockERC20 public immutable word;
    uint256 public rate; // $WORD wei per 1e6 USDC units
    uint256 public lastMin;

    constructor(IERC20 _usdc, MockERC20 _word, uint256 _rate) {
        usdc = _usdc;
        word = _word;
        rate = _rate;
    }

    function swapUsdcForWord(uint256 usdcIn, uint256 minWordOut, address to) external returns (uint256 out) {
        lastMin = minWordOut;
        usdc.transferFrom(msg.sender, address(this), usdcIn);
        out = (usdcIn * rate) / 1e6;
        require(out >= minWordOut, "slippage");
        word.mint(to, out);
    }
}

/// @dev Pays the peg rate up to `depth` USDC, then a third of it: a thin pool's price impact.
contract ThinPoolAdapter is IUsdcSwapAdapter {
    IERC20 public immutable usdc;
    MockERC20 public immutable word;
    uint256 public immutable rate;
    uint256 public immutable depth;

    constructor(IERC20 _usdc, MockERC20 _word, uint256 _rate, uint256 _depth) {
        usdc = _usdc;
        word = _word;
        rate = _rate;
        depth = _depth;
    }

    function swapUsdcForWord(uint256 usdcIn, uint256 minWordOut, address to) external returns (uint256 out) {
        usdc.transferFrom(msg.sender, address(this), usdcIn);
        out = usdcIn <= depth ? (usdcIn * rate) / 1e6 : (usdcIn * rate) / 3e6;
        require(out >= minWordOut, "slippage");
        word.mint(to, out);
    }
}

/// @dev Ignores minWordOut and pays a fixed amount: checks the Shop measures what arrived.
contract LiarAdapter is IUsdcSwapAdapter {
    IERC20 public immutable usdc;

    constructor(IERC20 _usdc) {
        usdc = _usdc;
    }

    function swapUsdcForWord(uint256 usdcIn, uint256, address) external returns (uint256) {
        usdc.transferFrom(msg.sender, address(this), usdcIn);
        return type(uint256).max; // claims a fortune, delivers nothing
    }
}

/// @dev Tries to re-enter the Shop from inside a swap, and reverts with what the Shop answered, so the
///      answer shows up as the SwapDeferred reason.
contract ReentrantAdapter is IUsdcSwapAdapter {
    Shop public shop;
    uint8 public mode; // 0 = re-enter sweep, 1 = re-enter buy

    function setShop(Shop s, uint8 m) external {
        shop = s;
        mode = m;
    }

    function swapUsdcForWord(uint256, uint256, address) external returns (uint256) {
        if (mode == 0) {
            try shop.sweep(0) {}
            catch (bytes memory e) {
                assembly {
                    revert(add(e, 32), mload(e))
                }
            }
        } else {
            try shop.buy(1, address(this), 0) {}
            catch (bytes memory e) {
                assembly {
                    revert(add(e, 32), mload(e))
                }
            }
        }
        revert("re-entry was allowed");
    }
}

contract ShopTest is Test {
    MockERC20 word;
    MockUSDC usdc;
    FeeRouter feeRouter;
    MockPeg peg;
    MockUsdcWordAdapter adapter;
    Shop shop;

    address treasury = makeAddr("treasury");
    address studio = makeAddr("studio");
    address faucetSigner;
    uint256 constant FAUCET_SIGNER_PK = 0xFA11CE7;
    uint256 constant ALICE_PK = 0xA11CE;
    address alice;
    address bob = makeAddr("bob");

    // The price keeper's peg: 4.22M $WORD per $1 pack (the deploy default), so $1 = 4.22e24 wei.
    uint256 constant PEG = 4_220_000 ether;
    uint256 constant PACK_USDC = 1e6;
    uint16 constant SLIPPAGE = 1_000; // 10%
    uint16 constant CARVE = 1_500; // the bounty carve, as on Sepolia

    function setUp() public {
        alice = vm.addr(ALICE_PK);
        faucetSigner = vm.addr(FAUCET_SIGNER_PK);
        word = new MockERC20();
        usdc = new MockUSDC(faucetSigner, address(this));
        feeRouter = new FeeRouter(word, treasury, address(this));
        feeRouter.setSplit(FeeSource.ROYALTY, FeeRouter.Split(10_000, 0, 0, 0));
        feeRouter.setBountyCarveBps(CARVE);
        peg = new MockPeg(PEG);
        adapter = new MockUsdcWordAdapter(usdc, IMintableWord(address(word)), PEG, address(this));
        shop = _newShop(adapter);
        feeRouter.setCollector(address(shop), true);

        usdc.mint(alice, 1_000e6);
        vm.prank(alice);
        usdc.approve(address(shop), type(uint256).max);
    }

    /// @dev Move the route through its delay (the only way the peg changes after deploy).
    function _setRoute(Shop s, IUsdcSwapAdapter a, IPackPricePeg p, uint256 packUsdc) internal {
        s.proposeRoute(a, p, packUsdc);
        vm.warp(block.timestamp + s.ROUTE_DELAY());
        s.acceptRoute();
    }

    function _newShop(IUsdcSwapAdapter a) internal returns (Shop) {
        return new Shop(
            word, IFeeRouter(address(feeRouter)), usdc, a, studio, peg, PACK_USDC, SLIPPAGE, address(this)
        );
    }

    // --- fixtures (test-only items; never in a script, seed, or app config) -----------------------

    function _item(uint128 price) internal returns (uint256) {
        return shop.addItem(price, 0, 0, 0, true);
    }

    function _wordFor(uint256 usdcIn) internal pure returns (uint256) {
        return (usdcIn * PEG) / 1e6;
    }

    function _poolShare(uint256 wordIn) internal pure returns (uint256 pool, uint256 bounty) {
        bounty = (wordIn * CARVE) / 10_000;
        pool = wordIn - bounty;
    }

    // --- the registry -----------------------------------------------------------------------------

    function test_registryStartsEmpty() public {
        Shop fresh = _newShop(adapter);
        assertEq(fresh.itemCount(), 0);
        vm.expectRevert(abi.encodeWithSelector(Shop.UnknownItem.selector, 1));
        fresh.item(1);
    }

    function test_addUpdateSetActive_emitAndStore() public {
        vm.expectEmit(true, false, false, true, address(shop));
        emit Shop.ItemAdded(1, 2e6, 100, 200, 5, false);
        uint256 id = shop.addItem(2e6, 100, 200, 5, false);
        assertEq(id, 1);

        vm.expectEmit(true, false, false, true, address(shop));
        emit Shop.ItemUpdated(1, 3e6, 0, 0, 0);
        shop.updateItem(1, 3e6, 0, 0, 0);

        vm.expectEmit(true, false, false, true, address(shop));
        emit Shop.ItemActiveSet(1, true);
        shop.setActive(1, true);

        Shop.Item memory it = shop.item(1);
        assertEq(it.priceUsdc, 3e6);
        assertEq(it.end, 0);
        assertTrue(it.active);
    }

    function test_registryRules() public {
        vm.expectRevert(Shop.PriceTooLow.selector);
        shop.addItem(9_999, 0, 0, 0, true);
        vm.expectRevert(Shop.BadWindow.selector);
        shop.addItem(1e6, 200, 200, 0, true);
        uint256 id = shop.addItem(1e6, 0, 0, 3, true);
        vm.startPrank(alice);
        shop.buy(id, alice, 0);
        shop.buy(id, alice, 0);
        vm.stopPrank();
        vm.expectRevert(Shop.SupplyBelowSold.selector);
        shop.updateItem(id, 1e6, 0, 0, 1); // 2 already sold
        shop.updateItem(id, 1e6, 0, 0, 2); // exactly what's sold: now sold out
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Shop.SoldOut.selector, id));
        shop.buy(id, alice, 0);
        shop.updateItem(id, 1e6, 0, 0, 0); // 0 = unlimited
        vm.prank(alice);
        shop.buy(id, alice, 0);
        vm.expectRevert(abi.encodeWithSelector(Shop.UnknownItem.selector, 9));
        shop.updateItem(9, 1e6, 0, 0, 0);
        vm.expectRevert(abi.encodeWithSelector(Shop.UnknownItem.selector, 9));
        shop.setActive(9, true);
    }

    function test_onlyOwnerManagesRegistry() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        shop.addItem(1e6, 0, 0, 0, true);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        shop.setSplit(5_000);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        shop.pause();
        vm.stopPrank();
    }

    // --- the split --------------------------------------------------------------------------------

    function test_defaultSplit_80_20() public {
        uint256 id = _item(1e6);
        uint256 toSwap = 200_000;
        uint256 wordOut = _wordFor(toSwap);
        vm.expectEmit(true, true, true, true, address(shop));
        emit Shop.Purchased(alice, bob, id, 1e6, 800_000, wordOut, 0);
        vm.prank(alice);
        shop.buy(id, bob, 0);

        assertEq(usdc.balanceOf(studio), 800_000);
        (uint256 pool, uint256 bounty) = _poolShare(wordOut);
        assertEq(feeRouter.poolBalance(), pool);
        assertEq(feeRouter.bountyBalance(), bounty);
        assertEq(feeRouter.jackpotBalance(), 0, "no shop money reaches the jackpot");
        assertEq(usdc.balanceOf(address(shop)), 0);
        assertEq(word.balanceOf(address(shop)), 0);
        assertEq(shop.item(id).sold, 1);
    }

    function testFuzz_splitMath(uint128 price, uint16 bps) public {
        price = uint128(bound(price, shop.MIN_PRICE_USDC(), 1_000e6));
        bps = uint16(bound(bps, 0, shop.MAX_REVENUE_BPS()));
        shop.setSplit(bps);
        uint256 id = _item(price);
        uint256 studioBefore = usdc.balanceOf(studio);
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        shop.buy(id, alice, 0);

        uint256 toStudio = (uint256(price) * bps) / 10_000;
        uint256 toSwap = price - toStudio;
        assertEq(aliceBefore - usdc.balanceOf(alice), price, "buyer pays exactly the price");
        assertEq(usdc.balanceOf(studio) - studioBefore, toStudio);
        assertGe(toSwap, uint256(price) / 10, "the pool always gets at least 10%");
        (uint256 pool, uint256 bounty) = _poolShare(_wordFor(toSwap));
        assertEq(feeRouter.poolBalance(), pool);
        assertEq(feeRouter.bountyBalance(), bounty);
        assertEq(usdc.balanceOf(address(shop)), 0);
    }

    function test_splitCap() public {
        vm.expectRevert(Shop.SplitTooHigh.selector);
        shop.setSplit(9_001);
        shop.setSplit(9_000);
        assertEq(shop.revenueBps(), 9_000);
        vm.expectRevert(Shop.SlippageTooHigh.selector);
        shop.setMaxSlippageBps(2_001);
    }

    // --- what can't be bought ---------------------------------------------------------------------

    function test_revert_unknownId() public {
        _item(1e6);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Shop.UnknownItem.selector, 0));
        shop.buy(0, alice, 0);
        vm.expectRevert(abi.encodeWithSelector(Shop.UnknownItem.selector, 2));
        shop.buy(2, alice, 0);
        vm.stopPrank();
    }

    function test_revert_inactive() public {
        uint256 id = shop.addItem(1e6, 0, 0, 0, false);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Shop.ItemInactive.selector, id));
        shop.buy(id, alice, 0);
        shop.setActive(id, true);
        vm.prank(alice);
        shop.buy(id, alice, 0);
        shop.setActive(id, false);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Shop.ItemInactive.selector, id));
        shop.buy(id, alice, 0);
    }

    function test_revert_window() public {
        vm.warp(1_000);
        uint256 id = shop.addItem(1e6, 2_000, 3_000, 0, true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Shop.SaleNotStarted.selector, id));
        shop.buy(id, alice, 0);
        vm.warp(2_000); // the start second is on sale
        vm.prank(alice);
        shop.buy(id, alice, 0);
        vm.warp(2_999);
        vm.prank(alice);
        shop.buy(id, alice, 0);
        vm.warp(3_000); // the end second is not
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Shop.SaleEnded.selector, id));
        shop.buy(id, alice, 0);
    }

    function test_revert_soldOut() public {
        uint256 id = shop.addItem(1e6, 0, 0, 2, true);
        vm.startPrank(alice);
        shop.buy(id, alice, 0);
        shop.buy(id, bob, 0);
        vm.expectRevert(abi.encodeWithSelector(Shop.SoldOut.selector, id));
        shop.buy(id, alice, 0);
        vm.stopPrank();
    }

    function test_revert_zeroRecipient() public {
        uint256 id = _item(1e6);
        vm.prank(alice);
        vm.expectRevert(Shop.ZeroAddress.selector);
        shop.buy(id, address(0), 0);
    }

    function test_revert_noAllowance() public {
        uint256 id = _item(1e6);
        usdc.mint(bob, 10e6);
        vm.prank(bob);
        vm.expectRevert();
        shop.buy(id, bob, 0);
        assertEq(shop.item(id).sold, 0, "a failed buy sells nothing");
    }

    // --- a deferred swap still completes the sale -------------------------------------------------

    function test_deferred_brokenAdapter() public {
        uint256 id = _item(1e6);
        adapter.setBroken(true);
        vm.expectEmit(true, false, false, true, address(shop));
        emit Shop.SwapDeferred(id, 200_000, abi.encodeWithSelector(MockUsdcWordAdapter.Broken.selector));
        vm.expectEmit(true, true, true, true, address(shop));
        emit Shop.Purchased(alice, alice, id, 1e6, 800_000, 0, 200_000);
        vm.prank(alice);
        shop.buy(id, alice, 0);

        assertEq(usdc.balanceOf(studio), 800_000, "the studio is paid at once");
        assertEq(shop.pendingUsdc(), 200_000, "the pool's share waits here");
        assertEq(feeRouter.poolBalance(), 0);
        assertEq(shop.item(id).sold, 1, "the sale stands");
        assertEq(usdc.allowance(address(shop), address(adapter)), 0, "no approval left behind");
    }

    function test_deferred_notACollector() public {
        Shop unregistered = _newShop(adapter);
        uint256 id = unregistered.addItem(1e6, 0, 0, 0, true);
        vm.startPrank(alice);
        usdc.approve(address(unregistered), type(uint256).max);
        unregistered.buy(id, alice, 0);
        vm.stopPrank();
        assertEq(unregistered.pendingUsdc(), 200_000);
        assertEq(word.balanceOf(address(unregistered)), 0, "the swap's $WORD rolled back with it");
        feeRouter.setCollector(address(unregistered), true);
        unregistered.sweep(0);
        assertEq(unregistered.pendingUsdc(), 0);
        assertGt(feeRouter.poolBalance(), 0);
    }

    function test_deferred_noPeg() public {
        uint256 id = _item(1e6);
        _setRoute(shop, adapter, IPackPricePeg(address(0)), 0);
        vm.expectEmit(true, false, false, true, address(shop));
        emit Shop.SwapDeferred(id, 200_000, abi.encodeWithSelector(Shop.NoPeg.selector));
        vm.prank(alice);
        shop.buy(id, alice, 0);
        assertEq(shop.pendingUsdc(), 200_000);

        // A peg that reads zero waits too: the swap never runs unprotected.
        _setRoute(shop, adapter, peg, PACK_USDC);
        peg.set(0);
        vm.prank(alice);
        shop.buy(id, alice, 0);
        assertEq(shop.pendingUsdc(), 400_000);
        vm.expectRevert(Shop.NoPeg.selector);
        shop.sweep(0);
    }

    function test_deferred_brokenPegSource() public {
        uint256 id = _item(1e6);
        _setRoute(shop, adapter, IPackPricePeg(address(0xdead)), PACK_USDC); // no code: the read reverts
        vm.prank(alice);
        shop.buy(id, alice, 0);
        assertEq(shop.pendingUsdc(), 200_000, "a broken peg defers the swap, never the sale");
    }

    function test_deferred_jackpotShare() public {
        uint256 id = _item(1e6);
        feeRouter.setSplit(FeeSource.ROYALTY, FeeRouter.Split(9_000, 1_000, 0, 0));
        vm.expectEmit(true, false, false, true, address(shop));
        emit Shop.SwapDeferred(id, 200_000, abi.encodeWithSelector(Shop.JackpotShare.selector));
        vm.prank(alice);
        shop.buy(id, alice, 0);
        assertEq(feeRouter.jackpotBalance(), 0);
        vm.expectRevert(Shop.JackpotShare.selector);
        shop.sweep(0);
    }

    function test_deferred_liarAdapterDeliversNothing() public {
        LiarAdapter liar = new LiarAdapter(usdc);
        Shop s = _newShop(liar);
        feeRouter.setCollector(address(s), true);
        uint256 id = s.addItem(1e6, 0, 0, 0, true);
        vm.startPrank(alice);
        usdc.approve(address(s), type(uint256).max);
        s.buy(id, alice, 0);
        vm.stopPrank();
        assertEq(s.pendingUsdc(), 200_000, "the USDC came back when the frame reverted");
        assertEq(usdc.balanceOf(address(liar)), 0);
    }

    function _reentryReason(uint8 mode) internal returns (bytes memory) {
        ReentrantAdapter bad = new ReentrantAdapter();
        Shop s = _newShop(bad);
        bad.setShop(s, mode);
        feeRouter.setCollector(address(s), true);
        uint256 id = s.addItem(1e6, 0, 0, 0, true);
        vm.startPrank(alice);
        usdc.approve(address(s), type(uint256).max);
        vm.recordLogs();
        s.buy(id, alice, 0);
        vm.stopPrank();
        assertEq(s.pendingUsdc(), 200_000, "the sale stands, the swap waits");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == Shop.SwapDeferred.selector) {
                (, bytes memory reason) = abi.decode(logs[i].data, (uint256, bytes));
                return reason;
            }
        }
        revert("no SwapDeferred");
    }

    function test_reentry_sweepIsBlocked() public {
        assertEq(_reentryReason(0), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector));
    }

    function test_reentry_buyIsBlocked() public {
        assertEq(_reentryReason(1), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector));
    }

    function test_swapAndRoute_onlySelf() public {
        vm.prank(alice);
        vm.expectRevert(Shop.OnlySelf.selector);
        shop.swapAndRoute(1, 0);
    }

    // --- sweep ------------------------------------------------------------------------------------

    function test_sweep_convertsDeferredUsdc() public {
        uint256 id = _item(1e6);
        adapter.setBroken(true);
        vm.startPrank(alice);
        shop.buy(id, alice, 0);
        shop.buy(id, alice, 0);
        vm.stopPrank();
        assertEq(shop.pendingUsdc(), 400_000);

        adapter.setBroken(false);
        uint256 out = _wordFor(400_000);
        vm.expectEmit(false, false, false, true, address(shop));
        emit Shop.Swept(400_000, out, 0);
        vm.prank(bob); // permissionless
        (uint256 usdcIn, uint256 wordOut) = shop.sweep(0);
        assertEq(usdcIn, 400_000);
        assertEq(wordOut, out);
        assertEq(shop.pendingUsdc(), 0);
        (uint256 pool,) = _poolShare(out);
        assertEq(feeRouter.poolBalance(), pool);
    }

    function test_sweep_swapsAtMostTheCapEachBlock() public {
        uint256 id = _item(100e6); // $100: $20 of each sale waits when the swap fails
        usdc.mint(alice, 1_000e6);
        adapter.setBroken(true);
        vm.startPrank(alice);
        for (uint256 i = 0; i < 6; i++) shop.buy(id, alice, 0); // $120 waiting
        vm.stopPrank();
        adapter.setBroken(false);
        assertEq(shop.pendingUsdc(), 120e6);

        (uint256 first,) = shop.sweep(0);
        assertEq(first, 100e6, "one chunk of maxSweepUsdc");
        vm.expectRevert(Shop.SweptThisBlock.selector);
        shop.sweep(0); // a second in the same block (or transaction) can't run
        vm.roll(block.number + 1);
        (uint256 second,) = shop.sweep(0);
        assertEq(second, 20e6, "the rest, next block");
        assertEq(shop.pendingUsdc(), 0);
    }

    function test_sweep_chunksDrainABacklogTheFloorCantTakeAtOnce() public {
        // A route whose price falls with size, like a thin pool: past $50 the output sinks below the floor.
        ThinPoolAdapter thin = new ThinPoolAdapter(usdc, word, PEG, 50e6);
        Shop s = _newShop(thin);
        feeRouter.setCollector(address(s), true);
        usdc.mint(address(s), 120e6); // $120 waiting
        vm.expectRevert(); // all at once: below the floor
        vm.prank(bob);
        this.sweepAll(s, 120e6);
        s.setMaxSweepUsdc(50e6);
        for (uint256 i = 0; i < 3; i++) {
            vm.roll(block.number + 1);
            s.sweep(0);
        }
        assertEq(s.pendingUsdc(), 0, "chunks the floor accepts drain it");
    }

    /// @dev Helper so the "all at once" attempt runs at a raised cap without touching the shop under test.
    function sweepAll(Shop s, uint256 cap) external {
        s.setMaxSweepUsdc(cap > s.MAX_SWEEP_USDC() ? s.MAX_SWEEP_USDC() : cap);
        s.sweep(0);
    }

    function test_sweepCapBounds() public {
        vm.expectRevert(Shop.SweepCapOutOfRange.selector);
        shop.setMaxSweepUsdc(999_999);
        vm.expectRevert(Shop.SweepCapOutOfRange.selector);
        shop.setMaxSweepUsdc(1_000e6 + 1);
        shop.setMaxSweepUsdc(1_000e6);
        assertEq(shop.maxSweepUsdc(), 1_000e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        shop.setMaxSweepUsdc(5e6);
    }

    function test_sweep_noopWhenNothingWaits() public {
        (uint256 usdcIn, uint256 wordOut) = shop.sweep(0);
        assertEq(usdcIn, 0);
        assertEq(wordOut, 0);
    }

    function test_sweep_revertsWhenTheSwapFails() public {
        uint256 id = _item(1e6);
        adapter.setBroken(true);
        vm.prank(alice);
        shop.buy(id, alice, 0);
        vm.expectRevert(MockUsdcWordAdapter.Broken.selector);
        shop.sweep(0);
        assertEq(shop.pendingUsdc(), 200_000);
    }

    function test_sweep_usesTheFloor() public {
        uint256 id = _item(1e6);
        adapter.setBroken(true);
        vm.prank(alice);
        shop.buy(id, alice, 0);
        adapter.setBroken(false);
        adapter.setRate((PEG * 85) / 100); // 15% under the peg, past the 10% allowance
        vm.expectRevert();
        shop.sweep(0);
    }

    function test_sweep_routesStrayWord() public {
        word.mint(address(shop), 7 ether);
        (uint256 usdcIn,) = shop.sweep(0);
        assertEq(usdcIn, 0);
        assertEq(word.balanceOf(address(shop)), 0);
        (uint256 pool,) = _poolShare(7 ether);
        assertEq(feeRouter.poolBalance(), pool);
    }

    // --- the floor --------------------------------------------------------------------------------

    function test_floor_raisesALowMinimum() public {
        SpyAdapter spy = new SpyAdapter(usdc, word, PEG);
        Shop s = _newShop(spy);
        feeRouter.setCollector(address(s), true);
        uint256 id = s.addItem(1e6, 0, 0, 0, true);
        vm.startPrank(alice);
        usdc.approve(address(s), type(uint256).max);
        s.buy(id, alice, 1); // a buyer's minimum below the floor
        vm.stopPrank();
        uint256 floor = (_wordFor(200_000) * (10_000 - SLIPPAGE)) / 10_000;
        assertEq(s.floorFor(200_000), floor);
        assertEq(spy.lastMin(), floor, "the adapter was asked for the floor, not 1");
    }

    function test_floor_keepsAHigherMinimum() public {
        SpyAdapter spy = new SpyAdapter(usdc, word, PEG);
        Shop s = _newShop(spy);
        feeRouter.setCollector(address(s), true);
        uint256 id = s.addItem(1e6, 0, 0, 0, true);
        uint256 high = _wordFor(200_000); // exactly the peg, above the floor
        vm.startPrank(alice);
        usdc.approve(address(s), type(uint256).max);
        s.buy(id, alice, high);
        vm.stopPrank();
        assertEq(spy.lastMin(), high);
        // One wei above what the swap can return: the swap waits.
        vm.startPrank(alice);
        s.buy(id, alice, high + 1);
        vm.stopPrank();
        assertEq(s.pendingUsdc(), 200_000);
    }

    function test_floor_belowFloorOutputDefers() public {
        uint256 id = _item(1e6);
        adapter.setRate((PEG * 85) / 100); // the pool moved 15% against us
        vm.prank(alice);
        shop.buy(id, alice, 0);
        assertEq(shop.pendingUsdc(), 200_000);
        assertEq(feeRouter.poolBalance(), 0);
    }

    // --- permit -----------------------------------------------------------------------------------

    function _permitSig(uint256 pk, address owner, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 typehash =
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
        bytes32 structHash = keccak256(abi.encode(typehash, owner, spender, value, usdc.nonces(owner), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    function test_permit_domainMatchesCircle() public view {
        assertEq(usdc.name(), "USD Coin");
        assertEq(usdc.version(), "2");
        assertEq(usdc.decimals(), 6);
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("USD Coin"),
                keccak256("2"),
                block.chainid,
                address(usdc)
            )
        );
        assertEq(usdc.DOMAIN_SEPARATOR(), expected);
    }

    function test_buyWithPermit_noPriorApproval() public {
        uint256 id = _item(2e6);
        vm.prank(alice);
        usdc.approve(address(shop), 0);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(ALICE_PK, alice, address(shop), 2e6, deadline);
        vm.prank(alice);
        shop.buyWithPermit(id, alice, 0, deadline, v, r, s);
        assertEq(usdc.balanceOf(studio), 1_600_000);
        assertEq(usdc.allowance(alice, address(shop)), 0, "the permit covered exactly the price");
    }

    function test_buyWithPermit_frontRunPermitStillBuys() public {
        uint256 id = _item(2e6);
        vm.prank(alice);
        usdc.approve(address(shop), 0);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(ALICE_PK, alice, address(shop), 2e6, deadline);
        vm.prank(bob); // someone copies the permit from the mempool and runs it first
        usdc.permit(alice, address(shop), 2e6, deadline, v, r, s);
        vm.prank(alice);
        shop.buyWithPermit(id, alice, 0, deadline, v, r, s);
        assertEq(shop.item(id).sold, 1);
    }

    function test_buyWithPermit_badPermitNoAllowanceReverts() public {
        uint256 id = _item(2e6);
        vm.prank(alice);
        usdc.approve(address(shop), 0);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(0xB0B, alice, address(shop), 2e6, deadline); // wrong key
        vm.prank(alice);
        vm.expectRevert();
        shop.buyWithPermit(id, alice, 0, deadline, v, r, s);
    }

    // --- no withdraw path -------------------------------------------------------------------------

    /// @dev Every owner function, with USDC waiting in the Shop: none of them moves it or any $WORD.
    ///      (The ABI allowlist in tests/shop-abi.test.ts pins the external surface itself.)
    function test_noOwnerWithdrawPath() public {
        uint256 id = _item(1e6);
        adapter.setBroken(true);
        vm.prank(alice);
        shop.buy(id, alice, 0);
        word.mint(address(shop), 3 ether);
        uint256 usdcHeld = usdc.balanceOf(address(shop));
        uint256 wordHeld = word.balanceOf(address(shop));

        shop.addItem(5e6, 0, 0, 0, true);
        shop.updateItem(id, 2e6, 0, 0, 0);
        shop.setActive(id, false);
        shop.setRevenueWallet(address(this));
        shop.setSplit(9_000);
        shop.setMaxSlippageBps(0);
        shop.setMaxSweepUsdc(50e6);
        shop.proposeRoute(adapter, peg, PACK_USDC);
        shop.cancelRoute();
        shop.pause();
        shop.unpause();
        vm.expectRevert(Shop.OnlySelf.selector);
        shop.swapAndRoute(usdcHeld, 0);

        assertEq(usdc.balanceOf(address(shop)), usdcHeld);
        assertEq(word.balanceOf(address(shop)), wordHeld);
        assertEq(usdc.balanceOf(address(this)), 0);
        assertEq(word.balanceOf(address(this)), 0);
    }

    function test_routeChangeWaitsTheDelay() public {
        SpyAdapter next = new SpyAdapter(usdc, word, PEG);
        vm.expectRevert(Shop.NoPendingRoute.selector);
        shop.acceptRoute();
        vm.expectRevert(Shop.NoPendingRoute.selector);
        shop.cancelRoute();
        shop.proposeRoute(next, peg, PACK_USDC);
        uint64 readyAt = uint64(block.timestamp) + shop.ROUTE_DELAY();
        (,,, uint64 pendingAt) = shop.pendingRoute();
        assertEq(pendingAt, readyAt);
        vm.warp(readyAt - 1);
        vm.expectRevert(abi.encodeWithSelector(Shop.RouteNotReady.selector, readyAt));
        shop.acceptRoute();
        assertEq(address(shop.adapter()), address(adapter), "the old route still runs");
        vm.warp(readyAt);
        shop.acceptRoute();
        assertEq(address(shop.adapter()), address(next));
        (,,, pendingAt) = shop.pendingRoute();
        assertEq(pendingAt, 0, "nothing pending after");
    }

    /// @dev The audit's finding: the floor's peg once changed instantly (setPeg), which made the slippage
    ///      cap and the adapter delay moot. Now the peg moves only with the route, after the delay.
    function test_pegChangeWaitsTheDelayToo() public {
        uint256 floorBefore = shop.floorFor(200_000);
        shop.proposeRoute(adapter, peg, PACK_USDC * 1_000_000); // a peg that would make the floor ~0
        assertEq(shop.floorFor(200_000), floorBefore, "a proposal changes nothing yet");
        // Swaps keep running at the old floor during the delay, and anyone can see the proposal.
        uint256 id = _item(1e6);
        vm.prank(alice);
        shop.buy(id, alice, 0);
        assertEq(shop.pendingUsdc(), 0);
        vm.warp(block.timestamp + shop.ROUTE_DELAY());
        shop.acceptRoute();
        assertLt(shop.floorFor(200_000), floorBefore);
    }

    // --- pause ------------------------------------------------------------------------------------

    function test_pauseStopsBuyingAndSweeping() public {
        uint256 id = _item(1e6);
        shop.pause();
        vm.startPrank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        shop.buy(id, alice, 0);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        shop.buyWithPermit(id, alice, 0, 0, 0, 0, 0);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        shop.sweep(0);
        vm.stopPrank();
        shop.unpause();
        vm.prank(alice);
        shop.buy(id, alice, 0);
    }

    // --- MockUSDC's faucet (Base Sepolia only) ----------------------------------------------------

    function _faucetSig(address caller, address profile, uint256 deadline) internal view returns (bytes memory) {
        uint32 today = uint32(block.timestamp / 1 days);
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(
                abi.encode(address(usdc), block.chainid, usdc.FAUCET_KIND(), caller, profile, today, deadline)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(FAUCET_SIGNER_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_faucet_oncePerProfilePerDay() public {
        vm.warp(10 days + 1 hours);
        address profile = makeAddr("profile");
        address walletA = makeAddr("walletA");
        address walletB = makeAddr("walletB");
        uint256 deadline = block.timestamp + 10 minutes;

        bytes memory sigA = _faucetSig(walletA, profile, deadline); // before the prank: it reads FAUCET_KIND
        vm.prank(walletA);
        usdc.faucet(profile, deadline, sigA);
        assertEq(usdc.balanceOf(walletA), 25e6);

        // Another wallet of the same profile, the same day: refused.
        bytes memory sigB = _faucetSig(walletB, profile, deadline);
        vm.prank(walletB);
        vm.expectRevert(MockUSDC.AlreadyToday.selector);
        usdc.faucet(profile, deadline, sigB);

        // The next day: fine.
        vm.warp(11 days + 1 hours);
        deadline = block.timestamp + 10 minutes;
        sigB = _faucetSig(walletB, profile, deadline);
        vm.prank(walletB);
        usdc.faucet(profile, deadline, sigB);
        assertEq(usdc.balanceOf(walletB), 25e6);
    }

    function test_faucet_voucherIsTheCallers() public {
        address profile = makeAddr("profile");
        uint256 deadline = block.timestamp + 10 minutes;
        bytes memory sig = _faucetSig(alice, profile, deadline);
        vm.prank(bob); // copied from the mempool
        vm.expectRevert(MockUSDC.BadSignature.selector);
        usdc.faucet(profile, deadline, sig);
    }

    function test_faucet_expiredVoucher() public {
        address profile = makeAddr("profile");
        uint256 deadline = block.timestamp + 10 minutes;
        bytes memory sig = _faucetSig(alice, profile, deadline);
        vm.warp(deadline + 1);
        vm.prank(alice);
        vm.expectRevert(MockUSDC.VoucherExpired.selector);
        usdc.faucet(profile, deadline, sig);
    }

    function test_mockUsdc_onlyOwnerMints() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        usdc.mint(alice, 1);
    }
}
