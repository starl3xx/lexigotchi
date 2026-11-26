/**
 * The Dictionary hands a word to Spell: "Spell BINGO" in the word view opens Spell with BINGO on
 * the rack, where its Claim button already is. The Dictionary gets no claim button of its own
 * (decisions.md #31): one place claims, so the owner check, the fee line, and the case rules live once.
 *
 * A word waits here between the tap and Spell mounting (a navigation, not a render), and is taken
 * exactly once, so coming back to Spell later starts with an empty rack as always.
 */
let queued: string | null = null;

/** Queue a word for Spell's rack. Follow it with `nav("claim")`. */
export function queueSpell(word: string): void {
  queued = word.toUpperCase();
}

/** The word waiting for Spell, if any. Taking it clears it. */
export function takeQueuedSpell(): string | null {
  const w = queued;
  queued = null;
  return w;
}
