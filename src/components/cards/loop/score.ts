/**
 * The score of the share video's letters (decisions.md #48, part 7): what each letter does at each
 * moment of the six seconds, so that the letters on the card breathe, blink, and glance as they do
 * in the game (starl3xx: "the eyes and blinking and subtle movement is chef's kiss, BUT this
 * doesn't come across in the downloaded video").
 *
 * In the game a word's life runs off a timer and a random number. A video can have neither: every
 * frame must be the same on every device, and the last frame must lead into the first. So the life
 * is WRITTEN here, as functions of time, and every motion takes a time that divides the loop.
 *
 * Pure: no drawing, no clock.
 */
import { LOOP_SECONDS } from "./loopRenderer";

/** One breath: half the loop, so two breaths end where they began. (The game's is 3.6 s, which doesn't fit six.) */
export const BREATH_S = LOOP_SECONDS / 2;
/**
 * How far a body rises in a breath, in the rig's units. The game's is 3; the video's is deeper
 * (starl3xx: "i like 'a little deeper' for the videos"): the video is small and gets compressed,
 * and at its size the game's breath is under two pixels.
 */
export const BREATH_UNITS = 4.8;
/** The legs' stretch at the top of a breath: the rise over a leg's own length (52 units), so the feet stay down. */
export const LEG_STRETCH = BREATH_UNITS / 52;
/** Each letter breathes this far behind the one before it, as in the game. */
export const BREATH_STEP_S = 0.6;
/** How long a blink shows (the game's is 0.12 s; four frames of the video). */
export const BLINK_S = 0.13;
/** How far a pupil travels in a glance, in the rig's units (the game's --glance 0.9 × 5.5). */
export const GLANCE_UNITS = 4.95;
/** The front faces away from about here to about there: nothing a letter does then is seen. */
export const FRONT_AWAY: readonly [number, number] = [2.25, 5.15];

export type Eyes = "open" | "shut" | "left" | "right";

const wrap = (t: number) => ((t % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS;

/**
 * Which eyes letter `i` of `n` shows at time `t`.
 * - Early on: one letter near the middle blinks, and the next one catches it, as in the game.
 * - The last letter glances along the word; then the first one does.
 * - The card turns over and comes home.
 * - As the front comes home the word blinks along its length, a letter at a time, as if the turn
 *   had made it dizzy; then one letter blinks once more.
 */
export function eyesAt(i: number, n: number, t: number): Eyes {
  const s = wrap(t);
  const within = (from: number, d = BLINK_S) => s >= from && s < from + d;
  const mid = Math.min(n - 1, Math.floor(n / 2));
  const last = n - 1;
  if (i === mid && within(0.5)) return "shut";
  if (n > 1 && i === (mid + 1) % n && within(0.64)) return "shut";
  if (i === 0 && within(1.25)) return "shut";
  if (n > 1 && i === last && s >= 0.95 && s < 1.8) return "left";
  if (n > 1 && i === 0 && s >= 1.5 && s < 2.2) return "right";
  if (within(5.34 + i * 0.07)) return "shut";
  if (i === mid && within(5.78)) return "shut";
  return "open";
}

/** How far letter `i` has risen at time `t`, 0 to 1: the game's breath (ease in, ease out), each letter a little behind the last. */
export function breathAt(i: number, t: number): number {
  const p = wrap(t + i * BREATH_STEP_S) % BREATH_S / BREATH_S;
  const s = p < 0.5 ? p * 2 : (1 - p) * 2;
  return s * s * (3 - 2 * s);
}
