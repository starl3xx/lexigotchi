/**
 * Reserved word sets in the player's words (decisions.md, "Reserved word sets"): what each state of
 * a set says, and how long is left. Pure.
 *
 * A set is a locked slot until it is revealed (nothing about it is known to the game before then),
 * then a name and its words with a countdown, then words like any others, with the set's name on
 * them. For its first day a released set may be limited to one word per player.
 */
import type { PublicSet } from "@/lib/sets/rules";

/** How long is left, for a countdown line. Null once the time has come. */
export function leftText(ms: number): string | null {
  if (ms <= 0) return null;
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${String(min % 60).padStart(2, "0")} min`;
  return `${Math.floor(h / 24)} days`;
}

export interface SetLines {
  /** The set's heading. A locked slot has no name to show. */
  title: string;
  /** What is happening with it now. */
  status: string;
  /** The first-day rule, while it applies. */
  rule?: string;
  /** True while the first-day limit is up. */
  gated: boolean;
}

/** The first-day rule in words: "First day: one word per player". */
export function firstDayRule(limit: number): string {
  return limit <= 1 ? "First day: one word per player" : `First day: ${limit} words per player`;
}

/** What a set says of itself right now. */
export function setLines(set: PublicSet, nowMs: number): SetLines {
  if (set.kind === "locked") return { title: "A new set is coming", status: "Locked", gated: false };
  if (set.kind === "revealed") {
    const left = set.releaseAt ? leftText(Date.parse(set.releaseAt) - nowMs) : undefined;
    return {
      title: set.name,
      status: left === undefined ? "Unlocks soon" : left === null ? "Unlocks any moment now" : `Unlocks in ${left}`,
      gated: false,
    };
  }
  const left = set.gateUntil ? leftText(Date.parse(set.gateUntil) - nowMs) : null;
  if (left) return { title: set.name, status: `Opens to everyone in ${left}`, rule: firstDayRule(set.perPlayerLimit), gated: true };
  return { title: set.name, status: "Unlocked", gated: false };
}

/** word → the name of the RELEASED set it belongs to (the label a card's back carries). */
export function releasedSetNames(sets: readonly PublicSet[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of sets) if (s.kind === "released") for (const w of s.words) m.set(w.word, s.name);
  return m;
}
