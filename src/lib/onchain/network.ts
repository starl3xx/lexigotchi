/**
 * The network the app targets — the single source of truth for chain id, explorer, and CAIP-2.
 *
 * Everything that used to hardcode `8453` / `basescan.org` reads from here: the write chokepoint
 * (`sendCalls.ts`), the admin console's transaction plans and Safe batches, and the deployment
 * registry. Selected at build time by `NEXT_PUBLIC_CHAIN_ID`; Base mainnet when unset, so the
 * default behaviour is unchanged and testnet is strictly opt-in.
 *
 * An unrecognised `NEXT_PUBLIC_CHAIN_ID` **throws** rather than falling back. A silent fallback here
 * would point a signed transaction at a chain the operator didn't choose, which is exactly the class
 * of quiet failure the Launch panel exists to prevent — a boot-time error is the cheap version.
 */

export interface NetworkDef {
  /** EIP-155 chain id. */
  id: number;
  /** Same id, hex-encoded — the form ERC-5792 / EIP-1193 calls want. */
  idHex: `0x${string}`;
  /** Stable slug, used to pick the per-network deployment registry. */
  key: "base" | "base-sepolia";
  /** Human label for the admin chrome. */
  name: string;
  /** Block explorer origin, no trailing slash. */
  explorer: string;
  isTestnet: boolean;
}

export const BASE: NetworkDef = {
  id: 8453,
  idHex: "0x2105",
  key: "base",
  name: "Base",
  explorer: "https://basescan.org",
  isTestnet: false,
};

export const BASE_SEPOLIA: NetworkDef = {
  id: 84532,
  idHex: "0x14a34",
  key: "base-sepolia",
  name: "Base Sepolia",
  explorer: "https://sepolia.basescan.org",
  isTestnet: true,
};

export const NETWORKS: readonly NetworkDef[] = [BASE, BASE_SEPOLIA];

export function networkById(id: number): NetworkDef | undefined {
  return NETWORKS.find((n) => n.id === id);
}

/** Resolve the configured network, or throw on an unrecognised id. Exported for tests. */
export function resolveNetwork(raw: string | undefined): NetworkDef {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return BASE;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`NEXT_PUBLIC_CHAIN_ID must be a chain id, got ${JSON.stringify(trimmed)}`);
  }
  const found = networkById(Number(trimmed));
  if (!found) {
    throw new Error(
      `NEXT_PUBLIC_CHAIN_ID=${trimmed} is not a supported network. ` +
        `Supported: ${NETWORKS.map((n) => `${n.id} (${n.name})`).join(", ")}.`,
    );
  }
  return found;
}

/** The active network for this build. */
export const NETWORK: NetworkDef = resolveNetwork(process.env.NEXT_PUBLIC_CHAIN_ID);

/** CAIP-2 chain identifier, e.g. "eip155:8453". */
export function caip2(net: NetworkDef = NETWORK): string {
  return `eip155:${net.id}`;
}

/** Explorer link for an address on the active network. */
export function explorerAddress(addr: string, net: NetworkDef = NETWORK): string {
  return `${net.explorer}/address/${addr}`;
}

/** Explorer link for a transaction on the active network. */
export function explorerTx(hash: string, net: NetworkDef = NETWORK): string {
  return `${net.explorer}/tx/${hash}`;
}
