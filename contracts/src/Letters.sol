// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ILetters} from "./interfaces/ILetters.sol";
import {ISwapRouter} from "./interfaces/ISwapRouter.sol";
import {IFeeRouter, FeeSource} from "./interfaces/IFeeRouter.sol";
import {FeeCollector} from "./FeeCollector.sol";

/**
 * @title Letters
 * @notice The 52-id letter ERC-1155 (lowercase id `i` = `i`, uppercase id `i` = `26+i`).
 *
 *         Mints are 100% lowercase (v0.2 §1.3) and demand-mirrored: each draw samples a letter by
 *         its share of dictionary slots (Appendix A), respecting per-letter supply caps
 *         (floor(slots × 2.5)). Randomness uses commit→blockhash reveal: the buyer commits and pays
 *         at commit, then reveals against the committed block's hash (low-stakes lowercase draws, so
 *         a future-blockhash source is acceptable and fully trustless — unlike the value-bearing
 *         rolls, which use the EGGS server-signed reveal in `Rolls.sol`).
 *
 *         Two mint paths (v0.2 §1.2): a discounted DAILY single gated on a Farcaster FID via a
 *         backend-signed allowance (the off-chain Quick-Auth / Sybil gate), and full-price PACKS of
 *         five, anytime. Either path accepts $WORD directly or ETH (auto-swapped to $WORD, v0.2 §4).
 *
 *         Uppercase is never minted directly — only via `upgrade` (a successful roll), which burns a
 *         lowercase and mints its uppercase counterpart, conserving total per-letter supply.
 */
contract Letters is ILetters, ERC1155, Ownable2Step, ReentrancyGuard, FeeCollector {
    using SafeERC20 for IERC20;

    uint8 internal constant KIND_PACK = 0;
    uint8 internal constant KIND_DAILY = 1;
    uint8 public constant PACK_SIZE = 5;
    uint256 internal constant BLOCKHASH_WINDOW = 256;

    struct Commit {
        address buyer;
        uint8 kind;
        uint8 count;
        bool revealed;
        uint64 blockNumber;
    }

    // Letter economy (set at deploy from the canonical dictionary; tunable by the multisig).
    uint32[26] public cap; // per-letter supply cap = floor(slots × demandMultiple)
    uint32[26] public mintedEver; // cumulative primary lowercase mints (rolls don't change this)
    uint32[26] internal cumWeight; // cumulative slot weights for the demand-mirrored draw
    uint32 public totalWeight;

    uint256 public packPrice; // $WORD, full price (volume loop)
    uint256 public dailyPrice; // $WORD, discounted single (habit loop)

    address public signer; // backend allowance signer for the FID-gated daily
    ISwapRouter public swapRouter; // ETH→$WORD auto-swap
    // Contracts allowed to call `upgrade`: Rolls (loose-letter rolls) AND Words (escrowed-letter
    // rolls burn/mint on Words' own escrow balance, so Words must be authorized too).
    mapping(address => bool) public isUpgrader;

    Commit[] public commits;
    // `dailyUsed` stores (UTC day + 1) of the last daily mint, so the default 0 means "never used"
    // and never collides with day 0. One discounted mint per FID per UTC day.
    mapping(uint256 fid => uint32 lastDailyDayPlusOne) public dailyUsed;

    event Committed(uint256 indexed commitId, address indexed buyer, uint8 kind, uint8 count);
    event Revealed(uint256 indexed commitId, address indexed buyer, uint256[] letterIds);
    event DailyMinted(uint256 indexed fid, address indexed buyer, uint32 day);
    event PricesSet(uint256 packPrice, uint256 dailyPrice);
    event SignerSet(address signer);
    event SwapRouterSet(address swapRouter);
    event UpgraderSet(address upgrader, bool allowed);

    error NotUpgrader();
    error BadCommit();
    error TooSoon();
    error CommitExpired();
    error AlreadyRevealed();
    error MintedOut();
    error BadSignature();
    error AllowanceExpired();
    error DailyAlreadyUsed();
    error InsufficientSwapOutput();
    error ZeroAddress();

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
    ) ERC1155(_uri) Ownable(initialOwner) FeeCollector(_word, _feeRouter) {
        cap = _cap;
        uint32 running;
        for (uint8 i = 0; i < 26; i++) {
            running += _weight[i];
            cumWeight[i] = running;
        }
        totalWeight = running;
        packPrice = _packPrice;
        dailyPrice = _dailyPrice;
        signer = _signer;
    }

    // --- mint: pack of five -----------------------------------------------------------------------

    /// @notice Commit + pay for a pack of five (in $WORD). Reveal in a later block.
    function commitPack() external nonReentrant returns (uint256 commitId) {
        _collect(msg.sender, packPrice, FeeSource.PACK_MINT);
        commitId = _newCommit(msg.sender, KIND_PACK, PACK_SIZE);
    }

    /// @notice Commit + pay for a pack with ETH (auto-swapped to $WORD; excess $WORD refunded).
    function commitPackETH(uint256 minWordOut) external payable nonReentrant returns (uint256 commitId) {
        uint256 out = swapRouter.swapETHForWord{value: msg.value}(minWordOut, address(this));
        if (out < packPrice) revert InsufficientSwapOutput();
        _routeHeld(packPrice, FeeSource.PACK_MINT);
        uint256 refund = out - packPrice;
        if (refund > 0) word.safeTransfer(msg.sender, refund);
        commitId = _newCommit(msg.sender, KIND_PACK, PACK_SIZE);
    }

    // --- mint: FID-gated daily single -------------------------------------------------------------

    /// @notice Commit + pay for the discounted daily single. Requires a backend-signed allowance
    ///         proving this FID's Quick-Auth/Sybil gate passed; enforces one mint per FID per UTC day.
    function commitDaily(uint256 fid, uint256 deadline, bytes calldata sig)
        external
        nonReentrant
        returns (uint256 commitId)
    {
        _verifyDaily(fid, deadline, sig);
        _collect(msg.sender, dailyPrice, FeeSource.DAILY_MINT);
        commitId = _newCommit(msg.sender, KIND_DAILY, 1);
        emit DailyMinted(fid, msg.sender, uint32(block.timestamp / 1 days));
    }

    /// @notice ETH variant of the daily single.
    function commitDailyETH(uint256 fid, uint256 deadline, bytes calldata sig, uint256 minWordOut)
        external
        payable
        nonReentrant
        returns (uint256 commitId)
    {
        _verifyDaily(fid, deadline, sig);
        uint256 out = swapRouter.swapETHForWord{value: msg.value}(minWordOut, address(this));
        if (out < dailyPrice) revert InsufficientSwapOutput();
        _routeHeld(dailyPrice, FeeSource.DAILY_MINT);
        uint256 refund = out - dailyPrice;
        if (refund > 0) word.safeTransfer(msg.sender, refund);
        commitId = _newCommit(msg.sender, KIND_DAILY, 1);
        emit DailyMinted(fid, msg.sender, uint32(block.timestamp / 1 days));
    }

    function _verifyDaily(uint256 fid, uint256 deadline, bytes calldata sig) internal {
        if (block.timestamp > deadline) revert AllowanceExpired();
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(address(this), block.chainid, msg.sender, fid, deadline))
        );
        if (ECDSA.recover(digest, sig) != signer) revert BadSignature();
        uint32 todayPlusOne = uint32(block.timestamp / 1 days) + 1;
        if (dailyUsed[fid] == todayPlusOne) revert DailyAlreadyUsed();
        dailyUsed[fid] = todayPlusOne;
    }

    // --- reveal -----------------------------------------------------------------------------------

    /// @notice Reveal a commit, minting its lowercase letters from the committed block's hash.
    function reveal(uint256 commitId) external nonReentrant {
        Commit storage c = commits[commitId];
        if (c.buyer == address(0)) revert BadCommit();
        if (c.revealed) revert AlreadyRevealed();
        if (block.number <= c.blockNumber) revert TooSoon();
        if (block.number > c.blockNumber + BLOCKHASH_WINDOW) revert CommitExpired();
        bytes32 bh = blockhash(c.blockNumber);
        if (bh == 0) revert CommitExpired();

        c.revealed = true;
        uint8 count = c.count;
        uint256[] memory ids = new uint256[](count);
        for (uint8 k = 0; k < count; k++) {
            uint8 idx = _drawLetter(uint256(keccak256(abi.encode(bh, commitId, k))));
            mintedEver[idx] += 1;
            _mint(c.buyer, idx, 1, ""); // lowercase id == alphabet index
            ids[k] = idx;
        }
        emit Revealed(commitId, c.buyer, ids);
    }

    /// @dev Demand-mirrored draw: pick a letter by slot-weight, skipping any at its supply cap.
    function _drawLetter(uint256 seed) internal view returns (uint8) {
        uint256 r = seed % totalWeight;
        uint8 i = 0;
        while (i < 25 && cumWeight[i] <= r) {
            i++;
        }
        if (mintedEver[i] < cap[i]) return i;
        // capped letter — deterministically scan to the next mintable letter
        for (uint8 d = 1; d < 26; d++) {
            uint8 j = uint8((i + d) % 26);
            if (mintedEver[j] < cap[j]) return j;
        }
        revert MintedOut();
    }

    // --- upgrade (rolls only) ---------------------------------------------------------------------

    /// @inheritdoc ILetters
    function upgrade(address holder, uint8 letterIndex) external {
        if (!isUpgrader[msg.sender]) revert NotUpgrader();
        _burn(holder, letterIndex, 1); // burn the lowercase (reverts if the holder lacks it)
        _mint(holder, uint256(letterIndex) + 26, 1, ""); // mint the uppercase counterpart
    }

    // --- views / admin ----------------------------------------------------------------------------

    function commitCount() external view returns (uint256) {
        return commits.length;
    }

    function caps() external view returns (uint32[26] memory) {
        return cap;
    }

    function _newCommit(address buyer, uint8 kind, uint8 count) internal returns (uint256 commitId) {
        commitId = commits.length;
        commits.push(Commit({buyer: buyer, kind: kind, count: count, revealed: false, blockNumber: uint64(block.number)}));
        emit Committed(commitId, buyer, kind, count);
    }

    function setPrices(uint256 _packPrice, uint256 _dailyPrice) external onlyOwner {
        packPrice = _packPrice;
        dailyPrice = _dailyPrice;
        emit PricesSet(_packPrice, _dailyPrice);
    }

    function setSigner(address _signer) external onlyOwner {
        if (_signer == address(0)) revert ZeroAddress();
        signer = _signer;
        emit SignerSet(_signer);
    }

    function setSwapRouter(ISwapRouter _swapRouter) external onlyOwner {
        swapRouter = _swapRouter;
        emit SwapRouterSet(address(_swapRouter));
    }

    function setUpgrader(address upgrader, bool allowed) external onlyOwner {
        if (upgrader == address(0)) revert ZeroAddress();
        isUpgrader[upgrader] = allowed;
        emit UpgraderSet(upgrader, allowed);
    }

    function setURI(string calldata newuri) external onlyOwner {
        _setURI(newuri);
    }
}
