// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AnswerChain} from "../src/AnswerChain.sol";

/**
 * Cross-language vector for the AnswerChain generator (`scripts/generate-answer-chain.ts`).
 *
 * TS_HEAD was computed by the TS generator for this exact fixture (words CRANE/MOTEL/GRAPE, salts
 * 0x11…/0x22…/0x33…, terminal 0). Recomputing the chain here with `keccak256(abi.encode(...))` and
 * walking `reveal()` through a live AnswerChain proves the generator's encoding matches the contract
 * — i.e. a generated schedule will actually verify on-chain. The same constant is asserted from the
 * TS side in `tests/answer-chain.test.ts`; if either encoder drifts, one of the two suites breaks.
 */
contract AnswerChainVectorTest is Test {
    bytes32 constant TS_HEAD = 0x5cd5f4880aaa97e2ccb1a0f6b5718f8de7b4a0faa8c30a68831b56737fb7bafd;
    bytes32 constant SALT1 = 0x1111111111111111111111111111111111111111111111111111111111111111;
    bytes32 constant SALT2 = 0x2222222222222222222222222222222222222222222222222222222222222222;
    bytes32 constant SALT3 = 0x3333333333333333333333333333333333333333333333333333333333333333;
    bytes32 constant TERMINAL = bytes32(0); // required for post-exhaustion setHead rotation

    function _chainHead() internal pure returns (bytes32 h1, bytes32 h2, bytes32 h3) {
        h3 = keccak256(abi.encode("GRAPE", SALT3, TERMINAL));
        h2 = keccak256(abi.encode("MOTEL", SALT2, h3));
        h1 = keccak256(abi.encode("CRANE", SALT1, h2));
    }

    function test_tsGeneratorMatchesOnChainEncoding() public pure {
        (bytes32 h1,,) = _chainHead();
        assertEq(h1, TS_HEAD, "TS generator and AnswerChain.reveal disagree on the digest encoding");
    }

    function test_generatedChainRevealsAndRotates() public {
        (bytes32 h1, bytes32 h2, bytes32 h3) = _chainHead();
        AnswerChain ac = new AnswerChain(h1, address(this), address(this)); // keeper + owner = this

        ac.reveal("CRANE", SALT1, h2);
        assertEq(ac.revealedDay(), 1);
        assertEq(ac.currentWord(), "CRANE");

        ac.reveal("MOTEL", SALT2, h3);
        ac.reveal("GRAPE", SALT3, TERMINAL);
        assertEq(ac.revealedDay(), 3);

        // Exhausted (currentCommit == 0) ⇒ the owner can rotate in a fresh chain. This is exactly
        // why the generator pins the terminal to bytes32(0): any other value bricks rotation.
        assertEq(ac.currentCommit(), bytes32(0), "chain must end exhausted at zero");
        bytes32 nextHead = keccak256(abi.encode("BLAZE", SALT1, TERMINAL));
        ac.setHead(nextHead);
        assertEq(ac.currentCommit(), nextHead, "rotation after exhaustion must succeed");
        ac.reveal("BLAZE", SALT1, TERMINAL); // and the rotated chain reveals
        assertEq(ac.revealedDay(), 4);
    }
}
