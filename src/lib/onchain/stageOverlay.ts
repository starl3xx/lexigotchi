/**
 * The stage a word just reached, or the miss it just took, shown before the words read catches up.
 *
 * The game reads an ascension's result from the chain itself (`readPrestigeAttempt`: the commit's
 * `revealed` flag with the word's stage and pity, one multicall, so all three are from one block).
 * The player's words come from a slower read (a log scan through a public RPC), which can answer
 * with the old stage for seconds after. Without this, a word that just hit kept its old gold on
 * every screen, and "try again" priced and sized its approval from the stage before.
 *
 * So the provider notes what it read, and this lays it over the words until they agree, or for at
 * most `HOLD_MS` (after that the words read is trusted, even if it still disagrees). The same idea
 * as lib/onchain/pityOverlay for rolls, with one difference: a hit is known here too, because the
 * note is a chain read made after the reveal, never a guess from the signed outcome.
 *
 * Pure, so the rules are tested directly (tests/stage-overlay.test.ts).
 */

/** Longest a noted stage overrides the words read. Reads catch up within seconds; this is a backstop. */
export const HOLD_MS = 60_000;

/** A word's place on the ladder: its stage, and its misses in a row at that stage. */
export interface Stage {
  level: number;
  pity: number;
}

export interface StageNote extends Stage {
  /** When it was noted (ms). */
  at: number;
}

/**
 * True once `chain` is at or past `note`. A word only ever moves forward: pity climbs within a
 * stage, and a hit starts the next stage at zero. So "at or past" is the stage first, then pity.
 */
export function caughtUp(chain: Stage, note: Stage): boolean {
  return chain.level > note.level || (chain.level === note.level && chain.pity >= note.pity);
}

/**
 * The words still marked "an attempt is paid for and not known to be finished" (a try that ended
 * stranded), given the words read now. A mark holds the stage the word stood at when the try was
 * made. Once the read shows the word PAST that (a late hit raised its stage, a late miss its
 * pity), the reveal has landed on its own and the mark goes; a word that left the bag loses its
 * mark too. A read that is merely behind the mark keeps it: the read lags, the attempt hasn't moved.
 * Returns the same object when nothing changes.
 */
export function pruneUnfinished(chain: Readonly<Record<string, Stage>>, marks: Readonly<Record<string, Stage>>): Readonly<Record<string, Stage>> {
  let changed = false;
  const kept: Record<string, Stage> = {};
  for (const [word, mark] of Object.entries(marks)) {
    const at = chain[word];
    const past = at && caughtUp(at, mark) && (at.level !== mark.level || at.pity !== mark.pity);
    if (!at || past) {
      changed = true;
      continue;
    }
    kept[word] = mark;
  }
  return changed ? kept : marks;
}

/** The stage to show for a word: its fresh note while the words read is still behind it. */
export function overlayStage(chain: Stage, note: StageNote | undefined, now: number): Stage {
  if (!note || now - note.at > HOLD_MS || caughtUp(chain, note)) return chain;
  return { level: note.level, pity: note.pity };
}

/**
 * Drop the notes the words read has caught up with, that have aged out, or whose word is no longer
 * in the bag (`chain` has no entry for it). Returns the same object when nothing changes.
 */
export function pruneStageNotes(
  chain: Readonly<Record<string, Stage>>,
  notes: Readonly<Record<string, StageNote>>,
  now: number,
): Readonly<Record<string, StageNote>> {
  let changed = false;
  const kept: Record<string, StageNote> = {};
  for (const [word, note] of Object.entries(notes)) {
    const at = chain[word];
    if (!at || now - note.at > HOLD_MS || caughtUp(at, note)) {
      changed = true;
      continue;
    }
    kept[word] = note;
  }
  return changed ? kept : notes;
}
