// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IFeeRouter} from "./interfaces/IFeeRouter.sol";

/**
 * @title FeeCollector
 * @notice Shared base for every contract that charges a $WORD fee. Pulls the fee straight from
 *         the payer into the FeeRouter and books it against the right split source. The payer
 *         approves the *collector* (this contract) to spend $WORD; the tokens move directly to
 *         the router, so collectors never custody fees.
 */
abstract contract FeeCollector {
    using SafeERC20 for IERC20;

    IERC20 public immutable word;
    IFeeRouter public immutable feeRouter;

    constructor(IERC20 _word, IFeeRouter _feeRouter) {
        word = _word;
        feeRouter = _feeRouter;
    }

    /// @dev Move `amount` $WORD from `payer` to the router and credit it to `source`'s buckets.
    function _collect(address payer, uint256 amount, uint8 source) internal {
        if (amount > 0) {
            word.safeTransferFrom(payer, address(feeRouter), amount);
            feeRouter.route(source, amount);
        }
    }

    /// @dev Route `amount` of $WORD this contract already holds (e.g. ETH-swap output).
    function _routeHeld(uint256 amount, uint8 source) internal {
        if (amount > 0) {
            word.safeTransfer(address(feeRouter), amount);
            feeRouter.route(source, amount);
        }
    }
}
