// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IWords, CaseState} from "./interfaces/IWords.sol";
import {IStaking} from "./interfaces/IStaking.sol";
import {IFeeRouter, FeeSource} from "./interfaces/IFeeRouter.sol";
import {FeeCollector} from "./FeeCollector.sol";

/**
 * @title Prestige
 * @notice Ascension: a full-UPPERCASE staked Word climbs through `maxLevel` Gilded stages (EGGS
 *         chicken-level parity, default 4) — the renewable late-game DEPTH sink for the UPPERCASE
 *         cohort. Each attempt pays a commit fee + burns a snack and resolves on the same
 *         commit→signed-reveal as rolls. SUCCESS bumps the level (monotonic, never decremented);
 *         FAILURE is an explicit no-op — the level, case, and escrowed letters are untouched (same
 *         compliance stance as rolls). Each level multiplies that word's yield & bounty weight,
 *         applied off-chain by the distributors (a bigger slice of the *same* fixed pool — never
 *         enlarging it, so it stays solvency-neutral).
 */
contract Prestige is Ownable2Step, ReentrancyGuard, FeeCollector {
    IWords public immutable words;
    IStaking public immutable staking;

    uint8 public maxLevel; // Gilded stages above full-UPPERCASE
    uint256 public prestigeFee; // $WORD commit fee per attempt
    uint256 public snackCost; // $WORD burned per attempt (100% burn)
    address public signer; // backend outcome signer (shared superHen model)

    struct PrestigeCommit {
        uint256 tokenId;
        address owner;
        bool revealed;
        uint32 pityAtCommit;
    }

    mapping(uint256 tokenId => uint32) public prestigePity;
    PrestigeCommit[] public commits;

    event PrestigeCommitted(uint256 indexed commitId, uint256 indexed tokenId, address indexed owner, uint32 pity);
    event PrestigeSucceeded(uint256 indexed commitId, uint256 indexed tokenId, uint8 newLevel);
    event PrestigeFailed(uint256 indexed commitId, uint256 indexed tokenId, uint32 pity);
    event ParamsSet(uint8 maxLevel, uint256 prestigeFee, uint256 snackCost);
    event SignerSet(address signer);

    error NotBeneficialOwner();
    error NotFullyRaised();
    error MaxLevel();
    error BadCommit();
    error AlreadyRevealed();
    error BadSignature();
    error ZeroAddress();

    constructor(
        IERC20 _word,
        IFeeRouter _feeRouter,
        IWords _words,
        IStaking _staking,
        uint8 _maxLevel,
        uint256 _prestigeFee,
        uint256 _snackCost,
        address _signer
    ) Ownable(msg.sender) FeeCollector(_word, _feeRouter) {
        words = _words;
        staking = _staking;
        maxLevel = _maxLevel;
        prestigeFee = _prestigeFee;
        snackCost = _snackCost;
        signer = _signer;
    }

    /// @notice Begin an ascension attempt on a full-UPPERCASE staked Word you own.
    function commitPrestige(uint256 tokenId) external nonReentrant returns (uint256 commitId) {
        if (staking.beneficialOwner(tokenId) != msg.sender) revert NotBeneficialOwner();
        if (words.caseOf(tokenId) != CaseState.Uppercase) revert NotFullyRaised();
        if (words.prestigeLevel(tokenId) >= maxLevel) revert MaxLevel();

        _collect(msg.sender, prestigeFee, FeeSource.PRESTIGE);
        _collect(msg.sender, snackCost, FeeSource.SNACK); // the burned snack

        uint32 p = prestigePity[tokenId];
        commitId = commits.length;
        commits.push(PrestigeCommit({tokenId: tokenId, owner: msg.sender, revealed: false, pityAtCommit: p}));
        emit PrestigeCommitted(commitId, tokenId, msg.sender, p);
    }

    /// @notice Resolve an ascension with the backend's signed outcome.
    function reveal(uint256 commitId, bool success, bytes calldata sig) external nonReentrant {
        PrestigeCommit storage c = commits[commitId];
        if (c.owner == address(0)) revert BadCommit();
        if (c.revealed) revert AlreadyRevealed();

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(address(this), block.chainid, commitId, c.tokenId, c.owner, success))
        );
        if (ECDSA.recover(digest, sig) != signer) revert BadSignature();

        c.revealed = true;
        if (success) {
            words.bumpPrestige(c.tokenId);
            prestigePity[c.tokenId] = 0;
            emit PrestigeSucceeded(commitId, c.tokenId, words.prestigeLevel(c.tokenId));
        } else {
            uint32 p = prestigePity[c.tokenId] + 1; // failure never touches the asset
            prestigePity[c.tokenId] = p;
            emit PrestigeFailed(commitId, c.tokenId, p);
        }
    }

    function commitCount() external view returns (uint256) {
        return commits.length;
    }

    function setParams(uint8 _maxLevel, uint256 _prestigeFee, uint256 _snackCost) external onlyOwner {
        maxLevel = _maxLevel;
        prestigeFee = _prestigeFee;
        snackCost = _snackCost;
        emit ParamsSet(_maxLevel, _prestigeFee, _snackCost);
    }

    function setSigner(address _signer) external onlyOwner {
        if (_signer == address(0)) revert ZeroAddress();
        signer = _signer;
        emit SignerSet(_signer);
    }
}
