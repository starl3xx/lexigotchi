"use client";
/**
 * What sold lately (decisions.md #30), newest first: the thing, what the buyer paid, who sold it to
 * whom, and when. It is read from the chain by the server, so a sale made anywhere shows here.
 * A sold word opens its word view (decisions.md #32): who has it now, and its card. Not in the
 * practice game, unless the word is the player's: its other players are in no world read, so a word
 * one of them bought would open as nobody's.
 */
import type { Tier } from "@/lib/economy";
import { explorerTx } from "@/lib/onchain/network";
import { isUpperId, letterLabel } from "@/lib/market/deals";
import type { MarketSale } from "@/lib/market/types";
import { TierBadge } from "../primitives";
import { LetterTile } from "../LetterTile";
import { PlayerChip } from "../PlayerChip";
import { fmtWord, useGame } from "../state";
import { useOpenUrl } from "../useShare";
import { useOpenWord } from "../useDictionary";
import { timeAgo } from "./bits";

export function SoldList() {
  const g = useGame();
  const openUrl = useOpenUrl();
  const openWord = useOpenWord();
  const sales = g.market.sales;
  if (sales.length === 0) {
    return <p className="py-6 text-center text-sm text-ink/55">Nothing has sold yet. The first sale shows here.</p>;
  }
  return (
    <ul className="lg:grid lg:grid-cols-2 lg:gap-x-8">
      {sales.map((s) => (
        <li key={`${s.tx}:${s.kind}:${s.word ?? s.letterId}`} className="flex items-center justify-between gap-3 border-b-2 border-dashed border-ink/15 py-2.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {s.kind === "word" && s.word && (g.state.chainBacked || g.state.words.some((w) => w.word === s.word)) ? (
                <button type="button" className="word-press" onClick={() => openWord(s.word!)}>
                  <SoldThing sale={s} />
                </button>
              ) : (
                <SoldThing sale={s} />
              )}
              {s.kind === "letter" && s.qty > 1 && <span className="text-sm text-ink/60">×{s.qty}</span>}
              {s.kind === "word" && s.tier && <TierBadge tier={s.tier as Tier} />}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-ink/60">
              <PlayerChip address={s.seller} profile={g.market.faces[s.seller]} you={g.state.chainBacked && g.market.isMine(s.seller)} size={16} />
              <span>sold to</span>
              <PlayerChip address={s.buyer} profile={g.market.faces[s.buyer]} you={g.state.chainBacked && g.market.isMine(s.buyer)} size={16} />
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-display text-base font-extrabold leading-none tabular-nums">{fmtWord(s.price)}</div>
            <div className="text-xs text-ink/55">
              {s.kind === "letter" && s.qty > 1 ? `${fmtWord(s.unitPrice)} each` : "$WORD"}
            </div>
            {/^0x[0-9a-f]{64}$/.test(s.tx) ? (
              <button type="button" onClick={() => openUrl(explorerTx(s.tx))} className="text-xs text-ink/55 underline">
                {timeAgo(s.at)}
              </button>
            ) : (
              <div className="text-xs text-ink/55">{timeAgo(s.at)}</div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The word, or the letter and how many. */
export function SoldThing({ sale: s, size = 30 }: { sale: MarketSale; size?: number }) {
  // The word's name, not its tiles: a sale doesn't record which letters were raised.
  if (s.kind === "word" && s.word) return <span className="font-display text-base font-extrabold tracking-wide">{s.word}</span>;
  if (s.letterId === undefined) return null;
  // How many is said in words beside it: a count badge covers a tile this small.
  return <LetterTile char={letterLabel(s.letterId)} upper={isUpperId(s.letterId)} size={size} />;
}
