/**
 * Links into part of a screen (state.tsx ViewSection; decisions.md #32): the word view's "Find a q
 * in the Market" names the letter whose sellers to show, and the Market's "and 45 more words" names
 * the letter whose words to show in the Dictionary. A link that names no letter must read as none,
 * or a screen would open on a letter nobody asked for.
 */
import { describe, it, expect } from "vitest";
import { sectionLetter, type ViewSection } from "@/components/game/state";

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
