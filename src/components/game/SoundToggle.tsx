"use client";
/**
 * The sound switch (decisions.md #49, part 4). Off until the player turns it on, kept per browser.
 * Two sizes: the card (in More, and in the profile, because the desktop rail has no More), and a
 * small one under the envelope, where the sounds are.
 * Renders nothing in a build with no sounds (lib/sound `SOUND_READY`).
 */
import { useSound } from "./useSound";
import { Button } from "./primitives";
import { SpeakerHigh, SpeakerSlash } from "./ui/icons";

export function SoundToggle({ compact = false }: { compact?: boolean }) {
  const { ready, on, set } = useSound();
  if (!ready) return null;

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => set(!on)}
        aria-pressed={on}
        className="mx-auto mt-1 flex items-center gap-1.5 text-xs font-medium text-ink/70 underline"
      >
        {on ? <SpeakerHigh weight="fill" /> : <SpeakerSlash weight="bold" />}
        {on ? "Sound is on" : "Turn sound on"}
      </button>
    );
  }

  return (
    <div className="cel rounded-2xl bg-card p-4">
      <div className="flex items-center gap-2 font-display font-extrabold">
        {on ? <SpeakerHigh weight="fill" className="text-teal-ink" /> : <SpeakerSlash weight="bold" className="text-ink/40" />}
        Sound {on ? "is on" : ""}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink/70">Your mail makes a little noise: paper, a stamp, a tile for each letter, and a bell for a rare one.</p>
      <Button size="sm" variant={on ? "ghost" : "teal"} className="mt-3" onClick={() => set(!on)} aria-pressed={on}>
        {on ? "Turn sound off" : "Turn sound on"}
      </Button>
    </div>
  );
}
