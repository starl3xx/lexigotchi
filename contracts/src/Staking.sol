// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IWords} from "./interfaces/IWords.sol";
import {IStaking} from "./interfaces/IStaking.sol";
import {IFeeRouter, FeeSource} from "./interfaces/IFeeRouter.sol";
import {FeeCollector} from "./FeeCollector.sol";
import {RepegKeeper} from "./RepegKeeper.sol";

/**
 * @title Staking
 * @notice Custodial staking for Word NFTs plus the hunger clock. Staking a Word transfers it here
 *         and starts it "fed"; feeding resets the clock. Each PROFILE gets one free snack per UTC day
 *         (the v0.1 §5.6 check-in hook), through a signer voucher (`feedWithSnack`); every other feed
 *         costs a snack (100% burned). Hunger
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
    bool public freeDailySnack = true; // one free snack per profile per UTC day (v0.1 §5.6 check-in hook)
    /// @notice The backend signer that vouches for each profile's free snack (the same key that signs
    ///         Letters' daily vouchers and the reveal outcomes).
    address public signer;

    mapping(uint256 tokenId => address) public stakerOf;
    mapping(uint256 tokenId => uint64) public lastFed;
    /// @notice (UTC day + 1) on which a PROFILE last used its free snack; 0 means "never". A profile is
    ///         the player's linked wallets, named by its account (its first wallet). Only the signer
    ///         knows which wallets share a profile, so only its voucher spends one (starl3xx: "only one
    ///         wallet per profile should get a free anything"). Keyed per wallet, a player with two
    ///         staking wallets took two free snacks a day.
    mapping(address profile => uint32 dayPlusOne) public freeSnackDayPlusOne;
    /// @notice Wallets a staker lets care for its staked Words: feed them here, and roll and ascend
    ///         them (Rolls, Prestige). A caretaker pays with its own $WORD and never receives a Word,
    ///         so it can take nothing. This is separate from ERC-721 operator approval on purpose: a
    ///         marketplace, or any other operator of the staker's Words, gets nothing here.
    mapping(address staker => mapping(address wallet => bool)) public isCaretaker;

    event Staked(uint256 indexed tokenId, address indexed staker);
    event Unstaked(uint256 indexed tokenId, address indexed staker);
    event Fed(uint256 indexed tokenId, address indexed staker, uint64 at);
    event CareParamsSet(uint64 peckishAfter, uint64 hungryAfter, uint256 snackPrice);
    event FreeDailySnackSet(bool enabled);
    event CaretakerSet(address indexed staker, address indexed wallet, bool allowed);
    event SignerSet(address signer);
    /// @dev `profile`'s free snack for `day` fed `tokenId` (its Fed event follows).
    event FreeSnackUsed(address indexed profile, uint256 indexed tokenId, uint32 day);

    error NotStaked();
    error NotStaker();
    error BadCaretaker();
    error UnexpectedTransfer();
    error ZeroAddress();
    error NothingToFeed();
    error WrongStaker();
    error VoucherExpired();
    error BadSignature();

    /// @dev Bound into the free-snack digest, so no other voucher this signer makes can pass for one.
    bytes32 private constant FREE_SNACK_KIND = keccak256("lexigotchi.staking.freeSnack");

    constructor(
        IERC20 _word,
        IFeeRouter _feeRouter,
        IWords _words,
        uint256 _snackPrice,
        uint64 _peckishAfter,
        uint64 _hungryAfter,
        address _signer,
        address initialOwner
    ) Ownable(initialOwner) FeeCollector(_word, _feeRouter) {
        if (_signer == address(0)) revert ZeroAddress();
        words = _words;
        signer = _signer;
        snackPrice = _snackPrice;
        peckishAfter = _peckishAfter;
        hungryAfter = _hungryAfter;
    }

    // --- stake / unstake / feed -------------------------------------------------------------------

    function stake(uint256 tokenId) external nonReentrant {
        words.safeTransferFrom(msg.sender, address(this), tokenId);
        stakerOf[tokenId] = msg.sender;
        // Only a Word's FIRST stake starts fed. After that the hunger clock never resets except by
        // feed(): it keeps running while the Word is unstaked, and a restake picks up the real
        // time since the last meal. Pausing the clock instead (the first audit fix) still let a
        // player stake for a few minutes around the daily snapshot (jackpot resolve + yield scan,
        // 00:05 UTC, public in vercel.json) and never feed: almost no staked time ever accrued.
        // "First stake" means first since THIS claim: ids are the word's hash, so a word dissolved
        // and claimed again (by anyone) keeps its id, and must not inherit the old clock. Claiming
        // costs the claim fee, far more than a snack, so this is no way around feeding; passing a
        // word between wallets keeps its clock, because the claim doesn't change.
        if (lastFed[tokenId] < words.claimedAt(tokenId)) lastFed[tokenId] = uint64(block.timestamp);
        emit Staked(tokenId, msg.sender);
    }

    function unstake(uint256 tokenId) external nonReentrant {
        if (stakerOf[tokenId] != msg.sender) revert NotStaker();
        delete stakerOf[tokenId]; // lastFed stays: unstake + stake is never a meal
        words.safeTransferFrom(address(this), msg.sender, tokenId);
        emit Unstaked(tokenId, msg.sender);
    }

    /// @notice Feed `tokenId` with a paid snack. The day's free snack comes only with a voucher
    ///         (`feedWithSnack`): it's the profile's, and only the signer knows a wallet's profile.
    function feed(uint256 tokenId) public nonReentrant {
        _feed(tokenId, false);
    }

    function feedMany(uint256[] calldata tokenIds) external {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            feed(tokenIds[i]);
        }
    }

    /// @notice Feed `tokenIds`, the first with today's free snack of `profile`, the profile of that
    ///         Word's staker, when the signer vouched for it; the rest are paid. A profile that already
    ///         used today's free snack pays for the first too, as `feed` would (no revert: two wallets
    ///         of one profile racing each get a valid voucher, and the loser simply pays).
    /// @param staker  The staker of `tokenIds[0]`, as the voucher names it.
    /// @param profile The staker's profile (its account), as the voucher names it.
    /// @param deadline The voucher's last valid second (it's also valid only on the UTC day it names).
    function feedWithSnack(
        uint256[] calldata tokenIds,
        address staker,
        address profile,
        uint256 deadline,
        bytes calldata sig
    ) external nonReentrant {
        if (tokenIds.length == 0) revert NothingToFeed();
        if (block.timestamp > deadline) revert VoucherExpired();
        // The free snack belongs to the STAKER's profile, whoever feeds, and feeds only the staker's
        // Words: a voucher names both, so a wallet can't ask for a stranger's voucher and spend that
        // profile's snack on Words of its own. Keyed on the caller's profile instead, a staker could
        // name a caretaker in each of N profiles and feed N Words free every day.
        if (stakerOf[tokenIds[0]] != staker) revert WrongStaker();
        uint32 today = uint32(block.timestamp / 1 days);
        // The day is in the digest, so a voucher whose deadline straddles midnight can't take the next
        // day's snack. msg.sender is too: a voucher seen in the mempool is useless to anyone else.
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(address(this), block.chainid, FREE_SNACK_KIND, msg.sender, staker, profile, today, deadline))
        );
        if (ECDSA.recover(digest, sig) != signer) revert BadSignature();

        bool free = freeDailySnack && freeSnackDayPlusOne[profile] != today + 1;
        if (free) {
            freeSnackDayPlusOne[profile] = today + 1;
            emit FreeSnackUsed(profile, tokenIds[0], today);
        }
        _feed(tokenIds[0], free);
        for (uint256 i = 1; i < tokenIds.length; i++) {
            _feed(tokenIds[i], false);
        }
    }

    /// @dev The staker feeds, or a wallet the staker named with setCaretaker. A paid snack is the
    ///      caller's, never the staker's: a staker keeps a standing allowance to this contract, so
    ///      charging the staker would let a caretaker spend the staker's $WORD.
    function _feed(uint256 tokenId, bool free) internal {
        address staker = stakerOf[tokenId];
        if (staker == address(0)) revert NotStaked();
        if (staker != msg.sender && !isCaretaker[staker][msg.sender]) revert NotStaker();
        if (!free) _collect(msg.sender, snackPrice, FeeSource.SNACK); // snacks are 100% burned
        lastFed[tokenId] = uint64(block.timestamp);
        emit Fed(tokenId, staker, uint64(block.timestamp));
    }

    /// @dev Accept a Word only when Staking pulls it in itself (stake()). A Word sent here directly
    ///      with safeTransferFrom would get no stakerOf entry and could never be unstaked, so refuse it
    ///      (audit scan, 2026-11-24). A plain transferFrom skips this callback; nothing can catch that.
    function onERC721Received(address operator, address, uint256, bytes memory)
        public
        view
        override
        returns (bytes4)
    {
        if (msg.sender != address(words) || operator != address(this)) revert UnexpectedTransfer();
        return this.onERC721Received.selector;
    }

    /// @notice Let `wallet` feed, roll, and ascend the Words you stake, or stop it (`allowed` false).
    function setCaretaker(address wallet, bool allowed) external {
        if (wallet == address(0) || wallet == msg.sender) revert BadCaretaker();
        isCaretaker[msg.sender][wallet] = allowed;
        emit CaretakerSet(msg.sender, wallet, allowed);
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

    function setSigner(address signer_) external onlyOwner {
        if (signer_ == address(0)) revert ZeroAddress();
        signer = signer_;
        emit SignerSet(signer_);
    }

    function setFreeDailySnack(bool enabled) external onlyOwner {
        freeDailySnack = enabled;
        emit FreeDailySnackSet(enabled);
    }

    // --- repeg (price keeper) ---------------------------------------------------------------------

    /// @notice Keeper-driven clamped repeg of the snack price ONLY; the hunger thresholds are re-passed
    ///         unchanged into the existing CareParamsSet event (the keeper can't touch governance args).
    function repegSnackPrice(uint256 snackPrice_) external onlyPriceKeeper repegRateLimited {
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
