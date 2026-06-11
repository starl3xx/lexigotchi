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

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20FlashMintUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./IMegapot.sol";
import "./EggsStaking.sol";

/// @custom:security-contact eggs@bwl.gg
contract Eggs is
  Initializable,
  ERC20Upgradeable,
  ERC20BurnableUpgradeable,
  ERC20PausableUpgradeable,
  OwnableUpgradeable,
  ERC20PermitUpgradeable,
  ERC20VotesUpgradeable,
  ERC20FlashMintUpgradeable,
  ReentrancyGuardUpgradeable
{
  // State
  address public superHen;
  mapping(uint256 => mapping(uint256 => bool)) public claimedTickets;
  uint256 public taxRate; // not used anymore

  // Bok bak?
  mapping(uint256 => uint256) public extraChickens;

  mapping(uint256 => uint256) public chickenLevelPrices;
  mapping(uint256 => bool) public chickenLevelCommitments;
  mapping(uint256 => uint256) public chickenLevels;

  address public taxReceiver; // not used anymore

  // Jackpot state
  uint256 public currentJackpotId;
  mapping(uint256 jackpotId => uint256 lastTicketIndex)
    public jackpotLastTicketIndexes;
  mapping(uint256 ticketId => bool claimed) public jackpotTicketsClaimed;
  mapping(uint256 jackpotId => mapping(uint256 ticketIndex => uint256 userId))
    public jackpotTickets;

  mapping(uint256 jackpotId => uint256[] userIds) public jackpotWinners;
  bool public jackpotTicketClaimsOpen;

  // Megapot state
  address public megapotContractAddress;
  address public megapotReferrerAddress;
  address public usdcAddress;

  // Staking state
  address public eggsStakingContract;
  bool public stakingOpen;

  // Events
  event SuperHenSet(address newSuperHen);
  event ClaimedEggs(
    address indexed user,
    uint256 ticketType,
    uint256 amount,
    uint256 ticketId
  );
  event TaxRateSet(uint256 newTaxRate);
  event TaxReceiverSet(address newTaxReceiver);
  // Bok bak?
  event ExtraChickensSet(uint256 userId, uint256 extraChickens);
  event ChickenLevelPricesSet(uint256[] prices);
  event ChickenLevelSet(
    uint256 chickenId,
    uint256 chickenLevel,
    uint256 randomNumber
  );
  event ChickenLevelSetFailed(
    uint256 chickenId,
    uint256 chickenLevel,
    uint256 randomNumber
  );
  // Jackpot events
  event JackpotIdSet(uint256 jackpotId);
  event JackpotTicketClaimed(
    uint256 userId,
    uint256 jackpotId,
    uint256 ticketId,
    uint256 numberOfTickets
  );
  event JackpotWinnersSet(uint256 jackpotId, uint256[] winnerIds);
  event JackpotTicketClaimsOpenSet(uint256 jackpotId, bool open);
  // Staking events
  event Staked(address indexed user, uint256 amount);
  event Unstaked(address indexed user, uint256 amount);
  event StakingOpenSet(bool open);
  event EggsStakingContractSet(address newEggsStakingContract);

  function initialize(
    address initialOwner,
    string calldata name,
    string calldata symbol
  ) public initializer {
    __ERC20_init(name, symbol);
    __ERC20Burnable_init();
    __ERC20Pausable_init();
    __Ownable_init(initialOwner);
    __ERC20Permit_init(name);
    __ERC20Votes_init();
    __ERC20FlashMint_init();
    __ReentrancyGuard_init();
  }

  function setChickenLevelPrices(uint256[] calldata prices) public onlyOwner {
    for (uint256 i = 0; i < prices.length; i++) {
      chickenLevelPrices[i] = prices[i];
    }
    emit ChickenLevelPricesSet(prices);
  }

  function getChickenLevelPrices(
    uint256 count
  ) public view returns (uint256[] memory) {
    uint256[] memory prices = new uint256[](count);
    for (uint256 i = 0; i < count; i++) {
      prices[i] = chickenLevelPrices[i];
    }
    return prices;
  }

  function setJackpotClaimsOpen(bool open) public onlyOwner {
    jackpotTicketClaimsOpen = open;
    emit JackpotTicketClaimsOpenSet(currentJackpotId, open);
  }

  function redeemTicket(
    bytes calldata data,
    bytes32 r,
    bytes32 vs
  ) public nonReentrant {
    (address recoveredSuperHen, ECDSA.RecoverError ecdsaError, ) = ECDSA
      .tryRecover(MessageHashUtils.toEthSignedMessageHash(data), r, vs);
    require(
      ecdsaError == ECDSA.RecoverError.NoError,
      "Error while verifying the ECDSA signature"
    );
    require(
      recoveredSuperHen == superHen,
      "You're dealing with a wrong hen, beware!"
    );
    (
      uint256 userId,
      uint256 ticketType,
      uint256 eggsAmount,
      uint256 ticketId
    ) = abi.decode(data, (uint256, uint256, uint256, uint256));
    address userAddress = address(uint160(userId));
    require(
      !claimedTickets[userId][ticketId],
      "You've already claimed this ticket"
    );
    _mint(userAddress, eggsAmount);
    claimedTickets[userId][ticketId] = true;
    emit ClaimedEggs(userAddress, ticketType, eggsAmount, ticketId);
  }

  // Bok bak?

  function buyExtraChicken(uint256 userId) public nonReentrant {
    require(extraChickens[userId] < 2, "You already have all extra chickens");
    _transfer(msg.sender, address(this), 100 * 10 ** 18);
    extraChickens[userId] += 1;
    emit ExtraChickensSet(userId, extraChickens[userId]);
  }

  function commitToLevelUpChicken(uint256 chickenId) public nonReentrant {
    require(chickenLevels[chickenId] < 4, "Your chicken is already max level");
    _transfer(
      msg.sender,
      address(this),
      chickenLevelPrices[chickenLevels[chickenId]]
    );
    chickenLevelCommitments[chickenId] = true;
  }

  function levelUpChicken(
    bytes calldata data,
    bytes32 r,
    bytes32 vs
  ) public nonReentrant {
    (address recoveredSuperHen, ECDSA.RecoverError ecdsaError, ) = ECDSA
      .tryRecover(MessageHashUtils.toEthSignedMessageHash(data), r, vs);
    require(
      ecdsaError == ECDSA.RecoverError.NoError,
      "Error while verifying the ECDSA signature"
    );
    require(
      recoveredSuperHen == superHen,
      "You're dealing with a wrong hen, beware!"
    );
    (uint256 chickenId, uint256 chickenLevel, uint256 randomNumber) = abi
      .decode(data, (uint256, uint256, uint256));
    require(
      chickenLevelCommitments[chickenId],
      "You need to commit to level up your chicken"
    );
    require(
      chickenLevels[chickenId] == chickenLevel,
      "Your chicken level is not correct"
    );
    if (randomNumber == 0) {
      emit ChickenLevelSetFailed(
        chickenId,
        chickenLevels[chickenId],
        randomNumber
      );
    } else {
      chickenLevels[chickenId] += 1;
      emit ChickenLevelSet(chickenId, chickenLevels[chickenId], randomNumber);
    }
    chickenLevelCommitments[chickenId] = false;
    // Megapot ticket purchase
    buyMegapotTicket();
  }

  function burnFees() public nonReentrant {
    uint256 balance = balanceOf(address(this));
    uint256 reward = 1 * 10 ** 17; // 0.1 Eggs
    require(
      balance > 10 * 10 ** 18, // 10 Eggs
      "Not enough Eggs to burn, please try again later"
    );
    // Burn the fees
    _burn(address(this), balance - reward);
    // Transfer the reward to the caller
    _transfer(address(this), msg.sender, reward);
  }

  // Jackpot

  function redeemJackpotTicket(
    bytes calldata data,
    bytes32 r,
    bytes32 vs
  ) public nonReentrant {
    require(jackpotTicketClaimsOpen, "Jackpot ticket claims are closed");
    (address recoveredSuperHen, ECDSA.RecoverError ecdsaError, ) = ECDSA
      .tryRecover(MessageHashUtils.toEthSignedMessageHash(data), r, vs);
    require(
      ecdsaError == ECDSA.RecoverError.NoError,
      "Error while verifying the ECDSA signature"
    );
    require(
      recoveredSuperHen == superHen,
      "You're dealing with a wrong hen, beware!"
    );
    (
      uint256 userId,
      uint256 ticketId,
      uint256 jackpotId,
      uint256 numberOfTickets
    ) = abi.decode(data, (uint256, uint256, uint256, uint256));
    require(
      !jackpotTicketsClaimed[ticketId],
      "You've already claimed this ticket"
    );
    require(
      jackpotId == currentJackpotId,
      "This jackpot is not active anymore"
    );
    // Redeem the ticket
    jackpotTickets[jackpotId][
      jackpotLastTicketIndexes[jackpotId] + numberOfTickets
    ] = userId;
    jackpotTicketsClaimed[ticketId] = true;
    jackpotLastTicketIndexes[jackpotId] += numberOfTickets;
    emit JackpotTicketClaimed(userId, jackpotId, ticketId, numberOfTickets);
  }

  function drawJackpot() public onlyOwner {
    // Get 30 random numbers
    uint256[] memory pseudoRandomNumbers = new uint256[](30);
    for (uint256 i = 0; i < 30; i++) {
      pseudoRandomNumbers[i] =
        uint256(keccak256(abi.encodePacked(block.prevrandao, i))) %
        jackpotLastTicketIndexes[currentJackpotId];
    }
    // Get 30 winning user ids
    uint256[] memory winners = new uint256[](30);
    for (uint256 i = 0; i < 30; i++) {
      uint256 ticketIndex = pseudoRandomNumbers[i];
      uint256 userId;
      for (
        uint256 j = ticketIndex;
        j <= jackpotLastTicketIndexes[currentJackpotId];
        j++
      ) {
        if (jackpotTickets[currentJackpotId][j] != 0) {
          userId = jackpotTickets[currentJackpotId][j];
          break;
        }
      }
      winners[i] = userId;
    }
    // Set the winners
    jackpotWinners[currentJackpotId] = winners;
    emit JackpotWinnersSet(currentJackpotId, winners);
    // Reset the jackpot
    currentJackpotId += 1;
    emit JackpotIdSet(currentJackpotId);
  }

  // Megapot

  function setMegapotContractAddress(
    address newMegapotContractAddress
  ) public onlyOwner {
    megapotContractAddress = newMegapotContractAddress;
  }

  function setMegapotReferrerAddress(
    address newMegapotReferrerAddress
  ) public onlyOwner {
    megapotReferrerAddress = newMegapotReferrerAddress;
  }

  function setUsdcAddress(address newUsdcAddress) public onlyOwner {
    usdcAddress = newUsdcAddress;
  }

  function approveUsdc() public onlyOwner {
    IERC20(usdcAddress).approve(megapotContractAddress, type(uint256).max);
  }

  function buyMegapotTicket() private {
    uint256 amount = 1000000;
    if (IERC20(usdcAddress).balanceOf(address(this)) >= amount) {
      IMegapot(megapotContractAddress).purchaseTickets(
        megapotReferrerAddress,
        amount,
        msg.sender
      );
    }
  }

  // Staking

  function stake(uint256 amount) public nonReentrant {
    require(stakingOpen, "Staking is not open");
    require(amount > 0, "Amount must be greater than 0");
    require(eggsStakingContract != address(0), "Staking contract not set");

    _transfer(msg.sender, eggsStakingContract, amount);
    EggsStaking(eggsStakingContract).stake(msg.sender, amount);
    emit Staked(msg.sender, amount);
  }

  function unstake() public nonReentrant {
    require(eggsStakingContract != address(0), "Staking contract not set");

    uint256 amount = EggsStaking(eggsStakingContract).unstake(msg.sender);
    _transfer(eggsStakingContract, msg.sender, amount);
    emit Unstaked(msg.sender, amount);
  }

  function stakeOf(address user) public view returns (uint256) {
    if (eggsStakingContract == address(0)) {
      return 0;
    }
    return EggsStaking(eggsStakingContract).stakeOf(user);
  }

  function setEggsStakingContract(
    address newEggsStakingContract
  ) public onlyOwner {
    eggsStakingContract = newEggsStakingContract;
    emit EggsStakingContractSet(newEggsStakingContract);
  }

  function setStakingOpen(bool open) public onlyOwner {
    stakingOpen = open;
    emit StakingOpenSet(open);
  }

  // Flash fees because please stop minting max supply smh get a life

  function _flashFee(
    address token,
    uint256 value
  ) internal view override returns (uint256) {
    if (token != address(this)) {
      revert ERC3156UnsupportedToken(token);
    }
    return (value * 1) / 100; // 1% fee
  }

  function _flashFeeReceiver() internal view override returns (address) {
    return address(this);
  }

  // The following functions are overrides required by Solidity.

  function _update(
    address from,
    address to,
    uint256 value
  )
    internal
    override(ERC20Upgradeable, ERC20PausableUpgradeable, ERC20VotesUpgradeable)
  {
    super._update(from, to, value);
  }

  function nonces(
    address owner
  )
    public
    view
    override(ERC20PermitUpgradeable, NoncesUpgradeable)
    returns (uint256)
  {
    return super.nonces(owner);
  }
}
