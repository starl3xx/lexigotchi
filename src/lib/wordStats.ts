/**
 * $WORD's public numbers for the in-game $WORD page (/api/word): supply and burns read from the
 * token on Base mainnet, the pool from GeckoTerminal, and Let's Have A Word!'s staking and burn
 * counter from its public API. The price is the app's own oracle (lib/oracle/wordPrice), never a
 * second source: two prices a few dollars apart on one page read as a bug.
 *
 * Burns come in two kinds, and the page labels them apart:
 *  - DESTROYED: a real burn() lowers totalSupply. Lexigotchi's FeeRouter and LHAW's WordManagerV3
 *    burn this way. Measured as WORD_MINTED - totalSupply.
 *  - THE DEAD ADDRESS: LHAW's older WordManagerV2 "burned" by sending to 0x…dEaD. Those tokens can
 *    never move, but totalSupply still counts them. Measured as balanceOf(0x…dEaD).
 */
import { formatUnits } from "viem";

/** $WORD on Base mainnet. */
export const WORD_TOKEN = "0x304e649e69979298bd1aee63e175adf07885fb4b";
/** Clanker tokens mint a fixed 100 billion; $WORD is one (ClankerToken, verified on Sourcify). */
export const WORD_MINTED = 100_000_000_000;
export const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD" as const;
export const WORD_POOLS_URL =
  "https://api.geckoterminal.com/api/v2/networks/base/tokens/0x304e649e69979298BD1AEE63e175ADf07885fb4b/pools?page=1";

export interface WordSupply {
  minted: number;
  /** totalSupply() now. */
  total: number;
  /** Destroyed by burn(): minted − total. */
  destroyed: number;
  /** Sitting at 0x…dEaD: out of circulation, still inside totalSupply. */
  dead: number;
  /** destroyed + dead. */
  outOfCirculation: number;
}

export function summarizeSupply(totalWei: bigint, deadWei: bigint): WordSupply {
  const total = Number(formatUnits(totalWei, 18));
  const dead = Number(formatUnits(deadWei, 18));
  const destroyed = Math.max(0, WORD_MINTED - total);
  return { minted: WORD_MINTED, total, destroyed, dead, outOfCirculation: destroyed + dead };
}

export interface WordPool {
  /** Both sides of the pool, in USD. (GeckoTerminal's token-level reserve is only the $WORD side.) */
  liquidityUsd: number;
  volume24hUsd: number | null;
  priceChange24hPct: number | null;
  /** GeckoTerminal's page for the pool. */
  url: string;
  dex: string;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** The deepest $WORD pool from GeckoTerminal's token-pools response, or null. */
export function parseTopPool(json: unknown): WordPool | null {
  const data = (json as { data?: unknown[] })?.data;
  if (!Array.isArray(data)) return null;
  const pools = data
    .map((p) => {
      const a = (p as { attributes?: Record<string, unknown> }).attributes ?? {};
      const rel = (p as { relationships?: { dex?: { data?: { id?: string } } } }).relationships;
      return {
        liquidityUsd: num(a.reserve_in_usd) ?? 0,
        volume24hUsd: num((a.volume_usd as Record<string, unknown> | undefined)?.h24),
        priceChange24hPct: num((a.price_change_percentage as Record<string, unknown> | undefined)?.h24),
        url: typeof a.address === "string" ? `https://www.geckoterminal.com/base/pools/${a.address}` : "",
        dex: rel?.dex?.data?.id ?? "",
      };
    })
    .filter((p) => p.liquidityUsd > 0 && p.url)
    .sort((a, b) => b.liquidityUsd - a.liquidityUsd);
  return pools[0] ?? null;
}
