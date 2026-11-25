// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IUsdcSwapAdapter} from "../interfaces/IUsdcSwapAdapter.sol";

/// @dev Uniswap's Universal Router, the one entry point this adapter calls (v2.0 on Base,
///      0x6fF5693b99212Da76ad316178A184AB56D299b43, from Uniswap's own deployments list).
interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/**
 * @title UniV4UsdcWordAdapter
 * @notice The Shop's mainnet route: USDC → WETH on a Uniswap v3 pool, then WETH → $WORD on $WORD's
 *         Uniswap v4 pool (Clanker's, with its hook), in one Universal Router call. It holds nothing
 *         between calls and has no owner: the route is fixed at deploy, and a new route is a new adapter
 *         (the Shop switches after its delay).
 *
 *         The pool key was read onchain before it was written down (2026-11-25): PositionManager
 *         `poolKeys(bytes25(poolId))` for pool id 0xc5db…a275 returned $WORD/WETH, fee 0x800000 (the
 *         dynamic-fee flag: the hook sets the fee), tick spacing 200, hook 0xd60D…68Cc, and
 *         keccak256(abi.encode(key)) equals the pool id. The deploy script takes these as arguments.
 *
 *         How the call runs: the adapter pulls the USDC from its caller and hands it to the router, so
 *         every leg pays from the router's own balance (no Permit2). V3_SWAP_EXACT_IN spends the router's
 *         whole USDC balance and leaves the WETH with the router; V4_SWAP then SETTLEs that whole WETH
 *         balance with the PoolManager, swaps it exact-in for $WORD, and TAKEs all of it to `to`. The
 *         router enforces `minWordOut` on the v4 leg, and this adapter checks what `to` received.
 */
contract UniV4UsdcWordAdapter is IUsdcSwapAdapter {
    using SafeERC20 for IERC20;

    /// @dev v4-core PoolKey with Currency and IHooks unwrapped to addresses (same ABI encoding).
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    /// @dev v4-periphery IV4Router.ExactInputSingleParams, as the deployed router decodes it.
    struct ExactInputSingleParams {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        bytes hookData;
    }

    // Universal Router commands (Commands.sol).
    uint8 private constant V3_SWAP_EXACT_IN = 0x00;
    uint8 private constant V4_SWAP = 0x10;
    // v4-periphery actions (Actions.sol).
    uint8 private constant SWAP_EXACT_IN_SINGLE = 0x06;
    uint8 private constant SETTLE = 0x0b;
    uint8 private constant TAKE = 0x0e;
    // v4-periphery ActionConstants.
    uint256 private constant CONTRACT_BALANCE = 1 << 255; // "the router's whole balance"
    uint256 private constant OPEN_DELTA = 0; // "the whole open delta"
    address private constant ADDRESS_THIS = address(2); // "the router itself"

    IUniversalRouter public immutable router;
    IERC20 public immutable usdc;
    IERC20 public immutable weth;
    IERC20 public immutable word;
    /// @notice The fee tier of the v3 USDC/WETH pool (500 = the 0.05% pool).
    uint24 public immutable usdcWethFee;
    uint24 public immutable wordPoolFee;
    int24 public immutable wordPoolTickSpacing;
    address public immutable wordPoolHooks;

    error ZeroAddress();
    error ZeroAmount();
    error InsufficientWordOut(uint256 wordOut, uint256 minWordOut);

    constructor(
        IUniversalRouter _router,
        IERC20 _usdc,
        IERC20 _weth,
        IERC20 _word,
        uint24 _usdcWethFee,
        uint24 _wordPoolFee,
        int24 _wordPoolTickSpacing,
        address _wordPoolHooks
    ) {
        if (
            address(_router) == address(0) || address(_usdc) == address(0) || address(_weth) == address(0)
                || address(_word) == address(0)
        ) revert ZeroAddress();
        router = _router;
        usdc = _usdc;
        weth = _weth;
        word = _word;
        usdcWethFee = _usdcWethFee;
        wordPoolFee = _wordPoolFee;
        wordPoolTickSpacing = _wordPoolTickSpacing;
        wordPoolHooks = _wordPoolHooks;
    }

    /// @notice $WORD's v4 pool key, currencies sorted as v4 requires.
    function poolKey() public view returns (PoolKey memory key) {
        (address c0, address c1) =
            address(word) < address(weth) ? (address(word), address(weth)) : (address(weth), address(word));
        key = PoolKey(c0, c1, wordPoolFee, wordPoolTickSpacing, wordPoolHooks);
    }

    /// @inheritdoc IUsdcSwapAdapter
    function swapUsdcForWord(uint256 usdcIn, uint256 minWordOut, address to) external returns (uint256 wordOut) {
        if (to == address(0)) revert ZeroAddress();
        if (usdcIn == 0) revert ZeroAmount();
        usdc.safeTransferFrom(msg.sender, address(router), usdcIn);

        bytes memory commands = abi.encodePacked(V3_SWAP_EXACT_IN, V4_SWAP);
        bytes[] memory inputs = new bytes[](2);
        // (recipient, amountIn, amountOutMin, path, payerIsUser): the WETH stays with the router.
        inputs[0] = abi.encode(
            ADDRESS_THIS, CONTRACT_BALANCE, uint256(0), abi.encodePacked(address(usdc), usdcWethFee, address(weth)), false
        );

        bytes memory actions = abi.encodePacked(SETTLE, SWAP_EXACT_IN_SINGLE, TAKE);
        bytes[] memory params = new bytes[](3);
        // (currency, amount, payerIsUser): settle the router's whole WETH balance from the router.
        params[0] = abi.encode(address(weth), CONTRACT_BALANCE, false);
        params[1] = abi.encode(
            ExactInputSingleParams({
                poolKey: poolKey(),
                zeroForOne: address(weth) < address(word), // WETH in
                // forge-lint: disable-next-line(unsafe-typecast)
                amountIn: uint128(OPEN_DELTA), // 0: the whole credit SETTLE just made
                amountOutMinimum: SafeCast.toUint128(minWordOut),
                hookData: ""
            })
        );
        // (currency, recipient, amount): all the $WORD, to `to`.
        params[2] = abi.encode(address(word), to, OPEN_DELTA);
        inputs[1] = abi.encode(actions, params);

        uint256 before = word.balanceOf(to);
        router.execute(commands, inputs, block.timestamp);
        wordOut = word.balanceOf(to) - before;
        if (wordOut < minWordOut) revert InsufficientWordOut(wordOut, minWordOut);
    }
}
