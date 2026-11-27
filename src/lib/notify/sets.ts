/**
 * Reminders for reserved word sets (decisions.md, "Reserved word sets"): a set is REVEALED, it
 * UNLOCKS, and its first day ENDS. Sent by the hourly `/api/cron/sets`, because each has a time
 * that matters (the daily keeper would say "the first day is over" up to a day late).
 *
 * - **Once.** Each moment of each set has ONE mark (`reminder_marks`, account "all", kind
 *   "sets"), claimed BEFORE anything is sent and given back only when nothing went out at all
 *   (so a pass that reached nobody tries again next hour). No mark table, no send.
 * - **Recent only.** A moment older than `TELL_WINDOW_MS` is never announced: a first run long
 *   after a release (a backfill, a paused cron) tells nobody about old news.
 * - **To everyone the game can reach who keeps the kind on** ("A new set of words" in the profile,
 *   on by default): Farcaster, else the player's browsers; and email and Telegram to those who
 *   asked for them. Choices that can't be read send nothing (lib/db/reminderPrefs.ts).
 * - **`SET_REMINDERS=off`** mutes all of it (a setting takes effect on the next deploy).
 *
 * Only what is public is ever said: a moment exists only for a set that is revealed or released.
 */
import type { WordSet } from "@/lib/sets/rules";
import type { Notification } from "./templates";
import { setOpen, setRevealed, setUnlocked } from "./templates";

/** A moment is announced only this long after it happened. Wider than the hourly cadence, with room for a few missed runs. */
export const TELL_WINDOW_MS = 6 * 3_600_000;

export type SetMoment = "revealed" | "unlocked" | "open";

export interface SetEvent {
  setId: number;
  moment: SetMoment;
  /** The send-once mark: the set and the moment. */
  mark: string;
  note: Notification;
}

/** Is `at` within the window before `now`? */
const recent = (at: Date | null, nowMs: number): boolean => at !== null && at.getTime() <= nowMs && nowMs - at.getTime() <= TELL_WINDOW_MS;

/**
 * The moments to announce now. Pure. A set unlocked with its first-day limit says the rule; the
 * "open to everyone" moment exists only for a set that had a gate.
 */
export function setEvents(sets: readonly WordSet[], nowMs: number): SetEvent[] {
  const out: SetEvent[] = [];
  for (const s of sets) {
    if (s.status === "draft") continue; // nothing of a draft is ever said
    const set = { id: s.id, name: s.name };
    // Revealed, and not yet unlocked: a set revealed and released in the same hour says only that it unlocked.
    if (s.status === "revealed" && recent(s.revealedAt, nowMs)) out.push({ setId: s.id, moment: "revealed", mark: `revealed:${s.id}`, note: setRevealed(set) });
    if (s.status !== "released") continue;
    const gated = s.gateUntil !== null && s.gateUntil.getTime() > nowMs;
    if (recent(s.releasedAt, nowMs) && (gated || s.gateUntil === null)) {
      out.push({ setId: s.id, moment: "unlocked", mark: `unlocked:${s.id}`, note: setUnlocked(set, gated ? { limit: s.perPlayerLimit } : null) });
    }
    if (recent(s.gateUntil, nowMs)) out.push({ setId: s.id, moment: "open", mark: `open:${s.id}`, note: setOpen(set) });
  }
  return out;
}

/** Are set reminders muted by the operator? */
export function setRemindersOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SET_REMINDERS !== "off";
}

export interface SetTellDeps {
  /** Take the event's send-once mark. */
  claim: (mark: string) => Promise<"claimed" | "taken" | "unavailable">;
  /** Give it back (nothing went out). */
  release: (mark: string) => Promise<void>;
  /** Send one note to everyone who keeps the kind on; how many players (or messages) it reached. */
  send: (note: Notification) => Promise<number>;
}

export interface SetTellResult {
  moment: SetMoment;
  setId: number;
  outcome: "sent" | "already" | "no_mark" | "nobody";
  reached: number;
}

/** Announce each event once. Never throws: a courtesy must not fail the job. */
export async function tellSetEvents(events: readonly SetEvent[], deps: SetTellDeps): Promise<SetTellResult[]> {
  const out: SetTellResult[] = [];
  for (const e of events) {
    const base = { moment: e.moment, setId: e.setId };
    const claim = await deps.claim(e.mark).catch(() => "unavailable" as const);
    if (claim !== "claimed") {
      out.push({ ...base, outcome: claim === "taken" ? "already" : "no_mark", reached: 0 });
      continue;
    }
    let reached = 0;
    try {
      reached = await deps.send(e.note);
    } catch {
      reached = 0;
    }
    if (reached === 0) await deps.release(e.mark).catch(() => {});
    out.push({ ...base, outcome: reached > 0 ? "sent" : "nobody", reached });
  }
  return out;
}
