/**
 * Wallet sightings: the game tells the server, once per wallet per UTC day, that a wallet is
 * connected, so the operator console can count wallets that connect and then do nothing onchain
 * (a connect alone leaves no trace anywhere else). Pure rules here; the table is schema.ts
 * `wallet_sightings`, the writes are lib/db/sightings.ts, the route is `/api/players/seen`.
 */
import { isAddress } from "viem";

export type SightingVia = "web" | "farcaster";
export const SIGHTING_VIAS: readonly SightingVia[] = ["web", "farcaster"];

/** The UTC day number (days since the Unix epoch), the same day the game's daily letter uses. */
export function utcDay(ms: number = Date.now()): number {
  return Math.floor(ms / 86_400_000);
}

/** The request body, checked: a wallet address and where the game runs. Null if either is wrong. */
export function parseSighting(body: unknown): { address: string; via: SightingVia } | null {
  if (!body || typeof body !== "object") return null;
  const { address, via } = body as { address?: unknown; via?: unknown };
  if (typeof address !== "string" || !isAddress(address, { strict: false })) return null;
  if (typeof via !== "string" || !SIGHTING_VIAS.includes(via as SightingVia)) return null;
  return { address: address.toLowerCase(), via: via as SightingVia };
}

/** The browser's "already told the server today" key, per wallet. */
export const sightingStorageKey = (address: string) => `lexigotchi:seen:${address.toLowerCase()}`;
