/**
 * Today's three pots, side by side at the bottom (starl3xx, 2026-11-26): the jackpot, the week's
 * bounty, and the Rewards Pool. Each shows its $WORD amount and about what that is in dollars.
 * Pure, so the dollar rule is tested both ways: practice mode always shows dollars, and the test
 * game never does (showsUsd: test $WORD has no value).
 */
import { DEFAULT_PARAMS } from "@/lib/params";
import { fmtUsdShort, fmtWord } from "@/lib/wordAmount";

/** One pot as a tile shows it. */
export interface PotLine {
  /** "18.50M", or an en dash while the pot is unread (a 0 would read as an empty pot). */
  amount: string;
  /** "$WORD", or "test $WORD" in the test game. */
  unit: string;
  /** "about $4.20", or null: no dollars for test $WORD, nor for a pot not read yet. */
  usd: string | null;
}

/**
 * `word` is the pot in whole $WORD, null while unread. `usd` is showsUsd(state); `wordUsd` is the
 * live price of one $WORD (currentWordUsd), read when the line is drawn.
 */
export function potLine(word: number | null, o: { usd: boolean; wordUsd: number }): PotLine {
  const known = word != null && Number.isFinite(word);
  return {
    amount: known ? fmtWord(word) : "–",
    unit: o.usd ? "$WORD" : "test $WORD",
    usd: known && o.usd && o.wordUsd > 0 ? `about ${fmtUsdShort(word * o.wordUsd)}` : null,
  };
}

/** The share of the Rewards Pool paid out each day ("1%"), from the keeper's own rate. */
export const POOL_DAILY_SHARE = `${+(DEFAULT_PARAMS.staking.dailyDistributionRate * 100).toFixed(2)}%`;

/** The player's place in today's jackpot, in a line that fits the tile. */
export interface JackpotStanding {
  text: string;
  tone: "gold" | "candy" | "quiet";
  /** Today's word, once it has been drawn: shown after the text, in the display face. */
  word?: string;
  /** The player may be holding today's word (the eye icon follows). */
  secret?: boolean;
}

/**
 * The same cases as the old jackpot card, in its order. A returning player must never read the
 * newcomer's line while their words load, so an unread bag says nothing (null). Every "how to get
 * in" line carries "staked and fed" (docs/messaging.md).
 */
export function jackpotStanding(i: {
  /** Today's word once drawn, else null. */
  revealedWord: string | null;
  /** The player holds today's word: in the running ("in") or not ("out"); null if they don't. */
  holds: "in" | "out" | null;
  /** The player's words are read (not loading, no error). */
  wordsKnown: boolean;
  words: number;
  inTheRunning: number;
}): JackpotStanding | null {
  if (i.revealedWord) return { text: "Today’s word was", word: i.revealedWord, tone: "quiet" };
  if (i.holds === "in") return { text: "You may be holding today’s word", tone: "candy", secret: true };
  if (i.holds === "out") return { text: "You hold today’s word. Stake it and wake it!", tone: "candy" };
  if (!i.wordsKnown) return null;
  if (i.words === 0) return { text: "Spell a word, stake it, and wake it every day to enter", tone: "quiet" };
  if (i.inTheRunning === 0) return { text: "Stake a word and wake it every day to enter", tone: "quiet" };
  return { text: "You’re in the running", tone: "gold" };
}
