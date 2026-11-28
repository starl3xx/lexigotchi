/**
 * Waking a word: the act, as rules (decisions.md #64). Pure, so every beat is tested
 * (tests/wake-flow.test.ts); ./useWakeAct plays it and ./wakeRun says which wake is in hand.
 *
 * A wake is not instant: the wallet asks, and then the chain takes 2 to 20 seconds. So the act has
 * four beats, and **nothing looks awake before the chain says so**:
 *
 *   the tap      the player pressed Wake. One sleeper half opens its eyes.
 *   the wait     the letters do the waiting: about once a second another one peeks and dozes
 *                again, never two in step. No spinner goes on the card.
 *   it lands     the wake passes along the word, a letter at a time, as the card's ink comes back;
 *                then the word stretches with its joined hands up, and bows.
 *   it does not  the wallet said no, or the wake never landed: the letters settle back as they were.
 *
 * The letters are vaudeville players and a word already stands hand in hand, so a woken word does
 * what a cast does at the end of a show. No tile is ever scaled: a rise and a dip are taken up by
 * the legs, as the hover and the press are (globals.css, .wk-rise and .wk-bow). No sound (the
 * owner's 27B).
 */
import type { TileState } from "../TileCharacter";

/** How a wake ended: the words read back awake; sent, but not seen yet; or nothing was sent. */
export type WakeOutcome = "landed" | "pending" | "none";
export type WakePhase = "waiting" | "landed";

/** What a card's letters wear at one moment of the act: a state and a moment's class for each, and the hands. */
export interface ActFrame {
  states: TileState[];
  armsUp: boolean;
  /** a class for the box around each letter, for a moment (globals.css: wk-rise, wk-bow; tc-blink shuts the eyes) */
  moments: string[];
}
/** A step of the act: from `at` ms the card shows `frame`. `null` ends it: the card shows the word as it is. */
export interface ActStep {
  at: number;
  frame: ActFrame | null;
}

/** The act's times, in ms. */
export const WAKE = {
  /** the wake passes along the word: one letter, then the next */
  step: 85,
  /** all awake and on their toes, before they come down */
  settle: 320,
  /** down, a breath, before the hands go up */
  breath: 240,
  /** joined hands up, on their toes */
  up: 600,
  /** the bow: eyes shut, a dip */
  bow: 560,
  /** up again, before the word is itself */
  rest: 460,
  /** while the wake is on its way: how often a sleeper peeks, and for how long */
  stirEvery: 980,
  peek: 850,
  /** under reduced motion the letters wake one by one and then hold, with no rise, hands, or bow */
  reducedHold: 900,
  /** a small card is a still picture: its letters hop once, one card after another */
  hopFirst: 140,
  hopStep: 95,
  hopMs: 900,
  hopCards: 9,
  /** a wake the wallet never answers is let go after this long */
  giveUp: 90_000,
} as const;

/** A moment's classes (globals.css). The bow shuts the eyes with the rig's own blink. */
export const RISE = "wk-rise";
export const BOW = "wk-bow tc-blink";
export const BLINK = "tc-blink";

const fill = <T,>(n: number, v: T): T[] => Array.from({ length: n }, () => v);

/** The look a card holds while its wake is on its way: every letter as it was. `peek` is the one that stirs. */
export function stirFrame(n: number, before: TileState, peek: number | null): ActFrame {
  const states = fill<TileState>(n, before);
  const moments = fill(n, "");
  if (peek !== null && peek >= 0 && peek < n) {
    // a sleeper half opens its eyes (the sleepy face); a sleepy letter, already half awake, blinks
    if (before === "hungry") states[peek] = "peckish";
    else moments[peek] = BLINK;
  }
  return { states, armsUp: false, moments };
}

// Never two in step, and never along the row: a wave would look like the wake itself.
const STIR_ORDER = [2, 0, 4, 1, 3, 0, 2, 4, 1, 3];
/** Which letter stirs at the `tick`-th beat of the wait. */
export const stirLetter = (tick: number, n: number): number => STIR_ORDER[((tick % STIR_ORDER.length) + STIR_ORDER.length) % STIR_ORDER.length] % Math.max(1, n);

/**
 * The act from the moment the wake lands, for a word of `n` letters that was `before` (sleepy or
 * asleep). Under reduced motion the letters still wake one by one, since that is a change of
 * picture and not a movement; nothing rises, no hands go up, and nobody bows.
 */
export function wakeScore(n: number, before: TileState, reduced: boolean): ActStep[] {
  const steps: ActStep[] = [];
  const awake = (k: number): TileState[] => Array.from({ length: n }, (_, i) => (i < k ? "glad" : before));
  for (let i = 0; i < n; i++) {
    steps.push({ at: i * WAKE.step, frame: { states: awake(i + 1), armsUp: false, moments: Array.from({ length: n }, (_, j) => (!reduced && j <= i ? RISE : "")) } });
  }
  const all = fill<TileState>(n, "glad");
  let t = (n - 1) * WAKE.step;
  if (reduced) {
    steps.push({ at: t + WAKE.reducedHold, frame: null });
    return steps;
  }
  t += WAKE.settle;
  steps.push({ at: t, frame: { states: all, armsUp: false, moments: fill(n, "") } });
  t += WAKE.breath;
  steps.push({ at: t, frame: { states: all, armsUp: true, moments: fill(n, RISE) } });
  t += WAKE.up;
  steps.push({ at: t, frame: { states: all, armsUp: false, moments: fill(n, BOW) } });
  t += WAKE.bow;
  steps.push({ at: t, frame: { states: all, armsUp: false, moments: fill(n, "") } });
  t += WAKE.rest;
  steps.push({ at: t, frame: null });
  return steps;
}

/** How long the act runs, from landing to rest. */
export const wakeActMs = (n: number, reduced: boolean): number => wakeScore(n, "hungry", reduced).at(-1)!.at;

/** A small card's turn to hop: the cards go one after another, and past the ninth they go together. */
export const hopDelay = (index: number): number => WAKE.hopFirst + Math.min(Math.max(0, index), WAKE.hopCards - 1) * WAKE.hopStep;
