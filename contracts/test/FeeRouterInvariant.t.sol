// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {FeeSource} from "../src/interfaces/IFeeRouter.sol";

/// @dev Fuzz handler: drives the FeeRouter through ARBITRARY route/payout sequences as the sole
///      collector + payer, so the invariant suite can assert solvency holds under any ordering of
///      fees in and payouts out (incl. the real burn that now reduces $WORD totalSupply).
contract FeeRouterHandler is Test {
    FeeRouter public immutable feeRouter;
    MockERC20 public immutable word;

    constructor(FeeRouter _fr, MockERC20 _word) {
        feeRouter = _fr;
        word = _word;
    }

    /// Deliver a fee of `amount` from source `source` (the realistic collector flow: pull-in + route).
    function route(uint8 source, uint256 amount) external {
        source = uint8(bound(source, 0, 6)); // FeeSource 0..6
        amount = bound(amount, 1, 1e30);
        word.mint(address(this), amount);
        word.transfer(address(feeRouter), amount);
        feeRouter.route(source, amount);
    }

    function payPool(uint256 amount) external {
        feeRouter.payFromPool(address(0xCAFE), bound(amount, 0, 1e30));
    }

    function payJackpot(uint256 amount) external {
        feeRouter.payFromJackpot(address(0xCAFE), bound(amount, 0, 1e30));
    }

    function payBounty(uint256 amount) external {
        feeRouter.payFromBounty(address(0xCAFE), bound(amount, 0, 1e30));
    }
}

/// @notice Invariant campaign for the FeeRouter's solvency core (the on-chain analog of the sim's
///         daily assertSolvent). Pre-mainnet checklist item — the held $WORD must always cover the
///         three live buckets, no matter the sequence of routes and capped payouts.
contract FeeRouterInvariant is Test {
    FeeRouter feeRouter;
    MockERC20 word;
    FeeRouterHandler handler;
    address treasury = makeAddr("treasury");

    function setUp() public {
        word = new MockERC20();
        feeRouter = new FeeRouter(word, treasury, address(this));
        handler = new FeeRouterHandler(feeRouter, word);

        feeRouter.setCollector(address(handler), true);
        feeRouter.setPayers(address(handler), address(handler), address(handler)); // handler is all 3 payers

        // v0.2 split table (each sums to 10_000 bps)
        feeRouter.setSplit(FeeSource.PACK_MINT, FeeRouter.Split(4000, 1000, 2000, 3000));
        feeRouter.setSplit(FeeSource.DAILY_MINT, FeeRouter.Split(4000, 1000, 2000, 3000));
        feeRouter.setSplit(FeeSource.ROLL, FeeRouter.Split(4750, 1000, 2750, 1500));
        feeRouter.setSplit(FeeSource.CLAIM, FeeRouter.Split(3250, 1000, 3250, 2500));
        feeRouter.setSplit(FeeSource.SNACK, FeeRouter.Split(0, 0, 10000, 0));
        feeRouter.setSplit(FeeSource.PRESTIGE, FeeRouter.Split(4750, 1000, 2750, 1500));
        feeRouter.setSplit(FeeSource.ROYALTY, FeeRouter.Split(0, 0, 0, 10000));
        feeRouter.setBountyCarveBps(1500); // carve ON so the bounty bucket is exercised

        targetContract(address(handler));
    }

    /// @notice The held $WORD always covers pool + jackpot + bounty — no sequence of fees/payouts can
    ///         make a bucket pay more than it holds (every payFrom* is balance-capped).
    function invariant_heldCoversLiveBuckets() public view {
        assertGe(
            word.balanceOf(address(feeRouter)),
            feeRouter.poolBalance() + feeRouter.jackpotBalance() + feeRouter.bountyBalance(),
            "solvency: held >= pool + jackpot + bounty"
        );
    }

    /// @notice The jackpot bucket is funded ONLY by routed fees — it can never be seeded (lottery
    ///         compliance). The handler has no seed path, so any jackpot balance came from route().
    function invariant_jackpotSelfFundedOnly() public view {
        // sanity: jackpot can hold value (from routes) but the contract still covers it (see above).
        assertLe(feeRouter.jackpotBalance(), word.balanceOf(address(feeRouter)), "jackpot <= held");
    }
}
