// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title IStaking
 * @notice Word-NFT staking custody + hunger state. Read by Jackpot (eligibility) and
 *         Prestige/Rolls (beneficial owner of a staked token).
 */
interface IStaking {
    /// @return the address that staked `tokenId` (address(0) if not staked)
    function beneficialOwner(uint256 tokenId) external view returns (address);
    function isStaked(uint256 tokenId) external view returns (bool);
    /// @return true once a staked word has gone unfed past the hungry threshold (v0.2 §1.6)
    function isHungry(uint256 tokenId) external view returns (bool);
    /// @return 0 = fed, 1 = peckish, 2 = hungry
    function hungerLevel(uint256 tokenId) external view returns (uint8);
}
