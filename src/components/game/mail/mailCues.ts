/**
 * Which sound an envelope makes, and when (decisions.md #49, part 4). Pure, so every case is a test.
 *
 * A cue comes from a STEP: what the envelope showed a moment ago against what it shows now. Never
 * from what it shows when it appears: the sheet's stage is made again for every piece, an envelope
 * that waited is opened at "ready", and one that came back by itself is opened mid-way. Read from
 * the first look, those would all press the stamp and the postmark a second time.
 *
 * The cues (the owner's picks, 2026-11-26): "Paper and ink" for the drop, the stamp, the postmark,
 * the rustle, the tear, and the word; a wooden tile for a letter hopping out; a typewriter's bell
 * for the rare one.
 */
import type { Cue } from "@/lib/sound";
import type { MailPhase } from "./mailFlow";

/** What the envelope shows, as far as sound cares. */
export interface MailView {
  phase: MailPhase;
  /** The postmark, with its number, is on. */
  numbered: boolean;
  /** The strip is off. */
  torn: boolean;
  /** Somebody is shifting inside, right now. */
  fidget: boolean;
  /** How many letters are out of the envelope. */
  out: number;
  /** The rare best letter (the one that got the shake and the shy peek) is out. */
  rareOut: boolean;
  /** The count is up, and it names a word these letters finish. */
  word: boolean;
}

export interface CueEvent {
  cue: Cue;
  /** Pitch: a hop climbs a little with each letter. */
  rate?: number;
  gain?: number;
  /** ms after the step: cues of one step are spread out, in order, so they don't land as one noise. */
  delay: number;
}

/** The gap between two cues of the same step. */
export const CUE_GAP_MS = 190;
/** How much a hop's pitch climbs per letter already out. */
export const HOP_CLIMB = 0.07;

const stamped = (phase: MailPhase) => phase !== "wallet";

/**
 * The cues for one step. `prev` is null when the envelope has just appeared.
 *
 * - Appearing: a piece that is being SENT now drops in (and takes its stamp, if it arrives stamped,
 *   as practice's does). A piece that appears further along (found, ready, waiting, finishing) was
 *   seen before, or waited: it is silent.
 * - Letters out: ONE cue a step, however many came out in it (a tap hurries all of them at once,
 *   and reduced motion shows them together). The bell rings once, for the rare best letter; every
 *   other letter, another rare one too, hops.
 */
export function cuesForStep(prev: MailView | null, next: MailView): CueEvent[] {
  const cues: Omit<CueEvent, "delay">[] = [];
  if (!prev) {
    if (next.phase === "wallet" || next.phase === "paid") cues.push({ cue: "drop" });
    if (next.phase === "paid") cues.push({ cue: "stamp" });
  } else {
    if (!stamped(prev.phase) && stamped(next.phase)) cues.push({ cue: "stamp" });
    if (!prev.numbered && next.numbered) cues.push({ cue: "postmark" });
    if (!prev.fidget && next.fidget) cues.push({ cue: "rustle", gain: 0.5 });
    if (!prev.torn && next.torn) cues.push({ cue: "tear" });
    if (next.out > prev.out) {
      if (!prev.rareOut && next.rareOut) cues.push({ cue: "rare" });
      else cues.push({ cue: "hop", rate: 1 + (next.out - 1) * HOP_CLIMB });
    }
    if (!prev.word && next.word) cues.push({ cue: "word" });
  }
  return cues.map((c, i) => ({ ...c, delay: i * CUE_GAP_MS }));
}
