// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @dev Fee sources, one configurable split each. Mirrors `params.ts splits.*`.
 *      PRESTIGE is its own slot (the sim defaults it to the ROLL split — the deploy
 *      script does the same on-chain). ROYALTY is the in-house swap fee (→ Treasury).
 */
library FeeSource {
    uint8 internal constant PACK_MINT = 0;
    uint8 internal constant DAILY_MINT = 1;
    uint8 internal constant ROLL = 2;
    uint8 internal constant CLAIM = 3;
    uint8 internal constant SNACK = 4;
    uint8 internal constant PRESTIGE = 5;
    uint8 internal constant ROYALTY = 6;
    uint8 internal constant COUNT = 7;
}

/**
 * @title IFeeRouter
 * @notice The on-chain analog of the sim's four-bucket ledger (`src/lib/sim/ledger.ts`):
 *         every fee is split into pool / jackpot / burn / treasury, and the pool/jackpot/
 *         bounty buckets can never pay out more $WORD than they hold (solvency by construction).
 */
interface IFeeRouter {
    /// @notice Credit `amount` of already-delivered $WORD into the buckets for `source`.
    /// @dev Caller must be an authorized collector and must have transferred `amount` in first.
    function route(uint8 source, uint256 amount) external;

    function payFromPool(address to, uint256 amount) external returns (uint256 paid);
    function payFromJackpot(address to, uint256 amount) external returns (uint256 paid);
    function payFromBounty(address to, uint256 amount) external returns (uint256 paid);

    function poolBalance() external view returns (uint256);
    function jackpotBalance() external view returns (uint256);
    function bountyBalance() external view returns (uint256);
}
