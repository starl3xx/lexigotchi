import { WORD_USD_PRICE } from "@/lib/params";

/**
 * The $WORD price oracle — GeckoTerminal's token endpoint on Base mainnet.
 *
 * Replaces the hardcoded June-2026 snapshot in params.ts as the price the app actually shows and
 * converts with. The constant stays as the FALLBACK seed (and the sim's deterministic input): a
 * dormant micro-cap's price is still a better answer stale than absent, and every consumer can see
 * which one it got via `source`.
 *
 * GeckoTerminal's free tier allows ~30 calls/min — the module cache plus the API route's CDN
 * headers keep us far under it regardless of traffic.
 */

/** The token endpoint. $WORD on Base mainnet — this address IS the token, never a pool. */
export const WORD_TOKEN_URL =
  "https://api.geckoterminal.com/api/v2/networks/base/tokens/0x304e649e69979298BD1AEE63e175ADf07885fb4b";

const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;

export interface WordPrice {
  /** USD per 1 $WORD. */
  priceUsd: number;
  /** $WORD per $1 — the peg the admin converts with. */
  wordPerUsd: number;
  fdvUsd: number | null;
  reserveUsd: number | null;
  volume24hUsd: number | null;
  /** Unix ms of the successful fetch; null when the fallback answered. */
  fetchedAt: number | null;
  source: "geckoterminal" | "fallback";
}

export function fallbackWordPrice(): WordPrice {
  return {
    priceUsd: WORD_USD_PRICE,
    wordPerUsd: 1 / WORD_USD_PRICE,
    fdvUsd: null,
    reserveUsd: null,
    volume24hUsd: null,
    fetchedAt: null,
    source: "fallback",
  };
}

/** Strict positive-finite parse — GeckoTerminal serves numbers as strings. */
function num(v: unknown): number | null {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Parse a GeckoTerminal token response into a WordPrice, or null if it doesn't hold a usable
 * price. Pure and paranoid: a $2.5e-7 token is one malformed field away from a $0 or $NaN price,
 * and a bad peg silently mis-sizes every USD→wei conversion the admin makes.
 */
export function parseWordPrice(json: unknown, now: number): WordPrice | null {
  const attrs = (json as { data?: { attributes?: Record<string, unknown> } })?.data?.attributes;
  if (!attrs) return null;
  const priceUsd = num(attrs.price_usd);
  if (priceUsd === null) return null;
  return {
    priceUsd,
    wordPerUsd: 1 / priceUsd,
    fdvUsd: num(attrs.fdv_usd),
    reserveUsd: num(attrs.total_reserve_in_usd),
    volume24hUsd: num((attrs.volume_usd as Record<string, unknown> | undefined)?.h24),
    fetchedAt: now,
    source: "geckoterminal",
  };
}

let cached: WordPrice | null = null;

/**
 * The current $WORD price: live within the TTL, the last live answer while a refresh fails, the
 * constant only when nothing has ever succeeded. Never throws — a price display must degrade, not
 * crash the payload it rides in.
 */
export async function fetchWordPrice(): Promise<WordPrice> {
  const now = Date.now();
  if (cached?.fetchedAt && now - cached.fetchedAt < CACHE_TTL_MS) return cached;

  try {
    const res = await fetch(WORD_TOKEN_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) {
      const parsed = parseWordPrice(await res.json(), now);
      if (parsed) return (cached = parsed);
    }
    console.error("[oracle] GeckoTerminal returned unusable payload, status", res.status);
  } catch (err) {
    console.error("[oracle] word price fetch failed:", err);
  }
  // A stale live price beats the June constant; the constant beats nothing.
  return cached ?? fallbackWordPrice();
}
