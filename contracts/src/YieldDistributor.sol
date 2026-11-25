// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IFeeRouter} from "./interfaces/IFeeRouter.sol";
import {MerkleEpochs} from "./MerkleEpochs.sol";

/**
 * @title YieldDistributor
 * @notice Streams the UPPERCASE-only daily yield (v0.2 §1.5) from the FeeRouter pool. Each epoch the
 *         keeper computes every eligible word's share — full-UPPERCASE, staked, not-hungry, weighted
 *         by tier (Common 1 … Legendary 8) × prestige (1.10^level), with peckish words at half — and
 *         posts the root. The epoch's total is pulled from the pool at open time, so the pool only
 *         ever pays a fraction of itself: `pool × dailyDistributionRate`, self-scaling and never
 *         draining (the equilibrium the sim finds). This is the FeeRouter's `poolPayer`.
 */
contract YieldDistributor is MerkleEpochs {
    constructor(IERC20 _word, IFeeRouter _feeRouter, address _keeper, address initialOwner)
        MerkleEpochs(_word, _feeRouter, _keeper, initialOwner)
    {}

    function _pull(uint256 amount) internal override returns (uint256 got) {
        return feeRouter.payFromPool(address(this), amount);
    }
}
