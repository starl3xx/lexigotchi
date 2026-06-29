// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @dev Stand-in for the live $WORD token in tests. Freely mintable; ERC20Burnable like the real
///      ClankerToken, so FeeRouter's real burn() path is exercised.
contract MockERC20 is ERC20Burnable {
    constructor() ERC20("Mock WORD", "WORD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
