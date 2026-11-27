// @vitest-environment jsdom
/**
 * Reserved word sets in the game (decisions.md, "Reserved word sets"): what each state of a set
 * says (components/game/sets.ts), and the Dictionary's Sets section (SetsSection).
 *
 * A set nobody has seen is a locked slot and nothing else; a revealed set shows its name and words
 * and counts down; a released set's words open like any word, and for its first day it says the
 * one-word rule. Nothing shows while the sets aren't known.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PublicSet } from "@/lib/sets/rules";
import { firstDayNote, firstDayRule, leftText, releasedSetNames, setLines, setsPollMs } from "@/components/game/sets";

const NOW = Date.parse("2026-12-01T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const H = 3_600_000;

const locked: PublicSet = { kind: "locked" };
const revealed = (releaseAt: string | null): PublicSet => ({
  kind: "revealed",
  id: 2,
  name: "Kitchen",
  words: [{ word: "CRANE", headliner: true }, { word: "MOTEL", headliner: false }],
  releaseAt,
});
const released = (gateUntil: string | null, perPlayerLimit = 1): PublicSet => ({
  kind: "released",
  id: 3,
  name: "Garden",
  words: [{ word: "GRAPE", headliner: false }, { word: "BLAZE", headliner: false }],
  releasedAt: iso(NOW - H),
  gateUntil,
  perPlayerLimit,
});

describe("how long is left", () => {
  it("minutes, then hours and minutes, then days; nothing once the time has come", () => {
    expect(leftText(30_000)).toBe("1 min");
    expect(leftText(59 * 60_000)).toBe("59 min");
    expect(leftText(H)).toBe("1 h 00 min");
    expect(leftText(5 * H + 7 * 60_000)).toBe("5 h 07 min");
    expect(leftText(47 * H)).toBe("47 h 00 min");
    expect(leftText(48 * H)).toBe("2 days");
    expect(leftText(9 * 24 * H + H)).toBe("9 days");
    expect(leftText(0)).toBeNull();
    expect(leftText(-5)).toBeNull();
  });
});

describe("what a set says of itself", () => {
  it("a locked slot has no name to show", () => {
    expect(setLines(locked, NOW)).toEqual({ title: "A new set is coming", status: "Locked", gated: false });
  });
  it("a revealed set counts down to its unlock", () => {
    expect(setLines(revealed(iso(NOW + 26 * H)), NOW)).toEqual({ title: "Kitchen", status: "Unlocks in 26 h 00 min", gated: false });
    expect(setLines(revealed(iso(NOW - 1000)), NOW).status).toBe("Unlocks any moment now"); // the owner's transaction is what unlocks it
    expect(setLines(revealed(null), NOW).status).toBe("Unlocks soon");
  });
  it("a released set says the first-day rule while its gate is up, and when it opens to everyone", () => {
    expect(setLines(released(iso(NOW + 5 * H)), NOW)).toEqual({
      title: "Garden",
      status: "Opens to everyone in 5 h 00 min",
      rule: "First day: one word per player",
      gated: true,
    });
    expect(setLines(released(iso(NOW + 5 * H), 2), NOW).rule).toBe("First day: 2 words per player");
  });
  it("and is simply unlocked after it, or when it never had a gate", () => {
    expect(setLines(released(iso(NOW - 1000)), NOW)).toEqual({ title: "Garden", status: "Unlocked", gated: false });
    expect(setLines(released(null), NOW)).toEqual({ title: "Garden", status: "Unlocked", gated: false });
  });
  it("the rule in words", () => {
    expect(firstDayRule(1)).toBe("First day: one word per player");
    expect(firstDayRule(3)).toBe("First day: 3 words per player");
  });
  it("what the rule means follows the set's own limit, and never says “today” (a gate may run longer)", () => {
    expect(firstDayNote(1)).toBe("Each verified player can claim one word from this set until it opens to everyone. After that, every word that’s left is open to all.");
    expect(firstDayNote(3)).toContain("up to 3 words");
    expect(firstDayNote(1)).not.toMatch(/today/i);
  });
  it("asks about the sets every minute, and every few seconds around a set's unlock", () => {
    expect(setsPollMs([], NOW)).toBe(60_000);
    expect(setsPollMs([locked, released(null), revealed(iso(NOW + 26 * H)), revealed(null)], NOW)).toBe(60_000);
    expect(setsPollMs([revealed(iso(NOW + 5 * 60_000))], NOW)).toBe(8_000); // about to unlock
    expect(setsPollMs([revealed(iso(NOW - 3 * H))], NOW)).toBe(8_000); // past its time: the owner's transaction is due
  });
  it("only a RELEASED set names its words' set (what a card's back carries)", () => {
    const names = releasedSetNames([locked, revealed(null), released(null)]);
    expect([...names.entries()].sort()).toEqual([["BLAZE", "Garden"], ["GRAPE", "Garden"]]);
  });
});

// --- the Dictionary's section ---
const sets = vi.hoisted(() => ({ known: true, list: [] as unknown[], opened: [] as string[] }));
vi.mock("@/components/game/useSets", () => ({
  useSets: () => ({ known: sets.known, sets: sets.list, setNameOf: () => undefined, released: undefined, gate: false }),
  useMinuteClock: () => Date.parse("2026-12-01T12:00:00Z"),
}));
vi.mock("@/components/game/useDictionary", () => ({ useOpenWord: () => (w: string) => void sets.opened.push(w) }));

afterEach(() => {
  cleanup();
  sets.known = true;
  sets.list = [];
  sets.opened = [];
});

describe("the Dictionary's Sets section", () => {
  it("shows nothing while the sets aren't known, and nothing when there are none", async () => {
    const { SetsSection } = await import("@/components/game/SetsSection");
    sets.known = false;
    sets.list = [locked];
    expect(render(<SetsSection />).container.innerHTML).toBe("");
    cleanup();
    sets.known = true;
    sets.list = [];
    expect(render(<SetsSection />).container.innerHTML).toBe("");
  });

  it("a locked slot says only that a set is coming", async () => {
    const { SetsSection } = await import("@/components/game/SetsSection");
    sets.list = [locked, locked];
    const { container } = render(<SetsSection />);
    expect(screen.getAllByText("A new set is coming")).toHaveLength(2);
    expect(container.querySelectorAll("button")).toHaveLength(0); // nothing to open
  });

  it("a revealed set shows its name, its words, and its countdown, and its words aren't buttons", async () => {
    const { SetsSection } = await import("@/components/game/SetsSection");
    sets.list = [revealed(iso(NOW + 26 * H))];
    const { container } = render(<SetsSection />);
    expect(screen.getByText("Kitchen")).toBeTruthy();
    expect(screen.getByText("Unlocks in 26 h 00 min")).toBeTruthy();
    expect(screen.getByText("CRANE")).toBeTruthy();
    expect(container.querySelectorAll("button")).toHaveLength(0); // not claimable yet: nothing to tap
  });

  it("a released set in its first day says the rule, and its words open like any word", async () => {
    const { SetsSection } = await import("@/components/game/SetsSection");
    sets.list = [released(iso(NOW + 5 * H))];
    render(<SetsSection />);
    expect(screen.getByText("First day: one word per player.")).toBeTruthy();
    expect(screen.getByText(/Each verified player can claim one word from this set until it opens to everyone/)).toBeTruthy();
    expect(screen.getByText("Opens to everyone in 5 h 00 min")).toBeTruthy();
    fireEvent.click(screen.getByText("GRAPE"));
    expect(sets.opened).toEqual(["GRAPE"]);
  });

  it("after the first day it says nothing of the rule, and folds to its name", async () => {
    const { SetsSection } = await import("@/components/game/SetsSection");
    sets.list = [released(iso(NOW - H))];
    render(<SetsSection />);
    expect(screen.getByText("Unlocked")).toBeTruthy();
    expect(screen.queryByText(/First day/)).toBeNull();
    expect(screen.queryByText("GRAPE")).toBeNull(); // old news: its words are in the list below
    fireEvent.click(screen.getByText("Show its 2 words"));
    fireEvent.click(screen.getByText("GRAPE"));
    expect(sets.opened).toEqual(["GRAPE"]);
    fireEvent.click(screen.getByText("Hide its words"));
    expect(screen.queryByText("GRAPE")).toBeNull();
  });

  it("a long set shows a few words until asked for all", async () => {
    const { SetsSection } = await import("@/components/game/SetsSection");
    const many = ["CRANE", "MOTEL", "GRAPE", "BLAZE", "ABOUT", "ABOVE", "ACORN", "ADAPT", "ADMIT", "ADOPT"];
    sets.list = [{ ...revealed(iso(NOW + H)), words: many.map((word) => ({ word, headliner: false })) }];
    render(<SetsSection />);
    expect(screen.getByText("CRANE")).toBeTruthy();
    expect(screen.queryByText("ADOPT")).toBeNull();
    fireEvent.click(screen.getByText("Show all 10 words"));
    expect(screen.getByText("ADOPT")).toBeTruthy();
  });
});
