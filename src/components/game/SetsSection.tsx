"use client";
/**
 * The Dictionary's Sets section (decisions.md, "Reserved word sets"): themed groups of words that
 * unlock later.
 *
 * - A set nobody has seen yet is a LOCKED slot: "A new set is coming", and nothing else. The game
 *   itself knows nothing more (the server tells it only that a slot exists).
 * - A REVEALED set shows its name and its words, still (they can't be claimed yet), and counts down
 *   to its unlock.
 * - A RELEASED set's words are words like any others: a tap opens the word. For its first day it
 *   says "First day: one word per player" and counts down to when it opens to everyone. Once it is
 *   simply unlocked it folds to its name (its words are in the list below like any others).
 *
 * - A COLLAB set (one made with a partner; decisions.md, "Collab sets") says so under its name,
 *   with the partner's name and link. A set whose first day has a rule of its own (an allowlist, or
 *   a token's holders) says who that day is open to, before the unlock and during the day.
 *
 * Nothing shows until the sets are known, and nothing shows when there are none.
 */
import { useState } from "react";
import type { PublicSet } from "@/lib/sets/rules";
import { wordTier } from "@/lib/economy";
import { MiniTiles } from "./MiniTiles";
import { Pill } from "./primitives";
import { Lock } from "./ui/icons";
import { firstDayAhead, firstDayNote, setLines } from "./sets";
import { useOpenWord } from "./useDictionary";
import { useMinuteClock, useSets } from "./useSets";

const LOWER = [false, false, false, false, false];
/** Words shown before "Show all": a set may hold dozens. */
const PREVIEW = 8;

function SetCard({ set, now, gate }: { set: Exclude<PublicSet, { kind: "locked" }>; now: number; gate: boolean }) {
  const [all, setAll] = useState(false);
  const openWord = useOpenWord();
  const lines = setLines(set, now, gate);
  const released = set.kind === "released";
  // A set that is simply unlocked (its first day over, or it never had one) is old news: it stays
  // folded to its name, so the Dictionary's top doesn't fill with every set there has ever been.
  const folded = released && !lines.gated;
  const words = all ? set.words : folded ? [] : set.words.slice(0, PREVIEW);
  return (
    <div className="cel-sm rounded-xl bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-display text-[15px] font-extrabold leading-tight">{lines.title}</h3>
        <span className={`text-xs font-bold ${released && !lines.gated ? "text-teal-ink" : "text-ink/60"}`}>{lines.status}</span>
      </div>
      {lines.partner && (
        <p className="mt-0.5 text-[13px] leading-snug text-ink/75">
          A collaboration with{" "}
          {lines.partner.url ? (
            // A partner's link is the operator's own entry, checked to be https; it still opens apart from the game.
            <a href={lines.partner.url} target="_blank" rel="noopener noreferrer nofollow" className="font-extrabold text-ink underline underline-offset-2">
              {lines.partner.name}
            </a>
          ) : (
            <span className="font-extrabold text-ink">{lines.partner.name}</span>
          )}
        </p>
      )}
      {lines.rule && (
        <p className="mt-1 text-[13px] leading-snug text-ink/75">
          <span className="font-extrabold text-gold-ink">{lines.rule}.</span>{" "}
          {set.kind === "released" ? firstDayNote(set.perPlayerLimit, lines.openTo ? set.firstDay : "verified", set.firstDayLabel) : null}
        </p>
      )}
      {!lines.rule && lines.openTo && <p className="mt-1 text-[13px] leading-snug text-ink/75">{firstDayAhead(lines.openTo)}</p>}
      <div className={words.length > 0 ? "mt-2 flex flex-wrap gap-2" : "hidden"}>
        {words.map((w) =>
          released ? (
            <button key={w.word} onClick={() => openWord(w.word)} className="press cel-sm flex flex-col items-start gap-1 rounded-lg bg-paper p-2 text-left">
              <MiniTiles word={w.word} upper={LOWER} tier={wordTier(w.word)} />
              <span className="font-display text-xs font-extrabold">{w.word}</span>
            </button>
          ) : (
            // Revealed, not released: shown, and not a button. It can't be spelled or claimed yet.
            <span key={w.word} className="flex flex-col items-start gap-1 rounded-lg border-2 border-dashed border-ink/25 p-2">
              <MiniTiles word={w.word} upper={LOWER} tier={wordTier(w.word)} className="opacity-60" />
              <span className="font-display text-xs font-extrabold text-ink/70">{w.word}</span>
            </span>
          ),
        )}
      </div>
      {(folded || set.words.length > PREVIEW) && (
        <button onClick={() => setAll((v) => !v)} className="round-btn mt-2 rounded-full text-xs font-bold text-ink/70 underline underline-offset-2">
          {all ? (folded ? "Hide its words" : "Show fewer") : folded ? `Show its ${set.words.length} ${set.words.length === 1 ? "word" : "words"}` : `Show all ${set.words.length} words`}
        </button>
      )}
    </div>
  );
}

export function SetsSection() {
  const { known, sets, gate } = useSets();
  const now = useMinuteClock();
  if (!known || sets.length === 0) return null;
  const locked = sets.filter((s) => s.kind === "locked").length;
  // What is happening soonest comes first: a first day in progress, then what is revealed, then the rest.
  const shown = sets.filter((s): s is Exclude<PublicSet, { kind: "locked" }> => s.kind !== "locked");
  const order = (s: (typeof shown)[number]) => (s.kind === "released" ? (setLines(s, now).gated ? 0 : 2) : 1);
  return (
    <section className="space-y-2" aria-label="Sets">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-extrabold">Sets</h2>
        <span className="text-xs text-ink/55">groups of words that unlock later</span>
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {shown
          .slice()
          .sort((a, b) => order(a) - order(b))
          .map((s) => (
            <SetCard key={s.id} set={s} now={now} gate={gate} />
          ))}
        {Array.from({ length: locked }, (_, i) => (
          <div key={`locked-${i}`} className="flex items-center gap-3 rounded-xl border-2 border-dashed border-ink/30 p-3">
            <Pill className="bg-paper-dark">
              <Lock weight="bold" size={12} /> Locked
            </Pill>
            <span className="font-display text-[15px] font-extrabold text-ink/75">A new set is coming</span>
          </div>
        ))}
      </div>
    </section>
  );
}
