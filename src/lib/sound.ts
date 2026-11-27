/**
 * The game's sounds (decisions.md #49, part 4): today, the mail's eight cues.
 *
 * - **Off until the player turns it on** (starl3xx, 2026-11-26: "sound off by default"), kept per
 *   browser. And off means off: with sound off no sound file is fetched and no AudioContext is made.
 * - **Dark without its files.** `SOUND_READY` is worked out at build time (next.config.mjs): the
 *   files are in the build, or `NEXT_PUBLIC_SOUND_BASE` names where they are served from. Without
 *   them no switch is offered and nothing here does anything.
 * - **It never throws and never waits.** A browser with no sound to give, a file that won't load, a
 *   context the browser keeps locked: each is silence, and the game plays on.
 * - **A browser plays only after a tap.** `wakeSound` is called from a pointer or key event while
 *   sound is on (`useSoundGestures`); cues themselves fire later, from timers and chain events.
 * - **It rests.** A running context can cost a little at idle, so it is suspended shortly after
 *   the last cue ends, and woken by the next tap or cue.
 */

export type Cue = "drop" | "stamp" | "postmark" | "rustle" | "tear" | "hop" | "rare" | "word";
export const CUES: readonly Cue[] = ["drop", "stamp", "postmark", "rustle", "tear", "hop", "rare", "word"];

/** Are there sounds to play in this build? */
export const SOUND_READY = process.env.NEXT_PUBLIC_SOUND_READY === "1";
const BASE = (process.env.NEXT_PUBLIC_SOUND_BASE || "/sfx/mail").replace(/\/+$/, "");
/** The file a cue plays. */
export const cueUrl = (cue: Cue): string => `${BASE}/${cue}.mp3`;

const KEY = "lexi-sound";
/** How long after the last cue ends the context is put to rest. */
const REST_AFTER_MS = 1500;

let on = false;
let known = false; // has the stored choice been read?
const subs = new Set<() => void>();

function stored(): boolean {
  if (!known && typeof window !== "undefined") {
    known = true;
    try {
      on = SOUND_READY && window.localStorage.getItem(KEY) === "on";
    } catch {
      on = false; // a browser that won't say keeps the default: off
    }
  }
  return on;
}

/** Is sound on in this browser? Always false on the server and where there are no sounds. */
export const soundOn = (): boolean => stored();
export function subscribeSound(f: () => void): () => void {
  subs.add(f);
  return () => void subs.delete(f);
}

let ctx: AudioContext | null = null;
const buffers = new Map<Cue, Promise<AudioBuffer | null>>();
let rest: ReturnType<typeof setTimeout> | undefined;

/** The context, made on first need, and only while sound is on. */
function context(): AudioContext | null {
  if (!stored()) return null;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

function buffer(cue: Cue, ac: AudioContext): Promise<AudioBuffer | null> {
  let got = buffers.get(cue);
  if (!got) {
    got = (async () => {
      try {
        const res = await fetch(cueUrl(cue));
        if (!res.ok) return null;
        const bytes = await res.arrayBuffer();
        // the callback form: older WebKit has no promise from decodeAudioData
        return await new Promise<AudioBuffer | null>((done) => {
          try {
            const p = ac.decodeAudioData(bytes, done, () => done(null));
            if (p && typeof p.catch === "function") p.catch(() => done(null));
          } catch {
            done(null);
          }
        });
      } catch {
        return null;
      }
    })();
    buffers.set(cue, got);
    // A file that didn't load is not kept as "no sound" for the life of the page: one bad moment
    // on the network at the first tap would silence that cue until a reload. The next ask fetches again.
    const mine = got;
    void got.then((buf) => {
      if (!buf && buffers.get(cue) === mine) buffers.delete(cue);
    });
  }
  return got;
}

/** How many things are on screen that will make a sound without a tap (an envelope on its way). */
let held = 0;

function restSoon(afterMs: number) {
  if (rest) clearTimeout(rest);
  rest = setTimeout(() => {
    if (held > 0) return; // something on screen is still going to play: stay awake for it
    if (ctx && ctx.state === "running") void ctx.suspend().catch(() => {});
  }, afterMs + REST_AFTER_MS);
}

/**
 * Keep the sound awake while something on screen plays cues by itself: an envelope's stamp and
 * postmark land when the CHAIN says so, seconds or a minute after the tap that bought it, and a
 * browser (an iPhone's above all) may refuse to wake a rested context without a tap. Call the
 * function it returns when that thing is gone; the context then rests as usual.
 */
export function holdSound(): () => void {
  held++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held = Math.max(0, held - 1);
    if (held === 0) restSoon(0);
  };
}

/**
 * Call from a tap or a key press while sound is on: it is what lets the browser play, and it
 * fetches the cues ahead so the first one isn't late. Does nothing while sound is off.
 */
export function wakeSound(): void {
  const ac = context();
  if (!ac) return;
  if (ac.state === "suspended") void ac.resume().catch(() => {});
  for (const cue of CUES) void buffer(cue, ac);
  restSoon(4000);
}

/** Turn sound on or off, and remember it. Call it from the tap itself: turning on wakes the browser's sound. */
export function setSoundOn(next: boolean): void {
  known = true;
  on = SOUND_READY && next;
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* not remembered: it holds for this page */
  }
  if (on) wakeSound();
  else if (ctx && ctx.state === "running") void ctx.suspend().catch(() => {});
  subs.forEach((f) => f());
}

/**
 * Play a cue, if sound is on. `rate` raises the pitch (a letter's hop climbs along a pack); `gain`
 * is its level, 0 to 1. Nothing plays in a hidden tab.
 */
export function play(cue: Cue, o: { rate?: number; gain?: number } = {}): void {
  if (!stored() || (typeof document !== "undefined" && document.hidden)) return;
  const ac = context();
  if (!ac) return;
  if (ac.state === "suspended") void ac.resume().catch(() => {});
  const rate = o.rate ?? 1;
  void buffer(cue, ac).then((buf) => {
    if (!buf || !on) return;
    try {
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const vol = ac.createGain();
      vol.gain.value = o.gain ?? 0.9;
      src.connect(vol).connect(ac.destination);
      src.start();
      restSoon((buf.duration / rate) * 1000);
    } catch {
      /* silence */
    }
  });
}

/** For tests: forget everything, as a fresh page would. */
export function resetSoundForTests(): void {
  on = false;
  known = false;
  ctx = null;
  held = 0;
  buffers.clear();
  if (rest) clearTimeout(rest);
  subs.clear();
}
