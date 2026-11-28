"use client";
/**
 * The wake in hand (decisions.md #64): which words the player is waking, and whether the chain has
 * said so yet. It lives outside any screen, as the piece of mail in hand does, because a wake
 * outlives the screen it was started on: the player can turn to another word, close the opened
 * word, or scroll the Bag while the chain takes its time. A card that is not on the screen when
 * the wake lands simply shows its word awake: there is no show to catch up on.
 *
 * One wake at a time, as the action gate allows one action at a time.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { TileState } from "../TileCharacter";
import { careState } from "../LetterTile";
import { useGame, type OwnedWord } from "../state";
import { WAKE, wakeActMs, type WakeOutcome, type WakePhase, type WakeResult } from "./wakeFlow";

export interface WakeRun {
  id: number;
  /** the words being woken, in the order their small cards take their turn */
  words: readonly string[];
  /** how each looked when the player pressed Wake (sleepy or asleep): the act starts from this */
  before: Readonly<Record<string, TileState>>;
  /** the word that was in focus when the player pressed Wake: Today holds it on stage until the act ends */
  focus: string | null;
  phase: WakePhase;
}

let run: WakeRun | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const set = (next: WakeRun | null) => {
  run = next;
  listeners.forEach((fn) => fn());
};
const later = (fn: () => void, ms: number) => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(fn, ms);
};

/** The player pressed Wake: the letters start to stir. Answers the wake's id. */
export function beginWake(words: readonly Pick<OwnedWord, "word" | "staked" | "daysUnfed">[], focus: string | null): number {
  const id = ++seq;
  set({ id, words: words.map((w) => w.word), before: Object.fromEntries(words.map((w) => [w.word, careState(w as OwnedWord)])), focus, phase: "waiting" });
  // a wallet that never answers must not leave the letters stirring for good
  later(() => run?.id === id && set(null), WAKE.giveUp);
  return id;
}

/**
 * The wake ended. Landed: the act plays, then the wake is let go. Anything else: the letters
 * settle back at once. `woke` narrows the wake to the words that did wake: one that stayed asleep
 * has no part, or it would bow and then go back to sleep (Bugbot on #334).
 */
export function endWake(id: number, outcome: WakeOutcome, reduced = false, woke?: readonly string[]) {
  if (run?.id !== id) return;
  const words = woke ? run.words.filter((w) => woke.includes(w)) : run.words;
  if (outcome !== "landed" || words.length === 0) {
    if (timer) clearTimeout(timer);
    return set(null);
  }
  const longest = Math.max(1, ...words.map((w) => w.length));
  set({ ...run, words, focus: run.focus && words.includes(run.focus) ? run.focus : null, phase: "landed" });
  later(() => run?.id === id && set(null), Math.max(wakeActMs(longest, reduced), WAKE.hopFirst + WAKE.hopCards * WAKE.hopStep + WAKE.hopMs) + 250);
}

/**
 * Let the wake go before its act is over: the player tapped the card in focus to end the bow.
 * Today holds the woken word on stage for as long as the wake is in hand, so a skipped bow must
 * let go of it too, or the word stays parked for the rest of the act (Bugbot on #334).
 */
export function releaseWake(id: number) {
  if (run?.id !== id || run.phase !== "landed") return;
  if (timer) clearTimeout(timer);
  set(null);
}

/** The wake in hand, outside React (tests). */
export const currentWake = (): WakeRun | null => run;

/** For tests, and for a store that is swapped out under the game. */
export function resetWake() {
  if (timer) clearTimeout(timer);
  timer = null;
  set(null);
}

const subscribe = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));
const snapshot = () => run;
/** The wake in hand, or null. */
export const useWakeRun = (): WakeRun | null => useSyncExternalStore(subscribe, snapshot, () => null);

/**
 * Wake words: the Wake buttons call this, never the store's `feed` on their own, so that every
 * card on the screen knows a wake is on its way. `all` sends the store's "wake all" (one send for
 * every word that needs it); otherwise the one word.
 */
export function useWake() {
  const g = useGame();
  return useCallback(
    (words: readonly OwnedWord[], opts: { all?: boolean; focus?: string | null; reduced?: boolean } = {}) => {
      if (words.length === 0) return;
      const send = () => (opts.all ? g.feedAll() : g.feed(words[0].word));
      // one wake at a time: a second tap is the action gate's to answer ("Still working on…")
      if (run?.phase === "waiting") return void send();
      const id = beginWake(words, opts.focus ?? null);
      void send().then(
        (r: WakeResult) => (typeof r === "string" ? endWake(id, r, opts.reduced) : endWake(id, "landed", opts.reduced, r.landed)),
        () => endWake(id, "none"),
      );
    },
    [g],
  );
}
