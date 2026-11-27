"use client";
/**
 * A word's reference numbers, beside a price (lib/wordCost.ts): about what it costs to make, what it
 * would earn staked, and whether the jackpot has already drawn it. The sell form shows them in full
 * with "Use this price"; each Market listing shows the total, with the parts one tap away.
 */
import { costToMake, dailyEarnEstimate, roundPrice, type CostToMake, type WordShape } from "@/lib/wordCost";
import { fmtUsd, fmtWord, showsUsd, useGame } from "./state";
import { useWorld } from "./useWorld";
import { useTierOf } from "./useRarity";

/** The word's cost to make at the game's live prices, or null while a price is still loading. */
export function useCostToMake(w: WordShape): CostToMake | null {
  const g = useGame();
  const prices = {
    pack: g.price("pack"),
    roll: g.price("roll"),
    claim: g.claimFee, // by the word's tier (decisions.md #60)
    prestigeSnack: g.price("prestigeSnack"),
    prestigeFee: g.prestigePrice,
  };
  // Five letters and at most five stages: cheap enough to work out on every render.
  const c = costToMake(w, prices);
  return Number.isFinite(c.total) && c.total > 0 ? c : null;
}

export function WordValue({
  word,
  cost,
  onUse,
  compact = false,
}: {
  word: WordShape;
  cost: CostToMake | null;
  /** The sell form's "Use this price": hands back the rounded total. */
  onUse?: (price: number) => void;
  /** A Market row: the total, with the parts inside a disclosure. */
  compact?: boolean;
}) {
  const tierOf = useTierOf();
  const g = useGame();
  const world = useWorld().data;
  const amount = (n: number) => (showsUsd(g.state) ? `${fmtWord(n)} $WORD (${fmtUsd(n)})` : `${fmtWord(n)} $WORD`);
  const earn = world?.yieldToday ? dailyEarnEstimate(word, world.yieldToday, tierOf) : undefined;
  const drawn = world?.drawn?.[word.word] !== undefined;

  const parts = cost && (
    <span>
      Letters {fmtWord(cost.letters)}
      {cost.raises > 0 ? ` · raises ${fmtWord(cost.raises)}` : ""} · claim {fmtWord(cost.claim)}
      {cost.ascension > 0 ? ` · ascension ${fmtWord(cost.ascension)}` : ""}. At today’s prices, with the average number of
      tries.
    </span>
  );
  const earnLine =
    earn === undefined ? null : earn === null ? (
      <p>Earns $WORD once all five letters are UPPERCASE.</p>
    ) : earn > 0 ? (
      <p>
        Earns about <strong className="font-display text-ink">{fmtWord(earn)} $WORD a day</strong>, staked and fed, at today’s pool.
      </p>
    ) : null;
  const drawnLine = drawn ? (
    <p className="font-bold text-candy-ink">
      Already drawn for the jackpot. The locked order of secret words never repeats one, so it won’t be drawn again.
    </p>
  ) : null;

  if (compact) {
    return (
      <div className="mt-1 space-y-0.5 text-xs text-ink/60">
        {cost && (
          <details>
            <summary className="cursor-pointer select-none">
              About <strong className="font-display text-ink">{amount(cost.total)}</strong> to make
            </summary>
            <p className="mt-0.5">{parts}</p>
          </details>
        )}
        {earnLine}
        {drawnLine}
      </div>
    );
  }

  return (
    <div className="mb-3 space-y-1 rounded-xl bg-paper-dark/30 px-3 py-2 text-xs text-ink/60">
      {cost && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span>
              Costs about <strong className="font-display text-ink">{amount(cost.total)}</strong> to make
            </span>
            {onUse && (
              <button type="button" onClick={() => onUse(roundPrice(cost.total))} className="font-bold text-teal-ink underline">
                Use this price
              </button>
            )}
          </div>
          <p>{parts} It isn’t what you paid, and nobody else can make {word.word} while you hold it.</p>
        </>
      )}
      {earnLine}
      {drawnLine}
    </div>
  );
}
