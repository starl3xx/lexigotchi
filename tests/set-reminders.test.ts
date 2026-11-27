/**
 * Reminders for reserved word sets (lib/notify/sets.ts; decisions.md, "Reserved word sets"): a set
 * is revealed, it unlocks, and its first day ends. Each is said once, only while it is recent,
 * never about a draft, and the operator can mute them all.
 */
import { describe, it, expect, vi } from "vitest";
import type { WordSet } from "@/lib/sets/rules";
import { NAME_MAX, STANDARD_FIELDS } from "@/lib/sets/rules";
import { KIND_INFO, REMINDER_KINDS, wantsKind, emailedNow } from "@/lib/notify/kinds";
import { ALL_TITLE_POOLS, setOpen, setRevealed, setUnlocked, withinLimits } from "@/lib/notify/templates";
import { TELL_WINDOW_MS, setEvents, setRemindersOn, tellSetEvents, type SetEvent } from "@/lib/notify/sets";

const NOW = Date.parse("2026-12-10T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms);
const H = 3_600_000;

function set(id: number, status: WordSet["status"], over: Partial<WordSet> = {}): WordSet {
  return {
    id, name: `Set ${id}`, status, revealAt: null, releaseAt: null, gateHours: 24, perPlayerLimit: 1, sort: id,
    revealedAt: null, releasedAt: null, gateUntil: null, releaseBlock: null, releaseRoot: null,
    words: [{ word: "CRANE", headliner: false }], ...STANDARD_FIELDS, ...over,
  };
}

describe("the messages", () => {
  const long = { id: 123456, name: "N".repeat(NAME_MAX) };
  it("fit every limit with the longest name a set can have", () => {
    for (const n of [setRevealed(long), setUnlocked(long, null), setUnlocked(long, { limit: 1 }), setUnlocked(long, { limit: 100 }), setOpen(long)]) {
      expect(withinLimits(n), n.body).toBe(true);
    }
  });
  it("say the set's name and what happened", () => {
    const s = { id: 7, name: "Kitchen" };
    expect(setRevealed(s)).toEqual({ title: "A new set is revealed", body: "Kitchen is revealed. See its words in the Dictionary.", notificationId: "set-revealed-7" });
    expect(setUnlocked(s, { limit: 1 }).body).toBe("Kitchen is unlocked. First day: one word per player.");
    expect(setUnlocked(s, { limit: 3 }).body).toBe("Kitchen is unlocked. First day: 3 words per player.");
    expect(setUnlocked(s, null).body).toBe("Kitchen is unlocked. Its words are open to claim.");
    expect(setOpen(s)).toEqual({ title: "A set is open to everyone", body: "Kitchen is open to everyone now. Claim any word that’s left.", notificationId: "set-open-7" });
  });
  it("are in the title pools the length test reads", () => {
    for (const k of ["setRevealed", "setUnlocked", "setOpen"]) expect(ALL_TITLE_POOLS[k]).toHaveLength(1);
  });
});

describe("the kind a player can turn off", () => {
  it("is on by default, in the profile's list, and never waits for a weekly email", () => {
    expect(REMINDER_KINDS).toContain("sets");
    expect(KIND_INFO.sets.on).toBe(true);
    expect(wantsKind(undefined, "sets")).toBe(true);
    expect(wantsKind({ sets: false }, "sets")).toBe(false);
    expect(emailedNow("weekly", "sets")).toBe(true); // a set's moments are timed
  });
});

describe("which moments to announce", () => {
  const marks = (sets: WordSet[]) => setEvents(sets, NOW).map((e) => e.mark);
  it("nothing of a draft, ever", () => {
    expect(marks([set(1, "draft", { revealedAt: ago(H), releasedAt: ago(H), gateUntil: ago(H) })])).toEqual([]);
  });
  it("a set revealed in the last few hours", () => {
    expect(marks([set(1, "revealed", { revealedAt: ago(H) })])).toEqual(["revealed:1"]);
    expect(marks([set(1, "revealed", { revealedAt: ago(TELL_WINDOW_MS + 1) })])).toEqual([]); // old news is never announced
    expect(marks([set(1, "revealed", { revealedAt: new Date(NOW + H) })])).toEqual([]);
  });
  it("a set that unlocked, with the first-day rule while its gate is up", () => {
    const gated = setEvents([set(2, "released", { revealedAt: ago(30 * H), releasedAt: ago(H), gateUntil: new Date(NOW + 23 * H), perPlayerLimit: 2 })], NOW);
    expect(gated.map((e) => e.mark)).toEqual(["unlocked:2"]);
    expect(gated[0].note.body).toBe("Set 2 is unlocked. First day: 2 words per player.");
    const open = setEvents([set(2, "released", { releasedAt: ago(H) })], NOW);
    expect(open[0].note.body).toBe("Set 2 is unlocked. Its words are open to claim.");
  });
  it("a set revealed and unlocked within the same few hours says only that it unlocked", () => {
    expect(marks([set(2, "released", { revealedAt: ago(2 * H), releasedAt: ago(H) })])).toEqual(["unlocked:2"]);
  });
  it("the end of a first day, once it has passed", () => {
    expect(marks([set(3, "released", { releasedAt: ago(25 * H), gateUntil: ago(H) })])).toEqual(["open:3"]);
    expect(marks([set(3, "released", { releasedAt: ago(40 * H), gateUntil: ago(TELL_WINDOW_MS + 1) })])).toEqual([]);
  });
  it("a short gate that already ended says the set is open, not the stale rule", () => {
    // Released 5 h ago with a 4-hour gate: the first day is over, so only "open to everyone".
    expect(marks([set(4, "released", { releasedAt: ago(5 * H), gateUntil: ago(H) })])).toEqual(["open:4"]);
  });
  it("several sets at once", () => {
    expect(
      marks([set(1, "revealed", { revealedAt: ago(H) }), set(2, "released", { releasedAt: ago(2 * H) }), set(3, "draft"), set(4, "released", { releasedAt: ago(90 * H) })]).sort(),
    ).toEqual(["revealed:1", "unlocked:2"]);
  });
});

describe("each moment is said once", () => {
  const events: SetEvent[] = [
    { setId: 1, moment: "revealed", mark: "revealed:1", note: setRevealed({ id: 1, name: "One" }) },
    { setId: 2, moment: "unlocked", mark: "unlocked:2", note: setUnlocked({ id: 2, name: "Two" }, null) },
  ];
  it("claims the mark first, and doesn't send what was already said", async () => {
    const taken = new Set(["revealed:1"]);
    const send = vi.fn(async (_n: unknown) => 5);
    const order: string[] = [];
    const out = await tellSetEvents(events, {
      claim: async (m) => (order.push(`claim ${m}`), taken.has(m) ? "taken" : "claimed"),
      release: async (m) => void order.push(`release ${m}`),
      send: async (n) => (order.push("send"), send(n)),
    });
    expect(out).toEqual([
      { setId: 1, moment: "revealed", outcome: "already", reached: 0 },
      { setId: 2, moment: "unlocked", outcome: "sent", reached: 5 },
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["claim revealed:1", "claim unlocked:2", "send"]);
  });
  it("sends nothing when no mark can be kept (it could never know it had sent)", async () => {
    const send = vi.fn(async () => 5);
    const out = await tellSetEvents(events, { claim: async () => "unavailable", release: async () => {}, send });
    expect(out.map((o) => o.outcome)).toEqual(["no_mark", "no_mark"]);
    expect(send).not.toHaveBeenCalled();
  });
  it("gives the mark back when it reached nobody, or the send failed, so the next hour tries again", async () => {
    const released: string[] = [];
    const nobody = await tellSetEvents(events.slice(0, 1), { claim: async () => "claimed", release: async (m) => void released.push(m), send: async () => 0 });
    expect(nobody[0].outcome).toBe("nobody");
    const failed = await tellSetEvents(events.slice(1), {
      claim: async () => "claimed",
      release: async (m) => void released.push(m),
      send: async () => {
        throw new Error("down");
      },
    });
    expect(failed[0].outcome).toBe("nobody");
    expect(released).toEqual(["revealed:1", "unlocked:2"]);
  });
});

describe("the operator's switch", () => {
  it("is on unless SET_REMINDERS is off", () => {
    expect(setRemindersOn({} as NodeJS.ProcessEnv)).toBe(true);
    expect(setRemindersOn({ SET_REMINDERS: "off" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(setRemindersOn({ SET_REMINDERS: "on" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});
