/**
 * The server's hot keys, as PUBLIC addresses only: which ones this deployment holds, and the address
 * each one signs as. Server-only (it reads the private keys from the environment).
 *
 * Returns an address or a fixed error string, never the key and never an exception's message: viem's
 * error for a malformed key can quote the input.
 */
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

export type ServerKeyRole = "signer" | "relayer" | "keeper" | "priceKeeper";

export const SERVER_KEY_ENV: Record<ServerKeyRole, string> = {
  signer: "SIGNER_PRIVATE_KEY",
  relayer: "RELAYER_PRIVATE_KEY",
  keeper: "KEEPER_PRIVATE_KEY",
  priceKeeper: "PRICE_KEEPER_PRIVATE_KEY",
};

export interface ServerKey {
  role: ServerKeyRole;
  env: string;
  configured: boolean;
  /** Lowercase address, or null when the key is unset or malformed. */
  address: `0x${string}` | null;
  error: "invalid_key" | null;
}

export function serverKey(role: ServerKeyRole, env: Readonly<Record<string, string | undefined>> = process.env): ServerKey {
  const name = SERVER_KEY_ENV[role];
  const raw = env[name]?.trim();
  if (!raw) return { role, env: name, configured: false, address: null, error: null };
  try {
    const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
    const address = privateKeyToAccount(key).address.toLowerCase() as `0x${string}`;
    return { role, env: name, configured: true, address, error: null };
  } catch {
    return { role, env: name, configured: true, address: null, error: "invalid_key" };
  }
}

export function serverKeys(env: Readonly<Record<string, string | undefined>> = process.env): ServerKey[] {
  return (Object.keys(SERVER_KEY_ENV) as ServerKeyRole[]).map((r) => serverKey(r, env));
}
