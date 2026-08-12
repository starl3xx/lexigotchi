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
  | "bounty";

type Registry = {
  network: string;
  chainId: number;
  /** Block the suite was deployed in — the floor for event queries. */
  deployBlock: number | null;
  wordToken: string;
  roles: Record<string, string | null>;
  contracts: Record<ContractKey, string | null>;
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

/** The backend signer role — the key that must sign every commit→reveal voucher. */
export function signerAddress(): `0x${string}` | null {
  return (REGISTRY.roles.signer as `0x${string}` | null) ?? null;
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
