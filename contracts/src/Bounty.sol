// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IFeeRouter} from "./interfaces/IFeeRouter.sol";
import {MerkleEpochs} from "./MerkleEpochs.sol";

/**
 * @title Bounty
 * @notice The renewable theme bounty (decisions.md "Renewable late-game loop"). Each period features
 *         a category of words; every owner of a staked + not-hungry matching word shares the bounty
 *         bucket pro-rata (weighted `TIER_WEIGHT^rarityWeight × prestige`). The bucket is funded
 *         zero-sum by the FeeRouter's pool carve (`bountyCarveBps`), so it never touches jackpot/yield
 *         solvency. The keeper computes each period's matching set + shares off-chain (the theme
 *         predicate + tier live in the published economy) and posts the root; an unsatisfied period
 *         simply isn't opened, so its funds roll forward in the bucket. This is the `bountyPayer`.
 *
 *         `epochId` is the period index; `meta` carries the themeId for that period.
 */
contract Bounty is MerkleEpochs {
    constructor(IERC20 _word, IFeeRouter _feeRouter, address _keeper, address initialOwner)
        MerkleEpochs(_word, _feeRouter, _keeper, initialOwner)
    {}

    function _pull(uint256 amount) internal override returns (uint256 got) {
        return feeRouter.payFromBounty(address(this), amount);
    }
}
