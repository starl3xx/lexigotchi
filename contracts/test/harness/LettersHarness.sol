// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Letters} from "../../src/Letters.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IFeeRouter} from "../../src/interfaces/IFeeRouter.sol";

/// @dev Test-only Letters with a direct minter so claim/roll/stake tests can fund a player with
///      specific letters without going through the random pack draw.
contract LettersHarness is Letters {
    constructor(
        IERC20 _word,
        IFeeRouter _feeRouter,
        uint32[26] memory _cap,
        uint32[26] memory _weight,
        uint256 _packPrice,
        uint256 _dailyPrice,
        address _signer,
        string memory _uri,
        address initialOwner
    ) Letters(_word, _feeRouter, _cap, _weight, _packPrice, _dailyPrice, _signer, _uri, initialOwner) {}

    function mintLower(address to, uint8 letterIndex, uint256 amount) external {
        mintedEver[letterIndex] += uint32(amount);
        _mint(to, letterIndex, amount, "");
    }

    /// @dev Uppercase letters normally only come from a roll; minted directly here for claim tests.
    function mintUpper(address to, uint8 letterIndex, uint256 amount) external {
        _mint(to, uint256(letterIndex) + 26, amount, "");
    }
}
