//     @@      @@@@@@@@   @@@@@@@@   @@@@@@@@   @@@@@@
//  @@@@@@@@@  @@@@@@@@  @@@@@@@@@  @@@@@@@@@  @@@@@@@
// !@@!@@!@@!  @@!       !@@        !@@        !@@
// !@! !@      !@!       !@!        !@!        !@!
// !!!@@!!!!   @!!!:!    !@! @!@!@  !@! @!@!@  !!@@!!
//  !!!@@@!!!  !!!!!:    !!! !!@!!  !!! !!@!!   !!@!!!
//     !: !:!  !!:       :!!   !!:  :!!   !!:       !:!
// !:!!:!: :!  :!:       :!:   !::  :!:   !::      !:!
// : :::: ::    :: ::::   ::: ::::   ::: ::::  :::: ::
//     ::      : :: ::    :: :: :    :: :: :   :: : :

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/// @custom:security-contact eggs@bwl.gg
contract EggsStaking is
  Initializable,
  OwnableUpgradeable,
  ReentrancyGuardUpgradeable
{
  // State
  mapping(address => uint256) public stakedAmounts;

  // Events
  event Staked(address indexed user, uint256 amount);
  event Unstaked(address indexed user, uint256 amount);

  function initialize(address initialOwner) public initializer {
    __Ownable_init(initialOwner);
    __ReentrancyGuard_init();
  }

  function stake(address user, uint256 amount) external onlyOwner nonReentrant {
    require(amount > 0, "Amount must be greater than 0");

    stakedAmounts[user] += amount;
    emit Staked(user, amount);
  }

  function unstake(
    address user
  ) external onlyOwner nonReentrant returns (uint256) {
    uint256 amount = stakedAmounts[user];
    require(amount > 0, "No staked amount");

    stakedAmounts[user] = 0;
    emit Unstaked(user, amount);
    return amount;
  }

  function stakeOf(address user) external view returns (uint256) {
    return stakedAmounts[user];
  }
}
