/**
 * Showcase shares (src/lib/showcase.ts): the link a post carries, and what its page accepts.
 *
 * A showcase is one of the player's words (starl3xx, 2026-11-24: "Showcase should only be for
 * words you own (people could tweet all sorts of crazy shit otherwise!)"), so the page and its
 * card draw dictionary words only. These tests are that guard.
 */
import { describe, it, expect } from "vitest";
import { HOUSE_CARDS, parseShowcase, CARD_LOOK, showcaseCardUrl, showcasePostText, showcaseText, showcaseUrl, showcaseWordText, xIntentUrl, showcaseXText, showcaseFacePath } from "@/lib/showcase";
import { BANNED, isWord } from "@/lib/dictionary";

describe("parseShowcase", () => {
  it("reads each tile's case from the path", () => {
    expect(parseShowcase("CRAne")).toEqual([
      { char: "C", upper: true },
      { char: "R", upper: true },
      { char: "A", upper: true },
      { char: "N", upper: false },
      { char: "E", upper: false },
    ]);
  });

  it("round-trips to the same path text", () => {
    for (const t of ["CRAne", "crane", "CRANE", "vIvId"]) expect(showcaseText(parseShowcase(t)!)).toBe(t);
  });

  it("draws a dictionary word in any case", () => {
    expect(isWord("CRANE")).toBe(true);
    for (const t of ["CRANE", "crane", "cRaNe"]) expect(parseShowcase(t)).not.toBeNull();
  });

  it("refuses free text: anything that isn't a dictionary word", () => {
    for (const bad of ["XQZPW", "zz", "ABCDEFGH", "jazzyy", "he llo", "héllo", "ab1", "<b>", "%3Cb%3E", "ab%2", ""]) {
      expect(parseShowcase(bad)).toBeNull();
    }
  });

  it("refuses every banned word, though it is five letters", () => {
    expect(BANNED.length).toBeGreaterThan(0);
    for (const w of BANNED) {
      expect(parseShowcase(w)).toBeNull();
      expect(parseShowcase(w.toLowerCase())).toBeNull();
    }
  });

  it("draws the game's own house cards (the beta group's HEYOO welcome)", () => {
    expect(HOUSE_CARDS).toContain("HEYOO");
    expect(parseShowcase("HEYOO")).not.toBeNull();
  });
});

describe("share links", () => {
  it("spell a word in its case", () => {
    expect(showcaseWordText("CRANE", [true, true, true, false, false])).toBe("CRAne");
    expect(showcaseWordText("CRANE", [false, false, false, false, false])).toBe("crane");
  });

  it("point at the showcase page and its two card shapes", () => {
    expect(showcaseUrl("CRAne")).toMatch(/\/s\/CRAne$/);
    expect(showcaseCardUrl("CRAne")).toMatch(new RegExp(`/s/CRAne/card\\?v=${CARD_LOOK}$`));
    expect(showcaseCardUrl("CRAne", "fc")).toMatch(new RegExp(`/s/CRAne/card\\?ratio=3x2&v=${CARD_LOOK}$`));
  });

  it("put the card's look in every card picture's address, so a redrawn card escapes every cache", () => {
    // The picture is cached for a day in a browser and a week at the edge. The share video draws
    // its front from this address, and showed the old letters after the letters changed.
    for (const url of [showcaseCardUrl("CRAne"), showcaseCardUrl("CRAne", "fc", "spring"), showcaseCardUrl("CRAne", "x", undefined, true)]) {
      expect(new URL(url).searchParams.get("v")).toBe(String(CARD_LOOK));
    }
    // the page's own address is a link people keep: it carries no version
    expect(showcaseUrl("CRAne", "spring")).not.toMatch(/[?&]v=/);
  });

  it("carry the scene, and leave it off for the Stage, so a link made before scenes is a Stage link", () => {
    expect(showcaseUrl("CRAne", "trophy")).toMatch(/\/s\/CRAne\?scene=trophy$/);
    expect(showcaseUrl("CRAne", "stage")).toMatch(/\/s\/CRAne$/);
    expect(showcaseCardUrl("CRAne", "x", "spring")).toMatch(new RegExp(`/s/CRAne/card\\?v=${CARD_LOOK}&scene=spring$`));
    expect(showcaseCardUrl("CRAne", "fc", "spring")).toMatch(new RegExp(`/s/CRAne/card\\?ratio=3x2&v=${CARD_LOOK}&scene=spring$`));
  });

  it("name the stock card in its link, though it is where a word starts: no scene in a link means the Stage", () => {
    // A word nobody picked a scene for stands on the stock card. Its link must say so, because a
    // link with no scene was made when the Stage was the default, and keeps meaning the Stage.
    expect(showcaseUrl("CRAne", "stock")).toMatch(/\/s\/CRAne\?scene=stock$/);
    expect(showcaseCardUrl("CRAne", "x", "stock")).toMatch(new RegExp(`/s/CRAne/card\\?v=${CARD_LOOK}&scene=stock$`));
  });

  it("give the share video the card's front alone, in the card's own shape", () => {
    expect(showcaseFacePath("CRAne", "spring")).toBe(`/s/CRAne/card?face=1&v=${CARD_LOOK}&scene=spring`);
    expect(showcaseFacePath("CRAne", "stage")).toBe(`/s/CRAne/card?face=1&v=${CARD_LOOK}`);
  });

  it("prefill X's composer with the words and the link, tagging @lexigotchi once", () => {
    const u = new URL(xIntentUrl(showcaseXText("CRAne"), showcaseUrl("CRAne")));
    expect(u.origin + u.pathname).toBe("https://x.com/intent/post");
    expect(u.searchParams.get("text")).toBe("CRAne ✨ spelled with letters I raised in @lexigotchi");
    expect(u.searchParams.get("url")).toBe(showcaseUrl("CRAne"));
    expect(u.searchParams.get("via")).toBeNull(); // the tag is in the text, never twice
  });

  it("tag @lexigotchi on any X post whose text doesn't name it", () => {
    const u = new URL(xIntentUrl("look at my letters", showcaseUrl("CRAne")));
    expect(u.searchParams.get("text")).toBe("look at my letters @lexigotchi");
  });

  it("keep @lexigotchi out of the cast text (on Farcaster it would be someone else)", () => {
    expect(showcasePostText("CRAne")).not.toMatch(/@lexigotchi/i);
  });

  it("post copy has no em dash", () => {
    expect(showcasePostText("CRAne")).not.toMatch(/—/);
  });
});
