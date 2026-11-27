/**
 * The Lexigotchi contract operator surface — a typed registry of every constructor, owner-only
 * setter, and keeper/operator duty across the 10-contract suite. This is the single source of
 * truth the admin dashboard renders into transaction builders (Parameters, Keeper, Access tabs)
 * and the deploy walkthrough (Launch tab).
 *
 * Signatures + argument types are mirrored exactly from `contracts/src/*.sol` so the emitted
 * `cast` commands and Safe batches encode correctly. Prefilled defaults track the v0.2 spec
 * (params.ts / Deploy.s.sol); $WORD-denominated prices are computed at the current peg.
 */
import { DEFAULT_PARAMS } from "@/lib/params";
import { usdToWordWei } from "./format";
import type { ContractKey } from "./deployments";

export type SolType =
  | "address"
  | "uint256"
  | "uint256[]" // written "[1,2,3]" (lib/admin/tx.ts): Words.setGate's token ids
  | "uint96"
  | "uint128"
  | "uint64"
  | "uint32"
  | "uint16"
  | "uint8"
  | "bytes32"
  | "bool"
  | "string"
  | "uint32[26]"
  | "(uint16,uint16,uint16,uint16)";

export interface FnArg {
  name: string;
  type: SolType;
  help?: string;
  default?: string;
  /** For tuple types: the named components, for Safe Transaction Builder JSON. */
  components?: { name: string; type: string }[];
}

export type FnKind = "owner" | "keeper" | "signer" | "lifecycle";

export interface ContractFn {
  fn: string;
  /** Canonical signature for `cast` + selector, e.g. "setClaimPrice(uint256)". */
  signature: string;
  title: string;
  desc: string;
  kind: FnKind;
  group: string;
  args: FnArg[];
  /** Sensitive action → require type-to-confirm in the UI. */
  danger?: boolean;
}

export interface ContractDef {
  key: ContractKey;
  name: string;
  order: number;
  purpose: string;
  /** Constructor arg list (for the Launch walkthrough). */
  ctor: FnArg[];
  fns: ContractFn[];
}

const P = DEFAULT_PARAMS.prices;

/** $WORD-wei defaults at the current peg (the operator re-pegs as $WORD moves). */
const WEI = {
  pack: usdToWordWei(P.pack),
  daily: usdToWordWei(P.dailyMint),
  roll: usdToWordWei(P.roll),
  claim: usdToWordWei(P.claim),
  snack: usdToWordWei(P.snack),
  /** The BASE ascension fee (Gilded 1); Prestige.sol charges a stage-N attempt N × this. */
  prestige: usdToWordWei(DEFAULT_PARAMS.prestige.commitFeeUsd),
};

const DAY = 86_400;

// --- fee sources (FeeRouter splits) -------------------------------------------------------------

export interface FeeSourceDef {
  id: number;
  key: string;
  label: string;
  /** Default split, bps [pool, jackpot, burn, treasury] — derived from params.ts `splits`. */
  bps: [number, number, number, number];
  note: string;
}

/** A params.ts split as FeeRouter basis points, so the console's defaults can't drift from the economy. */
const bpsOf = (s: { pool: number; jackpot: number; burn: number; treasury: number }): FeeSourceDef["bps"] => [
  Math.round(s.pool * 10_000),
  Math.round(s.jackpot * 10_000),
  Math.round(s.burn * 10_000),
  Math.round(s.treasury * 10_000),
];
const SPLITS = DEFAULT_PARAMS.splits;

export const FEE_SOURCES: FeeSourceDef[] = [
  { id: 0, key: "PACK_MINT", label: "Pack mint", bps: bpsOf(SPLITS.packMint), note: "pack of 5 letters" },
  { id: 1, key: "DAILY_MINT", label: "Daily mint", bps: bpsOf(SPLITS.dailyMint), note: "FID-gated daily single" },
  { id: 2, key: "ROLL", label: "Roll", bps: bpsOf(SPLITS.roll), note: "upgrade roll fee" },
  { id: 3, key: "CLAIM", label: "Claim", bps: bpsOf(SPLITS.claim), note: "claim a word" },
  { id: 4, key: "SNACK", label: "Snack", bps: bpsOf(SPLITS.snack), note: "100% burn" },
  { id: 5, key: "PRESTIGE", label: "Prestige", bps: bpsOf(SPLITS.prestige ?? SPLITS.roll), note: "ascension attempt fee" },
  { id: 6, key: "ROYALTY", label: "Word sale fee", bps: bpsOf(SPLITS.royalty), note: "10% of a word sale (SaleFees) → Rewards Pool (decisions.md #18)" },
];

/** The three FeeRouter buckets the operator can seed (jackpot deliberately excluded — see Treasury tab). */
export const SEED_BUCKETS = [
  { id: 0, key: "pool", label: "Rewards Pool", desc: "funds UPPERCASE staking yield" },
  { id: 2, key: "bounty", label: "Bounty Pool", desc: "funds the weekly theme bounty" },
] as const;

// --- shared lifecycle (Ownable2Step) ------------------------------------------------------------

function ownable(): ContractFn[] {
  return [
    {
      fn: "transferOwnership",
      signature: "transferOwnership(address)",
      title: "Transfer ownership",
      desc: "Begin handing this contract to a new owner (the owner hardware wallet). Two-step: the new owner must then call acceptOwnership.",
      kind: "lifecycle",
      group: "Ownership",
      danger: true,
      args: [{ name: "newOwner", type: "address", help: "the owner wallet (a hardware wallet) that will own this contract" }],
    },
    {
      fn: "acceptOwnership",
      signature: "acceptOwnership()",
      title: "Accept ownership",
      desc: "Called BY the pending new owner (the owner wallet) to complete the two-step transfer.",
      kind: "lifecycle",
      group: "Ownership",
      danger: true,
      args: [],
    },
  ];
}

// --- shared price-keeper config (identical across the 5 price contracts) ------------------------

function priceKeeperRoles(): ContractFn[] {
  return [
    {
      fn: "setPriceKeeper",
      signature: "setPriceKeeper(address)",
      title: "Set price keeper",
      desc: "Wire (or clear) the dedicated price-keeper hot key allowed to auto-repeg prices within the band. address(0) disables auto-repeg (the freeze default). Distinct from the resolution keeper.",
      kind: "owner",
      group: "Repeg",
      danger: true,
      args: [{ name: "keeper", type: "address", help: "price-keeper hot key (0x0 = disabled)" }],
    },
    {
      fn: "setMaxMoveBps",
      signature: "setMaxMoveBps(uint16)",
      title: "Set repeg band",
      desc: "Max per-call price move the price keeper may make, in basis points (2000 = ±20%). The keeper can't widen its own band.",
      kind: "owner",
      group: "Repeg",
      args: [{ name: "bps", type: "uint16", help: "± basis points per repeg", default: "2000" }],
    },
  ];
}

// --- the registry -------------------------------------------------------------------------------

export const CONTRACTS: ContractDef[] = [
  {
    key: "feeRouter",
    name: "FeeRouter",
    order: 1,
    purpose: "The economic hub — splits every $WORD fee into Pool / Jackpot / Burn / Treasury, solvency-capped.",
    ctor: [
      { name: "word", type: "address", help: "$WORD ERC-20", default: "0x304e649e69979298bd1aee63e175adf07885fb4b" },
      { name: "treasury", type: "address", help: "treasury (the owner wallet)" },
      { name: "initialOwner", type: "address", help: "deployer (hand to the owner wallet after)" },
    ],
    fns: [
      {
        fn: "seed",
        signature: "seed(uint8,uint256)",
        title: "Seed a reward pool",
        desc: "Pull $WORD from your wallet and credit the Pool or Bounty bucket directly (requires a prior $WORD approve). Jackpot is intentionally not seedable — it self-funds from fees.",
        kind: "owner",
        group: "Funding",
        args: [
          { name: "bucket", type: "uint8", help: "0 = Pool, 2 = Bounty", default: "0" },
          { name: "amount", type: "uint256", help: "$WORD amount in wei" },
        ],
      },
      {
        fn: "setSplit",
        signature: "setSplit(uint8,(uint16,uint16,uint16,uint16))",
        title: "Set fee split",
        desc: "Set the [pool, jackpot, burn, treasury] bps for a fee source. Must sum to 10000.",
        kind: "owner",
        group: "Economics",
        args: [
          { name: "source", type: "uint8", help: "fee source id (0–6)" },
          {
            name: "split",
            type: "(uint16,uint16,uint16,uint16)",
            help: "pool, jackpot, burn, treasury (bps, sum 10000)",
            components: [
              { name: "pool", type: "uint16" },
              { name: "jackpot", type: "uint16" },
              { name: "burn", type: "uint16" },
              { name: "treasury", type: "uint16" },
            ],
          },
        ],
      },
      {
        fn: "setBountyCarveBps",
        signature: "setBountyCarveBps(uint16)",
        title: "Set bounty carve",
        desc: "Fraction of the pool share diverted to the bounty bucket (0 = bounty off). Enables the renewable late-game loop.",
        kind: "owner",
        group: "Economics",
        args: [{ name: "bps", type: "uint16", help: "0–10000 (e.g. 1500 = 15%)", default: "0" }],
      },
      {
        fn: "setTreasury",
        signature: "setTreasury(address)",
        title: "Set treasury",
        desc: "Update the treasury address (the owner wallet) that receives treasury-share fees.",
        kind: "owner",
        group: "Roles",
        danger: true,
        args: [{ name: "treasury", type: "address" }],
      },
      {
        fn: "setCollector",
        signature: "setCollector(address,bool)",
        title: "Set collector",
        desc: "Whitelist (or revoke) a game contract allowed to call route(). Set during deploy wiring.",
        kind: "owner",
        group: "Wiring",
        danger: true,
        args: [
          { name: "collector", type: "address" },
          { name: "allowed", type: "bool", default: "true" },
        ],
      },
      {
        fn: "setPayers",
        signature: "setPayers(address,address,address)",
        title: "Set payers",
        desc: "Set the YieldDistributor / Jackpot / Bounty payout contracts. Set during deploy wiring.",
        kind: "owner",
        group: "Wiring",
        danger: true,
        args: [
          { name: "poolPayer", type: "address", help: "YieldDistributor" },
          { name: "jackpotPayer", type: "address", help: "Jackpot" },
          { name: "bountyPayer", type: "address", help: "Bounty" },
        ],
      },
      ...ownable(),
    ],
  },
  {
    key: "letters",
    name: "Letters",
    order: 2,
    purpose: "ERC-1155 letters (52 ids). 100%-lowercase commit→signed-reveal mints; upgrades via Rolls/Words.",
    ctor: [
      { name: "word", type: "address", help: "$WORD" },
      { name: "feeRouter", type: "address" },
      { name: "cap", type: "uint32[26]", help: "per-letter caps (from economy.json)" },
      { name: "packPrice", type: "uint256", default: WEI.pack },
      { name: "dailyPrice", type: "uint256", default: WEI.daily },
      { name: "signer", type: "address", help: "backend draw signer" },
      { name: "uri", type: "string", default: "" },
      { name: "initialOwner", type: "address" },
    ],
    fns: [
      {
        fn: "setPrices",
        signature: "setPrices(uint256,uint256)",
        title: "Set mint prices",
        desc: "Re-peg the pack and daily-single $WORD prices as $WORD moves (USD targets: pack $1.00, daily free — the daily single is free, FID-gated).",
        kind: "owner",
        group: "Pricing",
        args: [
          { name: "packPrice", type: "uint256", help: "$WORD wei — pack of 5", default: WEI.pack },
          { name: "dailyPrice", type: "uint256", help: "$WORD wei — daily single", default: WEI.daily },
        ],
      },
      {
        fn: "setSigner",
        signature: "setSigner(address)",
        title: "Set draw signer",
        desc: "Rotate the backend key that signs letter-draw reveals. Rotating to a dead key halts new reveals (an emergency lever).",
        kind: "owner",
        group: "Roles",
        danger: true,
        args: [{ name: "signer", type: "address" }],
      },
      {
        fn: "setSwapRouter",
        signature: "setSwapRouter(address)",
        title: "Set swap router",
        desc: "Set the ETH→$WORD auto-swap adapter used by the ETH mint paths.",
        kind: "owner",
        group: "Wiring",
        args: [{ name: "swapRouter", type: "address" }],
      },
      {
        fn: "setUpgrader",
        signature: "setUpgrader(address,bool)",
        title: "Set upgrader",
        desc: "Whitelist Rolls and Words to call upgrade(). Set during deploy wiring.",
        kind: "owner",
        group: "Wiring",
        danger: true,
        args: [
          { name: "upgrader", type: "address" },
          { name: "allowed", type: "bool", default: "true" },
        ],
      },
      {
        fn: "setURI",
        signature: "setURI(string)",
        title: "Set metadata URI",
        desc: "Update the ERC-1155 metadata URI.",
        kind: "owner",
        group: "Metadata",
        args: [{ name: "newuri", type: "string" }],
      },
      {
        fn: "setDefaultRoyalty",
        signature: "setDefaultRoyalty(address,uint96)",
        title: "Set royalty signal",
        desc: "EIP-2981 royalty SIGNAL (unenforced — open composability). Deploy default: 2.5% to the treasury.",
        kind: "owner",
        group: "Metadata",
        args: [
          { name: "receiver", type: "address", help: "usually the treasury" },
          { name: "bps", type: "uint96", default: "250", help: "basis points of the sale price (250 = 2.5%)" },
        ],
      },
      {
        fn: "repegPrices",
        signature: "repegPrices(uint256,uint256)",
        title: "Repeg prices (keeper)",
        desc: "Price-keeper auto-repeg of the pack + daily prices, each clamped to ±maxMoveBps; a zero/unchanged leg is skipped (so the free daily can't be moved off zero).",
        kind: "keeper",
        group: "Repeg",
        args: [
          { name: "packPrice", type: "uint256", help: "$WORD wei — pack of 5", default: WEI.pack },
          { name: "dailyPrice", type: "uint256", help: "$WORD wei — daily (0 = stays free)", default: WEI.daily },
        ],
      },
      {
        fn: "setFreePackOpen",
        signature: "setFreePackOpen(bool)",
        title: "Free-pack campaign",
        desc: "Open or close the one-time free-pack airdrop (claim-on-first-open). Close it after the campaign window.",
        kind: "owner",
        group: "Campaign",
        args: [{ name: "open", type: "bool", default: "true" }],
      },
      ...priceKeeperRoles(),
      ...ownable(),
    ],
  },
  {
    key: "words",
    name: "Words",
    order: 3,
    purpose: "One ERC-721 per dictionary word, escrowing 5 letters. tokenId = keccak256(word).",
    ctor: [
      { name: "word", type: "address" },
      { name: "feeRouter", type: "address" },
      { name: "letters", type: "address" },
      { name: "dictionaryRoot", type: "bytes32", help: "Merkle root from economy.json, or the RESERVE root when words are held back in sets (Sets tab; Deploy env DICTIONARY_ROOT)" },
      { name: "claimPrice", type: "uint256", default: WEI.claim },
      { name: "claimSigner", type: "address", help: "the backend signer (Deploy env SIGNER): vouches for first-day claims of a newly released set" },
      { name: "initialOwner", type: "address" },
    ],
    fns: [
      {
        fn: "setClaimPrice",
        signature: "setClaimPrice(uint256)",
        title: "Set claim price",
        desc: "Re-peg the $WORD price to claim a word (USD target: $0.50).",
        kind: "owner",
        group: "Pricing",
        args: [{ name: "price", type: "uint256", help: "$WORD wei", default: WEI.claim }],
      },
      {
        fn: "setDictionaryRoot",
        signature: "setDictionaryRoot(bytes32)",
        title: "Set dictionary root",
        desc: "Update the dictionary Merkle root. Use the Sets tab's builders, never a root typed here: with words held back in sets, the right root is the reserve root (it also follows a re-vendor), and a release sets its gate first.",
        kind: "owner",
        group: "Dictionary",
        danger: true,
        args: [
          { name: "root", type: "bytes32", default: "0x0d48916cd7b9f350667ee831da1e50506571843845327ab7977ba563761866c8" },
        ],
      },
      {
        fn: "setGate",
        signature: "setGate(uint256[],uint64)",
        title: "Set the first-day gate",
        desc: "Gate words until a time (at most 7 days ahead; never a word somebody holds): claiming one then needs the backend's voucher. Built by the Sets tab's release, BEFORE the root. Only on a Words deployed with the gate; a past time or 0 lifts it.",
        kind: "owner",
        group: "Dictionary",
        danger: true,
        args: [
          { name: "tokenIds", type: "uint256[]", help: "[id,id,…]: each word's token id (keccak256 of the word)" },
          { name: "until", type: "uint64", help: "unix seconds" },
        ],
      },
      {
        fn: "setClaimSigner",
        signature: "setClaimSigner(address)",
        title: "Set claim signer",
        desc: "Rotate the backend key that signs first-day claim vouchers (keep it the same key as Letters, Rolls, Staking, and Prestige). Rotating to a dead key closes gated words to everyone until their gate lifts. Only on a Words deployed with the gate.",
        kind: "owner",
        group: "Roles",
        danger: true,
        args: [{ name: "signer_", type: "address" }],
      },
      {
        fn: "setBaseURI",
        signature: "setBaseURI(string)",
        title: "Set base token URI",
        desc: "tokenURI = base + decimal tokenId; the metadata server maps the id to its word and renders case from the live escrow. Deploy env: WORDS_URI.",
        kind: "owner",
        group: "Metadata",
        args: [{ name: "uri", type: "string", help: "e.g. https://lexigotchi.fun/api/word/" }],
      },
      {
        fn: "refreshMetadata",
        signature: "refreshMetadata(uint256[])",
        title: "Refresh words’ metadata",
        desc: "Tell marketplaces and indexers (ERC-4906) to read these words again, for a change the chain can’t see: a card’s look, or what the metadata server says of a word. It only emits events; nothing is stored and no token moves. Only on a Words deployed with it.",
        kind: "owner",
        group: "Metadata",
        args: [{ name: "tokenIds", type: "uint256[]", help: "[id,id,…]: each word's token id (keccak256 of the word)" }],
      },
      {
        fn: "refreshAllMetadata",
        signature: "refreshAllMetadata()",
        title: "Refresh every word’s metadata",
        desc: "The same for all words at once (ERC-4906’s batch event): after a new metadata server, new contents behind the base URI, or a change to how every card is drawn. It only emits one event. Only on a Words deployed with it.",
        kind: "owner",
        group: "Metadata",
        args: [],
      },
      {
        fn: "setDefaultRoyalty",
        signature: "setDefaultRoyalty(address,uint96)",
        title: "Set royalty signal",
        desc: "EIP-2981 royalty SIGNAL (unenforced — open composability). Deploy default: 2.5% to the treasury.",
        kind: "owner",
        group: "Metadata",
        args: [
          { name: "receiver", type: "address", help: "usually the treasury" },
          { name: "bps", type: "uint96", default: "250", help: "basis points of the sale price (250 = 2.5%)" },
        ],
      },
      {
        fn: "setRolls",
        signature: "setRolls(address)",
        title: "Set Rolls",
        desc: "Whitelist the Rolls contract to apply escrow upgrades. Set during deploy wiring.",
        kind: "owner",
        group: "Wiring",
        danger: true,
        args: [{ name: "rolls", type: "address" }],
      },
      {
        fn: "setPrestige",
        signature: "setPrestige(address)",
        title: "Set Prestige",
        desc: "Whitelist the Prestige contract to bump prestige levels. Set during deploy wiring.",
        kind: "owner",
        group: "Wiring",
        danger: true,
        args: [{ name: "prestige", type: "address" }],
      },
      {
        fn: "repegClaimPrice",
        signature: "repegClaimPrice(uint256)",
        title: "Repeg claim price (keeper)",
        desc: "Price-keeper auto-repeg of the claim price, clamped to ±maxMoveBps.",
        kind: "keeper",
        group: "Repeg",
        args: [{ name: "price", type: "uint256", help: "$WORD wei", default: WEI.claim }],
      },
      ...priceKeeperRoles(),
      ...ownable(),
    ],
  },
  {
    key: "rolls",
    name: "Rolls",
    order: 4,
    purpose: "Upgrade rolls (lowercase→UPPERCASE). EGGS commit→signed-reveal; pity per (owner, letter).",
    ctor: [
      { name: "word", type: "address" },
      { name: "feeRouter", type: "address" },
      { name: "letters", type: "address" },
      { name: "words", type: "address" },
      { name: "rollPrice", type: "uint256", default: WEI.roll },
      { name: "signer", type: "address" },
    ],
    fns: [
      {
        fn: "setRollPrice",
        signature: "setRollPrice(uint256)",
        title: "Set roll price",
        desc: "Re-peg the $WORD roll fee (USD target: $0.25 — the core durable sink).",
        kind: "owner",
        group: "Pricing",
        args: [{ name: "price", type: "uint256", help: "$WORD wei", default: WEI.roll }],
      },
      {
        fn: "setSigner",
        signature: "setSigner(address)",
        title: "Set roll signer",
        desc: "Rotate the backend key that signs roll outcomes. Rotating to a dead key halts roll reveals (emergency lever).",
        kind: "owner",
        group: "Roles",
        danger: true,
        args: [{ name: "signer", type: "address" }],
      },
      {
        fn: "setStaking",
        signature: "setStaking(address)",
        title: "Set Staking",
        desc: "Set the Staking contract used to resolve the beneficial owner of staked words. Set during deploy wiring.",
        kind: "owner",
        group: "Wiring",
        danger: true,
        args: [{ name: "staking", type: "address" }],
      },
      {
        fn: "repegRollPrice",
        signature: "repegRollPrice(uint256)",
        title: "Repeg roll price (keeper)",
        desc: "Price-keeper auto-repeg of the roll price (the core durable sink), clamped to ±maxMoveBps.",
        kind: "keeper",
        group: "Repeg",
        args: [{ name: "price", type: "uint256", help: "$WORD wei", default: WEI.roll }],
      },
      ...priceKeeperRoles(),
      ...ownable(),
    ],
  },
  {
    key: "staking",
    name: "Staking",
    order: 5,
    purpose: "Custodial word staking + hunger clock. Gates yield & jackpot eligibility; one free daily feed.",
    ctor: [
      { name: "word", type: "address" },
      { name: "feeRouter", type: "address" },
      { name: "words", type: "address" },
      { name: "snackPrice", type: "uint256", default: WEI.snack },
      { name: "peckishAfter", type: "uint64", default: String(DAY) },
      { name: "hungryAfter", type: "uint64", default: String(3 * DAY) },
      { name: "initialOwner", type: "address" },
    ],
    fns: [
      {
        fn: "setCareParams",
        signature: "setCareParams(uint64,uint64,uint256)",
        title: "Set care params",
        desc: "Tune hunger thresholds and the snack price (USD target: $0.02).",
        kind: "owner",
        group: "Care",
        args: [
          { name: "peckishAfter", type: "uint64", help: "seconds unfed → peckish (½ yield)", default: String(DAY) },
          { name: "hungryAfter", type: "uint64", help: "seconds unfed → hungry (0 yield, no jackpot)", default: String(3 * DAY) },
          { name: "snackPrice", type: "uint256", help: "$WORD wei per paid feed", default: WEI.snack },
        ],
      },
      {
        fn: "setFreeDailySnack",
        signature: "setFreeDailySnack(bool)",
        title: "Free daily snack",
        desc: "Toggle each profile's one free snack per UTC day (the retention hook, on a signer voucher: feedWithSnack).",
        kind: "owner",
        group: "Care",
        args: [{ name: "enabled", type: "bool", default: "true" }],
      },
      {
        fn: "setSigner",
        signature: "setSigner(address)",
        title: "Set free-snack signer",
        desc: "Rotate the backend key that signs each profile's free-snack voucher (keep it the same key as Letters, Rolls, and Prestige). Rotating to a dead key makes every feed paid.",
        kind: "owner",
        group: "Roles",
        danger: true,
        args: [{ name: "signer_", type: "address" }],
      },
      {
        fn: "repegSnackPrice",
        signature: "repegSnackPrice(uint256)",
        title: "Repeg snack price (keeper)",
        desc: "Price-keeper auto-repeg of the snack price only (hunger thresholds untouched), clamped to ±maxMoveBps.",
        kind: "keeper",
        group: "Repeg",
        args: [{ name: "snackPrice", type: "uint256", help: "$WORD wei", default: WEI.snack }],
      },
      ...priceKeeperRoles(),
      ...ownable(),
    ],
  },
  {
    key: "prestige",
    name: "Prestige",
    order: 6,
    purpose: "Ascension, the word ladder — full-UPPERCASE staked words climb Gilded 1–4, then Holographic. A stage-N attempt costs N × prestigeFee. Commit→signed-reveal; fail = no-op.",
    ctor: [
      { name: "word", type: "address" },
      { name: "feeRouter", type: "address" },
      { name: "words", type: "address" },
      { name: "staking", type: "address" },
      { name: "maxLevel", type: "uint8", default: String(DEFAULT_PARAMS.prestige.levels) },
      { name: "prestigeFee", type: "uint256", default: WEI.prestige },
      { name: "snackCost", type: "uint256", default: WEI.snack },
      { name: "signer", type: "address" },
    ],
    fns: [
      {
        fn: "setParams",
        signature: "setParams(uint8,uint256,uint256)",
        title: "Set prestige params",
        desc: "Tune the number of stages (0 switches ascension off), the BASE fee (a stage-N attempt costs N × it), and the snack cost burned per attempt.",
        kind: "owner",
        group: "Economics",
        args: [
          { name: "maxLevel", type: "uint8", default: String(DEFAULT_PARAMS.prestige.levels) },
          { name: "prestigeFee", type: "uint256", help: "$WORD wei, the Gilded 1 price", default: WEI.prestige },
          { name: "snackCost", type: "uint256", help: "$WORD wei (100% burn)", default: WEI.snack },
        ],
      },
      {
        fn: "setSigner",
        signature: "setSigner(address)",
        title: "Set prestige signer",
        desc: "Rotate the backend key that signs prestige outcomes.",
        kind: "owner",
        group: "Roles",
        danger: true,
        args: [{ name: "signer", type: "address" }],
      },
      {
        fn: "repegFees",
        signature: "repegFees(uint256,uint256)",
        title: "Repeg fees (keeper)",
        desc: "Price-keeper auto-repeg of the prestige fee + snack cost only (maxLevel untouched), each clamped to ±maxMoveBps.",
        kind: "keeper",
        group: "Repeg",
        args: [
          { name: "prestigeFee", type: "uint256", help: "$WORD wei, the Gilded 1 price", default: WEI.prestige },
          { name: "snackCost", type: "uint256", help: "$WORD wei (100% burn)", default: WEI.snack },
        ],
      },
      ...priceKeeperRoles(),
      ...ownable(),
    ],
  },
  {
    key: "answerChain",
    name: "AnswerChain",
    order: 7,
    purpose: "The pre-committed daily-word reverse hash-chain. Unsteerable; revealed one word/day by the keeper.",
    ctor: [
      { name: "head", type: "bytes32", help: "precomputed chain head" },
      { name: "keeper", type: "address", help: "set to Jackpot during wiring" },
      { name: "initialOwner", type: "address" },
    ],
    fns: [
      {
        fn: "setHead",
        signature: "setHead(bytes32)",
        title: "Commit chain head",
        desc: "(Re)commit the head. Only allowed before the chain starts or once it's exhausted — never mid-stream. Used to rotate in a fresh sequence.",
        kind: "owner",
        group: "Chain",
        danger: true,
        args: [{ name: "head", type: "bytes32" }],
      },
      {
        fn: "setKeeper",
        signature: "setKeeper(address)",
        title: "Set chain keeper",
        desc: "Address authorized to reveal (the Jackpot contract). Set during deploy wiring.",
        kind: "owner",
        group: "Roles",
        danger: true,
        args: [{ name: "keeper", type: "address" }],
      },
      ...ownable(),
    ],
  },
  {
    key: "jackpot",
    name: "Jackpot",
    order: 8,
    purpose: "Daily jackpot. resolve() atomically reveals the day's word and pays the staked+fed holder, else rolls over.",
    ctor: [
      { name: "feeRouter", type: "address" },
      { name: "words", type: "address" },
      { name: "staking", type: "address" },
      { name: "answerChain", type: "address" },
      { name: "keeper", type: "address", help: "off-chain operator key" },
      { name: "initialOwner", type: "address" },
    ],
    fns: [
      {
        fn: "resolve",
        signature: "resolve(string,bytes32,bytes32)",
        title: "Resolve the daily jackpot",
        desc: "The daily keeper duty: reveal today's word on the AnswerChain and pay the winner (or roll over). Atomic — advances the chain by exactly one day.",
        kind: "keeper",
        group: "Daily",
        args: [
          { name: "word", type: "string", help: "today's UPPERCASE answer" },
          { name: "salt", type: "bytes32", help: "the commit salt for this word" },
          { name: "next", type: "bytes32", help: "the next commit in the chain" },
        ],
      },
      {
        fn: "setKeeper",
        signature: "setKeeper(address)",
        title: "Set jackpot keeper",
        desc: "Rotate the operator key allowed to call resolve(). Rotating to a dead key pauses the daily jackpot (emergency lever).",
        kind: "owner",
        group: "Roles",
        danger: true,
        args: [{ name: "keeper", type: "address" }],
      },
      ...ownable(),
    ],
  },
  {
    key: "yieldDistributor",
    name: "YieldDistributor",
    order: 9,
    purpose: "Streams UPPERCASE-only yield from the Pool via per-epoch Merkle roots. FeeRouter's poolPayer.",
    ctor: [
      { name: "word", type: "address" },
      { name: "feeRouter", type: "address" },
      { name: "keeper", type: "address" },
      { name: "initialOwner", type: "address" },
    ],
    fns: [
      {
        fn: "openEpoch",
        signature: "openEpoch(uint256,bytes32,uint256,uint256)",
        title: "Open a yield epoch",
        desc: "Post the Merkle root of this epoch's UPPERCASE yield shares and pull the funding amount from the Pool (capped at the bucket balance).",
        kind: "keeper",
        group: "Epochs",
        args: [
          { name: "epochId", type: "uint256", help: "monotonic epoch number" },
          { name: "root", type: "bytes32", help: "Merkle root of (tokenId, account, amount)" },
          { name: "amount", type: "uint256", help: "$WORD wei to pull from the Pool" },
          { name: "meta", type: "uint256", help: "unused for yield — pass 0", default: "0" },
        ],
      },
      {
        fn: "setClaimWindow",
        signature: "setClaimWindow(uint64)",
        title: "Set claim window",
        desc: "Duration a NEW epoch stays claimable before unclaimed funds can be recovered (snapshotted per epoch). Default 90 days.",
        kind: "owner",
        group: "Epochs",
        args: [{ name: "claimWindow", type: "uint64", help: "seconds", default: String(90 * DAY) }],
      },
      {
        fn: "recoverUnclaimed",
        signature: "recoverUnclaimed(uint256,address)",
        title: "Recover unclaimed",
        desc: "Recover a stale epoch's unclaimed remainder, only after its claim window has elapsed.",
        kind: "owner",
        group: "Epochs",
        danger: true,
        args: [
          { name: "epochId", type: "uint256" },
          { name: "to", type: "address", help: "where to send the remainder" },
        ],
      },
      {
        fn: "setKeeper",
        signature: "setKeeper(address)",
        title: "Set yield keeper",
        desc: "Rotate the operator key allowed to open epochs.",
        kind: "owner",
        group: "Roles",
        danger: true,
        args: [{ name: "keeper", type: "address" }],
      },
      ...ownable(),
    ],
  },
  {
    key: "bounty",
    name: "Bounty",
    order: 10,
    purpose: "Renewable theme bounty. Per-period Merkle payout to matching staked+fed words. FeeRouter's bountyPayer.",
    ctor: [
      { name: "word", type: "address" },
      { name: "feeRouter", type: "address" },
      { name: "keeper", type: "address" },
      { name: "initialOwner", type: "address" },
    ],
    fns: [
      {
        fn: "openEpoch",
        signature: "openEpoch(uint256,bytes32,uint256,uint256)",
        title: "Open a bounty period",
        desc: "Post the Merkle root of this period's theme-matching shares and pull the funding amount from the Bounty bucket. meta carries the themeId.",
        kind: "keeper",
        group: "Periods",
        args: [
          { name: "epochId", type: "uint256", help: "monotonic period number" },
          { name: "root", type: "bytes32", help: "Merkle root of (tokenId, account, amount)" },
          { name: "amount", type: "uint256", help: "$WORD wei to pull from the Bounty bucket" },
          { name: "meta", type: "uint256", help: "themeId for this period", default: "0" },
        ],
      },
      {
        fn: "setClaimWindow",
        signature: "setClaimWindow(uint64)",
        title: "Set claim window",
        desc: "Duration a NEW period stays claimable before unclaimed funds can be recovered.",
        kind: "owner",
        group: "Periods",
        args: [{ name: "claimWindow", type: "uint64", help: "seconds", default: String(90 * DAY) }],
      },
      {
        fn: "recoverUnclaimed",
        signature: "recoverUnclaimed(uint256,address)",
        title: "Recover unclaimed",
        desc: "Recover a stale period's unclaimed remainder, only after its claim window has elapsed.",
        kind: "owner",
        group: "Periods",
        danger: true,
        args: [
          { name: "epochId", type: "uint256" },
          { name: "to", type: "address" },
        ],
      },
      {
        fn: "setKeeper",
        signature: "setKeeper(address)",
        title: "Set bounty keeper",
        desc: "Rotate the operator key allowed to open bounty periods.",
        kind: "owner",
        group: "Roles",
        danger: true,
        args: [{ name: "keeper", type: "address" }],
      },
      ...ownable(),
    ],
  },
  {
    key: "saleFees",
    name: "SaleFees",
    order: 11,
    purpose:
      "Receives the 10% fee on word sales (Seaport, the in-game board) and routes it via FeeSource.ROYALTY into the Rewards Pool. No owner. Must be a FeeRouter collector (decisions.md #18).",
    ctor: [
      { name: "word", type: "address" },
      { name: "feeRouter", type: "address" },
    ],
    fns: [
      {
        fn: "flush",
        signature: "flush()",
        title: "Flush sale fees",
        desc: "Route every pending sale fee into the Rewards Pool (less the bounty carve). Anyone may call it; the keeper does each day before the yield epoch opens.",
        kind: "keeper",
        group: "Fees",
        args: [],
      },
    ],
  },
  {
    key: "shop",
    name: "Shop",
    order: 12,
    purpose:
      "Cosmetics for USDC at fixed prices (decisions.md #22). Each sale sends revenueBps (80%) to the revenue wallet and swaps the rest to $WORD for the Rewards Pool (ROYALTY), in the same transaction. The registry deploys EMPTY: what an item is (name, kind, art) goes in the shop_items table. Never add an item on mainnet without one. Deploy with DeployShop.s.sol (mainnet, ask the owner) or DeployShopTestnet.s.sol; must be a FeeRouter collector.",
    ctor: [
      { name: "word", type: "address" },
      { name: "feeRouter", type: "address" },
      { name: "usdc", type: "address", help: "Circle's USDC on Base (0x8335…2913), or MockUSDC on Sepolia" },
      { name: "adapter", type: "address", help: "the USDC→$WORD route (UniV4UsdcWordAdapter)" },
      { name: "revenueWallet", type: "address" },
      { name: "pegSource", type: "address", help: "Letters: the floor reads its packPrice (the price keeper's peg)" },
      { name: "pegPackUsdc", type: "uint256", help: "the pack's price in USDC units", default: "1000000" },
      { name: "maxSlippageBps", type: "uint16", help: "the floor's allowance under the peg (≤ 2000)", default: "1000" },
      { name: "initialOwner", type: "address" },
    ],
    fns: [
      {
        fn: "addItem",
        signature: "addItem(uint128,uint64,uint64,uint32,bool)",
        title: "Add an item",
        desc: "A new registry entry, numbered after the last. Prices are USDC units (6 decimals: 1000000 = $1, the least is 10000 = $0.01). The app shows it only once shop_items has its name and kind (on a test network, a plain 'Test item' card until then).",
        kind: "owner",
        group: "Items",
        args: [
          { name: "priceUsdc", type: "uint128", help: "USDC units: 1000000 = 1 USDC", default: "1000000" },
          { name: "start", type: "uint64", help: "first second on sale (unix); 0 = now", default: "0" },
          { name: "end", type: "uint64", help: "first second NOT on sale (unix); 0 = no end", default: "0" },
          { name: "maxSupply", type: "uint32", help: "0 = unlimited", default: "0" },
          { name: "active", type: "bool", help: "on sale at once?", default: "true" },
        ],
      },
      {
        fn: "updateItem",
        signature: "updateItem(uint256,uint128,uint64,uint64,uint32)",
        title: "Update an item",
        desc: "Change an item's price, window, or supply. Supply can't go below what's sold (0 = unlimited).",
        kind: "owner",
        group: "Items",
        args: [
          { name: "itemId", type: "uint256" },
          { name: "priceUsdc", type: "uint128", help: "USDC units: 1000000 = 1 USDC" },
          { name: "start", type: "uint64", help: "unix seconds; 0 = now", default: "0" },
          { name: "end", type: "uint64", help: "unix seconds; 0 = no end", default: "0" },
          { name: "maxSupply", type: "uint32", help: "0 = unlimited", default: "0" },
        ],
      },
      {
        fn: "setActive",
        signature: "setActive(uint256,bool)",
        title: "Put an item on or off sale",
        desc: "An inactive item can't be bought and isn't shown.",
        kind: "owner",
        group: "Items",
        args: [
          { name: "itemId", type: "uint256" },
          { name: "active", type: "bool", default: "true" },
        ],
      },
      {
        fn: "setRevenueWallet",
        signature: "setRevenueWallet(address)",
        title: "Set the revenue wallet",
        desc: "Where the studio's share of each sale goes, straight from the buyer.",
        kind: "owner",
        group: "Money",
        danger: true,
        args: [{ name: "wallet", type: "address" }],
      },
      {
        fn: "setSplit",
        signature: "setSplit(uint16)",
        title: "Set the split",
        desc: "The studio's share of a sale in bps (default 8000 = 80%; hard cap 9000, so the pool always gets at least 10%). The rest buys $WORD for the Rewards Pool.",
        kind: "owner",
        group: "Money",
        args: [{ name: "bps", type: "uint16", help: "≤ 9000", default: "8000" }],
      },
      {
        fn: "setMaxSlippageBps",
        signature: "setMaxSlippageBps(uint16)",
        title: "Set the floor's allowance",
        desc: "How far under the peg a swap may fill (bps, ≤ 2000). Too tight and swaps wait for sweep; too loose and a sandwich has more room.",
        kind: "owner",
        group: "Money",
        args: [{ name: "bps", type: "uint16", help: "≤ 2000", default: "1000" }],
      },
      {
        fn: "setMaxSweepUsdc",
        signature: "setMaxSweepUsdc(uint256)",
        title: "Set a sweep's size",
        desc: "The most one sweep swaps (USDC units, $1 to $1,000; default 100000000 = $100). Small chunks keep a sandwich unprofitable.",
        kind: "owner",
        group: "Money",
        args: [{ name: "cap", type: "uint256", help: "USDC units", default: "100000000" }],
      },
      {
        fn: "proposeRoute",
        signature: "proposeRoute(address,address,uint256)",
        title: "Propose a new route",
        desc: "A new adapter and/or a new peg (source + the pack's USDC price). Live only after ROUTE_DELAY (2 days), with acceptRoute. To move only the peg, pass the current adapter. Propose a peg change BEFORE the pack's USD retune lands.",
        kind: "owner",
        group: "Route",
        danger: true,
        args: [
          { name: "adapter", type: "address" },
          { name: "pegSource", type: "address", help: "Letters" },
          { name: "pegPackUsdc", type: "uint256", help: "the pack's price in USDC units", default: "1000000" },
        ],
      },
      {
        fn: "acceptRoute",
        signature: "acceptRoute()",
        title: "Accept the proposed route",
        desc: "Switch to the proposed adapter and peg, once ROUTE_DELAY has passed.",
        kind: "owner",
        group: "Route",
        danger: true,
        args: [],
      },
      {
        fn: "cancelRoute",
        signature: "cancelRoute()",
        title: "Cancel the proposed route",
        desc: "Drop a pending route proposal.",
        kind: "owner",
        group: "Route",
        args: [],
      },
      {
        fn: "pause",
        signature: "pause()",
        title: "Pause the Shop",
        desc: "Stops buying and sweeping. Nothing held is trapped: waiting USDC sweeps once unpaused.",
        kind: "owner",
        group: "Safety",
        danger: true,
        args: [],
      },
      {
        fn: "unpause",
        signature: "unpause()",
        title: "Unpause the Shop",
        desc: "Buying and sweeping again.",
        kind: "owner",
        group: "Safety",
        args: [],
      },
      {
        fn: "sweep",
        signature: "sweep(uint256)",
        title: "Sweep waiting USDC",
        desc: "Swap up to maxSweepUsdc of the USDC whose swap waited into the Rewards Pool (once a block). Anyone may call it; the keeper does each day in its fees job. 0 = the Shop's own floor.",
        kind: "keeper",
        group: "Fees",
        args: [{ name: "minWordOut", type: "uint256", help: "0 = the Shop's floor", default: "0" }],
      },
      ...ownable(),
    ],
  },
];

export const CONTRACT_BY_KEY: Record<ContractKey, ContractDef> = Object.fromEntries(
  CONTRACTS.map((c) => [c.key, c]),
) as Record<ContractKey, ContractDef>;

/** All keeper/operator duties across the suite (drives the Keeper tab). */
export function keeperFns(): { contract: ContractDef; fn: ContractFn }[] {
  return CONTRACTS.flatMap((c) => c.fns.filter((f) => f.kind === "keeper").map((fn) => ({ contract: c, fn })));
}
