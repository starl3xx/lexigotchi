"use client";
/**
 * A card's part in a wake (./wakeFlow has the rules, ./wakeRun the wake in hand): what its letters
 * wear from the tap to the bow, as props for SceneFrame.
 *
 * - While the wake is on its way the card HOLDS the look it had, whatever the words list says by
 *   then: the chain's read can show the word awake a moment before this card is told the wake
 *   landed, and a word that woke early would have nothing left to act.
 * - The card in focus (`big`) plays the whole act. A small card is a still picture: its word is
 *   shown awake at its turn, and its letters hop once (`hop`, globals.css .wk-hop).
 * - A tap on the card ends the act at once (`hurry`).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "../motionPrefs";
import type { TileState } from "../TileCharacter";
import { toneOf, type SceneTone } from "../../scenes/SceneFrame";
import { WAKE, hopDelay, stirFrame, stirLetter, wakeScore, type ActFrame } from "./wakeFlow";
import { useWakeRun } from "./wakeRun";

export interface WakeAct {
  /** a state for each letter, an arm pose, and a moment's class for each, while this card has a part; else undefined */
  states?: TileState[];
  armsUp?: boolean;
  moments?: string[];
  /** the face's tone while the card holds its look (the ink comes back when the wake lands) */
  tone?: SceneTone;
  /** a small card's letters hop once */
  hop: boolean;
  /** the wake is on its way for this word */
  waiting: boolean;
  /** the act is playing on this card: its word woke a moment ago */
  acting: boolean;
  hurry: () => void;
}
const NONE: WakeAct = { hop: false, waiting: false, acting: false, hurry: () => {} };

export function useWakeAct(word: string, big: boolean): WakeAct {
  const run = useWakeRun();
  const reduced = usePrefersReducedMotion();
  const mine = run && run.words.includes(word) ? run : null;
  const id = mine?.id ?? 0;
  const phase = mine?.phase ?? null;
  const before = mine?.before[word] ?? "hungry";
  const order = mine ? mine.words.indexOf(word) : 0;
  const n = word.length;

  // What the letters wear now, for the wake it belongs to. A frame of an older wake is never shown.
  const [shown, setShown] = useState<{ id: number; phase: string; frame: ActFrame | null; hop: boolean; over: boolean }>({ id: 0, phase: "", frame: null, hop: false, over: false });
  const timers = useRef<number[]>([]);
  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  useEffect(() => {
    clear();
    if (!id || !phase) return;
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    const show = (frame: ActFrame | null, more: { hop?: boolean; over?: boolean } = {}) => setShown({ id, phase, frame, hop: more.hop ?? false, over: more.over ?? false });
    if (phase === "waiting") {
      show(stirFrame(n, before, null));
      if (!big || reduced) return clear;
      // the tap: one sleeper stirs at once; then about once a second, another
      let tick = 0;
      const stir = () => {
        const j = stirLetter(tick++, n);
        show(stirFrame(n, before, j));
        at(before === "hungry" ? WAKE.peek : 160, () => show(stirFrame(n, before, null)));
      };
      stir();
      const every = window.setInterval(stir, WAKE.stirEvery);
      return () => {
        window.clearInterval(every);
        clear();
      };
    }
    // landed
    if (big) {
      for (const step of wakeScore(n, before, reduced)) at(step.at, () => show(step.frame, { over: step.frame === null }));
    } else {
      // a still picture: hold the old look until this card's turn, then the word as it is, and a hop
      show(stirFrame(n, before, null));
      at(hopDelay(order), () => show(null, { hop: !reduced }));
      at(hopDelay(order) + WAKE.hopMs, () => show(null, { over: true }));
    }
    return clear;
    // `before` and `order` belong to the wake (`id`): they don't change while it is in hand
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, phase, big, reduced, n]);

  const hurry = useCallback(() => {
    if (!id) return;
    clear();
    setShown((s) => (s.id === id ? { ...s, frame: null, hop: false, over: true } : s));
  }, [id]);

  if (!id || !phase) return NONE;
  // the first render of a wake, before its effect has run: hold the look, never show the word early
  const current = shown.id === id && shown.phase === phase ? shown : { id, phase, frame: stirFrame(n, before, null), hop: false, over: false };
  const frame = current.over ? null : current.frame;
  // The ink: held while the wake is on its way, and on a small card until its turn. On the card in
  // focus it comes back from the moment the wake lands, under the letters as they wake.
  const held = frame !== null && (phase === "waiting" || !big);
  return {
    states: frame?.states,
    armsUp: frame?.armsUp,
    moments: frame?.moments,
    tone: held ? toneOf(before) : undefined,
    hop: current.hop,
    waiting: phase === "waiting",
    acting: phase === "landed" && !current.over,
    hurry,
  };
}
