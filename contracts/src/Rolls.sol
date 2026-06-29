// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ILetters} from "./interfaces/ILetters.sol";
import {IWords} from "./interfaces/IWords.sol";
import {IStaking} from "./interfaces/IStaking.sol";
import {IFeeRouter, FeeSource} from "./interfaces/IFeeRouter.sol";
import {FeeCollector} from "./FeeCollector.sol";
import {RepegKeeper} from "./RepegKeeper.sol";

/**
 * @title Rolls
 * @notice Upgrade rolls (lowercase → UPPERCASE), the EGGS "Commit To Level Up → Level Up" pattern:
 *         the fee is taken at commit; the outcome is resolved at a backend-signed reveal (the
 *         `superHen` model). A FAILURE is an explicit no-op event — the asset is never burned or
 *         downgraded (hard compliance rule, v0.2 §6). Odds are 45% base, +10pp per consecutive fail
 *         on that (owner, letter), cap 85%, reset on success — the pity curve the backend signer
 *         applies when it decides the outcome.
 *
 *         PITY KEYS ON THE BENEFICIAL OWNER, NEVER THE 1155 HOLDER. When a letter is escrowed inside
 *         a Word, the 1155 is held by `Words` (and, when staked, the Word NFT is held by `Staking`).
 *         Keying pity on the token holder would collapse every player's escrowed-letter pity onto a
 *         single shared counter — pump it cheap, harvest near-cap upgrades on anyone's word. So pity
 *         is keyed on `(beneficialOwner, letterIndex)`, where the beneficial owner is resolved
 *         through staking custody back to the human (see PATTERN.md property #5).
 */
contract Rolls is Ownable2Step, ReentrancyGuard, FeeCollector, RepegKeeper {
    uint8 internal constant KIND_LOOSE = 0;
    uint8 internal constant KIND_WORD = 1;

    struct RollCommit {
        address owner; // beneficial owner (pity subject)
        uint8 letterIndex;
        uint8 kind;
        uint8 pos; // escrow position for KIND_WORD
        bool revealed;
        uint32 pityAtCommit;
        uint256 tokenId; // for KIND_WORD
    }

    ILetters public immutable letters;
    IWords public immutable words;
    IStaking public staking; // resolves beneficial owner of a staked Word (set post-deploy)

    uint256 public rollPrice; // $WORD
    address public signer; // backend outcome signer (the "superHen")

    mapping(bytes32 pityKey => uint32 streak) public pity; // keccak(owner, letterIndex)
    RollCommit[] public commits;

    event RollCommitted(uint256 indexed commitId, address indexed owner, uint8 letterIndex, uint8 kind, uint32 pity);
    event RollSucceeded(uint256 indexed commitId, address indexed owner, uint8 letterIndex);
    event RollFailed(uint256 indexed commitId, address indexed owner, uint8 letterIndex, uint32 pity);
    event RollPriceSet(uint256 price);
    event SignerSet(address signer);
    event StakingSet(address staking);

    error NoSuchLetter();
    error NotBeneficialOwner();
    error AlreadyRaised();
    error BadCommit();
    error AlreadyRevealed();
    error BadSignature();
    error ZeroAddress();

    constructor(
        IERC20 _word,
        IFeeRouter _feeRouter,
        ILetters _letters,
        IWords _words,
        uint256 _rollPrice,
        address _signer
    ) Ownable(msg.sender) FeeCollector(_word, _feeRouter) {
        letters = _letters;
        words = _words;
        rollPrice = _rollPrice;
        signer = _signer;
    }

    // --- commit -----------------------------------------------------------------------------------

    /// @notice Roll a loose lowercase letter you hold toward its uppercase counterpart.
    function commitLooseRoll(uint8 letterIndex) external nonReentrant returns (uint256 commitId) {
        if (letterIndex > 25 || letters.balanceOf(msg.sender, letterIndex) == 0) revert NoSuchLetter();
        _collect(msg.sender, rollPrice, FeeSource.ROLL);
        commitId = _commit(msg.sender, letterIndex, KIND_LOOSE, 0, 0);
    }

    /// @notice Roll the `pos`-th escrowed letter of a Word you beneficially own.
    function commitWordRoll(uint256 tokenId, uint8 pos) external nonReentrant returns (uint256 commitId) {
        address bo = beneficialOwnerOf(tokenId);
        if (msg.sender != bo) revert NotBeneficialOwner();
        (uint8 li, bool isUp) = words.escrowLetter(tokenId, pos);
        if (isUp) revert AlreadyRaised();
        _collect(msg.sender, rollPrice, FeeSource.ROLL);
        commitId = _commit(bo, li, KIND_WORD, pos, tokenId);
    }

    function _commit(address owner, uint8 letterIndex, uint8 kind, uint8 pos, uint256 tokenId)
        internal
        returns (uint256 commitId)
    {
        uint32 p = pity[_pityKey(owner, letterIndex)];
        commitId = commits.length;
        commits.push(
            RollCommit({
                owner: owner,
                letterIndex: letterIndex,
                kind: kind,
                pos: pos,
                revealed: false,
                pityAtCommit: p,
                tokenId: tokenId
            })
        );
        emit RollCommitted(commitId, owner, letterIndex, kind, p);
    }

    // --- reveal -----------------------------------------------------------------------------------

    /// @notice Resolve a roll with the backend's signed outcome. `success` is decided by the signer
    ///         using the live pity-adjusted odds (EGGS superHen). The signature is bound to this
    ///         commit id, so it is single-use; the `revealed` flag prevents double resolution.
    function reveal(uint256 commitId, bool success, bytes calldata sig) external nonReentrant {
        RollCommit storage c = commits[commitId];
        if (c.owner == address(0)) revert BadCommit();
        if (c.revealed) revert AlreadyRevealed();

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(address(this), block.chainid, commitId, c.owner, c.letterIndex, success))
        );
        if (ECDSA.recover(digest, sig) != signer) revert BadSignature();

        c.revealed = true;
        bytes32 key = _pityKey(c.owner, c.letterIndex);
        // Re-validate at reveal so a stale signed success (the loose letter was spent, the escrow
        // position was already raised, or the word was dissolved since commit) becomes a no-op rather
        // than a revert that would strand the paid fee.
        bool ok = success
            && (
                c.kind == KIND_LOOSE
                    ? letters.balanceOf(c.owner, c.letterIndex) > 0
                    : _wordSlotRaisable(c.tokenId, c.pos)
            );
        if (ok) {
            if (c.kind == KIND_LOOSE) {
                letters.upgrade(c.owner, c.letterIndex);
            } else {
                words.applyUpgrade(c.tokenId, c.pos);
            }
            pity[key] = 0;
            emit RollSucceeded(commitId, c.owner, c.letterIndex);
        } else if (success) {
            emit RollFailed(commitId, c.owner, c.letterIndex, pity[key]); // signed success, but no longer applicable
        } else {
            uint32 p = pity[key] + 1; // failure never touches the asset — only the pity streak
            pity[key] = p;
            emit RollFailed(commitId, c.owner, c.letterIndex, p);
        }
    }

    /// @dev True if the escrow position can still be raised (token exists and the slot is lowercase).
    function _wordSlotRaisable(uint256 tokenId, uint8 pos) internal view returns (bool) {
        if (!words.exists(tokenId)) return false;
        (, bool isUp) = words.escrowLetter(tokenId, pos);
        return !isUp;
    }

    // --- views ------------------------------------------------------------------------------------

    /// @notice The human behind a token, resolving through staking custody.
    function beneficialOwnerOf(uint256 tokenId) public view returns (address) {
        address o = words.ownerOf(tokenId);
        if (address(staking) != address(0) && o == address(staking)) {
            return staking.beneficialOwner(tokenId);
        }
        return o;
    }

    function pityOf(address owner, uint8 letterIndex) external view returns (uint32) {
        return pity[_pityKey(owner, letterIndex)];
    }

    function commitCount() external view returns (uint256) {
        return commits.length;
    }

    function _pityKey(address owner, uint8 letterIndex) internal pure returns (bytes32) {
        return keccak256(abi.encode(owner, letterIndex));
    }

    // --- admin ------------------------------------------------------------------------------------

    function setStaking(IStaking _staking) external onlyOwner {
        staking = _staking;
        emit StakingSet(address(_staking));
    }

    function setRollPrice(uint256 price) external onlyOwner {
        rollPrice = price;
        emit RollPriceSet(price);
    }

    function setSigner(address _signer) external onlyOwner {
        if (_signer == address(0)) revert ZeroAddress();
        signer = _signer;
        emit SignerSet(_signer);
    }

    // --- repeg (price keeper) ---------------------------------------------------------------------

    /// @notice Keeper-driven clamped repeg of the roll price (the durable-sink fee — primary target).
    function repegRollPrice(uint256 price) external onlyPriceKeeper {
        uint256 old = rollPrice;
        if (_clampRepeg(old, price)) {
            rollPrice = price;
            emit RollPriceSet(price);
            emit Repegged("rollPrice", old, price);
        }
    }

    function setPriceKeeper(address keeper) external onlyOwner {
        _setPriceKeeper(keeper);
    }

    function setMaxMoveBps(uint16 bps) external onlyOwner {
        _setMaxMoveBps(bps);
    }
}
