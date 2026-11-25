// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title IUsdcSwapAdapter
 * @notice The Shop's USDC→$WORD route, kept behind an interface so the route can change (a new pool,
 *         a new router) without redeploying the Shop: deploy a new adapter and point the Shop at it
 *         (`Shop.proposeAdapter`, then `acceptAdapter` after the delay).
 */
interface IUsdcSwapAdapter {
    /// @notice Pull exactly `usdcIn` USDC from msg.sender, swap it to $WORD, and send the $WORD to `to`.
    ///         Reverts if `to` would receive less than `minWordOut`.
    /// @return wordOut the $WORD delivered to `to`
    function swapUsdcForWord(uint256 usdcIn, uint256 minWordOut, address to) external returns (uint256 wordOut);
}
