"use client";
/**
 * One tappable line: what the player's words earned at the latest payout and in all. Opens the
 * Earnings sheet. Under the Today stage (on its night footer) and over the Bag's words. Silent for
 * a player with nothing earned and no word that could earn yet: Next steps tells them how.
 */
import { CaretRight, Coins } from "./ui/icons";
import { fmtWord, hunger, useGame } from "./state";
import { earningsLineText, payoutTimeLocal } from "./earnings";

export function EarningsLine({ onDark = false }: { onDark?: boolean }) {
  const g = useGame();
  const { state } = g;
  const e = g.earnings;
  if (!e) return null;
  // A word that will earn at the next payout: all UPPERCASE, staked, and not hungry.
  const canEarn = state.words.some((w) => w.staked && w.upper.every(Boolean) && hunger(w) !== "hungry");
  const text = earningsLineText(e, { canEarn, practice: !state.chainBacked, payoutTime: payoutTimeLocal(), fmt: fmtWord });
  if (!text) return null;
  return (
    <button
      onClick={() => g.openSheet({ kind: "earnings" })}
      className={`press-icon flex w-full items-center gap-2 rounded-xl px-1 text-left text-sm ${onDark ? "text-paper" : "text-ink"}`}
    >
      <Coins weight="fill" size={16} className={`shrink-0 ${onDark ? "text-gold" : "text-gold-ink"}`} />
      <span className="min-w-0 flex-1">
        {text.lead}
        {text.amount && <strong className={onDark ? "text-gold" : "text-gold-ink"}>{text.amount}</strong>}
        {text.rest}
      </span>
      <CaretRight weight="bold" size={14} className={`shrink-0 ${onDark ? "text-paper/70" : "text-ink/40"}`} />
    </button>
  );
}
