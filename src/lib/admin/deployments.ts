/**
 * Deployment registry — the bridge between the off-chain admin UI and the on-chain suite.
 *
 * The committed baseline lives in `config/deployments.json` (all-null until the suite ships). The
 * operator can also paste live addresses into the admin Deployments tab; those persist in the
 * browser (localStorage) for the session and are merged over the baseline. Once the addresses are
 * known for good, paste them into the JSON and commit. Every operations tab reads `isDeployed()` to
 * decide whether an action can execute live or stays a transaction plan.
 */
import baseline from "../../../config/deployments.json";

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

export type RoleKey = "treasury" | "signer" | "keeper" | "owner";

export interface Deployments {
  network: string;
  chainId: number;
  deployedAt: string | null;
  wordToken: string;
  roles: Record<RoleKey, string | null>;
  contracts: Record<ContractKey, string | null>;
}

const STORAGE_KEY = "lexigotchi:deployments";

export const CONTRACT_KEYS: ContractKey[] = [
  "feeRouter",
  "letters",
  "words",
  "rolls",
  "staking",
  "prestige",
  "answerChain",
  "jackpot",
  "yieldDistributor",
  "bounty",
];

export const ROLE_KEYS: RoleKey[] = ["treasury", "signer", "keeper", "owner"];

/** The committed baseline (server + client). */
export const BASE_DEPLOYMENTS: Deployments = {
  network: baseline.network,
  chainId: baseline.chainId,
  deployedAt: baseline.deployedAt,
  wordToken: baseline.wordToken,
  roles: baseline.roles as Deployments["roles"],
  contracts: baseline.contracts as Deployments["contracts"],
};

function plainObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Overlay only known keys with string|null values onto the baseline (ignores corrupt/foreign data). */
function mergeAddrs<K extends string>(
  src: Record<string, unknown>,
  keys: readonly K[],
  base: Record<K, string | null>,
): Record<K, string | null> {
  const out = { ...base };
  for (const k of keys) {
    const val = src[k];
    if (typeof val === "string" || val === null) out[k] = val as string | null;
  }
  return out;
}

/** Read the effective registry: baseline overlaid with any browser-saved overrides. The saved blob
 *  is shape-validated key-by-key so a corrupted/foreign localStorage value can't poison the registry. */
export function loadDeployments(): Deployments {
  if (typeof window === "undefined") return BASE_DEPLOYMENTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return BASE_DEPLOYMENTS;
    const saved = plainObject(JSON.parse(raw));
    return {
      network: typeof saved.network === "string" ? saved.network : BASE_DEPLOYMENTS.network,
      chainId: typeof saved.chainId === "number" ? saved.chainId : BASE_DEPLOYMENTS.chainId,
      deployedAt:
        typeof saved.deployedAt === "string" || saved.deployedAt === null
          ? (saved.deployedAt as string | null)
          : BASE_DEPLOYMENTS.deployedAt,
      wordToken: typeof saved.wordToken === "string" ? saved.wordToken : BASE_DEPLOYMENTS.wordToken,
      roles: mergeAddrs(plainObject(saved.roles), ROLE_KEYS, BASE_DEPLOYMENTS.roles),
      contracts: mergeAddrs(plainObject(saved.contracts), CONTRACT_KEYS, BASE_DEPLOYMENTS.contracts),
    };
  } catch {
    return BASE_DEPLOYMENTS;
  }
}

export function saveDeployments(d: Deployments): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export function clearDeployments(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Any contract addresses set at all? */
export function anyDeployed(d: Deployments): boolean {
  return CONTRACT_KEYS.some((k) => !!d.contracts[k]);
}

/** Whole suite present? */
export function fullyDeployed(d: Deployments): boolean {
  return CONTRACT_KEYS.every((k) => !!d.contracts[k]);
}
