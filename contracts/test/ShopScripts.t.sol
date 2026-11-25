// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {Shop, IPackPricePeg} from "../src/Shop.sol";
import {UniV4UsdcWordAdapter} from "../src/adapters/UniV4UsdcWordAdapter.sol";
import {FeeSource} from "../src/interfaces/IFeeRouter.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockUsdcWordAdapter} from "./mocks/MockUsdcWordAdapter.sol";
import {DeployShop} from "../script/DeployShop.s.sol";
import {DeployShopTestnet} from "../script/DeployShopTestnet.s.sol";

contract StubPeg is IPackPricePeg {
    function packPrice() external pure returns (uint256) {
        return 4_220_000 ether;
    }
}

/// @notice Both Shop deploy scripts leave the registry EMPTY (decisions.md #22: real items are added
///         later through the admin; the Sepolia test item too), and refuse a jackpot-sharing split.
contract ShopScriptsTest is Test {
    MockERC20 word;
    FeeRouter feeRouter;
    StubPeg peg;

    function setUp() public {
        word = new MockERC20();
        feeRouter = new FeeRouter(word, makeAddr("treasury"), address(this));
        feeRouter.setSplit(FeeSource.ROYALTY, FeeRouter.Split(10_000, 0, 0, 0));
        peg = new StubPeg();
    }

    function _mainnetConfig() internal returns (DeployShop.Config memory c) {
        c.feeRouter = feeRouter;
        c.letters = peg;
        c.revenueWallet = makeAddr("studio");
        c.usdc = makeAddr("usdc");
        c.weth = 0x4200000000000000000000000000000000000006;
        c.universalRouter = makeAddr("router");
        c.usdcWethFee = 500;
        c.wordPoolFee = 0x800000;
        c.wordPoolTickSpacing = 200;
        c.wordPoolHooks = makeAddr("hook");
        c.pegPackUsdc = 1e6;
        c.maxSlippageBps = 1_000;
        c.owner = makeAddr("owner");
        (address c0, address c1) = address(word) < c.weth ? (address(word), c.weth) : (c.weth, address(word));
        c.wordPoolId = keccak256(
            abi.encode(UniV4UsdcWordAdapter.PoolKey(c0, c1, c.wordPoolFee, c.wordPoolTickSpacing, c.wordPoolHooks))
        );
    }

    function test_mainnetScript_deploysAnEmptyShop() public {
        DeployShop script = new DeployShop();
        DeployShop.Config memory c = _mainnetConfig();
        (Shop shop, UniV4UsdcWordAdapter adapter) = script.deploy(c);
        assertEq(shop.itemCount(), 0);
        assertEq(address(shop.adapter()), address(adapter));
        assertEq(shop.owner(), c.owner);
        assertEq(shop.revenueBps(), 8_000);
        assertEq(address(shop.pegSource()), address(peg));
    }

    function test_mainnetScript_refusesAWrongPoolKey() public {
        DeployShop script = new DeployShop();
        DeployShop.Config memory c = _mainnetConfig();
        c.wordPoolId = bytes32(uint256(1));
        vm.expectRevert(bytes("pool key does not hash to WORD_POOL_ID"));
        script.deploy(c);
    }

    function test_scripts_refuseAJackpotShare() public {
        feeRouter.setSplit(FeeSource.ROYALTY, FeeRouter.Split(9_000, 1_000, 0, 0));
        DeployShop script = new DeployShop();
        DeployShop.Config memory c = _mainnetConfig();
        vm.expectRevert(bytes("the ROYALTY split gives the jackpot a share: no shop money goes there"));
        script.deploy(c);

        DeployShopTestnet t = new DeployShopTestnet();
        DeployShopTestnet.Config memory tc;
        tc.feeRouter = feeRouter;
        tc.letters = peg;
        tc.faucetSigner = makeAddr("signer");
        tc.revenueWallet = makeAddr("studio");
        tc.pegPackUsdc = 1e6;
        tc.maxSlippageBps = 1_000;
        tc.owner = makeAddr("owner");
        vm.expectRevert(bytes("the ROYALTY split gives the jackpot a share: no shop money goes there"));
        t.deploy(tc);
    }

    function test_testnetScript_deploysAnEmptyShop() public {
        DeployShopTestnet script = new DeployShopTestnet();
        DeployShopTestnet.Config memory c;
        c.feeRouter = feeRouter;
        c.letters = peg;
        c.faucetSigner = makeAddr("signer");
        c.revenueWallet = makeAddr("studio");
        c.pegPackUsdc = 1e6;
        c.maxSlippageBps = 1_000;
        c.owner = makeAddr("owner");
        (Shop shop, MockUSDC usdc, MockUsdcWordAdapter adapter) = script.deploy(c);
        assertEq(shop.itemCount(), 0);
        assertEq(address(shop.usdc()), address(usdc));
        assertEq(adapter.wordPerUsdc(), 4_220_000 ether, "the test rate is the peg");
        assertEq(usdc.signer(), c.faucetSigner);
        assertEq(usdc.owner(), c.owner);
        assertEq(adapter.owner(), c.owner);
        // The test rate clears the floor: a swap at it never defers on its own.
        assertGe((200_000 * adapter.wordPerUsdc()) / 1e6, shop.floorFor(200_000));
    }
}
