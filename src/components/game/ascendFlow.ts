/**
 * The ascend sheet's rules (sheets/AscendSheet), apart from its drawing so they can be tested:
 * where a finished attempt leaves the sheet, which stage it shows while a result is on its way,
 * what the next try is, and how a result passes along the word's letters.
 *
 * The rule under all of it is lib/onchain/guardedAction's: an attempt costs its fee whatever it
 * gives back, so the sheet never offers another try unless it KNOWS the last one is finished.
 */
import { HOLOGRAPHIC_LEVEL, stageName } from "@/lib/ascension";
import type { ActionOutcome } from "@/lib/onchain/guardedAction";
import { caughtUp, type Stage } from "@/lib/onchain/stageOverlay";
import type { Gild, TileState } from "./TileCharacter";

/**
 * - `ready`: nothing out. The button is a paid try.
 * - `trying`: an attempt is out (the wallet, then the chain). The letters can't look.
 * - `hit` / `miss`: the chain's answer. Another try is safe.
 * - `stranded`: paid, and not known to be finished. No try is offered: it would pay twice.
 */
export type AscendPhase = "ready" | "trying" | "hit" | "miss" | "stranded";

/** Where a finished attempt leaves the sheet. `not-started` spent nothing, so the sheet is ready again. */
export function phaseAfter(outcome: ActionOutcome): AscendPhase {
  if (outcome.status === "not-started") return "ready";
  if (outcome.status === "stranded") return "stranded";
  return outcome.success ? "hit" : "miss";
}

/**
 * The stage a result leaves by the rule: a hit starts the next stage fresh, a miss adds one to the
 * pity. This is the practice store's own rule. In the chain game the sheet shows what the chain
 * read back instead (ActionOutcome's `stage`), because one miss there adds nothing: a signed
 * success that no longer counted.
 */
export function stageAfter(from: Stage, hit: boolean): Stage {
  return hit ? { level: from.level + 1, pity: 0 } : { level: from.level, pity: from.pity + 1 };
}

/**
 * The stage the sheet draws and prices from.
 * - While a try is out it is the stage at the tap (`from`), whatever the store says: the practice
 *   store applies a result the moment it is drawn, and a words read can land mid-flight; either
 *   would gild the word, or move its odds, before the letters have opened their eyes.
 * - After a result it is what that result leaves (`expected`: the chain's own read where the
 *   store handed one over, else `stageAfter`), until the store has caught up.
 * - Otherwise it is the store's own (`live`).
 */
export function shownStage(phase: AscendPhase, live: Stage, from: Stage | null, expected: Stage | null): Stage {
  if (phase === "trying" && from) return from;
  if ((phase === "hit" || phase === "miss") && expected && !caughtUp(live, expected)) return expected;
  return live;
}

/**
 * What the result's second button does, or null when Done stands alone. A miss never touches the
 * word, so it can always try again; a hit can go for the next stage unless it reached the top.
 */
export function nextTry(phase: AscendPhase, level: number, maxLevel: number): "again" | "next" | null {
  if (level >= maxLevel) return null;
  if (phase === "miss") return "again";
  if (phase === "hit") return "next";
  return null;
}

/**
 * A result as a toast, for when the ascend sheet isn't there to show it (closed while the try was
 * out). The sheet shows a result, or a toast says it: once, and always. `level` is the stage the
 * word stands at after the result.
 *
 * `oddsRose`: the next try's odds are higher than this one's were. Usually true of a miss, but not
 * always: a signed success that no longer counted adds no miss, and at the cap a miss adds nothing
 * either. The toast claims it only when it is so (Bugbot on #229).
 */
export function resultToast(word: string, hit: boolean, level: number, oddsRose: boolean): { text: string; tone: "good" | "info" } {
  if (!hit) return { text: oddsRose ? `${word} held its ground. Next try’s odds are higher` : `${word} held its ground`, tone: "info" };
  return { text: level >= HOLOGRAPHIC_LEVEL ? `${word} turned Holographic!` : `${word} reached ${stageName(level)}`, tone: "good" };
}

/**
 * A try that ended paid and not known to be finished, said in a toast when its sheet has gone.
 * Without it the only word was the wallet's own "Cancelled", over a fee already spent.
 */
export function strandedToast(word: string, note: string): string {
  return `${word}: ${note}`;
}

/**
 * How each letter stands while a result passes along the word, left to right. `reached` letters
 * have had it: they wear `after`'s gold and the result's face. The rest still can't look, in the
 * gold they had at the tap.
 */
export function waveOf(
  letters: number,
  reached: number,
  result: TileState,
  from: Gild,
  after: Gild,
): { states: TileState[]; gilds: Gild[] } {
  const states: TileState[] = [];
  const gilds: Gild[] = [];
  for (let i = 0; i < letters; i++) {
    states.push(i < reached ? result : "rolling");
    gilds.push(i < reached ? after : from);
  }
  return { states, gilds };
}
