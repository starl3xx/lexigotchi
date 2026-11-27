/**
 * Typed, per-network contract addresses — the only place the app resolves a contract address.
 *
 * Switched on `NETWORK.key` exactly as the admin registry is, so the game and the operator console
 * can never disagree about which deployment they're talking to. Accessors THROW on a null address
 * rather than returning `undefined`: encoding a call to `0x0` produces a transaction that fails with
 * no useful reason, and mainnet is still all-null.
 *
 * The $WORD token is resolved here too, and that matters more than it looks — on Base Sepolia it's
 * the MockERC20 stand-in (0x4abE…22Ea), not the mainnet token. Approving the mainnet address on
 * Sepolia approves an account with no code, and the later transferFrom reverts opaquely.
 */
import baseMainnet from "../../../config/deployments.json";
import baseSepolia from "../../../config/deployments.base-sepolia.json";
import { NETWORK } from "./network";

export type ContractKey =
  | "feeRouter"
  | "letters"
  | "words"
  | "rolls"
  | "staking"
  | "prestige"
  | "answerChain"
  | "jackpot"
  | "yieldDistributor"
  | "bounty"
  | "saleFees";

type Registry = {
  network: string;
  chainId: number;
  /** Block the suite was deployed in — the floor for event queries. */
  deployBlock: number | null;
  wordToken: string;
  roles: Record<string, string | null>;
  contracts: Record<ContractKey, string | null>;
  /** The EAS schema the keeper attests achievements under, registered per network. */
  easAchievementsSchema?: string | null;
  /**
   * Was this network's Words deployed WITH the first-day gate (decisions.md, "Reserved word sets")?
   * A fact about the deployment, so it is written here with the addresses, by the same PR that
   * records a redeploy. Absent or false: no gate.
   */
  wordsGate?: boolean;
  /** The Shop beside the suite (decisions.md #22): never part of isSuiteDeployed. */
  shop?: { shop: string | null; usdc: string | null; adapter: string | null; deployBlock: number | null };
};

const REGISTRY: Registry =
  NETWORK.key === "base-sepolia" ? (baseSepolia as Registry) : (baseMainnet as Registry);

/** Sanity: the committed registry must describe the network we think we're on. */
if (REGISTRY.chainId !== NETWORK.id) {
  throw new Error(
    `Deployment registry chainId ${REGISTRY.chainId} does not match active network ${NETWORK.id}`,
  );
}

export class MissingDeploymentError extends Error {
  constructor(what: string) {
    super(
      `${what} is not deployed on ${NETWORK.name} (${NETWORK.id}). ` +
        `Populate config/deployments${NETWORK.key === "base-sepolia" ? ".base-sepolia" : ""}.json.`,
    );
    this.name = "MissingDeploymentError";
  }
}

/** Address of a suite contract on the active network. Throws if it isn't deployed. */
export function addressOf(key: ContractKey): `0x${string}` {
  const addr = REGISTRY.contracts[key];
  if (!addr) throw new MissingDeploymentError(key);
  return addr as `0x${string}`;
}

/** Address of a suite contract, or null when it isn't deployed — for UI gating, not for calls. */
export function maybeAddressOf(key: ContractKey): `0x${string}` | null {
  return (REGISTRY.contracts[key] as `0x${string}` | null) ?? null;
}

/** The $WORD ERC-20 for the active network (MockERC20 on Sepolia). */
export function wordTokenAddress(): `0x${string}` {
  if (!REGISTRY.wordToken) throw new MissingDeploymentError("wordToken");
  return REGISTRY.wordToken as `0x${string}`;
}

/**
 * Block the suite was deployed in — the `fromBlock` floor for event queries.
 * Scanning from genesis is both slow and rejected outright by most RPCs.
 */
export function deployBlock(): bigint {
  return BigInt(REGISTRY.deployBlock ?? 0);
}

/** This network's EAS achievements schema, or null when none is registered yet. */
export function achievementsSchema(): `0x${string}` | null {
  return (REGISTRY.easAchievementsSchema as `0x${string}` | null | undefined) ?? null;
}

/** The backend signer role — the key that must sign every commit→reveal voucher. */
export function signerAddress(): `0x${string}` | null {
  return (REGISTRY.roles.signer as `0x${string}` | null) ?? null;
}

/** The registry's role addresses (owner, treasury, keeper, signer, priceKeeper), lowercase, set ones only. */
export function roleAddresses(): Record<string, `0x${string}`> {
  const out: Record<string, `0x${string}`> = {};
  for (const [role, addr] of Object.entries(REGISTRY.roles)) if (addr) out[role] = addr.toLowerCase() as `0x${string}`;
  return out;
}

/** The Shop on the active network, or null where it isn't deployed (decisions.md #22). */
export function shopAddress(): `0x${string}` | null {
  return (REGISTRY.shop?.shop as `0x${string}` | null | undefined) ?? null;
}

/**
 * USDC on the active network: Circle's on Base mainnet (from Circle's docs, never from memory),
 * MockUSDC on Base Sepolia. Null where the registry names none.
 */
export function usdcAddress(): `0x${string}` | null {
  return (REGISTRY.shop?.usdc as `0x${string}` | null | undefined) ?? null;
}

/** The Shop's swap adapter, for the admin's view of the route. */
export function shopAdapterAddress(): `0x${string}` | null {
  return (REGISTRY.shop?.adapter as `0x${string}` | null | undefined) ?? null;
}

/** The block the Shop was deployed in: the floor for its event scans. */
export function shopDeployBlock(): bigint {
  return BigInt(REGISTRY.shop?.deployBlock ?? 0);
}

/**
 * Does this network's Words have the first-day gate (`setGate`, `gatedUntil`, `claimSigner`)?
 * Read from the registry, never by asking the contract: "the call failed" can't tell a Words
 * without the gate from an RPC hiccup, and reading a hiccup as "no gate" would plan a release
 * with no gate and send a gated word's claim without its voucher.
 */
export function wordsHaveGate(): boolean {
  return REGISTRY.wordsGate === true && isSuiteDeployed();
}

/** True when the whole suite resolves — the gate for showing real on-chain UI at all. */
export function isSuiteDeployed(): boolean {
  return (Object.keys(REGISTRY.contracts) as ContractKey[]).every((k) => !!REGISTRY.contracts[k]);
}

/** Everything at once, for multicall construction. Throws if any is missing. */
export function allAddresses(): Record<ContractKey, `0x${string}`> {
  const keys = Object.keys(REGISTRY.contracts) as ContractKey[];
  return Object.fromEntries(keys.map((k) => [k, addressOf(k)])) as Record<ContractKey, `0x${string}`>;
}
