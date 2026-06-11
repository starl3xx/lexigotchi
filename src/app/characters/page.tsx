import { Rig, type RigState } from "@/components/characters/Rig";
import { WordChorus } from "@/components/characters/WordChorus";

const STATES: { state: RigState; label: string; note: string }[] = [
  { state: "idle", label: "idle", note: "fed & happy — bounces and grins" },
  { state: "peckish", label: "peckish", note: "1–2 days unfed — arms droop, yield −50%" },
  { state: "hungry", label: "hungry", note: "3+ days unfed — slump & snore, yield paused, jackpot-ineligible" },
  { state: "celebrate", label: "celebrate", note: "upgrade success / jackpot win" },
];

// The 3 Phase-0 demo characters: the commonest letter, a mid, and the Charizard.
const DEMO = [
  { letter: "S", blurb: "the commonest letter — 2,343 slots, ~10.6% of every pull" },
  { letter: "A", blurb: "a workhorse vowel — 1,899 slots" },
  { letter: "Q", blurb: "the Charizard — 45 slots in the whole dictionary, ~0.20%" },
];

export default function CharactersPage() {
  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-extrabold">Characters</h1>
        <p className="max-w-2xl text-ink/80">
          1930s rubber-hose: noodle limbs, white gloves, pie-cut eyes, squash-and-stretch.
          One shared rig drives all 52 characters. Lowercase letters are{" "}
          <em>the kids</em>; UPPERCASE are <em>the glow-ups</em> — top hat, monocle, and a
          2× yield multiplier. An upgrade should read from across the room.
        </p>
        <p className="text-xs text-ink/60">
          Phase 0: static SVG + CSS keyframes. Phase 3 swaps in Rive state machines driven
          by contract data.
        </p>
      </header>

      {DEMO.map(({ letter, blurb }) => (
        <section key={letter} className="space-y-4">
          <h2 className="font-display text-2xl font-extrabold">
            {letter.toLowerCase()} / {letter}{" "}
            <span className="text-sm font-normal text-ink/60">— {blurb}</span>
          </h2>

          <div className="space-y-6">
            <div>
              <div className="mb-1 text-xs font-bold uppercase tracking-wide text-ink/50">
                lowercase (the kid) · animation states
              </div>
              <div className="flex flex-wrap gap-4">
                {STATES.map(({ state, label, note }) => (
                  <figure key={state} className="cel w-44 rounded-lg bg-paper p-2 text-center">
                    <Rig letter={letter} state={state} variant="lower" size={150} />
                    <figcaption className="mt-1">
                      <div className="font-display text-sm font-bold">{label}</div>
                      <div className="text-[11px] leading-tight text-ink/70">{note}</div>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1 text-xs font-bold uppercase tracking-wide text-ink/50">
                UPPERCASE (the glow-up) · earns 2× yield
              </div>
              <div className="flex flex-wrap gap-4">
                <figure className="cel w-44 rounded-lg bg-paper p-2 text-center">
                  <Rig letter={letter} state="idle" variant="upper" earning size={150} />
                  <figcaption className="mt-1 font-display text-sm font-bold">staked & earning</figcaption>
                </figure>
                <figure className="cel w-44 rounded-lg bg-paper p-2 text-center">
                  <Rig letter={letter} state="celebrate" variant="upper" size={150} />
                  <figcaption className="mt-1 font-display text-sm font-bold">jackpot winner</figcaption>
                </figure>
              </div>
            </div>
          </div>
        </section>
      ))}

      <section className="space-y-4">
        <h2 className="font-display text-2xl font-extrabold">A claimed word is a chorus line</h2>
        <p className="max-w-2xl text-sm text-ink/80">
          Five characters holding hands. Lowercase words shuffle side to side; full-UPPERCASE
          words do the synchronized kick. Trophy words — past daily winning words — wear a medal.
          <strong> JAZZY</strong> is the launch hero: the rarest word in the dictionary.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="cel flex flex-col items-center gap-3 rounded-lg bg-paper p-6">
            <WordChorus word="tease" variant="lower" size={92} />
            <div className="font-display text-sm font-bold">tease — lowercase, shuffling · 1× yield</div>
          </div>
          <div className="cel flex flex-col items-center gap-3 rounded-lg bg-paper p-6">
            <WordChorus word="JAZZY" variant="upper" earning trophy size={92} />
            <div className="font-display text-sm font-bold">JAZZY — UPPERCASE, kicking · 2× yield</div>
          </div>
        </div>
      </section>
    </div>
  );
}
