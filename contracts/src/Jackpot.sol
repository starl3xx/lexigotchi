// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFeeRouter} from "./interfaces/IFeeRouter.sol";
import {IWords} from "./interfaces/IWords.sol";
import {IStaking} from "./interfaces/IStaking.sol";
import {AnswerChain} from "./AnswerChain.sol";

/**
 * @title Jackpot
 * @notice The core daily jackpot — a single keccak256(word) lookup (v0.2 §2). After the keeper
 *         reveals today's word on the AnswerChain, `resolve` checks one thing: does that word's
 *         token exist, is it staked, and is it not hungry? If yes, the whole jackpot bucket pays its
 *         beneficial owner; otherwise it rolls over and keeps escalating. Case never affects the
 *         jackpot — only daily yield. The pot is funded by the jackpot fee share and held in the
 *         FeeRouter (solvency-capped), so the operator never funds the prize (seed.jackpot = 0).
 *
 *         One resolution per revealed day; `resolve` consumes the AnswerChain's latest reveal.
 */
contract Jackpot is Ownable2Step, ReentrancyGuard {
    IFeeRouter public immutable feeRouter;
    IWords public immutable words;
    IStaking public immutable staking;
    AnswerChain public immutable answerChain;

    uint32 public lastResolvedDay;
    address public keeper;

    event JackpotWon(uint32 indexed day, uint256 indexed tokenId, address indexed winner, uint256 amount);
    event JackpotRolledOver(uint32 indexed day, uint256 indexed tokenId, uint256 potBalance);
    event KeeperSet(address keeper);

    error NotKeeper();
    error AlreadyResolved();
    error ZeroAddress();

    constructor(
        IFeeRouter _feeRouter,
        IWords _words,
        IStaking _staking,
        AnswerChain _answerChain,
        address _keeper,
        address initialOwner
    ) Ownable(initialOwner) {
        feeRouter = _feeRouter;
        words = _words;
        staking = _staking;
        answerChain = _answerChain;
        keeper = _keeper;
    }

    /// @notice Resolve today's jackpot against the AnswerChain's latest revealed word.
    function resolve() external nonReentrant returns (bool won) {
        if (msg.sender != keeper) revert NotKeeper();
        uint32 day = answerChain.revealedDay();
        if (day <= lastResolvedDay) revert AlreadyResolved();
        lastResolvedDay = day;

        uint256 tokenId = uint256(keccak256(bytes(answerChain.currentWord())));
        bool eligible =
            words.exists(tokenId) && staking.isStaked(tokenId) && !staking.isHungry(tokenId);

        if (eligible) {
            address winner = staking.beneficialOwner(tokenId);
            uint256 amount = feeRouter.payFromJackpot(winner, feeRouter.jackpotBalance());
            emit JackpotWon(day, tokenId, winner, amount);
            return true;
        }
        emit JackpotRolledOver(day, tokenId, feeRouter.jackpotBalance());
        return false;
    }

    function setKeeper(address _keeper) external onlyOwner {
        if (_keeper == address(0)) revert ZeroAddress();
        keeper = _keeper;
        emit KeeperSet(_keeper);
    }
}
