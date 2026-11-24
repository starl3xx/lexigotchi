/**
 * Showcase shares (src/lib/showcase.ts): the link a post carries, and what its page accepts.
 */
import { describe, it, expect } from "vitest";
import { parseShowcase, showcaseCardUrl, showcasePostText, showcaseText, showcaseUrl, xIntentUrl } from "@/lib/showcase";

describe("parseShowcase", () => {
  it("reads each tile's case from the path", () => {
    expect(parseShowcase("HeLLo")).toEqual([
      { char: "H", upper: true },
      { char: "E", upper: false },
      { char: "L", upper: true },
      { char: "L", upper: true },
      { char: "O", upper: false },
    ]);
  });

  it("round-trips to the same path text", () => {
    for (const t of ["HeLLo", "zz", "ABCDEFGH", "jazzy"]) expect(showcaseText(parseShowcase(t)!)).toBe(t);
  });

  it("takes 2 to 8 letters, A to Z only", () => {
    expect(parseShowcase("a")).toBeNull();
    expect(parseShowcase("abcdefghi")).toBeNull();
    for (const bad of ["he llo", "héllo", "ab1", "<b>", "%3Cb%3E", "ab%2", ""]) expect(parseShowcase(bad)).toBeNull();
  });
});

describe("share links", () => {
  it("point at the showcase page and its two card shapes", () => {
    expect(showcaseUrl("HeLLo")).toMatch(/\/s\/HeLLo$/);
    expect(showcaseCardUrl("HeLLo")).toMatch(/\/s\/HeLLo\/card$/);
    expect(showcaseCardUrl("HeLLo", "fc")).toMatch(/\/s\/HeLLo\/card\?ratio=3x2$/);
  });

  it("prefill X's composer with the words and the link", () => {
    const u = new URL(xIntentUrl(showcasePostText("HeLLo"), showcaseUrl("HeLLo")));
    expect(u.origin + u.pathname).toBe("https://x.com/intent/post");
    expect(u.searchParams.get("text")).toBe("HeLLo ✨ spelled with letters I raised in Lexigotchi");
    expect(u.searchParams.get("url")).toBe(showcaseUrl("HeLLo"));
    expect(u.searchParams.get("via")).toBe("lexigotchi"); // "via @lexigotchi", X only
  });

  it("post copy has no em dash", () => {
    expect(showcasePostText("HeLLo")).not.toMatch(/—/);
  });
});
