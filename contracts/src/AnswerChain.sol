// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title AnswerChain
 * @notice Lexigotchi's OWN pre-committed daily-word sequence — a reverse hash-chain that makes the
 *         jackpot word unsteerable (decisions.md "Jackpot architecture — decoupled from LHAW").
 *
 *         The operator commits a single `head` hash that binds the entire future sequence:
 *             head = keccak256(word_1, salt_1, H_2)
 *             H_2  = keccak256(word_2, salt_2, H_3)
 *             ...
 *             H_N  = keccak256(word_N, salt_N, TERMINAL)
 *         Each day the keeper reveals `(word_i, salt_i, next = H_{i+1})`; the contract checks it hashes
 *         to the current commitment and advances to `next`. Because `head` was fixed before any reveal,
 *         no party — not even the operator — can change a future word after the fact. This replaces the
 *         old Phase-3 LHAW-answer hard dependency: the game runs the jackpot on its own clock.
 *
 *         A word is drawn at most ONCE, ever (starl3xx, 2026-11-25: "drawn words should be guaranteed not
 *         to be drawn again"). The off-chain list already holds each pool word once, but a list rotated
 *         in after exhaustion is a new commitment, so the contract enforces it too: `wasRevealed`
 *         remembers every revealed word across every chain this contract holds, and `reveal` refuses
 *         a repeat. A list that repeats an old answer therefore STOPS at that day instead of drawing it
 *         again (and `setHead` can't replace it mid-stream), so a rotated list must leave out every
 *         word in `wasRevealed`.
 */
contract AnswerChain is Ownable2Step {
    bytes32 public currentCommit; // the not-yet-revealed head of the remaining chain
    uint32 public revealedDay; // number of words revealed so far (today's index)
    string public currentWord; // most recently revealed word (UPPERCASE, A–Z)
    uint64 public lastRevealAt;

    address public keeper; // may reveal the daily word

    /// @notice Every word ever revealed, keyed `keccak256(bytes(word))` (the same key as its Words
    ///         tokenId). Never cleared, so no chain, now or rotated in later, can draw a word twice.
    mapping(bytes32 => bool) public wasRevealed;

    event HeadCommitted(bytes32 head);
    event WordRevealed(uint32 indexed day, string word, bytes32 next);
    event KeeperSet(address keeper);

    error NotKeeper();
    error BadReveal();
    error AlreadyRevealed();
    error ChainLive();
    error ZeroAddress();

    constructor(bytes32 head, address _keeper, address initialOwner) Ownable(initialOwner) {
        currentCommit = head;
        keeper = _keeper;
        emit HeadCommitted(head);
    }

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert NotKeeper();
        _;
    }

    /// @notice Reveal the next day's word, advancing the chain.
    function reveal(string calldata word, bytes32 salt, bytes32 next) external onlyKeeper {
        if (keccak256(abi.encode(word, salt, next)) != currentCommit) revert BadReveal();
        bytes32 key = keccak256(bytes(word));
        if (wasRevealed[key]) revert AlreadyRevealed();
        wasRevealed[key] = true;
        currentCommit = next;
        currentWord = word;
        revealedDay += 1;
        lastRevealAt = uint64(block.timestamp);
        emit WordRevealed(revealedDay, word, next);
    }

    /// @notice (Re)commit the head — only before the chain starts (initial setup) or once it is
    ///         exhausted (rotation). Never mid-stream, so the operator can't rewrite a future word
    ///         after the chain is live — preserving the unsteerable guarantee.
    function setHead(bytes32 head) external onlyOwner {
        if (revealedDay != 0 && currentCommit != bytes32(0)) revert ChainLive();
        currentCommit = head;
        emit HeadCommitted(head);
    }

    function setKeeper(address _keeper) external onlyOwner {
        if (_keeper == address(0)) revert ZeroAddress();
        keeper = _keeper;
        emit KeeperSet(_keeper);
    }
}
