// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
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
 *         Claiming escrows five letters, each in the case the claimer names (verified ERC-1155
 *         transfers), for a word proven to be in the canonical dictionary via a Merkle proof. A word
 *         may start in any mix of cases (decisions.md, "Mixed-case claims"). Upgrade rolls mutate the
 *         escrow in place (`applyUpgrade`, called by Rolls). Dissolution burns the Word, returns its
 *         five letters in their current case, and frees the name for re-claim (v0.1 §5.4).
 *
 *         RESERVED SETS AND THE FIRST-DAY GATE (decisions.md, "Reserved word sets"). A word is held
 *         back from the game by being left out of `dictionaryRoot`, and released by a root that
 *         includes it. For a time after its release a word may be GATED (`gatedUntil`): claiming it
 *         then also needs a voucher signed by `claimSigner` for the caller and that word, so the
 *         backend can limit how many words of a new set one player takes on its first day (it counts
 *         per profile; this contract can't know a profile). Once the gate's time passes, anyone
 *         claims the word exactly as before. A word that is not gated is not touched by any of this.
 *
 *         Trust in the gate: the owner sets gates (each at most `MAX_GATE` ahead, never on a word
 *         somebody holds) and names the claim signer; the signer decides who gets a voucher. Neither
 *         is a new power over unclaimed words: the owner already decides which words `dictionaryRoot`
 *         admits at all. The gate can't touch a claimed Word, its letters, or anybody's $WORD.
 *
 *         THE CLAIM FEE BY RARITY (decisions.md #60, "gentle ladder"). Each dictionary leaf names
 *         the word AND its rarity tier: leaf = (word, tier), so a claim states the tier and the proof
 *         checks it; a claimer can't understate it. The fee is `claimPrice` (the base: Common's
 *         price, still moved by the price keeper) times the tier's multiplier, in basis points of
 *         the base (`tierMultiplierBps`, owner-set within `MIN_TIER_MULTIPLIER`..`MAX_TIER_MULTIPLIER`;
 *         the deploy passes 1x, 2x, 3x, 5x, 8x, the tiers' earning weights). The tier never touches
 *         the token id, which stays the word's own hash. Tier numbers follow the game's TIERS:
 *         0 Common, 1 Uncommon, 2 Rare, 3 Legendary, 4 Mythic. The root is built off chain by the
 *         same function the game ranks a word by (a collab set's words are Legendary from its
 *         reveal), so the tier a claim pays for is the tier the game shows.
 */
contract Words is IWords, ERC721, ERC1155Holder, ERC2981, Ownable2Step, ReentrancyGuard, FeeCollector, RepegKeeper {
    uint8 internal constant FULL_MASK = 0x1F; // all five positions raised

    /// @notice The furthest ahead of now a gate may end. A gate is a first-day limit on a newly
    ///         released word; the cap bounds what one mistaken (or hostile) `setGate` can do.
    uint64 public constant MAX_GATE = 7 days;

    /// @dev Bound into the gated-claim digest, so nothing else this signer signs can pass for one
    ///      (the same key signs Letters, Rolls, Staking and Prestige vouchers; each of those digests
    ///      also names its own contract's address, as this one names this contract's).
    bytes32 private constant GATED_CLAIM_KIND = keccak256("lexigotchi.words.gatedClaim");

    /// @notice How many rarity tiers a leaf may name (0 Common .. 4 Mythic).
    uint8 public constant TIER_COUNT = 5;
    /// @notice 1x, in the basis points `tierMultiplierBps` is written in.
    uint32 public constant MULTIPLIER_ONE = 10_000;
    /// @notice The lowest a tier's multiplier may be: the base itself. No tier claims for less than
    ///         Common's price, so `claimPrice` stays the floor of the ladder.
    uint32 public constant MIN_TIER_MULTIPLIER = MULTIPLIER_ONE;
    /// @notice The highest a tier's multiplier may be: 20x the base. The ladder's top is 8x; the cap
    ///         bounds what one mistaken (or hostile) `setTierMultiplier` can charge.
    uint32 public constant MAX_TIER_MULTIPLIER = 20 * MULTIPLIER_ONE;

    struct Escrow {
        uint8[5] letters; // alphabet indices (0..25)
        uint8 upperMask; // bit k set ⇒ position k is uppercase
        bool exists;
        uint64 claimedAt; // when THIS claim happened; a re-claim after dissolve is a new Word (Staking)
    }

    ILetters public immutable letters;
    bytes32 public dictionaryRoot; // Merkle root over the canonical dictionary (config/economy.json); owner-updatable via setDictionaryRoot
    uint256 public claimPrice; // $WORD: the BASE claim fee (Common's); a claim pays claimFee(tier)
    /// @notice Each tier's claim fee as a multiple of `claimPrice`, in basis points (10,000 = 1x).
    uint32[5] public tierMultiplierBps;
    string internal baseTokenURI; // tokenURI = baseTokenURI + decimal tokenId (metadata is dynamic: case lives in escrow)

    mapping(uint256 tokenId => Escrow) internal escrows;
    mapping(uint256 tokenId => uint8) public prestigeLevel;

    address public rolls; // may call applyUpgrade
    address public prestige; // may call bumpPrestige

    /// @notice The backend key that vouches for a claim of a gated word (see `claim` with a voucher).
    address public claimSigner;
    /// @notice While `block.timestamp < gatedUntil[tokenId]`, claiming that word needs a voucher.
    ///         0 (the default, and every word that was never in a gated release) means "not gated".
    mapping(uint256 tokenId => uint64) public gatedUntil;

    /// @dev `upperMask` is the case the word was claimed in: bit k set ⇒ position k is uppercase.
    event Claimed(uint256 indexed tokenId, address indexed owner, string word, uint8 upperMask);
    event Dissolved(uint256 indexed tokenId, address indexed owner, string word);
    event Upgraded(uint256 indexed tokenId, uint8 pos, uint8 letterIndex);
    event PrestigeBumped(uint256 indexed tokenId, uint8 newLevel);
    event DictionaryRootSet(bytes32 root);
    event ClaimPriceSet(uint256 price);
    /// @dev Emitted for every tier at deploy, then on each change.
    event TierMultiplierSet(uint8 indexed tier, uint32 bps);
    /// @dev Emitted with every `Claimed`: the tier the proof confirmed and the $WORD the claimer paid.
    ///      A new event rather than new fields on `Claimed`, so every reader of `Claimed` keeps working.
    event ClaimFeePaid(uint256 indexed tokenId, address indexed payer, uint8 tier, uint256 fee);
    event BaseURISet(string uri);
    event RoyaltySet(address receiver, uint96 bps);
    event RollsSet(address rolls);
    event PrestigeSet(address prestige);
    /// @dev One event per `setGate` call: every listed word is gated until `until` (a past time
    ///      or 0 lifts the gate).
    event Gated(uint256[] tokenIds, uint64 until);
    event ClaimSignerSet(address signer);

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
    error BadCaseMask();
    error GateTooLong();
    error VoucherRequired();
    error VoucherExpired();
    error BadSignature();
    error BadTier();
    error BadMultiplier();

    constructor(
        IERC20 _word,
        IFeeRouter _feeRouter,
        ILetters _letters,
        bytes32 _dictionaryRoot,
        uint256 _claimPrice,
        uint32[5] memory _tierMultiplierBps,
        address _claimSigner,
        address initialOwner
    ) ERC721("Lexigotchi Word", "WORD-NFT") Ownable(initialOwner) FeeCollector(_word, _feeRouter) {
        // Set at deploy, as Staking's signer is: a gate set while no signer exists would close its
        // words to everyone until the owner noticed.
        if (_claimSigner == address(0)) revert ZeroAddress();
        letters = _letters;
        dictionaryRoot = _dictionaryRoot;
        claimPrice = _claimPrice;
        claimSigner = _claimSigner;
        for (uint8 t = 0; t < TIER_COUNT; t++) {
            _setTierMultiplier(t, _tierMultiplierBps[t]);
        }
    }

    // --- claim / dissolve -------------------------------------------------------------------------

    /// @notice Claim `word` by escrowing its five letters, each in the case `upperMask` names, and
    ///         paying `claimFee(tier)`.
    /// @param tier The word's rarity tier, as its dictionary leaf names it (0 Common .. 4 Mythic). The
    ///        proof is of the leaf (word, tier), so any other tier fails it (`NotInDictionary`).
    /// @param upperMask Bit k set ⇒ the letter at position k is escrowed uppercase (ERC-1155 id
    ///        `letter + 26`), else lowercase (id `letter`). 0 is all lowercase, 0x1F all UPPERCASE,
    ///        and anything between starts the word Mixed. Any mix is allowed (starl3xx, 2026-11-24,
    ///        replacing v0.1's "uniform case only"); the case stays derived from the escrow, so a
    ///        Mixed word is jackpot-eligible when staked and earns yield only once fully raised.
    /// @dev   Reverts `VoucherRequired` while the word is gated: use the overload below with the
    ///        backend's voucher. For every word that isn't gated this is the claim it always was.
    function claim(string calldata word_, uint8 tier, uint8 upperMask, bytes32[] calldata proof)
        external
        nonReentrant
        returns (uint256 tokenId)
    {
        tokenId = _checkClaim(word_, tier, upperMask, proof);
        if (block.timestamp < gatedUntil[tokenId]) revert VoucherRequired();
        _finishClaim(tokenId, word_, tier, upperMask);
    }

    /// @notice Claim `word` with a voucher: the way to claim a word while it is gated (the first
    ///         day after its set's release). The same claim as above in every other respect.
    /// @param deadline The voucher's last valid second.
    /// @param sig `claimSigner`'s signature over (this contract, this chain, the gated-claim kind,
    ///        the caller, the word's tokenId, `deadline`).
    /// @dev   The voucher is checked ONLY while the word is gated. Once the gate has lifted (or for
    ///        a word that was never gated) `deadline` and `sig` are ignored, so a claim sent with a
    ///        voucher just as the gate lifts doesn't fail for it.
    ///
    ///        A voucher names the CALLER, so one read out of the mempool is useless to anyone else,
    ///        and it names the WORD, so it claims no other. It carries no nonce on purpose: used
    ///        twice it can only be the same wallet claiming the same word again after dissolving it,
    ///        which takes nothing from anyone (how many DIFFERENT words a player gets is the
    ///        backend's count, per profile, and it signs one word's voucher at a time).
    ///
    ///        The voucher doesn't name the tier: the proof already fixes it, and the fee is the
    ///        tier's like any other claim's.
    function claim(
        string calldata word_,
        uint8 tier,
        uint8 upperMask,
        bytes32[] calldata proof,
        uint256 deadline,
        bytes calldata sig
    ) external nonReentrant returns (uint256 tokenId) {
        tokenId = _checkClaim(word_, tier, upperMask, proof);
        if (block.timestamp < gatedUntil[tokenId]) {
            if (block.timestamp > deadline) revert VoucherExpired();
            bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
                keccak256(abi.encode(address(this), block.chainid, GATED_CLAIM_KIND, msg.sender, tokenId, deadline))
            );
            if (ECDSA.recover(digest, sig) != claimSigner) revert BadSignature();
        }
        _finishClaim(tokenId, word_, tier, upperMask);
    }

    /// @dev The checks every claim makes first, in the order they were always made: the word's
    ///      length, the case mask (and now the tier's range), the dictionary proof, and that nobody
    ///      holds the word.
    function _checkClaim(string calldata word_, uint8 tier, uint8 upperMask, bytes32[] calldata proof)
        internal
        view
        returns (uint256 tokenId)
    {
        bytes memory b = bytes(word_);
        if (b.length != 5) revert WrongLength();
        if (upperMask > FULL_MASK) revert BadCaseMask(); // only five positions
        if (tier >= TIER_COUNT) revert BadTier();
        // tokenId is the word's own hash (v0.2 §2): the tier is never part of it. The dictionary
        // leaf is the OZ StandardMerkleTree double-hash of abi.encode(word, tier), leaf types
        // ["string", "uint8"], so off-chain proofs from @openzeppelin/merkle-tree verify.
        tokenId = uint256(keccak256(b));
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(word_, tier))));
        if (!MerkleProof.verify(proof, dictionaryRoot, leaf)) revert NotInDictionary();
        if (escrows[tokenId].exists) revert AlreadyClaimed();
    }

    /// @dev The claim itself, once it is allowed: escrow the five letters, take the tier's fee, mint.
    function _finishClaim(uint256 tokenId, string calldata word_, uint8 tier, uint8 upperMask) internal {
        bytes memory b = bytes(word_);
        uint8[5] memory idx;
        uint256[] memory ids = new uint256[](5);
        uint256[] memory amounts = new uint256[](5);
        for (uint256 k = 0; k < 5; k++) {
            uint256 c = uint256(uint8(b[k]));
            if (c < 65 || c > 90) revert NotAWord(); // 'A'..'Z'
            uint8 li = uint8(c - 65);
            idx[k] = li;
            ids[k] = (upperMask >> k) & 1 == 1 ? uint256(li) + 26 : uint256(li);
            amounts[k] = 1;
        }

        // Escrow the five letters (reverts if the claimer doesn't own each one in its chosen case).
        letters.safeBatchTransferFrom(msg.sender, address(this), ids, amounts, "");
        uint256 fee = claimFee(tier);
        _collect(msg.sender, fee, FeeSource.CLAIM);

        escrows[tokenId] = Escrow({letters: idx, upperMask: upperMask, exists: true, claimedAt: uint64(block.timestamp)});
        _safeMint(msg.sender, tokenId);
        emit Claimed(tokenId, msg.sender, word_, upperMask);
        emit ClaimFeePaid(tokenId, msg.sender, tier, fee);
    }

    /// @notice What claiming a word of `tier` costs now: the base `claimPrice` times the tier's
    ///         multiplier. Moves with both (the price keeper's repeg of the base scales every tier).
    function claimFee(uint8 tier) public view returns (uint256) {
        if (tier >= TIER_COUNT) revert BadTier();
        return claimPrice * tierMultiplierBps[tier] / MULTIPLIER_ONE;
    }

    /// @inheritdoc IWords
    function claimedAt(uint256 tokenId) external view returns (uint64) {
        return escrows[tokenId].claimedAt;
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

    /// @notice ERC-4906: tells metadata cachers (marketplaces, indexers) that `tokenId`'s
    ///         appearance changed. Words are DYNAMIC — letters get raised to UPPERCASE and the
    ///         gild deepens with prestige — and without this event a raised word keeps its stale
    ///         lowercase render everywhere tokenURI was cached. (Jake, 2026-08-13.)
    event MetadataUpdate(uint256 _tokenId);

    /// @notice ERC-4906's other event: every token from `_fromTokenId` to `_toTokenId` changed.
    ///         Word ids are hashes, never a run of numbers, so this is only ever "all of them".
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);

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
        emit MetadataUpdate(tokenId); // ERC-4906 — the word looks different now
    }

    /// @inheritdoc IWords
    function bumpPrestige(uint256 tokenId) external {
        if (msg.sender != prestige) revert NotPrestige();
        if (!escrows[tokenId].exists) revert NoSuchToken();
        uint8 lvl = prestigeLevel[tokenId] + 1;
        prestigeLevel[tokenId] = lvl;
        emit PrestigeBumped(tokenId, lvl);
        emit MetadataUpdate(tokenId); // ERC-4906 — gilding deepened
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

    /// @notice Gate `tokenIds` until `until`: while it is earlier than that, claiming one of them
    ///         needs a voucher (see `claim`). Sent BEFORE the `setDictionaryRoot` that releases the
    ///         words, so there is no moment when one is claimable without its gate.
    /// @param until The gate's end, at most `MAX_GATE` from now. A time that has passed (or 0)
    ///        lifts the gate on the listed words.
    /// @dev   Never a word somebody holds (`AlreadyClaimed`): a gate is for a word nobody has yet,
    ///        and a claimed Word must not be touched by this. The cap bounds one call; the owner can
    ///        call again, as it can also remove any unclaimed word from `dictionaryRoot`, so the gate
    ///        adds no power over unclaimed words that the root didn't already give.
    function setGate(uint256[] calldata tokenIds, uint64 until) external onlyOwner {
        if (until > block.timestamp + MAX_GATE) revert GateTooLong();
        for (uint256 i = 0; i < tokenIds.length; i++) {
            if (escrows[tokenIds[i]].exists) revert AlreadyClaimed();
            gatedUntil[tokenIds[i]] = until;
        }
        emit Gated(tokenIds, until);
    }

    function setClaimSigner(address signer_) external onlyOwner {
        if (signer_ == address(0)) revert ZeroAddress();
        claimSigner = signer_;
        emit ClaimSignerSet(signer_);
    }

    function setClaimPrice(uint256 price) external onlyOwner {
        claimPrice = price;
        emit ClaimPriceSet(price);
    }

    /// @notice Set one tier's claim fee multiple, in basis points of `claimPrice` (10,000 = 1x).
    /// @dev    Bounded to `MIN_TIER_MULTIPLIER`..`MAX_TIER_MULTIPLIER`. The ladder's order isn't
    ///         enforced: the owner may price tiers in any order, as it may set the base to anything.
    function setTierMultiplier(uint8 tier, uint32 bps) external onlyOwner {
        _setTierMultiplier(tier, bps);
    }

    function _setTierMultiplier(uint8 tier, uint32 bps) internal {
        if (tier >= TIER_COUNT) revert BadTier();
        if (bps < MIN_TIER_MULTIPLIER || bps > MAX_TIER_MULTIPLIER) revert BadMultiplier();
        tierMultiplierBps[tier] = bps;
        emit TierMultiplierSet(tier, bps);
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

    /// @notice Tell metadata cachers (ERC-4906) to read these words again, for a change the chain
    ///         can't see. A word's card is drawn off chain, and what the metadata server says of
    ///         a word can change with no transaction here: a set made with a partner gives its
    ///         words their own look and a trait (decisions.md "Collab sets"; the owner, 2026-11-27:
    ///         "Metadata refresh function"). `applyUpgrade` and `setPrestige` already emit this
    ///         for what the chain does see.
    /// @dev    Emits and nothing else: no storage is read or written and no token is touched. A
    ///         token id nobody holds is harmless to name (there is nothing cached to refresh).
    ///         Owner-only so the event stays a signal worth acting on, never spam anyone can
    ///         send. It is here before it is needed because Words can't change after deploy.
    function refreshMetadata(uint256[] calldata tokenIds) external onlyOwner {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            emit MetadataUpdate(tokenIds[i]);
        }
    }

    /// @notice The same for every word at once (a new metadata server, a new base URI's
    ///         contents, a change to how every card is drawn). Emits and nothing else.
    function refreshAllMetadata() external onlyOwner {
        emit BatchMetadataUpdate(0, type(uint256).max);
    }

    /// @notice EIP-2981 royalty — a SIGNAL only (decisions.md "Royalty & marketplace architecture"):
    ///         open composability, no on-chain enforcement; honoring marketplaces pay the treasury.
    function setDefaultRoyalty(address receiver, uint96 bps) external onlyOwner {
        _setDefaultRoyalty(receiver, bps);
        emit RoyaltySet(receiver, bps);
    }

    // --- repeg (price keeper) ---------------------------------------------------------------------

    /// @notice Keeper-driven clamped repeg of the BASE claim price. Every tier's fee is a multiple of
    ///         it, so one repeg moves the whole ladder by the same fraction.
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
        // 0x49064906 = ERC-4906 (metadata update events) — cachers probe this before subscribing.
        return interfaceId == bytes4(0x49064906) || super.supportsInterface(interfaceId);
    }
}
