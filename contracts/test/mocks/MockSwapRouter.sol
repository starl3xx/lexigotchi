// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISwapRouter} from "../../src/interfaces/ISwapRouter.sol";
import {MockERC20} from "./MockERC20.sol";

/// @dev Test double for the ETH→$WORD swap: mints `rate` $WORD per wei of ETH to `to`.
contract MockSwapRouter is ISwapRouter {
    MockERC20 public immutable word;
    uint256 public rate; // $WORD minted per wei

    constructor(MockERC20 _word, uint256 _rate) {
        word = _word;
        rate = _rate;
    }

    function setRate(uint256 _rate) external {
        rate = _rate;
    }

    function swapETHForWord(uint256 minWordOut, address to) external payable returns (uint256 wordOut) {
        wordOut = msg.value * rate;
        require(wordOut >= minWordOut, "slippage");
        word.mint(to, wordOut);
    }
}
