// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {FeeCollector} from "./FeeCollector.sol";
import {IFeeRouter, FeeSource} from "./interfaces/IFeeRouter.sol";
import {IUsdcSwapAdapter} from "./interfaces/IUsdcSwapAdapter.sol";

/// @dev The price keeper's peg, read where it already lives: Letters' pack price in $WORD, which the
///      price keeper holds at the pack's USD target (decisions.md #7).
interface IPackPricePeg {
    function packPrice() external view returns (uint256);
}

/// @dev FeeRouter's public `splits` getter (the Split struct as a tuple).
interface IRoyaltySplit {
    function splits(uint8 source) external view returns (uint16 pool, uint16 jackpot, uint16 burn, uint16 treasury);
}

/**
 * @title Shop
 * @notice Sells cosmetics for USDC at fixed prices (decisions.md #22). Each purchase splits in the same
 *         transaction: `revenueBps` (80% by default) goes straight from the buyer to `revenueWallet`,
 *         and the rest is swapped to $WORD through `adapter` and routed through the FeeRouter's ROYALTY
 *         split, which sends it to the Rewards Pool less the bounty carve, like the word-sale fee
 *         (SaleFees). What an item IS lives off chain: the registry holds only prices, windows, and
 *         supply. The registry starts empty; the owner adds items.
 *
 *         The swap never blocks a sale. It runs in its own call frame (`swapAndRoute`, callable only by
 *         this contract) inside try/catch, so a failed swap (the pool moved past the floor, the adapter
 *         or the peg is broken, the FeeRouter hasn't registered the Shop, the ROYALTY split carries a
 *         jackpot share) reverts that frame alone: the USDC stays here, `SwapDeferred` says why, and the
 *         purchase still completes. Anyone may `sweep` the waiting USDC through the same route and floor
 *         later; the keeper does it daily. A caller who sends too little gas can also make the inner
 *         frame fail; that only defers the swap, which is harmless.
 *
 *         The floor: every swap must return at least `floorFor(usdcIn)`, the USDC's worth of $WORD at
 *         the price keeper's peg less `maxSlippageBps`. A caller's own `minWordOut` only ever raises it.
 *         With no readable peg the floor is 0, and the swap waits rather than running unprotected.
 *
 *         Custody: the Shop holds only USDC whose swap is waiting, and $WORD only for the length of a
 *         swap. No function withdraws either. The one indirect path is the route itself: a malicious
 *         adapter paired with a floor set near zero could keep waiting USDC. So the adapter can change
 *         only `ADAPTER_DELAY` after a public proposal (`AdapterProposed`), and the floor's slippage is
 *         capped at `MAX_SLIPPAGE_BPS`. The 80% share is never held here at all.
 *
 *         No shop money reaches the jackpot (the Customization Spec's rule): a swap refuses to route
 *         while the ROYALTY split gives the jackpot anything, and waits instead.
 */
contract Shop is FeeCollector, Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;
    /// @notice The studio's share of a sale until the owner changes it (the other 20% buys $WORD).
    uint16 public constant DEFAULT_REVENUE_BPS = 8_000;
    /// @notice Hard cap on the studio's share: the Rewards Pool always gets at least 10% of a sale.
    uint16 public constant MAX_REVENUE_BPS = 9_000;
    /// @notice Hard cap on the floor's slippage allowance.
    uint16 public constant MAX_SLIPPAGE_BPS = 2_000;
    /// @notice How long a proposed adapter waits before the owner can switch to it.
    uint64 public constant ADAPTER_DELAY = 2 days;
    /// @notice The lowest item price, $0.01, so every sale leaves the pool a share worth swapping.
    uint128 public constant MIN_PRICE_USDC = 10_000;

    struct Item {
        uint128 priceUsdc; // 6 decimals
        uint64 start; // first second on sale
        uint64 end; // first second NOT on sale; 0 = no end
        uint32 maxSupply; // 0 = unlimited
        uint32 sold;
        bool active;
    }

    IERC20 public immutable usdc;

    /// @notice Items are numbered 1..itemCount, in the order they were added.
    uint256 public itemCount;
    mapping(uint256 => Item) private _items;

    address public revenueWallet;
    uint16 public revenueBps;
    uint16 public maxSlippageBps;

    /// @notice Where the peg is read ($WORD wei per pack) and the pack's price in USDC units.
    IPackPricePeg public pegSource;
    uint256 public pegPackUsdc;

    IUsdcSwapAdapter public adapter;
    IUsdcSwapAdapter public pendingAdapter;
    uint64 public pendingAdapterReadyAt;

    event ItemAdded(
        uint256 indexed itemId, uint128 priceUsdc, uint64 start, uint64 end, uint32 maxSupply, bool active
    );
    event ItemUpdated(uint256 indexed itemId, uint128 priceUsdc, uint64 start, uint64 end, uint32 maxSupply);
    event ItemActiveSet(uint256 indexed itemId, bool active);
    event Purchased(
        address indexed buyer,
        address indexed recipient,
        uint256 indexed itemId,
        uint256 priceUsdc,
        uint256 toStudio,
        uint256 wordToPool,
        uint256 deferredUsdc
    );
    event SwapDeferred(uint256 indexed itemId, uint256 usdcAmount, bytes reason);
    event Swept(uint256 usdcIn, uint256 wordOut, uint256 strayWord);
    event RevenueWalletSet(address revenueWallet);
    event SplitSet(uint16 revenueBps);
    event MaxSlippageSet(uint16 maxSlippageBps);
    event PegSet(address source, uint256 packUsdc);
    event AdapterProposed(address adapter, uint64 readyAt);
    event AdapterProposalCancelled(address adapter);
    event AdapterSet(address adapter);

    error UnknownItem(uint256 itemId);
    error ItemInactive(uint256 itemId);
    error SaleNotStarted(uint256 itemId);
    error SaleEnded(uint256 itemId);
    error SoldOut(uint256 itemId);
    error PriceTooLow();
    error BadWindow();
    error SupplyBelowSold();
    error ZeroAddress();
    error SplitTooHigh();
    error SlippageTooHigh();
    error OnlySelf();
    error NoPeg();
    error JackpotShare();
    error InsufficientWordOut(uint256 wordOut, uint256 minWordOut);
    error NoPendingAdapter();
    error AdapterNotReady(uint64 readyAt);

    constructor(
        IERC20 _word,
        IFeeRouter _feeRouter,
        IERC20 _usdc,
        IUsdcSwapAdapter _adapter,
        address _revenueWallet,
        IPackPricePeg _pegSource,
        uint256 _pegPackUsdc,
        uint16 _maxSlippageBps,
        address initialOwner
    ) FeeCollector(_word, _feeRouter) Ownable(initialOwner) {
        if (address(_usdc) == address(0) || address(_adapter) == address(0) || _revenueWallet == address(0)) {
            revert ZeroAddress();
        }
        if (_maxSlippageBps > MAX_SLIPPAGE_BPS) revert SlippageTooHigh();
        usdc = _usdc;
        // The first adapter takes effect at once: the Shop holds nothing yet.
        adapter = _adapter;
        revenueWallet = _revenueWallet;
        revenueBps = DEFAULT_REVENUE_BPS;
        maxSlippageBps = _maxSlippageBps;
        pegSource = _pegSource;
        pegPackUsdc = _pegPackUsdc;
        emit AdapterSet(address(_adapter));
        emit RevenueWalletSet(_revenueWallet);
        emit SplitSet(DEFAULT_REVENUE_BPS);
        emit MaxSlippageSet(_maxSlippageBps);
        emit PegSet(address(_pegSource), _pegPackUsdc);
    }

    // --- buying -----------------------------------------------------------------------------------

    /// @notice Buy one of `itemId` for `recipient`. The buyer approves this contract for the price.
    /// @param minWordOut the least $WORD the pool's share may buy; raised to `floorFor` if lower.
    function buy(uint256 itemId, address recipient, uint256 minWordOut) external nonReentrant whenNotPaused {
        _buy(itemId, recipient, minWordOut);
    }

    /// @notice `buy`, with a USDC EIP-2612 permit for exactly the item's price instead of an approval.
    ///         A permit that fails (one already used, e.g. copied from the mempool by someone who ran it
    ///         first) is ignored: the allowance it set still stands, and a buyer with no allowance fails at
    ///         the transfer.
    function buyWithPermit(
        uint256 itemId,
        address recipient,
        uint256 minWordOut,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused {
        try IERC20Permit(address(usdc)).permit(msg.sender, address(this), _items[itemId].priceUsdc, deadline, v, r, s) {}
            catch {}
        _buy(itemId, recipient, minWordOut);
    }

    function _buy(uint256 itemId, address recipient, uint256 minWordOut) private {
        if (recipient == address(0)) revert ZeroAddress();
        if (itemId == 0 || itemId > itemCount) revert UnknownItem(itemId);
        Item storage it = _items[itemId];
        if (!it.active) revert ItemInactive(itemId);
        if (block.timestamp < it.start) revert SaleNotStarted(itemId);
        if (it.end != 0 && block.timestamp >= it.end) revert SaleEnded(itemId);
        if (it.maxSupply != 0 && it.sold >= it.maxSupply) revert SoldOut(itemId);
        it.sold += 1;

        uint256 price = it.priceUsdc;
        uint256 toStudio = (price * revenueBps) / BPS;
        // The pool's share takes the rounding, so it is never short a unit.
        uint256 toSwap = price - toStudio;
        usdc.safeTransferFrom(msg.sender, revenueWallet, toStudio);
        usdc.safeTransferFrom(msg.sender, address(this), toSwap);

        uint256 wordOut;
        uint256 deferred;
        try this.swapAndRoute(toSwap, minWordOut) returns (uint256 out) {
            wordOut = out;
        } catch (bytes memory reason) {
            deferred = toSwap;
            emit SwapDeferred(itemId, toSwap, reason);
        }
        emit Purchased(msg.sender, recipient, itemId, price, toStudio, wordOut, deferred);
    }

    /// @notice Swap the USDC whose swap is waiting, through the same route and floor, and route the
    ///         $WORD. Also routes any $WORD sent here directly. Permissionless; a no-op when nothing waits.
    ///         Unlike a purchase, a failed swap reverts here.
    function sweep(uint256 minWordOut)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 usdcIn, uint256 wordOut)
    {
        usdcIn = usdc.balanceOf(address(this));
        if (usdcIn != 0) wordOut = this.swapAndRoute(usdcIn, minWordOut);
        uint256 stray = word.balanceOf(address(this));
        if (stray != 0) {
            _requireNoJackpotShare();
            _routeHeld(stray, FeeSource.ROYALTY);
        }
        emit Swept(usdcIn, wordOut, stray);
    }

    /// @notice The swap and the routing, in a call frame of its own so a purchase can catch its failure
    ///         and keep the USDC. Callable only by this contract (from `buy`, `buyWithPermit`, `sweep`).
    function swapAndRoute(uint256 usdcIn, uint256 minWordOut) external returns (uint256 wordOut) {
        if (msg.sender != address(this)) revert OnlySelf();
        _requireNoJackpotShare();
        uint256 floor = floorFor(usdcIn);
        if (floor == 0) revert NoPeg();
        uint256 minOut = minWordOut > floor ? minWordOut : floor;

        IUsdcSwapAdapter a = adapter;
        // Measured, not taken from the adapter's return value: only $WORD that arrived counts.
        uint256 before = word.balanceOf(address(this));
        usdc.forceApprove(address(a), usdcIn);
        a.swapUsdcForWord(usdcIn, minOut, address(this));
        usdc.forceApprove(address(a), 0);
        wordOut = word.balanceOf(address(this)) - before;
        if (wordOut < minOut) revert InsufficientWordOut(wordOut, minOut);
        _routeHeld(wordOut, FeeSource.ROYALTY);
    }

    function _requireNoJackpotShare() private view {
        (, uint16 toJackpot,,) = IRoyaltySplit(address(feeRouter)).splits(FeeSource.ROYALTY);
        if (toJackpot != 0) revert JackpotShare();
    }

    // --- views ------------------------------------------------------------------------------------

    function item(uint256 itemId) external view returns (Item memory) {
        if (itemId == 0 || itemId > itemCount) revert UnknownItem(itemId);
        return _items[itemId];
    }

    /// @notice USDC whose swap is waiting for `sweep`.
    function pendingUsdc() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /// @notice The least $WORD `usdcIn` USDC must buy: its worth at the price keeper's peg (Letters'
    ///         pack price per `pegPackUsdc`), less `maxSlippageBps`. 0 when no peg is set or it reads 0.
    function floorFor(uint256 usdcIn) public view returns (uint256) {
        if (address(pegSource) == address(0) || pegPackUsdc == 0) return 0;
        uint256 wordAtPeg = Math.mulDiv(usdcIn, pegSource.packPrice(), pegPackUsdc);
        return Math.mulDiv(wordAtPeg, BPS - maxSlippageBps, BPS);
    }

    // --- owner: the registry ----------------------------------------------------------------------

    function addItem(uint128 priceUsdc, uint64 start, uint64 end, uint32 maxSupply, bool active)
        external
        onlyOwner
        returns (uint256 itemId)
    {
        _checkTerms(priceUsdc, start, end);
        itemId = ++itemCount;
        _items[itemId] = Item(priceUsdc, start, end, maxSupply, 0, active);
        emit ItemAdded(itemId, priceUsdc, start, end, maxSupply, active);
    }

    function updateItem(uint256 itemId, uint128 priceUsdc, uint64 start, uint64 end, uint32 maxSupply)
        external
        onlyOwner
    {
        if (itemId == 0 || itemId > itemCount) revert UnknownItem(itemId);
        _checkTerms(priceUsdc, start, end);
        Item storage it = _items[itemId];
        if (maxSupply != 0 && maxSupply < it.sold) revert SupplyBelowSold();
        it.priceUsdc = priceUsdc;
        it.start = start;
        it.end = end;
        it.maxSupply = maxSupply;
        emit ItemUpdated(itemId, priceUsdc, start, end, maxSupply);
    }

    function setActive(uint256 itemId, bool active) external onlyOwner {
        if (itemId == 0 || itemId > itemCount) revert UnknownItem(itemId);
        _items[itemId].active = active;
        emit ItemActiveSet(itemId, active);
    }

    function _checkTerms(uint128 priceUsdc, uint64 start, uint64 end) private pure {
        if (priceUsdc < MIN_PRICE_USDC) revert PriceTooLow();
        if (end != 0 && end <= start) revert BadWindow();
    }

    // --- owner: money settings --------------------------------------------------------------------

    function setRevenueWallet(address wallet) external onlyOwner {
        if (wallet == address(0)) revert ZeroAddress();
        revenueWallet = wallet;
        emit RevenueWalletSet(wallet);
    }

    /// @notice The studio's share of each sale, in bps; the rest buys $WORD for the pool.
    function setSplit(uint16 bps) external onlyOwner {
        if (bps > MAX_REVENUE_BPS) revert SplitTooHigh();
        revenueBps = bps;
        emit SplitSet(bps);
    }

    function setMaxSlippageBps(uint16 bps) external onlyOwner {
        if (bps > MAX_SLIPPAGE_BPS) revert SlippageTooHigh();
        maxSlippageBps = bps;
        emit MaxSlippageSet(bps);
    }

    /// @notice Where the floor reads the peg, and the pack's USDC price it stands for. Change it with
    ///         any owner retune of the pack's USD target, or the floor drifts by the same ratio.
    function setPeg(IPackPricePeg source, uint256 packUsdc) external onlyOwner {
        pegSource = source;
        pegPackUsdc = packUsdc;
        emit PegSet(address(source), packUsdc);
    }

    // --- owner: the route (delayed) ---------------------------------------------------------------

    function proposeAdapter(IUsdcSwapAdapter next) external onlyOwner {
        if (address(next) == address(0)) revert ZeroAddress();
        uint64 readyAt = uint64(block.timestamp) + ADAPTER_DELAY;
        pendingAdapter = next;
        pendingAdapterReadyAt = readyAt;
        emit AdapterProposed(address(next), readyAt);
    }

    function acceptAdapter() external onlyOwner {
        IUsdcSwapAdapter next = pendingAdapter;
        if (address(next) == address(0)) revert NoPendingAdapter();
        if (block.timestamp < pendingAdapterReadyAt) revert AdapterNotReady(pendingAdapterReadyAt);
        adapter = next;
        pendingAdapter = IUsdcSwapAdapter(address(0));
        pendingAdapterReadyAt = 0;
        emit AdapterSet(address(next));
    }

    function cancelAdapter() external onlyOwner {
        IUsdcSwapAdapter next = pendingAdapter;
        if (address(next) == address(0)) revert NoPendingAdapter();
        pendingAdapter = IUsdcSwapAdapter(address(0));
        pendingAdapterReadyAt = 0;
        emit AdapterProposalCancelled(address(next));
    }

    // --- owner: pause -----------------------------------------------------------------------------

    /// @notice Stops buying and sweeping. Nothing is held that a pause could trap except waiting USDC,
    ///         which `sweep` routes once unpaused.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
