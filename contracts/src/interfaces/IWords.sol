// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @dev Derived case of a Word, computed from its escrowed letters (never stored).
enum CaseState {
    Lowercase, // 0 — all five escrowed letters lowercase
    Mixed, // 1 — partially raised
    Uppercase // 2 — all five raised
}

/**
 * @title IWords
 * @notice One ERC-721 per dictionary word, `tokenId = uint256(keccak256(bytes(word)))`
 *         (v0.2 §2). Case is derived from the five escrowed letters, never stored.
 */
interface IWords is IERC721 {
    function exists(uint256 tokenId) external view returns (bool);
    function caseOf(uint256 tokenId) external view returns (CaseState);
    function prestigeLevel(uint256 tokenId) external view returns (uint8);

    /// @return letterIndex alphabet position (0..25) of the escrowed letter at `pos`
    /// @return isUpper whether that escrowed letter has been raised to uppercase
    function escrowLetter(uint256 tokenId, uint8 pos)
        external
        view
        returns (uint8 letterIndex, bool isUpper);

    /// @notice Raise the escrowed letter at `pos` to uppercase (mutates escrow in place). Roller-only.
    function applyUpgrade(uint256 tokenId, uint8 pos) external;

    /// @notice Increment a word's prestige level (monotonic). Prestige-contract-only.
    function bumpPrestige(uint256 tokenId) external;
}
