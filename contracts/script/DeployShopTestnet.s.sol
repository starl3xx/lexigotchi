// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {Shop, IPackPricePeg} from "../src/Shop.sol";
import {IFeeRouter, FeeSource} from "../src/interfaces/IFeeRouter.sol";
import {MockUSDC} from "../test/mocks/MockUSDC.sol";
import {MockUsdcWordAdapter, IMintableWord} from "../test/mocks/MockUsdcWordAdapter.sol";

/**
 * @title DeployShopTestnet
 * @notice BASE SEPOLIA ONLY: deploys test USDC (MockUSDC: 6 decimals, Circle's permit domain, a faucet
 *         of 25 a profile a day vouched by the app's signer), the mock route (MockUsdcWordAdapter: test
 *         USDC → test $WORD at a fixed rate, minted, since the Sepolia $WORD's mint() is permissionless),
 *         and the Shop, then registers the Shop with the FeeRouter. The registry is EMPTY: the one test
 *         item is added afterwards through the admin's transaction builder, never here.
 *
 *         The test rate defaults to the peg the Shop's floor reads (Letters' $1 pack price), so a swap
 *         at the test rate always clears the floor.
 *
 *         Required env: FEE_ROUTER, LETTERS, FAUCET_SIGNER (the app's SIGNER key's address).
 *         Optional env: REVENUE_WALLET (default the broadcaster), WORD_PER_USDC (the test rate, $WORD wei
 *                       per 1 USDC), PEG_PACK_USDC (default 1e6), MAX_SLIPPAGE_BPS (default 1000),
 *                       SHOP_OWNER (default the broadcaster), REGISTER (default true).
 */
contract DeployShopTestnet is Script {
    struct Config {
        FeeRouter feeRouter;
        IPackPricePeg letters;
        address faucetSigner;
        address revenueWallet;
        uint256 wordPerUsdc; // 0 = read the peg
        uint256 pegPackUsdc;
        uint16 maxSlippageBps;
        address owner;
    }

    function run() external returns (Shop shop, MockUSDC usdc, MockUsdcWordAdapter adapter) {
        require(block.chainid != 8453, "never on Base mainnet: this deploys test USDC");
        Config memory c;
        c.feeRouter = FeeRouter(vm.envAddress("FEE_ROUTER"));
        c.letters = IPackPricePeg(vm.envAddress("LETTERS"));
        c.faucetSigner = vm.envAddress("FAUCET_SIGNER");
        c.revenueWallet = vm.envOr("REVENUE_WALLET", msg.sender);
        c.wordPerUsdc = vm.envOr("WORD_PER_USDC", uint256(0));
        c.pegPackUsdc = vm.envOr("PEG_PACK_USDC", uint256(1e6));
        c.maxSlippageBps = uint16(vm.envOr("MAX_SLIPPAGE_BPS", uint256(1_000)));
        c.owner = vm.envOr("SHOP_OWNER", msg.sender);
        bool register = vm.envOr("REGISTER", true);

        vm.startBroadcast();
        (shop, usdc, adapter) = deploy(c);
        if (register) c.feeRouter.setCollector(address(shop), true);
        vm.stopBroadcast();

        console2.log("MockUSDC           ", address(usdc));
        console2.log("MockUsdcWordAdapter", address(adapter));
        console2.log("Shop               ", address(shop));
        console2.log("test rate ($WORD wei per USDC)", adapter.wordPerUsdc());
    }

    /// @notice The deploy itself, without broadcasting (the tests call it). Leaves the registry empty.
    function deploy(Config memory c) public returns (Shop shop, MockUSDC usdc, MockUsdcWordAdapter adapter) {
        IERC20 word = c.feeRouter.word();
        (, uint16 toJackpot,,) = c.feeRouter.splits(FeeSource.ROYALTY);
        require(toJackpot == 0, "the ROYALTY split gives the jackpot a share: no shop money goes there");
        uint256 rate = c.wordPerUsdc != 0 ? c.wordPerUsdc : (c.letters.packPrice() * 1e6) / c.pegPackUsdc;
        usdc = new MockUSDC(c.faucetSigner, c.owner);
        adapter = new MockUsdcWordAdapter(usdc, IMintableWord(address(word)), rate, c.owner);
        shop = new Shop(
            word,
            IFeeRouter(address(c.feeRouter)),
            usdc,
            adapter,
            c.revenueWallet,
            c.letters,
            c.pegPackUsdc,
            c.maxSlippageBps,
            c.owner
        );
        require(shop.itemCount() == 0, "the Shop deploys with no items");
    }
}
