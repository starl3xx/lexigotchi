// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title ISwapRouter
 * @notice Minimal ETH→$WORD swap surface for the mint auto-swap (v0.2 §4). In production this
 *         is an adapter over a Uniswap v3 / aggregator route; the frontend supplies `minWordOut`
 *         as a slippage bound and the swap reverts rather than absorbing excess slippage.
 */
interface ISwapRouter {
    /// @notice Swap the attached ETH to $WORD, sending the output to `to`. Reverts if the
    ///         output would be below `minWordOut`.
    /// @return wordOut the amount of $WORD delivered to `to`
    function swapETHForWord(uint256 minWordOut, address to) external payable returns (uint256 wordOut);
}
