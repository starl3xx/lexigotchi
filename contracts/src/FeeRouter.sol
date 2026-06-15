// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFeeRouter, FeeSource} from "./interfaces/IFeeRouter.sol";

/**
 * @title FeeRouter
 * @notice The economic heart of Lexigotchi: every $WORD fee in the game flows through here and is
 *         split into four buckets — Rewards Pool, Jackpot, Burn, Treasury — per a configurable,
 *         multisig-tunable split (spec v0.2: "a storage variable behind admin/multisig, not a
 *         constant"). It is the on-chain analog of `src/lib/sim/ledger.ts`.
 *
 *         Solvency by construction: the pool / jackpot / bounty buckets are tracked as balances and
 *         their `payFrom*` functions cap every payout at the bucket's balance, so no bucket can ever
 *         go negative — exactly the invariant the sim asserts every day. Burn (→ 0x…dEaD) and
 *         Treasury shares leave immediately; the held $WORD always covers pool+jackpot+bounty.
 *
 *         The Bounty carve (the renewable late-game loop, default OFF / 0 bps) skims a fraction of
 *         the *pool* share into a side bounty bucket — a zero-sum redistribution from passive yield
 *         to the weekly goal, never touching jackpot/burn/treasury (see decisions.md).
 */
contract FeeRouter is IFeeRouter, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    struct Split {
        uint16 pool;
        uint16 jackpot;
        uint16 burn;
        uint16 treasury;
    }

    IERC20 public immutable word;

    /// @notice split[source] — bps into each bucket, must sum to 10_000.
    mapping(uint8 => Split) public splits;
    /// @notice fraction of the pool share diverted to the bounty bucket (default 0 = bounty off).
    uint16 public bountyCarveBps;

    uint256 public poolBalance;
    uint256 public jackpotBalance;
    uint256 public bountyBalance;

    address public treasury;
    mapping(address => bool) public isCollector; // game contracts allowed to call route()
    address public poolPayer; // YieldDistributor
    address public jackpotPayer; // Jackpot
    address public bountyPayer; // Bounty

    event Routed(
        uint8 indexed source, uint256 amount, uint256 toPool, uint256 toJackpot, uint256 toBounty, uint256 toBurn, uint256 toTreasury
    );
    event PaidFromPool(address indexed to, uint256 amount);
    event PaidFromJackpot(address indexed to, uint256 amount);
    event PaidFromBounty(address indexed to, uint256 amount);
    event SplitSet(uint8 indexed source, Split split);
    event BountyCarveSet(uint16 bps);
    event CollectorSet(address indexed collector, bool allowed);
    event TreasurySet(address indexed treasury);
    event PayersSet(address poolPayer, address jackpotPayer, address bountyPayer);
    event Seeded(uint8 indexed bucket, uint256 amount);

    error NotCollector();
    error BadSource();
    error FeeNotDelivered();
    error SplitMustSumToBps();
    error Unauthorized();
    error ZeroAddress();
    error JackpotNotSeedable();
    error BadBucket();

    constructor(IERC20 _word, address _treasury, address initialOwner) Ownable(initialOwner) {
        if (address(_word) == address(0) || _treasury == address(0)) revert ZeroAddress();
        word = _word;
        treasury = _treasury;
    }

    // --- routing ---------------------------------------------------------------------------------

    /// @inheritdoc IFeeRouter
    function route(uint8 source, uint256 amount) external nonReentrant {
        if (!isCollector[msg.sender]) revert NotCollector();
        if (source >= FeeSource.COUNT) revert BadSource();

        // The collector must have delivered `amount` of *unaccounted* $WORD to this contract.
        uint256 accounted = poolBalance + jackpotBalance + bountyBalance;
        if (word.balanceOf(address(this)) - accounted < amount) revert FeeNotDelivered();

        Split memory s = splits[source];
        uint256 toJackpot = (amount * s.jackpot) / BPS;
        uint256 toBurn = (amount * s.burn) / BPS;
        uint256 toTreasury = (amount * s.treasury) / BPS;
        // Pool gets the remainder so rounding dust is never lost or double-counted.
        uint256 toPool = amount - toJackpot - toBurn - toTreasury;

        uint256 carve = (toPool * bountyCarveBps) / BPS;
        unchecked {
            toPool -= carve;
        }

        jackpotBalance += toJackpot;
        bountyBalance += carve;
        poolBalance += toPool;
        if (toBurn > 0) word.safeTransfer(BURN_ADDRESS, toBurn);
        if (toTreasury > 0) word.safeTransfer(treasury, toTreasury);

        emit Routed(source, amount, toPool, toJackpot, carve, toBurn, toTreasury);
    }

    // --- bucket payouts (solvency-capped) --------------------------------------------------------

    function payFromPool(address to, uint256 amount) external nonReentrant returns (uint256 paid) {
        if (msg.sender != poolPayer) revert Unauthorized();
        paid = amount > poolBalance ? poolBalance : amount;
        poolBalance -= paid;
        if (paid > 0) word.safeTransfer(to, paid);
        emit PaidFromPool(to, paid);
    }

    function payFromJackpot(address to, uint256 amount) external nonReentrant returns (uint256 paid) {
        if (msg.sender != jackpotPayer) revert Unauthorized();
        paid = amount > jackpotBalance ? jackpotBalance : amount;
        jackpotBalance -= paid;
        if (paid > 0) word.safeTransfer(to, paid);
        emit PaidFromJackpot(to, paid);
    }

    function payFromBounty(address to, uint256 amount) external nonReentrant returns (uint256 paid) {
        if (msg.sender != bountyPayer) revert Unauthorized();
        paid = amount > bountyBalance ? bountyBalance : amount;
        bountyBalance -= paid;
        if (paid > 0) word.safeTransfer(to, paid);
        emit PaidFromBounty(to, paid);
    }

    // --- admin (multisig) ------------------------------------------------------------------------

    /**
     * @notice Owner-only top-up of a reward bucket. Pulls `amount` $WORD from the owner (requires a
     *         prior approve) and credits the Rewards Pool (bucket 0) or the Bounty bucket (bucket 2).
     *         The Jackpot (bucket 1) is intentionally NOT seedable: an operator-funded chance pot is
     *         the core lottery-compliance risk (params.ts: seed.jackpot = 0), so the jackpot only
     *         ever self-funds from fee splits. Solvency invariant is preserved — held $WORD and the
     *         accounted bucket both rise by exactly `amount`.
     */
    function seed(uint8 bucket, uint256 amount) external onlyOwner nonReentrant {
        if (bucket == 1) revert JackpotNotSeedable();
        if (bucket != 0 && bucket != 2) revert BadBucket();
        word.safeTransferFrom(msg.sender, address(this), amount);
        if (bucket == 0) {
            poolBalance += amount;
        } else {
            bountyBalance += amount;
        }
        emit Seeded(bucket, amount);
    }

    function setSplit(uint8 source, Split calldata s) external onlyOwner {
        if (source >= FeeSource.COUNT) revert BadSource();
        if (uint256(s.pool) + s.jackpot + s.burn + s.treasury != BPS) revert SplitMustSumToBps();
        splits[source] = s;
        emit SplitSet(source, s);
    }

    function setBountyCarveBps(uint16 bps) external onlyOwner {
        if (bps > BPS) revert SplitMustSumToBps();
        bountyCarveBps = bps;
        emit BountyCarveSet(bps);
    }

    function setCollector(address collector, bool allowed) external onlyOwner {
        if (collector == address(0)) revert ZeroAddress();
        isCollector[collector] = allowed;
        emit CollectorSet(collector, allowed);
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
        emit TreasurySet(_treasury);
    }

    function setPayers(address _poolPayer, address _jackpotPayer, address _bountyPayer) external onlyOwner {
        poolPayer = _poolPayer;
        jackpotPayer = _jackpotPayer;
        bountyPayer = _bountyPayer;
        emit PayersSet(_poolPayer, _jackpotPayer, _bountyPayer);
    }
}
