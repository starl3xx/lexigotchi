/**
 * Reserved word sets: the pure rules (lib/sets/rules.ts; decisions.md, "Reserved word sets").
 *
 * The test words are ordinary dictionary words picked for the test. No real set is named anywhere
 * in this repository: the real lists live only in the database.
 */
import { describe, it, expect } from "vitest";
import { isWord, WORDS } from "@/lib/dictionary";
import {
  GATE_HOURS_DEFAULT,
  GATE_HOURS_MAX,
  PER_PLAYER_DEFAULT,
  canonicalSets,
  checkSettings,
  checkWords,
  commitmentOf,
  dueToReveal,
  editable,
  exportSets,
  gateUntilFor,
  heldOf,
  parseSetsFile,
  publicSets,
  releaseChange,
  reserveChange,
  scheduleError,
  type SetStatus,
  type WordSet,
} from "@/lib/sets/rules";

const [A, B, C, D, E, F] = WORDS.slice(100, 106);

function set(id: number, name: string, status: SetStatus, words: string[], over: Partial<WordSet> = {}): WordSet {
  return {
    id,
    name,
    status,
    revealAt: null,
    releaseAt: null,
    gateHours: GATE_HOURS_DEFAULT,
    perPlayerLimit: PER_PLAYER_DEFAULT,
    sort: id,
    revealedAt: null,
    releasedAt: null,
    gateUntil: null,
    releaseBlock: null,
    words: words.map((word, i) => ({ word, headliner: i === 0 })),
    ...over,
  };
}

describe("what may change in each state", () => {
  it("a draft is fully editable", () => {
    expect(editable("draft")).toEqual({ words: true, name: true, schedule: true, remove: true });
  });
  it("a revealed set's words and name are locked; its dates can still move", () => {
    expect(editable("revealed")).toEqual({ words: false, name: false, schedule: true, remove: false });
  });
  it("a released set is permanent", () => {
    expect(editable("released")).toEqual({ words: false, name: false, schedule: false, remove: false });
  });
});

describe("a set's words", () => {
  it("must be dictionary words, five letters, once each", () => {
    const c = checkWords([A.toLowerCase(), A, "QQQQQ", "abc", 7, B], isWord, new Set());
    expect(c.ok).toEqual([A, B]);
    expect(c.unknown).toEqual(["QQQQQ"]);
    expect(c.malformed).toEqual(["abc", "7"]);
  });
  it("a word another set holds is refused", () => {
    const c = checkWords([A, B], isWord, new Set([B]));
    expect(c.ok).toEqual([A]);
    expect(c.taken).toEqual([B]);
  });
});

describe("the words held back", () => {
  it("are every word of a set that isn't released", () => {
    const held = heldOf([set(1, "one", "draft", [A]), set(2, "two", "revealed", [B]), set(3, "three", "released", [C])]);
    expect([...held].sort()).toEqual([A, B].sort());
  });
});

describe("the schedule", () => {
  it("a draft is due once its reveal time has come", () => {
    const now = new Date("2026-12-01T00:00:00Z");
    expect(dueToReveal(set(1, "x", "draft", [A], { revealAt: new Date("2026-11-30T00:00:00Z") }), now)).toBe(true);
    expect(dueToReveal(set(1, "x", "draft", [A], { revealAt: new Date("2026-12-02T00:00:00Z") }), now)).toBe(false);
    expect(dueToReveal(set(1, "x", "draft", [A]), now)).toBe(false);
    expect(dueToReveal(set(1, "x", "revealed", [A], { revealAt: new Date("2026-11-30T00:00:00Z") }), now)).toBe(false);
  });
  it("the reveal comes before the release", () => {
    expect(scheduleError({ revealAt: new Date(2), releaseAt: new Date(1) })).toMatch(/before/);
    expect(scheduleError({ revealAt: new Date(1), releaseAt: new Date(2) })).toBeNull();
    expect(scheduleError({ revealAt: null, releaseAt: new Date(2) })).toBeNull();
  });
  it("settings are bounded: the gate by the contract's limit, the per-player limit above zero", () => {
    expect(checkSettings({ gateHours: GATE_HOURS_MAX + 1 }).ok).toBe(false);
    expect(checkSettings({ gateHours: 0 }).ok).toBe(true);
    expect(checkSettings({ perPlayerLimit: 0 }).ok).toBe(false);
    expect(checkSettings({ name: "  " }).ok).toBe(false);
    const ok = checkSettings({ name: " Spring ", gateHours: "48", revealAt: "2026-12-01T00:00:00Z", releaseAt: null });
    expect(ok.ok && ok.value).toEqual({ name: "Spring", gateHours: 48, revealAt: new Date("2026-12-01T00:00:00Z"), releaseAt: null });
  });
  it("a gate ends its length after the release, and can't be built further ahead than the contract takes", () => {
    const now = 1_800_000_000;
    expect(gateUntilFor(now, { releaseAt: null, gateHours: 24 })).toEqual({ until: now + 86_400 });
    expect(gateUntilFor(now, { releaseAt: new Date((now + 3600) * 1000), gateHours: 24 })).toEqual({ until: now + 3600 + 86_400 });
    // a release that has slipped past its planned time gates from NOW, never from the past
    expect(gateUntilFor(now, { releaseAt: new Date((now - 7200) * 1000), gateHours: 24 })).toEqual({ until: now + 86_400 });
    expect(gateUntilFor(now, { releaseAt: null, gateHours: 0 })).toEqual({ until: null });
    expect("error" in gateUntilFor(now, { releaseAt: new Date((now + 8 * 86_400) * 1000), gateHours: 24 })).toBe(true);
  });
});

describe("import and export", () => {
  it("reads a file into draft sets", () => {
    const text = JSON.stringify({ sets: [{ name: "One", words: [A, { word: B, headliner: true }], headliners: [A] }, { name: "Two", words: [C], gateHours: 12, perPlayerLimit: 2 }] });
    const r = parseSetsFile(text, isWord, new Set());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sets.map((s) => s.name)).toEqual(["One", "Two"]);
    expect(r.sets[0].words).toEqual([{ word: A, headliner: true }, { word: B, headliner: true }]);
    expect(r.sets[0].gateHours).toBe(GATE_HOURS_DEFAULT);
    expect(r.sets[1]).toMatchObject({ gateHours: 12, perPlayerLimit: 2, sort: 1 });
  });
  it("a word can't sit in two sets of one file", () => {
    const r = parseSetsFile(JSON.stringify({ sets: [{ name: "One", words: [A, B] }, { name: "Two", words: [B, C] }] }), isWord, new Set());
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.join(" ")).toContain(`${B} is also in "One"`);
  });
  it("nor in a file and a revealed or released set", () => {
    const r = parseSetsFile(JSON.stringify({ sets: [{ name: "One", words: [A] }] }), isWord, new Set([A]));
    expect(!r.ok && r.errors.join(" ")).toMatch(/already in a revealed or released set/);
  });
  it("refuses a word that isn't in the dictionary, and reports every problem at once", () => {
    const r = parseSetsFile(JSON.stringify({ sets: [{ name: "", words: ["QQQQQ"] }, { name: "Two", words: "x" }] }), isWord, new Set());
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.length).toBeGreaterThanOrEqual(2);
  });
  it("leaves a revealed set in an exported file alone, and takes the export back unchanged", () => {
    const sets = [set(1, "Draft", "draft", [A, B]), set(2, "Shown", "revealed", [C]), set(3, "Out", "released", [D])];
    const file = exportSets(sets);
    expect(file.sets.map((s) => s.name)).toEqual(["Draft", "Shown"]); // a released set isn't in the file
    const r = parseSetsFile(JSON.stringify(file), isWord, new Set([C, D]));
    expect(r.ok && r.sets.map((s) => s.name)).toEqual(["Draft"]);
    expect(r.ok && r.sets[0].words).toEqual([{ word: A, headliner: true }, { word: B, headliner: false }]);
  });
  it("isn't JSON, or isn't a list of sets: said plainly", () => {
    expect(parseSetsFile("nope", isWord, new Set())).toEqual({ ok: false, errors: ["that isn't JSON"] });
    expect(parseSetsFile("{}", isWord, new Set()).ok).toBe(false);
  });
});

describe("the commitment", () => {
  const sets = [set(1, "Beta", "draft", [B, A]), set(2, "Alpha", "revealed", [C])];
  it("is the keccak256 of a canonical JSON anyone can rebuild", () => {
    expect(canonicalSets(sets)).toBe(
      JSON.stringify({ v: 1, sets: [{ name: "Alpha", words: [C], headliners: [C] }, { name: "Beta", words: [A, B].sort(), headliners: [B] }] }),
    );
    expect(commitmentOf(sets)).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("doesn't change with the order of the sets or words, the dates, the gate, or a reveal", () => {
    const moved = [
      set(9, "Alpha", "draft", [C], { sort: 5, gateHours: 2, releaseAt: new Date(5) }),
      { ...set(1, "Beta", "draft", [A, B]), words: [{ word: A, headliner: false }, { word: B, headliner: true }] },
    ];
    expect(commitmentOf(moved)).toBe(commitmentOf(sets));
  });
  it("changes when a word, a headliner, or a name does", () => {
    const base = commitmentOf(sets);
    expect(commitmentOf([set(1, "Beta", "draft", [B, A, D]), sets[1]])).not.toBe(base);
    expect(commitmentOf([set(1, "Beta!", "draft", [B, A]), sets[1]])).not.toBe(base);
    expect(commitmentOf([{ ...sets[0], words: sets[0].words.map((w) => ({ ...w, headliner: true })) }, sets[1]])).not.toBe(base);
  });
  it("covers unreleased sets only", () => {
    expect(commitmentOf([...sets, set(3, "Out", "released", [D])])).toBe(commitmentOf(sets));
  });
});

describe("root changes", () => {
  it("a release adds the set's words and never removes one", () => {
    const chainHeld = new Set([A, B, C, D]);
    const r = releaseChange(chainHeld, [A, B]);
    expect(r.added).toEqual([A, B].sort());
    expect(r.held).toEqual([C, D].sort());
    expect(r.neverHeld).toEqual([]);
    // every word claimable before is claimable after: the new held list is a subset of the old
    expect(r.held.every((w) => chainHeld.has(w))).toBe(true);
  });
  it("a release is built from the chain's list, so a waiting draft edit can't ride along", () => {
    // E was put in a draft after the last reserve root: the chain doesn't hold it back yet.
    const r = releaseChange(new Set([A, B]), [A]);
    expect(r.held).toEqual([B]);
    expect(r.held).not.toContain(E);
  });
  it("says which of a set's words the chain never held back", () => {
    expect(releaseChange(new Set([A]), [A, F]).neverHeld).toEqual([F]);
  });
  it("a reserve moves the chain to what the sets say, both ways", () => {
    const r = reserveChange(new Set([A, B]), new Set([B, C]));
    expect(r.removed).toEqual([C]); // newly held back
    expect(r.added).toEqual([A]); // let go
    expect(r.held).toEqual([B, C].sort());
  });
});

describe("what a player's browser is told", () => {
  const sets = [
    set(1, "Secret", "draft", [A, B], { revealAt: new Date("2027-01-01T00:00:00Z"), releaseAt: new Date("2027-01-02T00:00:00Z") }),
    set(2, "Shown", "revealed", [C], { releaseAt: new Date("2026-12-24T00:00:00Z") }),
    set(3, "Out", "released", [D, E], { releasedAt: new Date("2026-12-01T00:00:00Z"), gateUntil: new Date("2026-12-02T00:00:00Z") }),
    set(4, "Empty", "draft", []),
  ];
  const pub = publicSets(sets);
  it("a draft is a locked slot and nothing else", () => {
    expect(pub[0]).toEqual({ kind: "locked" });
    expect(Object.keys(pub[0])).toEqual(["kind"]);
  });
  it("an empty draft isn't even a slot", () => {
    expect(pub.filter((p) => p.kind === "locked")).toHaveLength(1);
  });
  it("NOTHING of a draft is in the answer: no name, word, date, id, or count", () => {
    const text = JSON.stringify(pub);
    for (const secret of ["Secret", A, B, "2027-01-01", "2027-01-02", "Empty"]) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/"id":1\b/);
  });
  it("a revealed set shows its name, words, and release time", () => {
    expect(pub[1]).toEqual({ kind: "revealed", id: 2, name: "Shown", words: [{ word: C, headliner: true }], releaseAt: "2026-12-24T00:00:00.000Z" });
  });
  it("a released set shows its words, headliners first, and its gate", () => {
    expect(pub[2]).toMatchObject({ kind: "released", id: 3, name: "Out", gateUntil: "2026-12-02T00:00:00.000Z", perPlayerLimit: 1 });
    expect(pub[2].kind === "released" && pub[2].words[0]).toEqual({ word: D, headliner: true });
  });
});
