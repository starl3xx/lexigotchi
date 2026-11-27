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
