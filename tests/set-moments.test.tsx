// @vitest-environment jsdom
/**
 * A set's moments in the game (decisions.md, "A set's moments in the game"): Today's Sets card,
 * the link a set's notice carries, and getting ready for a revealed word.
 *
 * - One rule says whether a set is still news (sets.ts setPhase), for Today and for the Dictionary.
 * - A notice's tap lands on the Sets section, on every channel, and the game reads only the links
 *   it knows.
 * - A word of a REVEALED set counts the player's letters against it and offers no Spell. A held
 *   word of a set nobody has seen names no set at all.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PublicSet } from "@/lib/sets/rules";
import { FRESH_MS, aheadLine, byNews, revealedSetOf, setPhase, todayLine, todaySets, type ShownSet } from "@/components/game/sets";
import { GO, goTarget, goUrl, ownLink } from "@/lib/gameLinks";
import { setOpen, setRevealed, setUnlocked, withinLimits } from "@/lib/notify/templates";
import { reminderEmail } from "@/lib/notify/email";
import { buildPayload } from "@/lib/notify/send";
import { telegramText } from "@/lib/notify/telegram";

const NOW = Date.parse("2026-12-01T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const H = 3_600_000;

const locked: PublicSet = { kind: "locked" };
const revealed = (id: number, releaseAt: string | null, over: Partial<ShownSet> = {}): ShownSet =>
  ({
    kind: "revealed",
    id,
    name: `Coming ${id}`,
    words: [{ word: "CRANE", headliner: false }, { word: "MOTEL", headliner: false }],
    collab: null,
    firstDay: "verified",
    firstDayLabel: null,
    releaseAt,
    ...over,
  }) as ShownSet;
const released = (id: number, releasedAt: string | null, gateUntil: string | null, over: Partial<ShownSet> = {}): ShownSet =>
  ({
    kind: "released",
    id,
    name: `Out ${id}`,
    words: [{ word: "GRAPE", headliner: false }, { word: "BLAZE", headliner: false }],
    collab: null,
    firstDay: "verified",
    firstDayLabel: null,
    releasedAt,
    gateUntil,
    perPlayerLimit: 1,
    ...over,
  }) as ShownSet;

// --- the one rule: is a set still news? ---
describe("where a set is in its life", () => {
  it("revealed until it unlocks; then its first day, while the limit is up", () => {
    expect(setPhase(revealed(1, iso(NOW + H)), NOW)).toBe("revealed");
    expect(setPhase(revealed(1, null), NOW)).toBe("revealed");
    expect(setPhase(released(2, iso(NOW - H), iso(NOW + 23 * H)), NOW)).toBe("firstDay");
  });

  it("with no first day (a network whose Words has no gate records none), an unlock is news for a day", () => {
    expect(setPhase(released(2, iso(NOW - H), null), NOW)).toBe("fresh");
    expect(setPhase(released(2, iso(NOW - FRESH_MS + 60_000), null), NOW)).toBe("fresh");
    expect(setPhase(released(2, iso(NOW - FRESH_MS), null), NOW)).toBe("old");
    expect(setPhase(released(2, iso(NOW - 10 * 24 * H), null), NOW)).toBe("old");
  });

  it("a short first day that ended leaves the set fresh until a day after its unlock", () => {
    expect(setPhase(released(2, iso(NOW - 7 * H), iso(NOW - H)), NOW)).toBe("fresh");
    expect(setPhase(released(2, iso(NOW - 25 * H), iso(NOW - H)), NOW)).toBe("old");
  });

  it("a release a moment ahead of this device's clock is fresh, and one with no time is old", () => {
    expect(setPhase(released(2, iso(NOW + 90_000), null), NOW)).toBe("fresh");
    expect(setPhase(released(2, null, null), NOW)).toBe("old");
  });

  it("orders what can be claimed first, then what is coming (the nearest unlock first), then old news", () => {
    const sets: PublicSet[] = [
      released(1, iso(NOW - 9 * 24 * H), null),
      revealed(2, null),
      locked,
      revealed(3, iso(NOW + 5 * H)),
      released(4, iso(NOW - H), null),
      revealed(5, iso(NOW + 2 * H)),
      released(6, iso(NOW - 2 * H), iso(NOW + 22 * H)),
    ];
    expect(byNews(sets, NOW).map((s) => s.id)).toEqual([6, 4, 5, 3, 2, 1]);
  });

  it("Today shows only the sets that are news: never a locked slot, never an old set", () => {
    const sets: PublicSet[] = [locked, released(1, iso(NOW - 9 * 24 * H), null), revealed(2, null), released(4, iso(NOW - H), null)];
    expect(todaySets(sets, NOW).map((s) => s.id)).toEqual([4, 2]);
    expect(todaySets([locked, locked], NOW)).toEqual([]);
    expect(todaySets([released(1, iso(NOW - 9 * 24 * H), null)], NOW)).toEqual([]);
  });
});

describe("a set's line on Today", () => {
  it("counts down to the unlock, or says soon when no time is set", () => {
    expect(todayLine(revealed(1, iso(NOW + 3 * H + 5 * 60_000)), NOW)).toBe("Unlocks in 3 h 05 min.");
    expect(todayLine(revealed(1, null), NOW)).toBe("Unlocks soon.");
    expect(todayLine(revealed(1, iso(NOW - 60_000)), NOW)).toBe("Unlocks any moment now.");
  });

  it("says the first-day rule and when the set opens to everyone", () => {
    expect(todayLine(released(2, iso(NOW - H), iso(NOW + 20 * H)), NOW)).toBe("First day: one word per player. Opens to everyone in 20 h 00 min.");
    expect(todayLine(released(2, iso(NOW - H), iso(NOW + 20 * H), { perPlayerLimit: 3 } as Partial<ShownSet>), NOW)).toBe(
      "First day: 3 words per player. Opens to everyone in 20 h 00 min.",
    );
  });

  it("a set that just unlocked says its words are open to claim", () => {
    expect(todayLine(released(2, iso(NOW - H), null), NOW)).toBe("Unlocked. Its words are open to claim.");
  });
});

describe("a word of a revealed set", () => {
  const sets: PublicSet[] = [locked, revealed(1, iso(NOW + 2 * H)), released(2, iso(NOW - H), null)];
  it("is found by its set only while that set is revealed", () => {
    expect(revealedSetOf(sets, "CRANE")?.id).toBe(1);
    expect(revealedSetOf(sets, "crane")?.id).toBe(1);
    expect(revealedSetOf(sets, "GRAPE")).toBeNull(); // released: a word like any other
    expect(revealedSetOf(sets, "ABOUT")).toBeNull(); // in no set, or in one nobody has seen
  });

  it("says its set and the set's countdown", () => {
    expect(aheadLine("crane", revealedSetOf(sets, "CRANE")!, NOW)).toBe("CRANE is in the set Coming 1. Unlocks in 2 h 00 min.");
    expect(aheadLine("CRANE", revealed(1, null) as Extract<PublicSet, { kind: "revealed" }>, NOW)).toBe("CRANE is in the set Coming 1. Unlocks soon.");
  });
});

// --- links into the game ---
describe("a link into the game", () => {
  it("knows only its own keys", () => {
    expect(goTarget("sets")).toEqual({ view: "dictionary", section: "sets" });
    for (const bad of [null, undefined, "", "SETS", "sets ", "dictionary", "constructor", "__proto__", "toString", '"],body[x="']) {
      expect(goTarget(bad), String(bad)).toBeNull();
    }
    expect(Object.keys(GO)).toEqual(["sets"]);
  });

  it("is an address on the game's own page", () => {
    expect(goUrl("sets", "https://game.example")).toBe("https://game.example/play?go=sets");
  });

  it("an email keeps a link to the game's own pages, and sends any other to the front door", () => {
    const site = "https://game.example";
    expect(ownLink("https://game.example/play?go=sets", site)).toBe("https://game.example/play?go=sets");
    expect(ownLink(undefined, site)).toBe("https://game.example/play");
    expect(ownLink("https://elsewhere.example/play?go=sets", site)).toBe("https://game.example/play");
    expect(ownLink("javascript:alert(1)", site)).toBe("https://game.example/play");
    expect(ownLink("not a url", site)).toBe("https://game.example/play");
    // it goes into an href: the parser's own writing of it, so a quote can't close the attribute
    expect(ownLink('https://game.example/play?go=sets"><b>', site)).not.toContain('"');
  });
});

describe("a set's notice opens the Sets section", () => {
  const set = { id: 7, name: "Kitchen" };
  const notes = [setRevealed(set), setUnlocked(set, null), setUnlocked(set, { limit: 1 }), setOpen(set)];

  it("each of the three moments carries the link, and still fits every limit", () => {
    for (const n of notes) {
      expect(n.targetUrl, n.title).toBe(goUrl("sets"));
      expect(withinLimits(n), n.title).toBe(true);
    }
  });

  it("on Farcaster and in Telegram the link is the note's own", () => {
    expect(buildPayload(notes[0]).notification.target_url).toBe(goUrl("sets"));
    expect(telegramText(notes[0]).endsWith(goUrl("sets"))).toBe(true);
  });

  it("in an email the button opens the Sets section when the link is on the game's site, and the front door otherwise", () => {
    const before = process.env.PROFILE_SESSION_SECRET;
    process.env.PROFILE_SESSION_SECRET = "a-secret-for-tests-only-0123456789"; // a reminder needs its unsubscribe link
    const wallet = "0x00000000000000000000000000000000000000aa";
    const own = reminderEmail("p@example.com", wallet, { ...notes[0], targetUrl: "https://lexigotchi.fun/play?go=sets" })!;
    const other = reminderEmail("p@example.com", wallet, { ...notes[0], targetUrl: "https://elsewhere.example/play?go=sets" })!;
    const none = reminderEmail("p@example.com", wallet, { title: notes[0].title, body: notes[0].body })!;
    if (before === undefined) delete process.env.PROFILE_SESSION_SECRET;
    else process.env.PROFILE_SESSION_SECRET = before;
    expect(own && other && none).toBeTruthy();
    expect(own.html).toContain('href="https://lexigotchi.fun/play?go=sets"');
    expect(own.text).toContain("Open Lexigotchi: https://lexigotchi.fun/play?go=sets");
    for (const m of [other, none]) {
      expect(m.html).toContain('href="https://lexigotchi.fun/play"');
      expect(m.html).not.toContain("elsewhere.example");
      expect(m.text).toContain("Open Lexigotchi: https://lexigotchi.fun/play\n");
    }
  });
});

// --- the game's side ---
const hook = vi.hoisted(() => ({
  known: true,
  gate: false,
  sets: [] as unknown[],
  status: {} as Record<string, string>,
  hasLetters: true,
  here: { lower: Array(26).fill(0) as number[], upper: Array(26).fill(0) as number[] },
}));
vi.mock("@/components/game/useSets", () => ({
  useSets: () => ({ known: hook.known, sets: hook.sets, gate: hook.gate, collab: new Map(), held: null, setNameOf: () => undefined, released: undefined }),
  useMinuteClock: () => Date.parse("2026-12-01T12:00:00Z"),
}));
vi.mock("@/components/game/useDictionary", () => ({
  useDictionary: () => ({
    statusOf: (w: string) => hook.status[w] ?? "open",
    listings: new Map(),
    holderOf: () => null,
    here: hook.here,
    all: hook.here,
    hasLetters: hook.hasLetters,
    numbers: undefined,
    checkFailed: false,
  }),
}));
vi.mock("@/components/game/useWorld", () => ({ useWorld: () => ({ data: undefined }) }));
vi.mock("@/components/game/useLetterSupply", () => ({ useLetterSupply: () => ({ data: undefined }) }));
vi.mock("@/components/game/WordValue", () => ({ useCostToMake: () => null, WordValue: () => null }));
vi.mock("@/components/game/useRarity", () => ({ useTierOf: () => () => "Common" }));

window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

const { GameCtx, useGame } = await import("@/components/game/state");
const { TodaySets, TODAY_SETS_MAX } = await import("@/components/game/TodaySets");
const { GoHost } = await import("@/components/game/GoHost");
const { LookupSheet } = await import("@/components/game/sheets/LookupSheet");
type GameApi = ReturnType<typeof useGame>;

function inGame(node: React.ReactNode) {
  const nav = vi.fn();
  const openSheet = vi.fn();
  const api = {
    state: { chainBacked: false, status: "ready", view: "dictionary", bountyTheme: 0, words: [] },
    nav,
    openSheet,
    closeSheet: vi.fn(),
    claimFee: () => 2_120_000,
    lettersLeft: null,
    market: { letterBook: {}, isMine: () => false },
  } as unknown as GameApi;
  return { nav, openSheet, ...render(<GameCtx.Provider value={api}>{node}</GameCtx.Provider>) };
}

afterEach(() => {
  cleanup();
  hook.known = true;
  hook.gate = false;
  hook.sets = [];
  hook.status = {};
  hook.hasLetters = true;
  hook.here = { lower: Array(26).fill(0), upper: Array(26).fill(0) };
  window.history.replaceState(null, "", "/play");
});

describe("Today's Sets card", () => {
  it("shows nothing while the sets aren't known, when there are none, and when none is news", () => {
    hook.known = false;
    hook.sets = [revealed(1, iso(NOW + H))];
    expect(inGame(<TodaySets />).container.innerHTML).toBe("");
    cleanup();
    hook.known = true;
    hook.sets = [];
    expect(inGame(<TodaySets />).container.innerHTML).toBe("");
    cleanup();
    hook.sets = [locked, released(1, iso(NOW - 9 * 24 * H), null)];
    expect(inGame(<TodaySets />).container.innerHTML).toBe("");
  });

  it("a row per set that is news: its name, its line, and for a collab its partner", () => {
    hook.sets = [
      revealed(1, iso(NOW + 3 * H), { name: "Kitchen", collab: { partner: "Test partner", url: null, colorA: "#1f6f8b", colorB: "#f2a65a", stamp: null } } as Partial<ShownSet>),
      released(2, iso(NOW - H), null, { name: "Garden" } as Partial<ShownSet>),
    ];
    inGame(<TodaySets />);
    expect(screen.getByText("Garden")).toBeTruthy();
    expect(screen.getByText("Unlocked. Its words are open to claim.")).toBeTruthy();
    expect(screen.getByText("Kitchen")).toBeTruthy();
    expect(screen.getByText("Unlocks in 3 h 00 min.")).toBeTruthy();
    expect(screen.getByText("A collaboration with Test partner")).toBeTruthy();
    // what can be claimed now comes first
    const names = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(names[0]).toContain("Garden");
    expect(names[1]).toContain("Kitchen");
  });

  it("a tap opens the Dictionary at its Sets section", () => {
    hook.sets = [revealed(1, null)];
    const { nav } = inGame(<TodaySets />);
    expect(screen.getByText("Unlocks soon.")).toBeTruthy(); // no time set: no countdown
    fireEvent.click(screen.getByRole("button"));
    expect(nav).toHaveBeenCalledWith("dictionary", "sets");
  });

  it("shows a few rows, and says how many more are in the Dictionary", () => {
    hook.sets = [1, 2, 3, 4].map((id) => revealed(id, iso(NOW + id * H)));
    const { nav } = inGame(<TodaySets />);
    expect(screen.getAllByText(/^Coming \d$/)).toHaveLength(TODAY_SETS_MAX);
    expect(screen.getByText("Coming 1")).toBeTruthy(); // the nearest unlock
    fireEvent.click(screen.getByText(`and ${4 - TODAY_SETS_MAX} more in the Dictionary`));
    expect(nav).toHaveBeenCalledWith("dictionary", "sets");
  });

  it("says the first-day rule while it is up, even where the network can't say who the day is open to", () => {
    hook.sets = [released(2, iso(NOW - H), iso(NOW + 23 * H))];
    inGame(<TodaySets />);
    expect(screen.getByText("First day: one word per player. Opens to everyone in 23 h 00 min.")).toBeTruthy();
  });
});

describe("the link reader", () => {
  it("opens the place a known link names, once, and takes the link out of the address", () => {
    window.history.replaceState(null, "", "/play?go=sets&keep=1#top");
    const { nav } = inGame(<GoHost />);
    expect(nav).toHaveBeenCalledTimes(1);
    expect(nav).toHaveBeenCalledWith("dictionary", "sets");
    expect(window.location.pathname + window.location.search + window.location.hash).toBe("/play?keep=1#top");
  });

  it("drops a link it doesn't know, and does nothing with no link", () => {
    window.history.replaceState(null, "", `/play?go=${encodeURIComponent('"],body[x="')}`);
    const a = inGame(<GoHost />);
    expect(a.nav).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
    cleanup();
    window.history.replaceState(null, "", "/play?x=linked");
    const b = inGame(<GoHost />);
    expect(b.nav).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?x=linked"); // another reader's link is left for it
  });
});

describe("the word view, for a word of a revealed set", () => {
  const give = (letters: string) => {
    for (const ch of letters) hook.here.lower[ch.toUpperCase().charCodeAt(0) - 65] += 1;
  };

  it("counts the player's letters against it, says its set and countdown, and offers no Spell", () => {
    hook.sets = [revealed(1, iso(NOW + 2 * H), { name: "Kitchen" } as Partial<ShownSet>)];
    hook.status = { CRANE: "held" };
    give("cran");
    const { container } = inGame(<LookupSheet word="CRANE" />);
    expect(container.textContent).toMatch(/You only need an\s*e\s*\./); // the lead line is drawn in pieces (NeedText)
    expect(screen.getByText("CRANE is in the set Kitchen. Unlocks in 2 h 00 min.")).toBeTruthy();
    expect(screen.getByText("Mint a pack")).toBeTruthy(); // a way to get what's missing
    expect(screen.getByText("Find an e in the Market")).toBeTruthy();
    expect(screen.queryByText(/^Spell /)).toBeNull();
    expect(screen.getByText("Set")).toBeTruthy();
    expect(screen.getByText("Kitchen")).toBeTruthy();
    expect(screen.getByText("To claim")).toBeTruthy();
    expect(screen.queryByText("Nobody yet")).toBeNull(); // it isn't open
  });

  it("with all five letters it says so, and still offers no Spell until the set unlocks", () => {
    hook.sets = [revealed(1, null, { name: "Kitchen" } as Partial<ShownSet>)];
    hook.status = { CRANE: "held" };
    give("crane");
    inGame(<LookupSheet word="CRANE" />);
    expect(screen.getByText("You have all five letters.")).toBeTruthy();
    expect(screen.getByText("CRANE is in the set Kitchen. Unlocks soon.")).toBeTruthy();
    expect(screen.queryByText(/^Spell /)).toBeNull();
    expect(screen.queryByText(/yours alone/)).toBeNull();
    expect(screen.queryByText("Mint a pack")).toBeNull();
  });

  it("a visitor with no letters is told the set and its countdown, and how to get letters", () => {
    hook.sets = [revealed(1, iso(NOW + 2 * H), { name: "Kitchen" } as Partial<ShownSet>)];
    hook.status = { CRANE: "held" };
    hook.hasLetters = false;
    inGame(<LookupSheet word="CRANE" />);
    expect(screen.getByText("CRANE isn’t available yet.")).toBeTruthy();
    expect(screen.getByText("CRANE is in the set Kitchen. Unlocks in 2 h 00 min.")).toBeTruthy();
    expect(screen.getByText("Get letters")).toBeTruthy();
  });

  it("a held word of a set nobody has seen names no set, counts nothing, and offers nothing", () => {
    // The word is held back, and the only revealed set is another one: nothing may say where it is.
    hook.sets = [locked, revealed(1, iso(NOW + 2 * H), { name: "Kitchen" } as Partial<ShownSet>)];
    hook.status = { ABOUT: "held" };
    give("abou");
    const { container } = inGame(<LookupSheet word="ABOUT" />);
    expect(screen.getByText("ABOUT isn’t available yet.")).toBeTruthy();
    expect(screen.getByText("Some words unlock later, in sets. The Dictionary shows which sets are coming.")).toBeTruthy();
    expect(container.textContent).not.toContain("Kitchen");
    expect(container.textContent).not.toContain("is in the set");
    expect(screen.queryByText(/You only need/)).toBeNull();
    expect(screen.queryByText("Mint a pack")).toBeNull();
    expect(screen.queryByText("Set")).toBeNull();
    expect(screen.queryByText("To claim")).toBeNull();
  });
});
