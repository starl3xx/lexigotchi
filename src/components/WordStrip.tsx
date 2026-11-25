"use client";
/**
 * The $WORD line at the foot of every page: the contract, a link to it, and the market cap, on one
 * line (as Let's Have A Word! shows it). Always the REAL token on Base, even when the game runs on a
 * testnet: this is the token's public identity, not the game's balance.
 *
 * "Market cap" is GeckoTerminal's fully diluted value (price × total supply), the same figure LHAW
 * labels market cap. Unknown renders "—", never $0.
 */
import { useWordPrice } from "@/lib/oracle/useWordPrice";

// The address lives in lib/wordStats (server-safe); re-exported here for the screens that import it.
import { WORD_TOKEN } from "@/lib/wordStats";
export { WORD_TOKEN };
const SHORT = `${WORD_TOKEN.slice(0, 6)}…${WORD_TOKEN.slice(-4)}`;
const BASESCAN = `https://basescan.org/token/${WORD_TOKEN}`;
const CHART = `https://www.geckoterminal.com/base/tokens/${WORD_TOKEN}`;

export function fmtMarketCap(usd: number | null | undefined): string {
  if (!usd || !Number.isFinite(usd) || usd <= 0) return "—";
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${Math.round(usd)}`;
}

/** Presentational: the caller supplies the market cap (the game shell already polls the price). */
export function WordStrip({ marketCapUsd, className = "" }: { marketCapUsd: number | null | undefined; className?: string }) {
  const link = "underline-offset-2 hover:text-candy hover:underline";
  return (
    <div className={`flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-ink/55 ${className}`}>
      <span className="font-bold text-ink/70">$WORD</span>
      <a href={BASESCAN} target="_blank" rel="noopener noreferrer" title={`${WORD_TOKEN} on Basescan`} className={`font-mono ${link}`}>
        {SHORT}
      </a>
      <span aria-hidden>·</span>
      <span>
        Market cap <span className="font-bold tabular-nums text-ink/70">{fmtMarketCap(marketCapUsd)}</span>
      </span>
      <span aria-hidden>·</span>
      <a href={CHART} target="_blank" rel="noopener noreferrer" className={link}>
        Chart ↗
      </a>
    </div>
  );
}

/** Self-fetching, for pages without the game shell (the landing page, the share pages). */
export function WordStripLive({ className = "" }: { className?: string }) {
  const { live } = useWordPrice();
  return <WordStrip marketCapUsd={live?.fdvUsd} className={className} />;
}
