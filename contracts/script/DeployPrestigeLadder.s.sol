// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {Words} from "../src/Words.sol";
import {Rolls} from "../src/Rolls.sol";
import {Prestige} from "../src/Prestige.sol";
import {IWords} from "../src/interfaces/IWords.sol";
import {IStaking} from "../src/interfaces/IStaking.sol";
import {IFeeRouter, FeeSource} from "../src/interfaces/IFeeRouter.sol";

/**
 * @title DeployPrestigeLadder
 * @notice Moves a suite that's already deployed onto the economy retune (decisions.md #19). A full
 *         deploy does all of this in Deploy.s.sol.
 *
 *         1. Every paid action's split becomes 75 / 10 / 10 / 5 (pool, jackpot, burn, treasury).
 *            Snacks and the word-sale fee keep theirs.
 *         2. A new Prestige, the word ladder: 5 stages (Gilded 1–4 + Holographic), a stage-N attempt
 *            paying N × the base fee. The base defaults to two rolls ($0.50 at the roll's $0.25 peg);
 *            the signer, snack cost, move cap, and price keeper carry over from the old Prestige.
 *         3. Words trusts the new Prestige (setPrestige), the FeeRouter takes its fees, and the old
 *            one stops being a collector.
 *
 *         Stages already earned live in Words, so none are lost. The broadcaster must own the
 *         FeeRouter, Words, and the old Prestige (one owner EOA). Run it only when the old Prestige
 *         has no unrevealed attempt: once Words stops trusting it, that reveal would revert and the
 *         paid fee would stay stuck. The script refuses if any attempt was ever made, unless
 *         ALLOW_PAST_ATTEMPTS=true (then check `attemptOpen` for the words that tried).
 *
 *         Required env: FEE_ROUTER, WORDS, STAKING, ROLLS, OLD_PRESTIGE.
 *         Optional: SIGNER, PRESTIGE_FEE (wei), PRESTIGE_MAX_LEVEL (5), ALLOW_PAST_ATTEMPTS.
 */
contract DeployPrestigeLadder is Script {
    function run() external returns (Prestige prestige) {
        FeeRouter fr = FeeRouter(vm.envAddress("FEE_ROUTER"));
        Words words = Words(vm.envAddress("WORDS"));
        IStaking staking = IStaking(vm.envAddress("STAKING"));
        Rolls rolls = Rolls(vm.envAddress("ROLLS"));
        Prestige old = Prestige(vm.envAddress("OLD_PRESTIGE"));
        require(address(old.words()) == address(words), "OLD_PRESTIGE belongs to another Words");
        require(
            vm.envOr("ALLOW_PAST_ATTEMPTS", false) || old.commitCount() == 0,
            "the old Prestige has attempts: confirm none is open, then set ALLOW_PAST_ATTEMPTS=true"
        );

        address signer = vm.envOr("SIGNER", old.signer());
        uint256 baseFee = vm.envOr("PRESTIGE_FEE", rolls.rollPrice() * 2);
        uint8 maxLevel = uint8(vm.envOr("PRESTIGE_MAX_LEVEL", uint256(5)));

        vm.startBroadcast();
        FeeRouter.Split memory paid = FeeRouter.Split(7500, 1000, 1000, 500);
        fr.setSplit(FeeSource.PACK_MINT, paid);
        fr.setSplit(FeeSource.DAILY_MINT, paid);
        fr.setSplit(FeeSource.ROLL, paid);
        fr.setSplit(FeeSource.CLAIM, paid);
        fr.setSplit(FeeSource.PRESTIGE, paid);

        prestige = new Prestige(
            fr.word(), IFeeRouter(address(fr)), IWords(address(words)), staking, maxLevel, baseFee, old.snackCost(), signer
        );
        prestige.setMaxMoveBps(old.maxMoveBps());
        if (old.priceKeeper() != address(0)) prestige.setPriceKeeper(old.priceKeeper());
        fr.setCollector(address(prestige), true);
        words.setPrestige(address(prestige));
        fr.setCollector(address(old), false);
        vm.stopBroadcast();

        console2.log("Prestige (ladder)", address(prestige));
        console2.log("base fee (wei)   ", baseFee);
        console2.log("max level        ", maxLevel);
    }
}
