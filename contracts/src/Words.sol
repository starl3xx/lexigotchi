// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ILetters} from "./interfaces/ILetters.sol";
import {IWords, CaseState} from "./interfaces/IWords.sol";
import {IFeeRouter, FeeSource} from "./interfaces/IFeeRouter.sol";
import {FeeCollector} from "./FeeCollector.sol";
import {RepegKeeper} from "./RepegKeeper.sol";

/**
 * @title Words
 * @notice One ERC-721 per dictionary word, `tokenId = uint256(keccak256(bytes(word)))` (v0.2 §2).
 *         "Who wins the jackpot if lowercase CRANE and UPPERCASE CRANE have different owners?" is
 *         unrepresentable here: there is exactly one token per word for its lifetime, and its case is
 *         *derived* from the five escrowed letters (never stored independently).
 *
 *         Claiming escrows five letters of uniform case (verified ERC-1155 transfers) for a word
 *         proven to be in the canonical dictionary via a Merkle proof. Upgrade rolls mutate the
 *         escrow in place (`applyUpgrade`, called by Rolls). Dissolution burns the Word, returns its
 *         five letters in their current case, and frees the name for re-claim (v0.1 §5.4).
 */
contract Words is IWords, ERC721, ERC1155Holder, ERC2981, Ownable2Step, ReentrancyGuard, FeeCollector, RepegKeeper {
    uint8 internal constant FULL_MASK = 0x1F; // all five positions raised

    struct Escrow {
        uint8[5] letters; // alphabet indices (0..25)
        uint8 upperMask; // bit k set ⇒ position k is uppercase
        bool exists;
    }

    ILetters public immutable letters;
    bytes32 public dictionaryRoot; // Merkle root of keccak256(bytes(word)) over the 4,438 words
    uint256 public claimPrice; // $WORD
    string internal baseTokenURI; // tokenURI = baseTokenURI + decimal tokenId (metadata is dynamic: case lives in escrow)

    mapping(uint256 tokenId => Escrow) internal escrows;
    mapping(uint256 tokenId => uint8) public prestigeLevel;

    address public rolls; // may call applyUpgrade
    address public prestige; // may call bumpPrestige

    event Claimed(uint256 indexed tokenId, address indexed owner, string word, bool uppercase);
    event Dissolved(uint256 indexed tokenId, address indexed owner, string word);
    event Upgraded(uint256 indexed tokenId, uint8 pos, uint8 letterIndex);
    event PrestigeBumped(uint256 indexed tokenId, uint8 newLevel);
    event DictionaryRootSet(bytes32 root);
    event ClaimPriceSet(uint256 price);
    event BaseURISet(string uri);
    event RoyaltySet(address receiver, uint96 bps);
    event RollsSet(address rolls);
    event PrestigeSet(address prestige);

    error WrongLength();
    error NotInDictionary();
    error AlreadyClaimed();
    error NotAWord();
    error NotRolls();
    error NotPrestige();
    error NotOwner();
    error NoSuchToken();
    error BadPosition();
    error AlreadyRaised();
    error ZeroAddress();

    constructor(
        IERC20 _word,
        IFeeRouter _feeRouter,
        ILetters _letters,
        bytes32 _dictionaryRoot,
        uint256 _claimPrice,
        address initialOwner
    ) ERC721("Lexigotchi Word", "WORD-NFT") Ownable(initialOwner) FeeCollector(_word, _feeRouter) {
        letters = _letters;
        dictionaryRoot = _dictionaryRoot;
        claimPrice = _claimPrice;
    }

    // --- claim / dissolve -------------------------------------------------------------------------

    /// @notice Claim `word` by escrowing its five letters (all `uppercase` or all lowercase).
    function claim(string calldata word_, bool uppercase, bytes32[] calldata proof)
        external
        nonReentrant
        returns (uint256 tokenId)
    {
        bytes memory b = bytes(word_);
        if (b.length != 5) revert WrongLength();
        // tokenId is the word's own hash (v0.2 §2); the dictionary leaf is the OZ StandardMerkleTree
        // double-hash of abi.encode(word) so off-chain proofs from @openzeppelin/merkle-tree verify.
        tokenId = uint256(keccak256(b));
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(word_))));
        if (!MerkleProof.verify(proof, dictionaryRoot, leaf)) revert NotInDictionary();
        if (escrows[tokenId].exists) revert AlreadyClaimed();

        uint8[5] memory idx;
        uint256[] memory ids = new uint256[](5);
        uint256[] memory amounts = new uint256[](5);
        for (uint256 k = 0; k < 5; k++) {
            uint256 c = uint256(uint8(b[k]));
            if (c < 65 || c > 90) revert NotAWord(); // 'A'..'Z'
            uint8 li = uint8(c - 65);
            idx[k] = li;
            ids[k] = uppercase ? uint256(li) + 26 : uint256(li);
            amounts[k] = 1;
        }

        // Escrow the five letters (reverts if the claimer doesn't own them in the chosen case).
        letters.safeBatchTransferFrom(msg.sender, address(this), ids, amounts, "");
        _collect(msg.sender, claimPrice, FeeSource.CLAIM);

        escrows[tokenId] = Escrow({letters: idx, upperMask: uppercase ? FULL_MASK : 0, exists: true});
        _safeMint(msg.sender, tokenId);
        emit Claimed(tokenId, msg.sender, word_, uppercase);
    }

    /// @notice Burn a Word you own (must be unstaked), recover its five letters, free the name.
    function dissolve(uint256 tokenId, string calldata word_) external nonReentrant {
        if (_ownerOf(tokenId) != msg.sender) revert NotOwner();
        Escrow memory e = escrows[tokenId];
        if (!e.exists) revert NoSuchToken();

        uint256[] memory ids = new uint256[](5);
        uint256[] memory amounts = new uint256[](5);
        for (uint256 k = 0; k < 5; k++) {
            bool up = (e.upperMask >> k) & 1 == 1;
            ids[k] = up ? uint256(e.letters[k]) + 26 : uint256(e.letters[k]);
            amounts[k] = 1;
        }

        delete escrows[tokenId];
        delete prestigeLevel[tokenId];
        _burn(tokenId);
        letters.safeBatchTransferFrom(address(this), msg.sender, ids, amounts, "");
        emit Dissolved(tokenId, msg.sender, word_);
    }

    // --- escrow mutation (rolls / prestige) -------------------------------------------------------

    /// @inheritdoc IWords
    function applyUpgrade(uint256 tokenId, uint8 pos) external {
        if (msg.sender != rolls) revert NotRolls();
        Escrow storage e = escrows[tokenId];
        if (!e.exists) revert NoSuchToken();
        if (pos > 4) revert BadPosition();
        if ((e.upperMask >> pos) & 1 == 1) revert AlreadyRaised();
        letters.upgrade(address(this), e.letters[pos]); // burns lowercase, mints uppercase into escrow
        e.upperMask |= uint8(1 << pos);
        emit Upgraded(tokenId, pos, e.letters[pos]);
    }

    /// @inheritdoc IWords
    function bumpPrestige(uint256 tokenId) external {
        if (msg.sender != prestige) revert NotPrestige();
        if (!escrows[tokenId].exists) revert NoSuchToken();
        uint8 lvl = prestigeLevel[tokenId] + 1;
        prestigeLevel[tokenId] = lvl;
        emit PrestigeBumped(tokenId, lvl);
    }

    // --- views ------------------------------------------------------------------------------------

    /// @inheritdoc IWords
    function exists(uint256 tokenId) public view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    /// @inheritdoc IWords
    function caseOf(uint256 tokenId) external view returns (CaseState) {
        uint8 m = escrows[tokenId].upperMask;
        if (m == 0) return CaseState.Lowercase;
        if (m == FULL_MASK) return CaseState.Uppercase;
        return CaseState.Mixed;
    }

    /// @inheritdoc IWords
    function escrowLetter(uint256 tokenId, uint8 pos) external view returns (uint8 letterIndex, bool isUpper) {
        Escrow memory e = escrows[tokenId];
        letterIndex = e.letters[pos];
        isUpper = (e.upperMask >> pos) & 1 == 1;
    }

    function prestigeLevelOf(uint256 tokenId) external view returns (uint8) {
        return prestigeLevel[tokenId];
    }

    /// @dev OZ ERC721 composes `tokenURI` as `baseURI + tokenId` (decimal). The metadata server maps
    ///      the id back to its word (the dictionary is fixed) and renders case from the live escrow.
    function _baseURI() internal view override returns (string memory) {
        return baseTokenURI;
    }

    // --- admin ------------------------------------------------------------------------------------

    function setDictionaryRoot(bytes32 root) external onlyOwner {
        dictionaryRoot = root;
        emit DictionaryRootSet(root);
    }

    function setClaimPrice(uint256 price) external onlyOwner {
        claimPrice = price;
        emit ClaimPriceSet(price);
    }

    function setRolls(address _rolls) external onlyOwner {
        if (_rolls == address(0)) revert ZeroAddress();
        rolls = _rolls;
        emit RollsSet(_rolls);
    }

    function setPrestige(address _prestige) external onlyOwner {
        if (_prestige == address(0)) revert ZeroAddress();
        prestige = _prestige;
        emit PrestigeSet(_prestige);
    }

    function setBaseURI(string calldata uri) external onlyOwner {
        baseTokenURI = uri;
        emit BaseURISet(uri);
    }

    /// @notice EIP-2981 royalty — a SIGNAL only (decisions.md "Royalty & marketplace architecture"):
    ///         open composability, no on-chain enforcement; honoring marketplaces pay the treasury.
    function setDefaultRoyalty(address receiver, uint96 bps) external onlyOwner {
        _setDefaultRoyalty(receiver, bps);
        emit RoyaltySet(receiver, bps);
    }

    // --- repeg (price keeper) ---------------------------------------------------------------------

    /// @notice Keeper-driven clamped repeg of the claim price.
    function repegClaimPrice(uint256 price) external onlyPriceKeeper repegRateLimited {
        uint256 old = claimPrice;
        if (_clampRepeg(old, price)) {
            claimPrice = price;
            emit ClaimPriceSet(price);
            emit Repegged("claimPrice", old, price);
        }
    }

    function setPriceKeeper(address keeper) external onlyOwner {
        _setPriceKeeper(keeper);
    }

    function setMaxMoveBps(uint16 bps) external onlyOwner {
        _setMaxMoveBps(bps);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC1155Holder, ERC2981, IERC165)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
