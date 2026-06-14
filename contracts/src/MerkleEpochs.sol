// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IFeeRouter} from "./interfaces/IFeeRouter.sol";

/**
 * @title MerkleEpochs
 * @notice Shared base for the two per-epoch reward streams — UPPERCASE staking yield and the theme
 *         bounty. Both express per-NFT weights (case / tier / prestige / hunger / theme-match) that
 *         are impractical to iterate on-chain, so a keeper computes each epoch's shares off-chain and
 *         posts a Merkle root; players claim with a proof. Crucially, the funds for an epoch are
 *         PULLED FROM THE FEEROUTER BUCKET AT OPEN TIME (`_pull`), so this contract can never pay more
 *         than its bucket funded — solvency holds regardless of how the off-chain tree was built. The
 *         operator is trusted only for the *fairness* of the share split, never for solvency. Each
 *         leaf bakes in (tokenId, account, amount); tokenId is the per-epoch dedupe key.
 */
abstract contract MerkleEpochs is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Epoch {
        bytes32 root;
        uint256 funded;
        uint256 claimed;
        uint256 meta; // themeId (bounty) or 0 (yield)
        bool open;
        uint64 recoverableAt; // openedAt + claimWindow, SNAPSHOTTED so later tuning can't shrink it
    }

    IERC20 public immutable word;
    IFeeRouter public immutable feeRouter;
    address public keeper;
    /// @notice How long after an epoch opens its unclaimed remainder is locked for claimers. Applied
    ///         (snapshotted into the epoch) at open time, so changing it only affects future epochs.
    uint64 public claimWindow = 90 days;

    mapping(uint256 epochId => Epoch) public epochs;
    mapping(uint256 epochId => mapping(uint256 tokenId => bool)) public hasClaimed;

    event EpochOpened(uint256 indexed epochId, bytes32 root, uint256 funded, uint256 meta);
    event RewardClaimed(uint256 indexed epochId, uint256 indexed tokenId, address indexed account, uint256 amount);
    event UnclaimedRecovered(uint256 indexed epochId, address to, uint256 amount);
    event KeeperSet(address keeper);
    event ClaimWindowSet(uint64 claimWindow);

    error NotKeeper();
    error EpochExists();
    error NoSuchEpoch();
    error AlreadyClaimed();
    error BadProof();
    error Underfunded();
    error ClaimWindowOpen();
    error ZeroAddress();

    constructor(IERC20 _word, IFeeRouter _feeRouter, address _keeper, address initialOwner) Ownable(initialOwner) {
        word = _word;
        feeRouter = _feeRouter;
        keeper = _keeper;
    }

    /// @dev Pull `amount` from the relevant FeeRouter bucket into this contract; returns the amount
    ///      actually delivered (≤ bucket balance).
    function _pull(uint256 amount) internal virtual returns (uint256 got);

    /// @notice Open an epoch: pull its total from the bucket and post the distribution root.
    function openEpoch(uint256 epochId, bytes32 root, uint256 amount, uint256 meta) external nonReentrant {
        if (msg.sender != keeper) revert NotKeeper();
        if (epochs[epochId].open) revert EpochExists();
        uint256 got = _pull(amount);
        if (got < amount) revert Underfunded(); // bucket short — keeper must size amount ≤ bucket
        epochs[epochId] = Epoch({
            root: root,
            funded: got,
            claimed: 0,
            meta: meta,
            open: true,
            recoverableAt: uint64(block.timestamp + claimWindow)
        });
        emit EpochOpened(epochId, root, got, meta);
    }

    /// @notice Claim a reward leaf. Permissionless — funds always go to the baked-in `account`.
    function claim(uint256 epochId, uint256 tokenId, address account, uint256 amount, bytes32[] calldata proof)
        external
        nonReentrant
    {
        Epoch storage e = epochs[epochId];
        if (!e.open) revert NoSuchEpoch();
        if (hasClaimed[epochId][tokenId]) revert AlreadyClaimed();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(tokenId, account, amount))));
        if (!MerkleProof.verify(proof, e.root, leaf)) revert BadProof();

        hasClaimed[epochId][tokenId] = true;
        e.claimed += amount;
        if (e.claimed > e.funded) revert Underfunded(); // tree over-allocated vs what was pulled
        word.safeTransfer(account, amount);
        emit RewardClaimed(epochId, tokenId, account, amount);
    }

    /// @notice Recover the unclaimed remainder of a STALE epoch — only after its claim window has
    ///         elapsed, so the owner can never pull funds out from under players who still hold valid
    ///         proofs for a live epoch.
    function recoverUnclaimed(uint256 epochId, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        Epoch storage e = epochs[epochId];
        if (!e.open) revert NoSuchEpoch();
        if (block.timestamp < e.recoverableAt) revert ClaimWindowOpen();
        uint256 remaining = e.funded - e.claimed;
        e.claimed = e.funded; // no further claims for this epoch
        if (remaining > 0) word.safeTransfer(to, remaining);
        emit UnclaimedRecovered(epochId, to, remaining);
    }

    function setKeeper(address _keeper) external onlyOwner {
        if (_keeper == address(0)) revert ZeroAddress();
        keeper = _keeper;
        emit KeeperSet(_keeper);
    }

    /// @notice Tune the claim window before opening epochs against it (multisig only).
    function setClaimWindow(uint64 _claimWindow) external onlyOwner {
        claimWindow = _claimWindow;
        emit ClaimWindowSet(_claimWindow);
    }
}
