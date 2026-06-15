/**
 * Formatting + $WORD-peg helpers shared across the admin dashboard.
 *
 * Pricing is USD-pegged (see `params.ts`): the operator thinks in USD targets, the chain stores
 * $WORD amounts. These helpers convert a USD target to the on-chain $WORD amount (human and wei)
 * at the current peg so the parameter / launch / funding forms can show both and emit correct
 * transaction values. $WORD is an 18-decimal ERC-20.
 */
import { WORD_USD_PRICE, WORD_PER_USD, priceWord } from "@/lib/params";

export { WORD_USD_PRICE, WORD_PER_USD, priceWord };

export const WORD_DECIMALS = 18n;
export const WEI = 10n ** WORD_DECIMALS;

/** USD → human $WORD amount at the given peg (e.g. $1 ≈ 4.24M $WORD). */
export function usdToWord(usd: number, wordUsd = WORD_USD_PRICE): number {
  return priceWord(usd, wordUsd);
}

/** USD → on-chain $WORD amount in wei (integer string), at the given peg. */
export function usdToWordWei(usd: number, wordUsd = WORD_USD_PRICE): string {
  // Round to whole $WORD before scaling so the wei value is exact and human-legible.
  const whole = BigInt(Math.round(priceWord(usd, wordUsd)));
  return (whole * WEI).toString();
}

/** Human $WORD amount → wei (integer string). */
export function wordToWei(word: number): string {
  return (BigInt(Math.round(word)) * WEI).toString();
}

/** Compact $WORD label, e.g. 4_242_224 → "4.24M". Thresholds account for toFixed rounding so a
 *  value like 999_999 rolls to "1.00M" rather than the four-digit "1000.0K". */
export function fmtWordCompact(word: number): string {
  if (!Number.isFinite(word)) return "0";
  const abs = Math.abs(word);
  if (abs >= 999_995_000) return `${(word / 1e9).toFixed(2)}B`;
  if (abs >= 999_950) return `${(word / 1e6).toFixed(2)}M`;
  if (abs >= 1_000) return `${(word / 1e3).toFixed(1)}K`;
  return Math.round(word).toLocaleString();
}

/** USD amount, no cents unless small. */
export function fmtUsd(usd: number): string {
  if (Math.abs(usd) >= 1000 || usd === 0) return `$${Math.round(usd).toLocaleString()}`;
  return `$${usd.toFixed(2)}`;
}

/** Whole number with thousands separators. */
export function fmtNum(n: number): string {
  return Math.round(n).toLocaleString();
}

/** Fraction → percent string, e.g. 0.402 → "40.2%". */
export function fmtPct(frac: number, digits = 1): string {
  return `${(frac * 100).toFixed(digits)}%`;
}

/** bps → percent string, e.g. 2500 → "25%". */
export function fmtBps(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

/** Shorten an address: 0x1234…cdef. Returns "—" for empty. */
export function shortAddr(addr?: string | null): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Loose 0x-address check (not checksum-validated). */
export function isAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s.trim());
}

/** Loose bytes32 check. */
export function isBytes32(s: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(s.trim());
}

export const BASESCAN = "https://basescan.org";
export function basescanAddress(addr: string): string {
  return `${BASESCAN}/address/${addr}`;
}
