/**
 * Links into part of a screen (state.tsx ViewSection; decisions.md #32): the word view's "Find a q
 * in the Market" names the letter whose sellers to show, and the Market's "and 45 more words" names
 * the letter whose words to show in the Dictionary. A link that names no letter must read as none,
 * or a screen would open on a letter nobody asked for.
 */
import { describe, it, expect } from "vitest";
import { reducer, sectionLetter, seedState, type ViewSection } from "@/components/game/state";

describe("following a link", () => {
  it("counts every navigation, so the same link followed twice is still two links", () => {
    // A screen keys its effect on `navSeq` as well as the section. Without it, "Find a q in the
    // Market" tapped again (after closing q's sellers) left `section` unchanged and did nothing.
    const a = reducer(seedState(), { t: "nav", view: "swap", section: "letter:q" });
    const b = reducer(a, { t: "nav", view: "swap", section: "letter:q" });
    expect(b.section).toBe(a.section);
    expect(b.navSeq).toBe(a.navSeq + 1);
    expect(a.navSeq).toBe(seedState().navSeq + 1);
  });

  it("names the part, closes any sheet, and forgets the part on the next plain navigation", () => {
    const open = reducer(seedState(), { t: "sheet", sheet: { kind: "lookup", word: "QUINT" } });
    const linked = reducer(open, { t: "nav", view: "dictionary", section: "needs:x" });
    expect(linked).toMatchObject({ view: "dictionary", section: "needs:x", sheet: null });
    expect(reducer(linked, { t: "nav", view: "dictionary" }).section).toBeUndefined();
  });
});

describe("the letter a link names", () => {
  it("reads the letter of its own kind of link", () => {
    expect(sectionLetter("letter:q", "letter")).toBe(16);
    expect(sectionLetter("needs:a", "needs")).toBe(0);
    expect(sectionLetter("needs:z", "needs")).toBe(25);
    // an UPPERCASE letter for sale is the same letter
    expect(sectionLetter("letter:Z", "letter")).toBe(25);
  });

  it("is none for the other kind, for a plain section, and for no link", () => {
    expect(sectionLetter("letter:q", "needs")).toBeNull();
    expect(sectionLetter("needs:q", "letter")).toBeNull();
    for (const s of ["bounty", "letters", "sellLetters", "words"] as ViewSection[]) {
      expect(sectionLetter(s, "letter"), s).toBeNull();
      expect(sectionLetter(s, "needs"), s).toBeNull();
    }
    expect(sectionLetter(undefined, "letter")).toBeNull();
  });

  it("is none for anything that isn't one letter", () => {
    for (const s of ["letter:", "letter:qq", "letter:1", "needs:é", "letter: q"] as ViewSection[]) {
      expect(sectionLetter(s, "letter"), s).toBeNull();
      expect(sectionLetter(s, "needs"), s).toBeNull();
    }
  });
});
