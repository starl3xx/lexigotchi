"use client";
/**
 * /tile-lab — a private showcase for the vaudeville TileCharacter. Not linked anywhere; it's the
 * visual proof surface for the design handoff (every state, gild stage, pose, LOD + the link row).
 */
import { useState } from "react";
import { TileCharacter, TileWord, type TileState } from "@/components/game/TileCharacter";
import { ALPHABET } from "@/lib/economy";

const STATES: TileState[] = ["idle", "peckish", "hungry", "eating", "rolling", "upgrade", "celebrate"];
const MEANS: Record<TileState, string> = {
  idle: "fed / healthy",
  peckish: "unfed 1–2d · ½ yield",
  hungry: "unfed 3+d · 0 yield",
  eating: "being fed a snack",
  rolling: "mid upgrade-roll",
  upgrade: "roll succeeded → UPPERCASE",
  celebrate: "win / jackpot",
};

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex h-[180px] items-end justify-center">{children}</div>
      <span className="text-center text-[11px] font-semibold uppercase tracking-wide text-ink/60">{label}</span>
    </div>
  );
}

function Section({ title, hint, id, children }: { title: string; hint?: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="cel scroll-mt-6 rounded-2xl bg-paper p-6">
      <h2 className="font-display text-2xl font-extrabold">{title}</h2>
      {hint && <p className="mb-5 mt-1 text-sm text-ink/60">{hint}</p>}
      <div className={hint ? "" : "mt-5"}>{children}</div>
    </section>
  );
}

export default function TileLab() {
  const [boil, setBoil] = useState(false);

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-5 py-12">
      <header className="space-y-2">
        <h1 className="font-display text-4xl font-extrabold">Tile Lab</h1>
        <p className="max-w-2xl text-ink/70">
          The vaudeville rubber-hose tile — a Scrabble letter come to life. Lowercase is the kid;
          UPPERCASE is the glow-up (it becomes the blue <em>Let&rsquo;s Have A Word!</em> game tile).
          No mouth: all expression is eyes, brows, and the planted-feet bounce.
        </p>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={boil} onChange={(e) => setBoil(e.target.checked)} />
          hand-drawn “boil” on the limbs
        </label>
      </header>

      <Section title="The glow-up" hint="Same letter, two lives. The case + colour carries it — no costume.">
        <div className="flex flex-wrap items-end justify-center gap-12">
          <Cell label="lowercase — the kid">
            <TileCharacter char="a" size={150} boil={boil} />
          </Cell>
          <Cell label="UPPERCASE — the glow-up">
            <TileCharacter char="a" upper size={150} boil={boil} />
          </Cell>
        </div>
      </Section>

      <Section title="The seven states" hint="Each maps 1:1 to an on-chain game state.">
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4 lg:grid-cols-7">
          {STATES.map((s) => (
            <Cell key={s} label={`${s} · ${MEANS[s]}`}>
              <TileCharacter char="R" upper={s === "upgrade" || s === "celebrate"} state={s} size={132} boil={boil} />
            </Cell>
          ))}
        </div>
      </Section>

      <Section id="gild" title="The four Gilded stages" hint="UPPERCASE only. Gold accrues around the tile; the blue game piece stays intact underneath.">
        <div className="grid grid-cols-3 gap-x-6 gap-y-8 sm:grid-cols-5">
          {([0, 1, 2, 3, 4] as const).map((gild) => (
            <Cell key={gild} label={`gild ${gild} · ×${[1.0, 1.1, 1.21, 1.33, 1.46][gild].toFixed(2)}`}>
              <TileCharacter char="Q" upper gild={gild} size={132} boil={boil} />
            </Cell>
          ))}
        </div>
      </Section>

      <Section title="Poses" hint="rest · hero (hand on hip, arm up) · link (holding hands in a word).">
        <div className="flex flex-wrap items-end justify-center gap-12">
          <Cell label="rest">
            <TileCharacter char="b" size={140} pose="rest" boil={boil} />
          </Cell>
          <Cell label="hero">
            <TileCharacter char="b" size={140} pose="hero" boil={boil} />
          </Cell>
          <Cell label="link (×5)">
            <TileWord word="CRANE" upper={[true, true, true, true, true]} size={104} />
          </Cell>
        </div>
      </Section>

      <Section title="A word, raised mid-way" hint="The link row drives the staking stage. Mixed case reads at a glance.">
        <div className="flex flex-col items-center gap-8">
          <TileWord word="JAZZY" upper={[false, false, false, false, false]} size={92} />
          <TileWord word="JAZZY" upper={[true, true, false, false, false]} size={92} />
          <TileWord word="JAZZY" upper={[true, true, true, true, true]} state="celebrate" size={92} />
        </div>
      </Section>

      <Section title="Level of detail" hint="The printed glyph never degrades — only the limbs simplify as the tile shrinks (full → bust → tile).">
        <div className="flex flex-wrap items-end justify-center gap-8">
          {[160, 120, 84, 56, 44, 32, 26].map((s) => (
            <Cell key={s} label={`${s}px`}>
              <TileCharacter char="e" size={s} />
            </Cell>
          ))}
        </div>
      </Section>

      <Section title="Every letter" hint="One rig, 26 glyphs, both cases — never hand-authored.">
        <div className="space-y-4">
          <div className="flex flex-wrap justify-center gap-1">
            {ALPHABET.map((c) => (
              <TileCharacter key={c} char={c} size={50} />
            ))}
          </div>
          <div className="flex flex-wrap justify-center gap-1">
            {ALPHABET.map((c) => (
              <TileCharacter key={c} char={c} upper size={50} />
            ))}
          </div>
        </div>
      </Section>
    </main>
  );
}
