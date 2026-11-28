/**
 * Reserved word sets in the player's words (decisions.md, "Reserved word sets"): what each state of
 * a set says, and how long is left. Pure.
 *
 * A set is a locked slot until it is revealed (nothing about it is known to the game before then),
 * then a name and its words with a countdown, then words like any others, with the set's name on
 * them. For its first day a released set may be limited to one word per player.
 */
import type { GateRule, PublicSet } from "@/lib/sets/rules";
import { firstDayWho } from "./setGate";

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
  /** Who the first day is open to, when the set has a rule of its own (an allowlist, or a token's holders). */
  openTo?: string;
  /** A collab set's partner: "A collaboration with …", and a link when there is one. */
  partner?: { name: string; url: string | null };
  /** True while the first-day limit is up. */
  gated: boolean;
}

/** The first-day rule in words: "First day: one word per player". */
export function firstDayRule(limit: number): string {
  return limit <= 1 ? "First day: one word per player" : `First day: ${limit} words per player`;
}

/**
 * What a set says of itself right now. `gate` is whether this network's Words can enforce a first
 * day at all (the sets answer's `gate`): where it can't, a set opens to everyone at once, so
 * nothing is said about who its first day is open to.
 */
export function setLines(set: PublicSet, nowMs: number, gate = true): SetLines {
  if (set.kind === "locked") return { title: "A new set is coming", status: "Locked", gated: false };
  const partner = set.collab ? { name: set.collab.partner, url: set.collab.url } : undefined;
  // `firstDay` may be missing in an answer kept from before this field existed: that is "verified".
  const ruled = gate && (set.firstDay === "allowlist" || set.firstDay === "token");
  const openTo = ruled ? firstDayWho(set.firstDay, set.firstDayLabel) : undefined;
  if (set.kind === "revealed") {
    const left = set.releaseAt ? leftText(Date.parse(set.releaseAt) - nowMs) : undefined;
    return {
      title: set.name,
      status: left === undefined ? "Unlocks soon" : left === null ? "Unlocks any moment now" : `Unlocks in ${left}`,
      partner,
      openTo,
      gated: false,
    };
  }
  const left = set.gateUntil ? leftText(Date.parse(set.gateUntil) - nowMs) : null;
  if (left) return { title: set.name, status: `Opens to everyone in ${left}`, rule: firstDayRule(set.perPlayerLimit), partner, openTo, gated: true };
  // The first day is over (or there was none): who it was open to is no longer news.
  return { title: set.name, status: "Unlocked", partner, gated: false };
}

/**
 * What the first-day rule means, under its heading: who may claim, how many words, and until when.
 * Every first day asks for a verified player; a set with a rule of its own (an allowlist, or a
 * token's holders) says who it is open to as well.
 */
export function firstDayNote(limit: number, rule: GateRule = "verified", label: string | null = null): string {
  const many = limit <= 1 ? "one word" : `up to ${limit} words`;
  const after = "After that, every word that’s left is open to all.";
  if (rule === "verified") return `Each verified player can claim ${many} from this set until it opens to everyone. ${after}`;
  return `The first day is open to ${firstDayWho(rule, label)}. Each of them who is verified can claim ${many} until the set opens to everyone. ${after}`;
}

/** Before a set unlocks: who its first day will be open to, when it has a rule of its own. */
export function firstDayAhead(openTo: string): string {
  return `Its first day is open to ${openTo}.`;
}

/** A set that anyone may see: revealed or released. A locked slot is not one. */
export type ShownSet = Exclude<PublicSet, { kind: "locked" }>;

/** How long a set stays news after it unlocks, when no first day is running. */
export const FRESH_MS = 24 * 3_600_000;

/**
 * Where a set is in its life, for every place that decides whether it is still news (Today's card,
 * and the Dictionary's order and fold; decisions.md, "A set's moments in the game"):
 * - `revealed`: named, and counting down to its unlock.
 * - `firstDay`: unlocked, with its first-day limit still up.
 * - `fresh`: unlocked within the last day, with no first day running. On a network whose Words has
 *   no gate, every unlock is this (a release there records no first day at all).
 * - `old`: everything after. Its words are words like any others.
 */
export type SetPhase = "revealed" | "firstDay" | "fresh" | "old";

export function setPhase(set: ShownSet, nowMs: number): SetPhase {
  if (set.kind === "revealed") return "revealed";
  if (set.gateUntil && Date.parse(set.gateUntil) > nowMs) return "firstDay";
  // A release a moment "ahead" of this device's clock is still fresh: only its age can make it old.
  const at = set.releasedAt ? Date.parse(set.releasedAt) : NaN;
  return Number.isFinite(at) && nowMs - at < FRESH_MS ? "fresh" : "old";
}

/** What is open to claim comes first, then what is coming, then old news. */
const PHASE_ORDER: Record<SetPhase, number> = { firstDay: 0, fresh: 1, revealed: 2, old: 3 };

/** The shown sets, soonest news first: the Dictionary's order. Locked slots are not in it. */
export function byNews(sets: readonly PublicSet[], nowMs: number): ShownSet[] {
  const shown = sets.filter((s): s is ShownSet => s.kind !== "locked");
  // A revealed set with a time comes before one without: its unlock is the nearer news.
  const when = (s: ShownSet) => (s.kind === "revealed" && s.releaseAt ? Date.parse(s.releaseAt) : Infinity);
  return shown
    .map((s, i) => ({ s, i, p: PHASE_ORDER[setPhase(s, nowMs)] }))
    .sort((a, b) => a.p - b.p || when(a.s) - when(b.s) || a.i - b.i)
    .map((x) => x.s);
}

/** The sets Today shows: every one that is still news. Old sets, and locked slots, stay in the Dictionary. */
export function todaySets(sets: readonly PublicSet[], nowMs: number): ShownSet[] {
  return byNews(sets, nowMs).filter((s) => setPhase(s, nowMs) !== "old");
}

/**
 * A set's row on Today, in one line: what is happening with it now, in the Dictionary's own words
 * (setLines), with what a player can do about it once it is unlocked.
 */
export function todayLine(set: ShownSet, nowMs: number, gate = true): string {
  const lines = setLines(set, nowMs, gate);
  const phase = setPhase(set, nowMs);
  if (phase === "firstDay" && lines.rule) return `${lines.rule}. ${lines.status}.`;
  if (phase === "fresh") return "Unlocked. Its words are open to claim.";
  return `${lines.status}.`;
}

/** The REVEALED set that holds `word`, or null: the only held words a player may be told about. */
export function revealedSetOf(sets: readonly PublicSet[], word: string): Extract<PublicSet, { kind: "revealed" }> | null {
  const W = word.toUpperCase();
  for (const s of sets) if (s.kind === "revealed" && s.words.some((w) => w.word === W)) return s;
  return null;
}

/** Under a revealed word's first line: the set it waits in, and when that unlocks. */
export function aheadLine(word: string, set: Extract<PublicSet, { kind: "revealed" }>, nowMs: number): string {
  return `${word.toUpperCase()} is in the set ${set.name}. ${setLines(set, nowMs).status}.`;
}

/**
 * How often to ask the server about the sets, in milliseconds. Every minute as a rule, but every
 * few seconds while a revealed set is about to unlock or is past its time: the game refuses a held
 * word itself (Spell never asks for its proof), so the moment a set unlocks must reach it quickly.
 */
export function setsPollMs(sets: readonly PublicSet[], nowMs: number): number {
  const soon = sets.some((s) => s.kind === "revealed" && s.releaseAt !== null && Date.parse(s.releaseAt) - nowMs < 10 * 60_000);
  return soon ? 8_000 : 60_000;
}

/** word → the name of the RELEASED set it belongs to (the label a card's back carries). */
export function releasedSetNames(sets: readonly PublicSet[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of sets) if (s.kind === "released") for (const w of s.words) m.set(w.word, s.name);
  return m;
}
