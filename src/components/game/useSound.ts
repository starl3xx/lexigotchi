"use client";
/**
 * Sound, for components (lib/sound holds the rules: off by default, dark without its files).
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { SOUND_READY, holdSound, play, setSoundOn, soundOn, subscribeSound, wakeSound } from "@/lib/sound";
import { cuesForStep, type MailView } from "./mail/mailCues";

/** Is sound on, and the switch. `ready` false: this build has no sounds, and nothing is offered. */
export function useSound(): { ready: boolean; on: boolean; set: (on: boolean) => void } {
  const on = useSyncExternalStore(subscribeSound, soundOn, () => false);
  return { ready: SOUND_READY, on, set: setSoundOn };
}

/**
 * While sound is on, every tap and key press wakes the browser's sound: a browser plays only after
 * one, and the cues themselves fire later, from timers and from the chain. Mounted once, in GameApp.
 */
export function useSoundGestures(): void {
  const { on } = useSound();
  useEffect(() => {
    if (!on) return;
    const wake = () => wakeSound();
    window.addEventListener("pointerdown", wake, { passive: true });
    window.addEventListener("keydown", wake);
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [on]);
}

/**
 * The envelope's sounds: each step of `view` plays its cues (mail/mailCues `cuesForStep`). A cue
 * waiting for its moment is dropped when the envelope goes (the sheet closed mid-way): no sound
 * outlives what made it.
 */
export function useMailCues(view: MailView): void {
  const prev = useRef<MailView | null>(null);
  // Is the envelope still there? A waiting cue asks at its moment, rather than being cancelled
  // when the component goes: React's development double mount "goes" and comes back at once, and a
  // cancelled cue (the stamp, a beat after the drop) was simply lost there.
  const here = useRef(false);
  const { phase, numbered, torn, fidget, out, rareOut, word } = view;
  useEffect(() => {
    const next: MailView = { phase, numbered, torn, fidget, out, rareOut, word };
    const cues = cuesForStep(prev.current, next);
    prev.current = next;
    if (!soundOn()) return;
    for (const c of cues) {
      if (c.delay === 0) play(c.cue, c);
      else window.setTimeout(() => here.current && play(c.cue, c), c.delay);
    }
  }, [phase, numbered, torn, fidget, out, rareOut, word]);
  useEffect(() => {
    here.current = true;
    // While the envelope is on screen its cues come by themselves, some when the chain says so:
    // the sound stays awake for them (lib/sound `holdSound`), and rests when the envelope goes.
    const release = holdSound();
    return () => {
      here.current = false;
      release();
    };
  }, []);
}
