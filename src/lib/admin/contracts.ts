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
};

const DAY = 86_400;

// --- fee sources (FeeRouter splits) -------------------------------------------------------------

export interface FeeSourceDef {
  id: number;
  key: string;
  label: string;
  /** v0.2 default split, bps [pool, jackpot, burn, treasury]. */
  bps: [number, number, number, number];
  note: string;
}

export const FEE_SOURCES: FeeSourceDef[] = [
  { id: 0, key: "PACK_MINT", label: "Pack mint", bps: [4000, 1000, 2000, 3000], note: "pack of 5 letters" },
  { id: 1, key: "DAILY_MINT", label: "Daily mint", bps: [4000, 1000, 2000, 3000], note: "FID-gated daily single" },
  { id: 2, key: "ROLL", label: "Roll", bps: [4000, 2500, 2000, 1500], note: "upgrade roll fee" },
  { id: 3, key: "CLAIM", label: "Claim", bps: [2500, 2500, 2500, 2500], note: "claim a word" },
  { id: 4, key: "SNACK", label: "Snack", bps: [0, 0, 10000, 0], note: "100% burn" },
  { id: 5, key: "PRESTIGE", label: "Prestige", bps: [4000, 2500, 2000, 1500], note: "ascension commit fee" },
  { id: 6, key: "ROYALTY", label: "Royalty", bps: [0, 0, 0, 10000], note: "in-house swap fee → treasury" },
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
      desc: "Begin handing this contract to a new owner (e.g. the multisig). Two-step: the new owner must then call acceptOwnership.",
      kind: "lifecycle",
      group: "Ownership",
      danger: true,
      args: [{ name: "newOwner", type: "address", help: "the multisig that will own this contract" }],
    },
    {
      fn: "acceptOwnership",
      signature: "acceptOwnership()",
      title: "Accept ownership",
      desc: "Called BY the pending new owner (the multisig) to complete the two-step transfer.",
      kind: "lifecycle",
      group: "Ownership",
      danger: true,
      args: [],
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
      { name: "treasury", type: "address", help: "treasury multisig" },
      { name: "initialOwner", type: "address", help: "deployer (hand to multisig after)" },
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
        desc: "Update the treasury multisig that receives treasury-share fees.",
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
      { name: "dictionaryRoot", type: "bytes32", help: "Merkle root from economy.json" },
      { name: "claimPrice", type: "uint256", default: WEI.claim },
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
        desc: "Update the canonical dictionary Merkle root. Only if the word list is re-vendored (regenerate with npm run derive:contracts).",
        kind: "owner",
        group: "Dictionary",
        danger: true,
        args: [
          { name: "root", type: "bytes32", default: "0x0d48916cd7b9f350667ee831da1e50506571843845327ab7977ba563761866c8" },
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
        desc: "Toggle whether each player's first feed per UTC day is free (the retention hook).",
        kind: "owner",
        group: "Care",
        args: [{ name: "enabled", type: "bool", default: "true" }],
      },
      ...ownable(),
    ],
  },
  {
    key: "prestige",
    name: "Prestige",
    order: 6,
    purpose: "Ascension — full-UPPERCASE staked words climb Gilded levels. Commit→signed-reveal; fail = no-op.",
    ctor: [
      { name: "word", type: "address" },
      { name: "feeRouter", type: "address" },
      { name: "words", type: "address" },
      { name: "staking", type: "address" },
      { name: "maxLevel", type: "uint8", default: "4" },
      { name: "prestigeFee", type: "uint256", default: WEI.roll },
      { name: "snackCost", type: "uint256", default: WEI.snack },
      { name: "signer", type: "address" },
    ],
    fns: [
      {
        fn: "setParams",
        signature: "setParams(uint8,uint256,uint256)",
        title: "Set prestige params",
        desc: "Tune max ascension level, the commit fee, and the snack cost burned per attempt.",
        kind: "owner",
        group: "Economics",
        args: [
          { name: "maxLevel", type: "uint8", default: "4" },
          { name: "prestigeFee", type: "uint256", help: "$WORD wei", default: WEI.roll },
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
];

export const CONTRACT_BY_KEY: Record<ContractKey, ContractDef> = Object.fromEntries(
  CONTRACTS.map((c) => [c.key, c]),
) as Record<ContractKey, ContractDef>;

/** All keeper/operator duties across the suite (drives the Keeper tab). */
export function keeperFns(): { contract: ContractDef; fn: ContractFn }[] {
  return CONTRACTS.flatMap((c) => c.fns.filter((f) => f.kind === "keeper").map((fn) => ({ contract: c, fn })));
}
