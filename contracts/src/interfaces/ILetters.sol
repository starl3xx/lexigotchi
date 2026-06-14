// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

/**
 * @title ILetters
 * @notice The 52-id letter ERC-1155. Id convention: lowercase letter `i` (0..25) is id `i`;
 *         uppercase letter `i` is id `26 + i`. Mints are 100% lowercase (v0.2 §1.3); uppercase
 *         exists only via `upgrade` (a roll), which conserves total per-letter supply.
 */
interface ILetters is IERC1155 {
    /// @notice Burn one lowercase `letterIndex` from `holder` and mint the uppercase counterpart
    ///         to `holder`. Conserves total supply (no `mintedEver` change). Roller-only.
    function upgrade(address holder, uint8 letterIndex) external;
}
