"use client";
/** Lexidex — browse the 4,438 claimable words; see tiers and what you already own. */
import { useMemo, useState } from "react";
import { WORDS, WORD_COUNT } from "@/lib/dictionary";
import { TIER_COUNTS, wordTier, type Tier } from "@/lib/economy";
import { Pill, TierBadge } from "../primitives";
import { useGame } from "../state";

const TIERS: (Tier | "All")[] = ["All", "Common", "Uncommon", "Rare", "Epic", "Legendary"];

export function LexidexScreen() {
  const g = useGame();
  const { state } = g;
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<Tier | "All">("All");

  const ownedMap = useMemo(() => new Map(state.words.map((w) => [w.word, w.id])), [state.words]);

  const results = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const out: string[] = [];
    for (const w of WORDS) {
      if (needle && !w.includes(needle)) continue;
      if (tier !== "All" && wordTier(w) !== tier) continue;
      out.push(w);
      if (out.length >= 80) break;
    }
    return out;
  }, [q, tier]);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-2xl font-extrabold">Lexidex</h1>
        <span className="text-xs text-ink/55">
          {ownedMap.size}/{WORD_COUNT.toLocaleString()} owned
        </span>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="search the dictionary…"
        className="w-full rounded-xl border-[3px] border-ink bg-paper px-3 py-2.5 font-display text-sm font-bold placeholder:font-body placeholder:font-normal placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-candy"
      />

      <div className="flex flex-wrap gap-1.5">
        {TIERS.map((t) => (
          <button key={t} onClick={() => setTier(t)}>
            <Pill className={tier === t ? "bg-ink text-paper" : "bg-paper"}>
              {t}
              {t !== "All" && <span className="text-ink/40">·{TIER_COUNTS[t as Tier]}</span>}
            </Pill>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {results.map((w) => {
          const owned = ownedMap.get(w);
          return (
            <button
              key={w}
              onClick={() => (owned ? g.openSheet({ kind: "word", id: owned }) : g.toast(`${w} — unclaimed. Spell it to own it.`, "info"))}
              className={`cel flex items-center justify-between rounded-xl bg-paper px-2.5 py-2 text-left transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${owned ? "ring-2 ring-teal ring-offset-1 ring-offset-paper" : ""}`}
            >
              <div>
                <div className="font-display text-sm font-extrabold">{w}</div>
                <TierBadge tier={wordTier(w)} />
              </div>
              <span className="text-sm" aria-hidden>{owned ? "✓" : "·"}</span>
            </button>
          );
        })}
      </div>
      {results.length >= 80 && <p className="text-center text-xs text-ink/45">showing the first 80 — keep typing to narrow.</p>}
      {results.length === 0 && <p className="py-8 text-center text-sm text-ink/55">no words match.</p>}
    </div>
  );
}
