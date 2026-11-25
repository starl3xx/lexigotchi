// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @dev Test USDC for Base Sepolia and the tests. It matches Circle's USDC where the Shop and wallets
 *      can tell: 6 decimals, and an EIP-2612 permit under the same EIP-712 domain name ("USD Coin") and
 *      version ("2"), so a permit or a batched buy signed here behaves as it will on mainnet. (OZ's
 *      ERC20Permit fixes its version at "1", so the permit is written out here with version "2".)
 *
 *      The faucet gives 25 test USDC per PROFILE per UTC day: the app's signer vouches for (caller,
 *      profile, day), the same way as Staking's free snack, because only the server knows a wallet's
 *      profile. The minted USDC goes to the caller, so a voucher copied from the mempool is useless.
 *      The owner can also mint (deploy scripts and tests).
 */
contract MockUSDC is ERC20, IERC20Permit, EIP712, Nonces, Ownable {
    bytes32 private constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes32 public constant FAUCET_KIND = keccak256("lexigotchi.mockUsdc.faucet");
    uint256 public constant FAUCET_AMOUNT = 25e6; // 25 test USDC

    address public signer;
    /// @notice A profile's last faucet day, plus one (0 = never).
    mapping(address => uint32) public faucetDayPlusOne;

    event SignerSet(address signer);
    event Faucet(address indexed profile, address indexed to, uint32 day);

    error ExpiredSignature(uint256 deadline);
    error InvalidSigner(address signer, address owner);
    error BadSignature();
    error VoucherExpired();
    error AlreadyToday();

    constructor(address _signer, address initialOwner)
        ERC20("USD Coin", "USDC")
        EIP712("USD Coin", "2")
        Ownable(initialOwner)
    {
        signer = _signer;
        emit SignerSet(_signer);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Circle's FiatToken exposes its EIP-712 version this way.
    function version() external pure returns (string memory) {
        return "2";
    }

    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
    {
        if (block.timestamp > deadline) revert ExpiredSignature(deadline);
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, _useNonce(owner), deadline));
        address recovered = ECDSA.recover(_hashTypedDataV4(structHash), v, r, s);
        if (recovered != owner) revert InvalidSigner(recovered, owner);
        _approve(owner, spender, value);
    }

    function nonces(address owner) public view override(IERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }

    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice 25 test USDC to the caller, once per `profile` per UTC day, with the signer's voucher.
    function faucet(address profile, uint256 deadline, bytes calldata sig) external {
        if (block.timestamp > deadline) revert VoucherExpired();
        uint32 today = uint32(block.timestamp / 1 days);
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(address(this), block.chainid, FAUCET_KIND, msg.sender, profile, today, deadline))
        );
        if (ECDSA.recover(digest, sig) != signer) revert BadSignature();
        if (faucetDayPlusOne[profile] == today + 1) revert AlreadyToday();
        faucetDayPlusOne[profile] = today + 1;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit Faucet(profile, msg.sender, today);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function setSigner(address _signer) external onlyOwner {
        signer = _signer;
        emit SignerSet(_signer);
    }
}
