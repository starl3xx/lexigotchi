// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {SaleFees} from "../src/SaleFees.sol";
import {IFeeRouter, FeeSource} from "../src/interfaces/IFeeRouter.sol";

/**
 * @title DeploySaleFees
 * @notice Adds SaleFees to a suite that's already deployed (a full deploy does this in Deploy.s.sol):
 *         deploy it, register it as a FeeRouter collector, and point the ROYALTY split at the Rewards
 *         Pool. The broadcaster must be the FeeRouter's owner. The split moves BEFORE any fee can be
 *         flushed, because a flush under the old split (100% Treasury) would send sale fees there.
 *
 *         Required env: FEE_ROUTER. Optional: WORD_TOKEN (defaults to the router's own $WORD).
 */
contract DeploySaleFees is Script {
    function run() external returns (SaleFees saleFees) {
        FeeRouter fr = FeeRouter(vm.envAddress("FEE_ROUTER"));
        IERC20 word = IERC20(vm.envOr("WORD_TOKEN", address(fr.word())));
        require(address(word) == address(fr.word()), "WORD_TOKEN is not the router's $WORD");

        vm.startBroadcast();
        fr.setSplit(FeeSource.ROYALTY, FeeRouter.Split(10000, 0, 0, 0));
        saleFees = new SaleFees(word, IFeeRouter(address(fr)));
        fr.setCollector(address(saleFees), true);
        vm.stopBroadcast();

        console2.log("SaleFees         ", address(saleFees));
    }
}
