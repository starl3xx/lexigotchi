// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IUsdcSwapAdapter} from "../../src/interfaces/IUsdcSwapAdapter.sol";

interface IMintableWord {
    function mint(address to, uint256 amount) external;
}

/**
 * @dev The Shop's route on Base Sepolia and in the tests: takes test USDC at a fixed test rate and
 *      MINTS test $WORD for it. The Sepolia $WORD is MockERC20, whose mint() is permissionless (it is
 *      the in-game faucet), so this adapter needs no funding. The USDC it takes stays here.
 *
 *      The owner can break it (`setBroken`) to exercise a deferred swap without changing the Shop's
 *      adapter (which waits two days), and can change the rate to match a moved peg.
 */
contract MockUsdcWordAdapter is IUsdcSwapAdapter, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    IMintableWord public immutable word;
    /// @notice $WORD wei minted per 1 whole USDC (1e6 units).
    uint256 public wordPerUsdc;
    bool public broken;

    event RateSet(uint256 wordPerUsdc);
    event BrokenSet(bool broken);

    error Broken();
    error InsufficientWordOut(uint256 wordOut, uint256 minWordOut);

    constructor(IERC20 _usdc, IMintableWord _word, uint256 _wordPerUsdc, address initialOwner) Ownable(initialOwner) {
        usdc = _usdc;
        word = _word;
        wordPerUsdc = _wordPerUsdc;
        emit RateSet(_wordPerUsdc);
    }

    function swapUsdcForWord(uint256 usdcIn, uint256 minWordOut, address to) external returns (uint256 wordOut) {
        if (broken) revert Broken();
        usdc.safeTransferFrom(msg.sender, address(this), usdcIn);
        wordOut = (usdcIn * wordPerUsdc) / 1e6;
        if (wordOut < minWordOut) revert InsufficientWordOut(wordOut, minWordOut);
        word.mint(to, wordOut);
    }

    function setRate(uint256 _wordPerUsdc) external onlyOwner {
        wordPerUsdc = _wordPerUsdc;
        emit RateSet(_wordPerUsdc);
    }

    function setBroken(bool _broken) external onlyOwner {
        broken = _broken;
        emit BrokenSet(_broken);
    }
}
