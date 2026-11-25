// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {FeeRouter} from "../src/FeeRouter.sol";
import {Shop, IPackPricePeg} from "../src/Shop.sol";
import {UniV4UsdcWordAdapter, IUniversalRouter} from "../src/adapters/UniV4UsdcWordAdapter.sol";
import {IFeeRouter, FeeSource} from "../src/interfaces/IFeeRouter.sol";

interface IStateView {
    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
}

interface IV3Pool {
    function slot0()
        external
        view
        returns (uint160 sqrtPriceX96, int24, uint16, uint16, uint16, uint8, bool);
}

interface IPositionManager {
    function poolKeys(bytes25 poolId)
        external
        view
        returns (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks);
}

contract ForkPeg is IPackPricePeg {
    uint256 public packPrice;

    function set(uint256 p) external {
        packPrice = p;
    }
}

/**
 * @notice The adapter and the Shop against the REAL Base pools, on a fork. Skipped unless BASE_RPC_URL
 *         is set (e.g. `BASE_RPC_URL=https://mainnet.base.org forge test --match-contract ShopFork -vv`),
 *         so `npm run contracts:test` stays offline. BASE_FORK_BLOCK pins a block; unset = the latest.
 *         Every address below is Base mainnet, checked onchain on 2026-11-25 (see the adapter's NatSpec).
 */
contract ShopForkTest is Test {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913; // Circle's docs
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant WORD = 0x304e649e69979298BD1AEE63e175ADf07885fb4b;
    address constant UNIVERSAL_ROUTER = 0x6fF5693b99212Da76ad316178A184AB56D299b43; // v2.0
    address constant STATE_VIEW = 0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71;
    address constant POSITION_MANAGER = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;
    address constant USDC_WETH_500 = 0xd0b53D9277642d899DF5C87A3966A349A798F224;
    bytes32 constant WORD_POOL_ID = 0xc5db937916d2c6f96142a6886ba8b5b74e14949c9cc1080a676ab2a5eb1ea275;
    uint24 constant DYNAMIC_FEE = 0x800000;
    int24 constant TICK_SPACING = 200;
    address constant CLANKER_HOOK = 0xd60D6B218116cFd801E28F78d011a203D2b068Cc;

    UniV4UsdcWordAdapter adapter;
    address studio = makeAddr("studio");
    address buyer = makeAddr("buyer");

    function setUp() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        uint256 forkBlock = vm.envOr("BASE_FORK_BLOCK", uint256(0));
        if (forkBlock == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, forkBlock);
        adapter = new UniV4UsdcWordAdapter(
            IUniversalRouter(UNIVERSAL_ROUTER),
            IERC20(USDC),
            IERC20(WETH),
            IERC20(WORD),
            500,
            DYNAMIC_FEE,
            TICK_SPACING,
            CLANKER_HOOK
        );
    }

    /// @dev $WORD wei per 1 USDC (1e6 units) at the two pools' mid prices, before fees and impact.
    function _midWordPerUsdc() internal view returns (uint256) {
        // v3: token0 = WETH, token1 = USDC, so price = USDC units per WETH wei.
        (uint160 sa,,,,,,) = IV3Pool(USDC_WETH_500).slot0();
        // v4: currency0 = $WORD, currency1 = WETH, so price = WETH wei per $WORD wei.
        (uint160 sb,,,) = IStateView(STATE_VIEW).getSlot0(WORD_POOL_ID);
        uint256 q96 = 1 << 96;
        uint256 ra = Math.mulDiv(q96, 1e18, sa); // sqrt(WETH wei per USDC unit) × 1e18
        uint256 rb = Math.mulDiv(q96, 1e18, sb); // sqrt($WORD wei per WETH wei) × 1e18
        uint256 wethPerUsdcUnit = Math.mulDiv(ra, ra, 1e18); // × 1e18
        uint256 wordPerWeth = Math.mulDiv(rb, rb, 1e18); // × 1e18
        return Math.mulDiv(wethPerUsdcUnit, wordPerWeth, 1e36) * 1e6;
    }

    function test_fork_poolKeyIsTheRealOne() public view {
        UniV4UsdcWordAdapter.PoolKey memory k = adapter.poolKey();
        assertEq(keccak256(abi.encode(k)), WORD_POOL_ID, "the key hashes to $WORD's pool id");
        (address c0, address c1, uint24 fee, int24 ts, address hooks) =
            IPositionManager(POSITION_MANAGER).poolKeys(bytes25(WORD_POOL_ID));
        assertEq(c0, k.currency0);
        assertEq(c1, k.currency1);
        assertEq(fee, k.fee);
        assertEq(ts, k.tickSpacing);
        assertEq(hooks, k.hooks);
    }

    function test_fork_adapterSwapsUsdcForWord() public {
        uint256 mid = _midWordPerUsdc();
        uint256[3] memory sizes = [uint256(200_000), 1e6, 20e6]; // $0.20 (a $1 item's share), $1, $20
        for (uint256 i = 0; i < sizes.length; i++) {
            uint256 usdcIn = sizes[i];
            deal(USDC, address(this), usdcIn);
            IERC20(USDC).approve(address(adapter), usdcIn);
            uint256 before = IERC20(WORD).balanceOf(address(this));
            uint256 out = adapter.swapUsdcForWord(usdcIn, 1, address(this));
            assertEq(IERC20(WORD).balanceOf(address(this)) - before, out);
            assertGt(out, 0);
            uint256 atMid = Math.mulDiv(usdcIn, mid, 1e6);
            // bps of the mid-price output actually received: what fees + impact cost.
            uint256 gotBps = Math.mulDiv(out, 10_000, atMid);
            console2.log("usdcIn", usdcIn, "received bps of mid", gotBps);
            assertGt(gotBps, 8_000, "fees + impact under 20%");
            assertEq(IERC20(USDC).balanceOf(address(adapter)), 0, "the adapter keeps nothing");
            assertEq(IERC20(WETH).balanceOf(address(adapter)), 0);
            assertEq(IERC20(USDC).balanceOf(UNIVERSAL_ROUTER), 0, "nothing left in the router");
        }
    }

    function test_fork_adapterRespectsMinOut() public {
        deal(USDC, address(this), 1e6);
        IERC20(USDC).approve(address(adapter), 1e6);
        uint256 mid = _midWordPerUsdc();
        vm.expectRevert();
        adapter.swapUsdcForWord(1e6, mid * 2, address(this)); // twice the market: must revert
    }

    function test_fork_shopEndToEnd() public {
        // A fresh FeeRouter on the real $WORD (a ClankerToken), wired like the deploy does.
        FeeRouter fr = new FeeRouter(IERC20(WORD), makeAddr("treasury"), address(this));
        fr.setSplit(FeeSource.ROYALTY, FeeRouter.Split(10_000, 0, 0, 0));
        fr.setBountyCarveBps(1_500);
        ForkPeg peg = new ForkPeg();
        peg.set(_midWordPerUsdc()); // a $1 pack's $WORD at the market, as the price keeper would hold it
        Shop shop = new Shop(
            IERC20(WORD), IFeeRouter(address(fr)), IERC20(USDC), adapter, studio, peg, 1e6, 1_000, address(this)
        );
        fr.setCollector(address(shop), true);
        uint256 id = shop.addItem(1e6, 0, 0, 0, true); // a fork-only fixture

        deal(USDC, buyer, 5e6);
        vm.startPrank(buyer);
        IERC20(USDC).approve(address(shop), type(uint256).max);
        shop.buy(id, buyer, 0);
        vm.stopPrank();

        assertEq(IERC20(USDC).balanceOf(studio), 800_000);
        assertEq(shop.pendingUsdc(), 0, "the swap ran in the same transaction");
        assertGt(fr.poolBalance(), 0);
        assertGt(fr.bountyBalance(), 0);
        assertEq(fr.jackpotBalance(), 0);
        console2.log("pool + bounty $WORD from a $1 sale", fr.poolBalance() + fr.bountyBalance());

        // With the peg set far above the market, the floor stops the swap and the sale still completes.
        peg.set(_midWordPerUsdc() * 2);
        vm.prank(buyer);
        shop.buy(id, buyer, 0);
        assertEq(shop.pendingUsdc(), 200_000);
        assertEq(shop.item(id).sold, 2);
        // Back at the market, anyone can sweep it.
        peg.set(_midWordPerUsdc());
        shop.sweep(0);
        assertEq(shop.pendingUsdc(), 0);
    }
}
