// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {FeeRouter} from "../src/FeeRouter.sol";
import {Letters} from "../src/Letters.sol";
import {Words} from "../src/Words.sol";
import {Rolls} from "../src/Rolls.sol";
import {Staking} from "../src/Staking.sol";
import {Prestige} from "../src/Prestige.sol";
import {AnswerChain} from "../src/AnswerChain.sol";
import {Jackpot} from "../src/Jackpot.sol";
import {YieldDistributor} from "../src/YieldDistributor.sol";
import {Bounty} from "../src/Bounty.sol";
import {ILetters} from "../src/interfaces/ILetters.sol";
import {IWords} from "../src/interfaces/IWords.sol";
import {IStaking} from "../src/interfaces/IStaking.sol";
import {ISwapRouter} from "../src/interfaces/ISwapRouter.sol";
import {IFeeRouter, FeeSource} from "../src/interfaces/IFeeRouter.sol";

/**
 * @title Deploy
 * @notice Deploys and fully wires the Lexigotchi contract suite. The letter caps/weights and the
 *         dictionary Merkle root are read from `config/economy.json` (regenerate with
 *         `npm run derive:contracts`) so the on-chain economy can never drift from the published
 *         Lexidex. Addresses, prices, and care thresholds come from environment variables.
 *
 *         Fee splits are seeded from the v0.2 table (params.ts). The bounty carve and prestige tuning
 *         default OFF/gentle, matching the sim. Ownership stays with the deployer; hand it to the
 *         owner wallet post-deploy (Ownable2Step: transferOwnership → acceptOwnership). No multisig.
 *
 *         Usage:
 *           forge script script/Deploy.s.sol:Deploy --rpc-url $BASE_RPC --broadcast --verify
 *         Required env: WORD_TOKEN, TREASURY, SIGNER, KEEPER, ANSWERCHAIN_HEAD (bytes32 — generate
 *         the chain + head with `npm run answerchain:generate`).
 *         Optional env: SWAP_ROUTER, *_PRICE / *_FEE, PECKISH_AFTER, HUNGRY_AFTER,
 *                       PRESTIGE_MAX_LEVEL, BOUNTY_CARVE_BPS, LETTERS_URI, WORDS_URI, ROYALTY_BPS.
 */
contract Deploy is Script {
    struct Config {
        IERC20 word;
        address treasury;
        address signer;
        address keeper;
        address swapRouter;
        bytes32 answerHead;
        uint256 packPrice;
        uint256 dailyPrice;
        uint256 rollPrice;
        uint256 claimPrice;
        uint256 snackPrice;
        uint256 prestigeFee;
        uint64 peckishAfter;
        uint64 hungryAfter;
        uint8 maxLevel;
        uint16 bountyCarveBps;
        address priceKeeper;
        uint16 maxMoveBps;
        string lettersUri;
        string wordsUri;
        uint96 royaltyBps;
        uint32[26] cap;
        bytes32 dictRoot;
    }

    struct Addrs {
        FeeRouter feeRouter;
        Letters letters;
        Words words;
        Rolls rolls;
        Staking staking;
        Prestige prestige;
        AnswerChain answerChain;
        Jackpot jackpot;
        YieldDistributor yieldDistributor;
        Bounty bounty;
    }

    function run() external returns (Addrs memory a) {
        Config memory c = _config();
        address deployer = msg.sender;

        vm.startBroadcast();

        a.feeRouter = new FeeRouter(c.word, c.treasury, deployer);
        a.letters =
            new Letters(c.word, a.feeRouter, c.cap, c.packPrice, c.dailyPrice, c.signer, c.lettersUri, deployer);
        a.words = new Words(c.word, a.feeRouter, ILetters(address(a.letters)), c.dictRoot, c.claimPrice, deployer);
        a.rolls = new Rolls(c.word, a.feeRouter, ILetters(address(a.letters)), IWords(address(a.words)), c.rollPrice, c.signer);
        a.staking =
            new Staking(c.word, a.feeRouter, IWords(address(a.words)), c.snackPrice, c.peckishAfter, c.hungryAfter, deployer);
        a.prestige = new Prestige(
            c.word, a.feeRouter, IWords(address(a.words)), IStaking(address(a.staking)), c.maxLevel, c.prestigeFee, c.snackPrice, c.signer
        );
        a.answerChain = new AnswerChain(c.answerHead, c.keeper, deployer);
        a.jackpot = new Jackpot(
            a.feeRouter, IWords(address(a.words)), IStaking(address(a.staking)), a.answerChain, c.keeper, deployer
        );
        a.yieldDistributor = new YieldDistributor(c.word, a.feeRouter, c.keeper, deployer);
        a.bounty = new Bounty(c.word, a.feeRouter, c.keeper, deployer);

        _wire(a, c);

        vm.stopBroadcast();
        _log(a);
    }

    function _wire(Addrs memory a, Config memory c) internal {
        a.feeRouter.setCollector(address(a.letters), true);
        a.feeRouter.setCollector(address(a.words), true);
        a.feeRouter.setCollector(address(a.rolls), true);
        a.feeRouter.setCollector(address(a.staking), true);
        a.feeRouter.setCollector(address(a.prestige), true);
        a.feeRouter.setPayers(address(a.yieldDistributor), address(a.jackpot), address(a.bounty));
        if (c.bountyCarveBps > 0) a.feeRouter.setBountyCarveBps(c.bountyCarveBps);
        _setSplits(a.feeRouter);

        a.letters.setUpgrader(address(a.rolls), true); // loose-letter rolls
        a.letters.setUpgrader(address(a.words), true); // escrowed-letter rolls mutate Words' escrow
        if (c.swapRouter != address(0)) a.letters.setSwapRouter(ISwapRouter(c.swapRouter));

        // EIP-2981 royalty SIGNAL (unenforced — open composability): 2.5% default → treasury,
        // per decisions.md "Royalty & marketplace architecture".
        if (c.royaltyBps > 0) {
            a.letters.setDefaultRoyalty(c.treasury, c.royaltyBps);
            a.words.setDefaultRoyalty(c.treasury, c.royaltyBps);
        }
        if (bytes(c.wordsUri).length > 0) a.words.setBaseURI(c.wordsUri);

        a.words.setRolls(address(a.rolls));
        a.words.setPrestige(address(a.prestige));
        a.rolls.setStaking(IStaking(address(a.staking)));

        // Jackpot reveals + resolves atomically, so it is the AnswerChain's keeper. The off-chain
        // operator keeper drives it through Jackpot.resolve (Jackpot's own keeper).
        a.answerChain.setKeeper(address(a.jackpot));

        // Price-keeper repeg band on the 5 price contracts. priceKeeper stays address(0) (auto-repeg
        // disabled) until the owner wires the hot key — a safe freeze default; the keeper is a distinct
        // role from the resolution keeper above.
        a.letters.setMaxMoveBps(c.maxMoveBps);
        a.words.setMaxMoveBps(c.maxMoveBps);
        a.rolls.setMaxMoveBps(c.maxMoveBps);
        a.staking.setMaxMoveBps(c.maxMoveBps);
        a.prestige.setMaxMoveBps(c.maxMoveBps);
        if (c.priceKeeper != address(0)) {
            a.letters.setPriceKeeper(c.priceKeeper);
            a.words.setPriceKeeper(c.priceKeeper);
            a.rolls.setPriceKeeper(c.priceKeeper);
            a.staking.setPriceKeeper(c.priceKeeper);
            a.prestige.setPriceKeeper(c.priceKeeper);
        }
    }

    /// @dev v0.2 fee split table (params.ts splits.*), in basis points (sum 10_000 each).
    function _setSplits(FeeRouter fr) internal {
        fr.setSplit(FeeSource.PACK_MINT, FeeRouter.Split(4000, 1000, 2000, 3000));
        fr.setSplit(FeeSource.DAILY_MINT, FeeRouter.Split(4000, 1000, 2000, 3000));
        fr.setSplit(FeeSource.ROLL, FeeRouter.Split(4750, 1000, 2750, 1500)); // jackpot rake 10% (freed 15pp → burn+pool)
        fr.setSplit(FeeSource.CLAIM, FeeRouter.Split(3250, 1000, 3250, 2500)); // jackpot rake 10% (freed 15pp → burn+pool)
        fr.setSplit(FeeSource.SNACK, FeeRouter.Split(0, 0, 10000, 0)); // snacks 100% burn
        fr.setSplit(FeeSource.PRESTIGE, FeeRouter.Split(4750, 1000, 2750, 1500)); // = roll
        fr.setSplit(FeeSource.ROYALTY, FeeRouter.Split(0, 0, 0, 10000)); // in-house swap fee → treasury
    }

    function _config() internal view returns (Config memory c) {
        c.word = IERC20(vm.envOr("WORD_TOKEN", 0x304e649e69979298BD1AEE63e175ADf07885fb4b));
        c.treasury = vm.envAddress("TREASURY");
        c.signer = vm.envAddress("SIGNER");
        c.keeper = vm.envAddress("KEEPER");
        c.swapRouter = vm.envOr("SWAP_ROUTER", address(0));
        c.answerHead = vm.envBytes32("ANSWERCHAIN_HEAD");

        c.packPrice = vm.envOr("PACK_PRICE", uint256(4_220_000 ether));
        // FREE daily (locked launch decision #1) — the voucher path is canonical and repegPrices
        // skips zero legs, so 0 can never be moved off zero by the keeper. The old 211_000 ether
        // default was the superseded $0.05-daily artifact.
        c.dailyPrice = vm.envOr("DAILY_PRICE", uint256(0));
        c.rollPrice = vm.envOr("ROLL_PRICE", uint256(1_060_000 ether));
        c.claimPrice = vm.envOr("CLAIM_PRICE", uint256(2_110_000 ether));
        c.snackPrice = vm.envOr("SNACK_PRICE", uint256(84_000 ether));
        c.prestigeFee = vm.envOr("PRESTIGE_FEE", c.rollPrice);
        c.peckishAfter = uint64(vm.envOr("PECKISH_AFTER", uint256(1 days)));
        c.hungryAfter = uint64(vm.envOr("HUNGRY_AFTER", uint256(3 days)));
        c.maxLevel = uint8(vm.envOr("PRESTIGE_MAX_LEVEL", uint256(4)));
        c.bountyCarveBps = uint16(vm.envOr("BOUNTY_CARVE_BPS", uint256(0)));
        c.priceKeeper = vm.envOr("PRICE_KEEPER", address(0)); // address(0) = auto-repeg disabled
        c.maxMoveBps = uint16(vm.envOr("MAX_MOVE_BPS", uint256(2000))); // ±20% per repeg
        c.lettersUri = vm.envOr("LETTERS_URI", string(""));
        c.wordsUri = vm.envOr("WORDS_URI", string(""));
        c.royaltyBps = uint96(vm.envOr("ROYALTY_BPS", uint256(250))); // 2.5% EIP-2981 signal; 0 = skip

        (c.cap, c.dictRoot) = _readEconomy();
    }

    function _readEconomy() internal view returns (uint32[26] memory cap, bytes32 dictRoot) {
        string memory json = vm.readFile("config/economy.json");
        dictRoot = vm.parseJsonBytes32(json, ".dictionaryRoot");
        uint256[] memory caps = vm.parseJsonUintArray(json, ".caps");
        require(caps.length == 26, "economy.json: expected 26 letters");
        for (uint256 i = 0; i < 26; i++) {
            cap[i] = uint32(caps[i]);
        }
    }

    function _log(Addrs memory a) internal pure {
        console2.log("FeeRouter        ", address(a.feeRouter));
        console2.log("Letters          ", address(a.letters));
        console2.log("Words            ", address(a.words));
        console2.log("Rolls            ", address(a.rolls));
        console2.log("Staking          ", address(a.staking));
        console2.log("Prestige         ", address(a.prestige));
        console2.log("AnswerChain      ", address(a.answerChain));
        console2.log("Jackpot          ", address(a.jackpot));
        console2.log("YieldDistributor ", address(a.yieldDistributor));
        console2.log("Bounty           ", address(a.bounty));
    }
}
