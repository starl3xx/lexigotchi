"use client";
/**
 * The $WORD page (rail: "$WORD universe", above Let's Have A Word!): the real token, whatever network
 * the game runs on. Its price and market cap, the supply and both kinds of burn, the pool, how
 * Lexigotchi uses it, and Let's Have A Word!'s side. Numbers from /api/word (lib/wordStats explains
 * each); the price is the app's own oracle, the same one the footer shows.
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { Button, Card, SectionTitle } from "../primitives";
import { ArrowRight, Copy, Fire, Planet } from "../ui/icons";
import { fmtWord, useGame } from "../state";
import { BUY_URL, useBuyWord } from "../useBuyWord";
import { SwapCard } from "../SwapCard";
import { useOpenUrl } from "../useShare";
import { fmtMarketCap } from "@/components/WordStrip";
import { DOCS_URL } from "@/lib/site";
import { DEFAULT_PARAMS } from "@/lib/params";
import { WORD_TOKEN } from "@/lib/wordStats";
import type { WordSummary } from "@/app/api/word/route";
import { usePlayerWallets } from "../usePlayerWallets";

const BASESCAN = `https://basescan.org/token/${WORD_TOKEN}`;

/** A sub-cent price with three significant figures and no exponent: $0.000000230. */
function fmtPrice(usd: number): string {
  if (!(usd > 0)) return "–";
  const decimals = Math.min(14, Math.max(2, -Math.floor(Math.log10(usd)) + 2));
  return `$${usd.toFixed(decimals)}`;
}
const fmtUsd0 = (usd: number | null | undefined) =>
  usd == null ? "–" : usd >= 1000 ? `$${(usd / 1000).toFixed(1)}K` : `$${usd.toFixed(usd < 10 ? 2 : 0)}`;
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

export function WordScreen() {
  const g = useGame();
  const { address } = useAccount();
  const { buy, env } = useBuyWord();
  const openUrl = useOpenUrl();
  // The public numbers and the wallet's balance are separate queries: keying the public summary on
  // the address made every connect or reconnect a new query, and every card flashed empty while the
  // same public numbers came back (Bugbot on #131).
  const q = useQuery({
    queryKey: ["word"],
    queryFn: async (): Promise<WordSummary> => (await fetch("/api/word")).json(),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  // Every wallet of the player (usePlayerWallets), summed: linked wallets hold one player's $WORD.
  const wallets = usePlayerWallets();
  const holderQ = useQuery({
    queryKey: ["wordHolder", wallets.join(",")],
    queryFn: async () => ((await (await fetch(`/api/word?addresses=${wallets.join(",")}`)).json()) as WordSummary).holder ?? null,
    enabled: !!address && wallets.length > 0,
    staleTime: 30_000,
  });
  const d = q.data;
  const holder = address ? holderQ.data : null;
  const s = d?.supply;
  const change = d?.pool?.priceChange24hPct ?? null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(WORD_TOKEN);
      g.toast("Contract address copied", "good");
    } catch {
      g.toast("Couldn’t copy. Select the address instead.", "info");
    }
  };

  const splits = DEFAULT_PARAMS.splits;
  const burnShares: [string, number][] = [
    ["Pack", splits.packMint.burn],
    ["Roll", splits.roll.burn],
    ["Claim", splits.claim.burn],
    ["Snack", splits.snack.burn],
  ];

  return (
    <div className="space-y-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0">
      {/* hero: price, market cap, buy */}
      <Card className="bg-gradient-to-b from-card to-gold/15 lg:col-span-2">
        <h1 className="font-display text-2xl font-extrabold">$WORD</h1>
        <p className="mt-0.5 text-sm text-ink/70">The token behind Lexigotchi and Let’s Have A Word!, on Base.</p>
        {/* Phones: the price gets its own row (a sub-cent price is wide); desktop: three across. */}
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
          <Stat label="Price" big className="col-span-2 md:col-span-1">
            {d ? fmtPrice(d.price.usd) : "–"}
          </Stat>
          <Stat label="Market cap" big>
            {fmtMarketCap(d?.price.marketCapUsd)}
          </Stat>
          <Stat label="24 hours" big>
            {change == null ? (
              "–"
            ) : (
              <span className={change >= 0 ? "text-teal-ink" : "text-candy-ink"}>
                {change >= 0 ? "+" : ""}
                {change.toFixed(1)}%
              </span>
            )}
          </Stat>
        </div>
        {holder && (
          <p className="mt-3 text-sm">
            You hold <strong className="tabular-nums">{fmtWord(holder.balance)} $WORD</strong>
            {(holder.wallets ?? 0) > 1 && <> across {holder.wallets} wallets</>}
            {d && d.price.usd > 0 && <span className="text-ink/60"> (about {fmtUsd0(holder.balance * d.price.usd)})</span>}.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {/* Inside Farcaster, the host's own swap; on the web, the swap card below does it here. */}
          {env === "farcaster" ? (
            <Button variant="primary" onClick={buy}>
              Buy $WORD
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => void openUrl(BUY_URL)} disabled={env === "loading"}>
              Other ways to buy ↗
            </Button>
          )}
          {d?.pool && (
            <Button variant="ghost" onClick={() => void openUrl(d.pool!.url)}>
              Chart ↗
            </Button>
          )}
        </div>
      </Card>

      {/* swap, on the web (Farcaster uses the host's swap, above) */}
      {env === "web" && <SwapCard />}

      {/* supply and burns */}
      <Card>
        <SectionTitle>Supply</SectionTitle>
        {s ? (
          <div className="space-y-2.5">
            <Stat label="Total supply now" big>
              {fmtWord(s.total)}
            </Stat>
            <div className="h-3 overflow-hidden rounded-full border-2 border-ink bg-card" aria-hidden>
              <div className="h-full bg-candy" style={{ width: `${Math.max(1, (s.outOfCirculation / s.minted) * 100)}%` }} />
            </div>
            <Rows
              rows={[
                ["Minted", `${fmtWord(s.minted)}`],
                ["Burned (destroyed)", `${fmtWord(s.destroyed)}`],
                ["At the dead address", `${fmtWord(s.dead)}`],
                ["Out of circulation", `${fmtWord(s.outOfCirculation)} (${pct(s.outOfCirculation / s.minted)})`],
              ]}
            />
            <p className="text-xs text-ink/60">
              A burn destroys $WORD for good and lowers the supply. Tokens sent to the dead address can never move
              again, but the supply still counts them.
            </p>
          </div>
        ) : (
          <Empty loading={q.isLoading} />
        )}
      </Card>

      {/* the market */}
      <Card>
        <SectionTitle>Market</SectionTitle>
        {d?.pool ? (
          <div className="space-y-2.5">
            <Rows
              rows={[
                ["Pool liquidity (both sides)", fmtUsd0(d.pool.liquidityUsd)],
                ["Traded in 24 hours", fmtUsd0(d.pool.volume24hUsd)],
                ["Where it trades", "Uniswap v4 on Base"],
              ]}
            />
            <p className="text-xs text-ink/60">The pool is small, so a large trade moves the price.</p>
          </div>
        ) : (
          <Empty loading={q.isLoading} />
        )}
      </Card>

      {/* how Lexigotchi uses it */}
      <Card>
        <SectionTitle>In Lexigotchi</SectionTitle>
        <p className="text-sm text-ink/80">
          Every pack, roll, claim, and snack is paid in $WORD, and part of each fee is burned for good:
        </p>
        <div className="mt-2.5 grid grid-cols-4 gap-2">
          {burnShares.map(([label, share]) => (
            <div key={label} className="cel-sm rounded-xl bg-card px-2 py-1.5 text-center">
              <div className="flex items-center justify-center gap-0.5 font-display text-base font-extrabold text-candy-ink">
                <Fire weight="fill" size={13} aria-hidden />
                {pct(share)}
              </div>
              <div className="text-xs text-ink/60">{label}</div>
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-xs text-ink/60">
          The rest funds the Rewards Pool, the daily jackpot, and the treasury, all in $WORD. Lexigotchi’s burns count
          from launch.
        </p>
        <button onClick={() => void openUrl(`${DOCS_URL}/fees`)} className="mt-2 text-xs font-bold text-ink/60 underline">
          Where fees go ↗
        </button>
      </Card>

      {/* Let's Have A Word! */}
      <Card>
        <SectionTitle>Let’s Have A Word!</SectionTitle>
        {d?.lhaw ? (
          <Rows
            rows={[
              ["Staked in Let’s Have A Word!", d.lhaw.staked == null ? "–" : fmtWord(d.lhaw.staked)],
              ["Its burn count", d.lhaw.burned == null ? "–" : fmtWord(d.lhaw.burned)],
            ]}
          />
        ) : (
          <Empty loading={q.isLoading} />
        )}
        <p className="mt-2 text-xs text-ink/60">
          Its burn count includes what its older contract sent to the dead address.
        </p>
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => g.nav("lhaw")}>
          <Planet weight="bold" /> The live round <ArrowRight weight="bold" />
        </Button>
      </Card>

      {/* the contract */}
      <Card className="lg:col-span-2">
        <SectionTitle>Contract</SectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 break-all rounded-lg bg-paper px-2 py-1 font-mono text-xs">{WORD_TOKEN}</code>
          <Button variant="ghost" size="sm" onClick={() => void copy()}>
            <Copy weight="bold" /> Copy
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void openUrl(BASESCAN)}>
            Basescan ↗
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, big = false, className = "", children }: { label: string; big?: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="text-xs font-bold text-ink/60">{label}</div>
      <div className={big ? "truncate font-display text-xl font-extrabold tabular-nums md:text-2xl" : "text-sm font-bold"}>{children}</div>
    </div>
  );
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="divide-y-2 divide-ink/10 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3 py-1.5">
          <dt className="text-ink/70">{k}</dt>
          <dd className="font-bold tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Empty({ loading }: { loading: boolean }) {
  return <p className="text-sm text-ink/60">{loading ? "Loading…" : "Couldn’t load this just now. It retries every minute."}</p>;
}
