// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {Shop, IPackPricePeg} from "../src/Shop.sol";
import {UniV4UsdcWordAdapter, IUniversalRouter} from "../src/adapters/UniV4UsdcWordAdapter.sol";
import {IFeeRouter, FeeSource} from "../src/interfaces/IFeeRouter.sol";

/**
 * @title DeployShop
 * @notice MAINNET: deploys the Shop with the real USDC→WETH→$WORD route (decisions.md #22) beside a
 *         suite that's already deployed, and registers it as a FeeRouter collector when the broadcaster
 *         owns the router. The registry is EMPTY: this script creates no items, and checks it. Items
 *         are added later through the admin's transaction builder. Ask the owner before running it.
 *
 *         Every route default was read onchain on 2026-11-25 (UniV4UsdcWordAdapter's NatSpec), and the
 *         script refuses to deploy unless the pool key hashes to WORD_POOL_ID.
 *
 *         Required env: FEE_ROUTER, LETTERS (the peg: its packPrice), REVENUE_WALLET.
 *         Optional env: USDC, WETH, UNIVERSAL_ROUTER, USDC_WETH_FEE, WORD_POOL_FEE,
 *                       WORD_POOL_TICK_SPACING, WORD_POOL_HOOKS, WORD_POOL_ID, PEG_PACK_USDC (the pack's
 *                       price in USDC units, default 1e6 = $1), MAX_SLIPPAGE_BPS (default 1000),
 *                       SHOP_OWNER (default the broadcaster), REGISTER (default true).
 */
contract DeployShop is Script {
    struct Config {
        FeeRouter feeRouter;
        IPackPricePeg letters;
        address revenueWallet;
        address usdc;
        address weth;
        address universalRouter;
        uint24 usdcWethFee;
        uint24 wordPoolFee;
        int24 wordPoolTickSpacing;
        address wordPoolHooks;
        bytes32 wordPoolId;
        uint256 pegPackUsdc;
        uint16 maxSlippageBps;
        address owner;
    }

    function run() external returns (Shop shop, UniV4UsdcWordAdapter adapter) {
        require(block.chainid == 8453, "DeployShop is the Base mainnet script; use DeployShopTestnet");
        Config memory c;
        c.feeRouter = FeeRouter(vm.envAddress("FEE_ROUTER"));
        c.letters = IPackPricePeg(vm.envAddress("LETTERS"));
        c.revenueWallet = vm.envAddress("REVENUE_WALLET");
        c.usdc = vm.envOr("USDC", 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913); // Circle's docs
        c.weth = vm.envOr("WETH", 0x4200000000000000000000000000000000000006);
        c.universalRouter = vm.envOr("UNIVERSAL_ROUTER", 0x6fF5693b99212Da76ad316178A184AB56D299b43);
        c.usdcWethFee = uint24(vm.envOr("USDC_WETH_FEE", uint256(500)));
        c.wordPoolFee = uint24(vm.envOr("WORD_POOL_FEE", uint256(0x800000)));
        c.wordPoolTickSpacing = int24(int256(vm.envOr("WORD_POOL_TICK_SPACING", uint256(200))));
        c.wordPoolHooks = vm.envOr("WORD_POOL_HOOKS", 0xd60D6B218116cFd801E28F78d011a203D2b068Cc);
        c.wordPoolId =
            vm.envOr("WORD_POOL_ID", bytes32(0xc5db937916d2c6f96142a6886ba8b5b74e14949c9cc1080a676ab2a5eb1ea275));
        c.pegPackUsdc = vm.envOr("PEG_PACK_USDC", uint256(1e6));
        c.maxSlippageBps = uint16(vm.envOr("MAX_SLIPPAGE_BPS", uint256(1_000)));
        c.owner = vm.envOr("SHOP_OWNER", msg.sender);
        bool register = vm.envOr("REGISTER", true);

        vm.startBroadcast();
        (shop, adapter) = deploy(c);
        if (register) c.feeRouter.setCollector(address(shop), true);
        vm.stopBroadcast();

        console2.log("UniV4UsdcWordAdapter", address(adapter));
        console2.log("Shop                ", address(shop));
    }

    /// @notice The deploy itself, without broadcasting (the tests call it). Leaves the registry empty.
    function deploy(Config memory c) public returns (Shop shop, UniV4UsdcWordAdapter adapter) {
        IERC20 word = c.feeRouter.word();
        (, uint16 toJackpot,,) = c.feeRouter.splits(FeeSource.ROYALTY);
        require(toJackpot == 0, "the ROYALTY split gives the jackpot a share: no shop money goes there");
        adapter = new UniV4UsdcWordAdapter(
            IUniversalRouter(c.universalRouter),
            IERC20(c.usdc),
            IERC20(c.weth),
            word,
            c.usdcWethFee,
            c.wordPoolFee,
            c.wordPoolTickSpacing,
            c.wordPoolHooks
        );
        require(keccak256(abi.encode(adapter.poolKey())) == c.wordPoolId, "pool key does not hash to WORD_POOL_ID");
        shop = new Shop(
            word,
            IFeeRouter(address(c.feeRouter)),
            IERC20(c.usdc),
            adapter,
            c.revenueWallet,
            c.letters,
            c.pegPackUsdc,
            c.maxSlippageBps,
            c.owner
        );
        require(shop.itemCount() == 0, "the mainnet Shop deploys with no items");
    }
}
