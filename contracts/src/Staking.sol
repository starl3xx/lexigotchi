// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IWords} from "./interfaces/IWords.sol";
import {IStaking} from "./interfaces/IStaking.sol";
import {IFeeRouter, FeeSource} from "./interfaces/IFeeRouter.sol";
import {FeeCollector} from "./FeeCollector.sol";
import {RepegKeeper} from "./RepegKeeper.sol";

/**
 * @title Staking
 * @notice Custodial staking for Word NFTs plus the hunger clock. Staking a Word transfers it here
 *         and starts it "fed"; feeding resets the clock — the first feed each UTC day is free (the
 *         v0.1 §5.6 check-in hook), every other feed costs a snack (100% burned). Hunger
 *         gates BOTH yield and jackpot eligibility (v0.2 §1.6): peckish (≥ peckishAfter) halves yield
 *         but keeps the jackpot ticket; hungry (≥ hungryAfter) earns nothing and cannot win the pot.
 *
 *         This contract owns the *eligibility truth* read by `Jackpot` (staked + not hungry) and the
 *         per-NFT weighting inputs (case via `Words.caseOf`, prestige via `Words.prestigeLevel`,
 *         tier off-chain). The actual UPPERCASE-only yield is streamed by `YieldDistributor` per
 *         epoch from the FeeRouter pool, so this contract holds no reward accounting itself.
 */
contract Staking is IStaking, ERC721Holder, Ownable2Step, ReentrancyGuard, FeeCollector, RepegKeeper {
    IWords public immutable words;

    uint256 public snackPrice; // $WORD per feed (100% burned)
    uint64 public peckishAfter; // seconds unfed → peckish
    uint64 public hungryAfter; // seconds unfed → hungry
    bool public freeDailySnack = true; // one free snack per player per UTC day (v0.1 §5.6 check-in hook)

    mapping(uint256 tokenId => address) public stakerOf;
    mapping(uint256 tokenId => uint64) public lastFed;
    // (UTC day + 1) on which a player last used their free snack; default 0 means "never".
    mapping(address player => uint32 dayPlusOne) public freeSnackDayPlusOne;

    event Staked(uint256 indexed tokenId, address indexed staker);
    event Unstaked(uint256 indexed tokenId, address indexed staker);
    event Fed(uint256 indexed tokenId, address indexed staker, uint64 at);
    event CareParamsSet(uint64 peckishAfter, uint64 hungryAfter, uint256 snackPrice);
    event FreeDailySnackSet(bool enabled);

    error NotStaked();
    error NotStaker();

    constructor(
        IERC20 _word,
        IFeeRouter _feeRouter,
        IWords _words,
        uint256 _snackPrice,
        uint64 _peckishAfter,
        uint64 _hungryAfter,
        address initialOwner
    ) Ownable(initialOwner) FeeCollector(_word, _feeRouter) {
        words = _words;
        snackPrice = _snackPrice;
        peckishAfter = _peckishAfter;
        hungryAfter = _hungryAfter;
    }

    // --- stake / unstake / feed -------------------------------------------------------------------

    function stake(uint256 tokenId) external nonReentrant {
        words.safeTransferFrom(msg.sender, address(this), tokenId);
        stakerOf[tokenId] = msg.sender;
        lastFed[tokenId] = uint64(block.timestamp); // a freshly staked word starts fed
        emit Staked(tokenId, msg.sender);
    }

    function unstake(uint256 tokenId) external nonReentrant {
        if (stakerOf[tokenId] != msg.sender) revert NotStaker();
        delete stakerOf[tokenId];
        delete lastFed[tokenId];
        words.safeTransferFrom(address(this), msg.sender, tokenId);
        emit Unstaked(tokenId, msg.sender);
    }

    function feed(uint256 tokenId) public nonReentrant {
        if (stakerOf[tokenId] == address(0)) revert NotStaked();
        // The first feed of the UTC day is free (the check-in hook); every other feed is paid + burned.
        uint32 todayPlusOne = uint32(block.timestamp / 1 days) + 1;
        if (freeDailySnack && freeSnackDayPlusOne[msg.sender] != todayPlusOne) {
            freeSnackDayPlusOne[msg.sender] = todayPlusOne;
        } else {
            _collect(msg.sender, snackPrice, FeeSource.SNACK); // snacks are 100% burned
        }
        lastFed[tokenId] = uint64(block.timestamp);
        emit Fed(tokenId, stakerOf[tokenId], uint64(block.timestamp));
    }

    function feedMany(uint256[] calldata tokenIds) external {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            feed(tokenIds[i]);
        }
    }

    // --- views (read by Jackpot / YieldDistributor / Prestige) ------------------------------------

    /// @inheritdoc IStaking
    function beneficialOwner(uint256 tokenId) external view returns (address) {
        return stakerOf[tokenId];
    }

    /// @inheritdoc IStaking
    function isStaked(uint256 tokenId) external view returns (bool) {
        return stakerOf[tokenId] != address(0);
    }

    /// @inheritdoc IStaking
    function isHungry(uint256 tokenId) external view returns (bool) {
        return hungerLevel(tokenId) == 2;
    }

    /// @inheritdoc IStaking
    function hungerLevel(uint256 tokenId) public view returns (uint8) {
        if (stakerOf[tokenId] == address(0)) return 0;
        uint256 elapsed = block.timestamp - lastFed[tokenId];
        if (elapsed >= hungryAfter) return 2;
        if (elapsed >= peckishAfter) return 1;
        return 0;
    }

    // --- admin ------------------------------------------------------------------------------------

    function setCareParams(uint64 _peckishAfter, uint64 _hungryAfter, uint256 _snackPrice) external onlyOwner {
        peckishAfter = _peckishAfter;
        hungryAfter = _hungryAfter;
        snackPrice = _snackPrice;
        emit CareParamsSet(_peckishAfter, _hungryAfter, _snackPrice);
    }

    function setFreeDailySnack(bool enabled) external onlyOwner {
        freeDailySnack = enabled;
        emit FreeDailySnackSet(enabled);
    }

    // --- repeg (price keeper) ---------------------------------------------------------------------

    /// @notice Keeper-driven clamped repeg of the snack price ONLY; the hunger thresholds are re-passed
    ///         unchanged into the existing CareParamsSet event (the keeper can't touch governance args).
    function repegSnackPrice(uint256 snackPrice_) external onlyPriceKeeper {
        uint256 old = snackPrice;
        if (_clampRepeg(old, snackPrice_)) {
            snackPrice = snackPrice_;
            emit CareParamsSet(peckishAfter, hungryAfter, snackPrice_);
            emit Repegged("snackPrice", old, snackPrice_);
        }
    }

    function setPriceKeeper(address keeper) external onlyOwner {
        _setPriceKeeper(keeper);
    }

    function setMaxMoveBps(uint16 bps) external onlyOwner {
        _setMaxMoveBps(bps);
    }
}
