/**
 * Feed all (Today and the Bag): which staked words it feeds, and what its button says. Pure, so the
 * count on the button is always the number of words the send feeds.
 *
 * A word is fed by Feed all when it's staked, isn't full (peckish or hungry), and this wallet may feed
 * it: its own, or a staker's word it cares for (Staking.setCaretaker). Any other linked wallet's word
 * would revert the whole batch, and a full word would burn a snack for nothing (feed() has no guard).
 */
import { hunger, type OwnedWord } from "./state";

export function wordsToFeed(words: readonly OwnedWord[], hungerOf: (w: OwnedWord) => ReturnType<typeof hunger> = (w) => hunger(w)): OwnedWord[] {
  return words.filter((w) => (w.mine || w.care) && w.staked && hungerOf(w) !== "fed");
}

/** "Feed CRANE" for one word, "Feed all 3" for more. */
export function feedAllLabel(toFeed: readonly OwnedWord[]): string {
  return toFeed.length === 1 ? `Feed ${toFeed[0].word}` : `Feed all ${toFeed.length}`;
}
