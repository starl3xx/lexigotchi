// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title RepegKeeper
 * @notice Shared mixin giving a contract a dedicated price-keeper hot-key role and an on-chain
 *         max-move clamp, so an automated keeper can repeg prices within a bounded band WITHOUT the
 *         owner in the loop (no multisig). Storage-only, like {FeeCollector}: the inheriting contract
 *         exposes the owner-gated config (`setPriceKeeper` / `setMaxMoveBps`) and the
 *         `onlyPriceKeeper` repeg entrypoints, which call `_clampRepeg` and write only price fields.
 *
 *         `priceKeeper` defaults to address(0) = repeg DISABLED (a safe freeze default); the owner
 *         wires the hot key post-deploy. The clamp bounds the blast radius of a bad price feed or a
 *         leaked keeper key: one repeg can move a price by at most `maxMoveBps`, can never move a price
 *         off zero, and can never zero a live price — so a price the owner has set to 0 (e.g. the FREE
 *         daily) can never start charging via the keeper, and a live price can never be zeroed by it.
 *         Going on/off zero, or moving beyond the band, stays an owner-only action via the original
 *         unclamped setters. The keeper is a distinct role from the resolution keeper (jackpot/epochs).
 */
abstract contract RepegKeeper {
    uint16 internal constant REPEG_DENOM_BPS = 10_000;

    address public priceKeeper;
    uint16 public maxMoveBps;

    event PriceKeeperSet(address priceKeeper);
    event MaxMoveBpsSet(uint16 maxMoveBps);
    event Repegged(bytes32 indexed priceId, uint256 oldPrice, uint256 newPrice);

    error NotPriceKeeper();
    error RepegTooLarge();

    modifier onlyPriceKeeper() {
        if (msg.sender != priceKeeper) revert NotPriceKeeper();
        _;
    }

    function _setPriceKeeper(address keeper) internal {
        priceKeeper = keeper;
        emit PriceKeeperSet(keeper);
    }

    function _setMaxMoveBps(uint16 bps) internal {
        maxMoveBps = bps;
        emit MaxMoveBpsSet(bps);
    }

    /// @dev Decide whether a keeper may move a price from `current` to `next`. Returns false when the
    ///      value is unchanged (the caller skips the write + event). Reverts {RepegTooLarge} if the
    ///      move exceeds `maxMoveBps`, or if it would cross zero in either direction (on/off zero is
    ///      owner-only). Compares against this contract's OWN stored price, the sole authority on it.
    function _clampRepeg(uint256 current, uint256 next) internal view returns (bool changed) {
        if (next == current) return false;
        if (current == 0 || next == 0) revert RepegTooLarge();
        uint256 delta = next > current ? next - current : current - next;
        if (delta * REPEG_DENOM_BPS > current * uint256(maxMoveBps)) revert RepegTooLarge();
        return true;
    }
}
