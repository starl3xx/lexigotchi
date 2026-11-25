// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IFeeRouter, FeeSource} from "./interfaces/IFeeRouter.sol";
import {FeeCollector} from "./FeeCollector.sol";

/**
 * @title SaleFees
 * @notice Receives the fee on word sales settled through Seaport (the in-game "For sale" board,
 *         10%; starl3xx, 2026-11-25) and routes it into the FeeRouter's ROYALTY split, which sends
 *         it to the Rewards Pool (less the bounty carve, like every pool share).
 *
 *         A Seaport order pays its fee as a plain $WORD transfer to an address, and the FeeRouter
 *         credits only $WORD that a registered collector routes, so the fee lands here and anyone
 *         may `flush()` it in. This contract has no owner and no admin: `flush` only ever moves its
 *         own $WORD into the router. Until the FeeRouter registers it (`setCollector`), `flush`
 *         reverts and the fees wait here.
 */
contract SaleFees is FeeCollector {
    event Flushed(uint256 amount);

    constructor(IERC20 _word, IFeeRouter _feeRouter) FeeCollector(_word, _feeRouter) {}

    /// @notice Route every pending sale fee into the ROYALTY split. Permissionless: the keeper calls
    ///         it each day before the yield epoch opens.
    function flush() external returns (uint256 amount) {
        amount = word.balanceOf(address(this));
        _routeHeld(amount, FeeSource.ROYALTY);
        emit Flushed(amount);
    }
}
