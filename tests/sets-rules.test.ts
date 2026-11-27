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
  STANDARD_FIELDS,
  ALLOWLIST_MAX,
  IDENTITY_KEYS,
  SCHEDULE_KEYS,
  SETTINGS_DEFAULTS,
  STAMP_MAX_BYTES,
  STAMP_TYPES,
  COLLAB_LIVE,
  parseAllowlist,
  releaseProblems,
  revealProblems,
  sniffStamp,
  type WordSet,
} from "@/lib/sets/rules";
import { pickTestWords, placeholderStamp } from "@/lib/sets/testCollab";

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
    releaseRoot: null,
    words: words.map((word, i) => ({ word, headliner: i === 0 })),
    ...STANDARD_FIELDS,
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
    expect(pub[1]).toEqual({
      kind: "revealed", id: 2, name: "Shown", words: [{ word: C, headliner: true }], collab: null, firstDay: "verified", firstDayLabel: null,
      releaseAt: "2026-12-24T00:00:00.000Z",
    });
  });
  it("a released set shows its words, headliners first, and its gate", () => {
    expect(pub[2]).toMatchObject({ kind: "released", id: 3, name: "Out", gateUntil: "2026-12-02T00:00:00.000Z", perPlayerLimit: 1 });
    expect(pub[2].kind === "released" && pub[2].words[0]).toEqual({ word: D, headliner: true });
  });
});

// --- collab sets (decisions.md, "Collab sets") ---------------------------------------------------

describe("a collab set", () => {
  const five = WORDS.slice(300, 305);
  const whole = { type: "collab", partnerName: "Partner", colorA: "#112233", colorB: "#aabbcc", stampAt: new Date(0) } as const;

  // `true`: the collab's own rules, as they hold once its card has shipped.
  it("can't be revealed with other than five words", () => {
    for (const n of [1, 4, 6]) {
      expect(revealProblems(set(1, "C", "draft", WORDS.slice(300, 300 + n), whole), true)).toEqual([`a collab set has exactly 5 words (this one has ${n})`]);
    }
    expect(revealProblems(set(1, "C", "draft", five, whole), true)).toEqual([]);
  });
  it("nor without its partner's name, its two colors, and its stamp", () => {
    expect(revealProblems(set(1, "C", "draft", five, { ...whole, partnerName: "  " }), true)).toEqual(["a collab set needs its partner's name"]);
    expect(revealProblems(set(1, "C", "draft", five, { ...whole, colorB: null }), true)).toEqual(["a collab set needs its two colors"]);
    expect(revealProblems(set(1, "C", "draft", five, { ...whole, stampAt: null }), true)).toEqual(["a collab set needs its stamp"]);
  });
  it("and not at all until the collab card ships: a collab word is Legendary and on its own card from the reveal, and neither exists yet", () => {
    // This pins today's state. The PR that ships the card flips COLLAB_LIVE and this expectation with it.
    expect(COLLAB_LIVE).toBe(false);
    expect(revealProblems(set(1, "C", "draft", five, whole))).toEqual(["a collab set can be revealed once the collab card ships (a draft can be made and edited now)"]);
    expect(revealProblems(set(1, "C", "draft", five, whole), false)).toHaveLength(1);
    expect(revealProblems(set(1, "S", "draft", five), false)).toEqual([]); // a standard set is as it was
  });
  it("a standard set needs none of it, only a word", () => {
    expect(revealProblems(set(1, "S", "draft", WORDS.slice(300, 303)))).toEqual([]);
    expect(revealProblems(set(1, "S", "draft", []))).toEqual(["a set with no words can't be revealed"]);
  });
  it("its identity is locked at reveal with its name; the first day's rule can change until release", () => {
    // Every setting is in exactly one of the two groups (or is the display order), so a new one can't be forgotten.
    const all: Record<keyof typeof SETTINGS_DEFAULTS | "name" | "sort", true> = {
      name: true, sort: true, revealAt: true, releaseAt: true, gateHours: true, perPlayerLimit: true, type: true, partnerName: true,
      partnerUrl: true, colorA: true, colorB: true, gateRule: true, gateToken: true, gateMin: true, gateLabel: true,
    };
    expect([...IDENTITY_KEYS, ...SCHEDULE_KEYS, "sort"].sort()).toEqual(Object.keys(all).sort());
    expect(IDENTITY_KEYS).toEqual(["name", "type", "partnerName", "partnerUrl", "colorA", "colorB"]);
  });
});

describe("a collab's settings as the operator types them", () => {
  it("takes a type, a partner, an https link, and two colors", () => {
    const c = checkSettings({ type: "collab", partnerName: " Partner ", partnerUrl: "https://partner.example/page", colorA: "#1F6F8B", colorB: "#f2a65a" });
    expect(c).toEqual({ ok: true, value: { type: "collab", partnerName: "Partner", partnerUrl: "https://partner.example/page", colorA: "#1f6f8b", colorB: "#f2a65a" } });
  });
  it("refuses a link that isn't https, and a color that isn't six hex digits", () => {
    for (const partnerUrl of ["http://partner.example", "javascript:alert(1)", "data:text/html,x", "//partner.example", "partner.example", "https://localhost"]) {
      expect(checkSettings({ partnerUrl }), partnerUrl).toMatchObject({ ok: false });
    }
    for (const colorA of ["red", "#fff", "#12345g", "rgb(1,2,3)", "#1234567", 'url("x")']) expect(checkSettings({ colorA }), colorA).toMatchObject({ ok: false });
    expect(checkSettings({ type: "premium" })).toMatchObject({ ok: false });
  });
  it("an empty value clears a field", () => {
    expect(checkSettings({ partnerName: "", partnerUrl: null, colorA: " ", gateToken: "", gateMin: null, gateLabel: "" })).toEqual({
      ok: true,
      value: { partnerName: null, partnerUrl: null, colorA: null, gateToken: null, gateMin: null, gateLabel: null },
    });
  });
  it("takes a first-day rule: a contract address, and a whole amount above zero", () => {
    const c = checkSettings({ gateRule: "token", gateToken: "0xAbCd000000000000000000000000000000000001", gateMin: "0001000000000000000000", gateLabel: "holders of a test token" });
    expect(c).toEqual({ ok: true, value: { gateRule: "token", gateToken: "0xabcd000000000000000000000000000000000001", gateMin: "1000000000000000000", gateLabel: "holders of a test token" } });
    for (const gateMin of ["0", "-1", "1.5", "1e18", "ten"]) expect(checkSettings({ gateMin }), gateMin).toMatchObject({ ok: false });
    expect(checkSettings({ gateToken: "0x123" })).toMatchObject({ ok: false });
    expect(checkSettings({ gateRule: "everyone" })).toMatchObject({ ok: false });
  });
});

describe("a first day's rule, before a release is built", () => {
  const s = (over: Partial<WordSet>) => set(1, "S", "revealed", [A], over);
  it("every verified player needs nothing more", () => {
    expect(releaseProblems(s({}))).toEqual([]);
  });
  it("a token rule needs its contract and its minimum; an allowlist needs somebody on it", () => {
    expect(releaseProblems(s({ gateRule: "token", gateToken: "0x" + "1".repeat(40) }))).toEqual(["the token rule needs a contract and a minimum balance"]);
    expect(releaseProblems(s({ gateRule: "token", gateToken: "0x" + "1".repeat(40), gateMin: "1" }))).toEqual([]);
    expect(releaseProblems(s({ gateRule: "allowlist" }))).toEqual(["the allowlist rule needs at least one wallet on the list"]);
    expect(releaseProblems(s({ gateRule: "allowlist", allowlistCount: 1 }))).toEqual([]);
  });
  it("a set with no first day has no rule to check", () => {
    expect(releaseProblems(s({ gateHours: 0, gateRule: "allowlist" }))).toEqual([]);
  });
});

describe("what the game is told about a collab", () => {
  const five = WORDS.slice(300, 305);
  const look = { type: "collab", partnerName: "Partner", partnerUrl: "https://partner.example/", colorA: "#112233", colorB: "#aabbcc", stampAt: new Date(5_000) } as const;
  it("nothing while it is a draft", () => {
    expect(publicSets([set(1, "Secret", "draft", five, { ...look, gateRule: "token", gateToken: "0x" + "4".repeat(40), gateMin: "9", gateLabel: "SecretLabel" })])).toEqual([{ kind: "locked" }]);
  });
  it("its partner, its colors, and its stamp's address once it is revealed; a first day's rule, and never what the rule checks against", () => {
    const [shown] = publicSets([set(4, "Shown", "revealed", five, { ...look, gateRule: "allowlist", gateLabel: "friends of the partner", allowlistCount: 2 })]);
    expect(shown).toMatchObject({
      kind: "revealed",
      collab: { partner: "Partner", url: "https://partner.example/", colorA: "#112233", colorB: "#aabbcc", stamp: "/api/sets/4/stamp?v=5" },
      firstDay: "allowlist",
      firstDayLabel: "friends of the partner",
    });
    expect(Object.keys(shown).sort()).toEqual(["collab", "firstDay", "firstDayLabel", "id", "kind", "name", "releaseAt", "words"]);
  });
  it("a set with no first day tells no rule", () => {
    const [shown] = publicSets([set(4, "Shown", "revealed", five, { gateHours: 0, gateRule: "token", gateLabel: "x" })]);
    expect(shown).toMatchObject({ firstDay: "verified", firstDayLabel: null, collab: null });
  });
});

describe("a collab in the file", () => {
  const five = WORDS.slice(300, 305);
  it("goes out and comes back with its type, partner, colors, and rule; a stamp and a list are never in a file", () => {
    const src = set(1, "Collab", "draft", five, {
      type: "collab", partnerName: "Partner", partnerUrl: "https://partner.example/", colorA: "#112233", colorB: "#aabbcc", stampAt: new Date(0),
      gateRule: "token", gateToken: "0x" + "4".repeat(40), gateMin: "9", gateLabel: "holders", allowlistCount: 3,
    });
    const file = exportSets([src, set(2, "Plain", "draft", [A])]);
    expect(Object.keys(file.sets[1]).sort()).toEqual(["gateHours", "headliners", "name", "perPlayerLimit", "releaseAt", "revealAt", "sort", "status", "words"]); // a plain set's file is what it was
    expect(JSON.stringify(file)).not.toMatch(/stamp|allowlist/i);
    const back = parseSetsFile(JSON.stringify(file), isWord, new Set());
    expect(back.ok && back.sets[0]).toMatchObject({
      name: "Collab", type: "collab", partnerName: "Partner", partnerUrl: "https://partner.example/", colorA: "#112233", colorB: "#aabbcc",
      gateRule: "token", gateToken: "0x" + "4".repeat(40), gateMin: "9", gateLabel: "holders",
    });
    expect(back.ok && back.sets[1]).toMatchObject({ name: "Plain", type: "standard", gateRule: "verified", partnerName: null });
  });
  it("the commitment is about the words, as before: a set's look doesn't change it", () => {
    const plain = set(1, "Same", "draft", five);
    const dressed: WordSet = { ...plain, type: "collab", partnerName: "Partner", colorA: "#112233" };
    expect(commitmentOf([dressed])).toBe(commitmentOf([plain]));
  });
});

describe("an allowlist as it is pasted", () => {
  it("takes wallets split by anything, each once, lowercase; counts what isn't a wallet and never echoes it", () => {
    const W1 = "0x00000000000000000000000000000000000000A1";
    const W2 = "0x00000000000000000000000000000000000000b2";
    expect(parseAllowlist(`${W1}\n${W2},${W1.toLowerCase()};  not-a-wallet 0x123\n`)).toEqual({ ok: true, wallets: [W1.toLowerCase(), W2], bad: 2 });
    expect(parseAllowlist("")).toEqual({ ok: true, wallets: [], bad: 0 });
  });
  it("is bounded", () => {
    const many = Array.from({ length: ALLOWLIST_MAX + 1 }, (_, i) => "0x" + i.toString(16).padStart(40, "0")).join("\n");
    expect(parseAllowlist(many)).toMatchObject({ ok: false });
  });
});

describe("a stamp is what its first bytes say", () => {
  it("a PNG or a JPEG; never an SVG, a WebP, a GIF, or a page", () => {
    expect(sniffStamp(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(sniffStamp(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(STAMP_TYPES).toEqual(["image/png", "image/jpeg"]); // what the server's pictures are known to draw
    for (const text of ['<svg xmlns="http://www.w3.org/2000/svg"/>', "<?xml version='1.0'?><svg/>", "GIF89a", "<!doctype html>", "RIFF\u0000\u0000\u0000\u0000WEBPVP8 ", ""]) {
      expect(sniffStamp(new TextEncoder().encode(text)), text).toBeNull();
    }
  });
  it("the placeholder stamp is a small PNG with a clear corner and an inked ring", () => {
    const png = placeholderStamp();
    expect(sniffStamp(png)).toBe("image/png");
    expect(png.length).toBeLessThan(STAMP_MAX_BYTES / 20);
    expect(Buffer.from(placeholderStamp()).equals(Buffer.from(png))).toBe(true); // the same picture every time
  });
});

describe("the test collab's five words", () => {
  const tier = (w: string) => (w.startsWith("M") ? "Mythic" : w.startsWith("L") ? "Legendary" : "Common");
  const first = () => 0;
  it("one Mythic word when there is one, the rest from below Legendary, A to Z", () => {
    expect(pickTestWords(["MYTHA", "MYTHB", "LEGEN", "ZEBRA", "APPLE", "BERRY", "CHAIR", "DOZEN"], tier, first)).toEqual(["APPLE", "BERRY", "CHAIR", "MYTHA", "ZEBRA"]);
  });
  it("five lower words when no Mythic word is free", () => {
    expect(pickTestWords(["LEGEN", "ZEBRA", "APPLE", "BERRY", "CHAIR", "DOZEN"], tier, first)).toEqual(["APPLE", "BERRY", "CHAIR", "DOZEN", "ZEBRA"]);
  });
  it("nothing when there aren't five", () => {
    expect(pickTestWords(["MYTHA", "LEGEN", "APPLE", "BERRY", "CHAIR"], tier, first)).toBeNull();
  });
});

