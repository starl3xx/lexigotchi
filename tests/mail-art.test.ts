/**
 * The envelope's art (src/lib/cardArt/mail.ts, decisions.md #49). It is drawn with the cards'
 * engraving kit and keeps the cards' rules (tests/scenes.test.tsx holds the same ones for a card's
 * art): plain shapes a renderer draws as they stand, every number a number, every name used once,
 * and nothing in it that moves. The page moves each piece whole.
 */
import { describe, it, expect } from "vitest";
import { CONTENTS, ENV, STAMP_PLACE, STRIP, envFront, envWindow, eyesArt, mailArt, mailUri, sparklesArt } from "@/lib/cardArt/mail";

const docs = mailArt();

describe("the mail's art", () => {
  it("is every piece the envelope needs", () => {
    expect(docs.map((d) => d.name)).toEqual(
      expect.arrayContaining(["the envelope's inside", "the envelope's face, five letters", "the envelope's face, one letter", "the tear strip", "the stamp", "the postmark", "eyes, you", "eyes, shut"]),
    );
  });

  it("is plain shapes: no text (the page letters the envelope), filters, scripts, styles, or anything fetched", () => {
    for (const d of docs) {
      expect(d.markup, d.name).not.toMatch(/<(text|filter|script|style|foreignObject|image|animate)\b/i);
      expect(d.markup, d.name).not.toMatch(/\b(class|style)=/);
      expect(d.markup, d.name).not.toMatch(/https?:\/\//);
    }
  });

  it("carries no number that isn't one (a NaN in a path drops the path without a word)", () => {
    for (const d of docs) expect(d.markup, d.name).not.toMatch(/NaN|Infinity|undefined|null/);
  });

  it("names each of its gradients, patterns, masks, and clips once, and uses only names it made", () => {
    for (const d of docs) {
      const ids = [...d.markup.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size, d.name).toBe(ids.length);
      const used = [...d.markup.matchAll(/url\(#([^)]+)\)/g), ...d.markup.matchAll(/\bhref="#([^"]+)"/g)].map((m) => m[1]);
      for (const u of used) expect(ids, `${d.name} uses #${u}`).toContain(u);
    }
  });

  it("is still pictures: nothing in one moves (the page moves each piece whole)", () => {
    for (const d of docs) expect(d.markup, d.name).not.toMatch(/<animate|<set\b|@keyframes/i);
  });

  it("is the same picture every time (seeded, not random)", () => {
    expect(envFront(5)).toBe(envFront(5));
    expect(mailArt().map((d) => d.markup)).toEqual(docs.map((d) => d.markup));
  });

  it("stays a few hundred shapes at most a piece", () => {
    for (const d of docs) expect((d.markup.match(/<[a-z]/g) ?? []).length, d.name).toBeLessThan(400);
  });

  it("makes an address an image can load", () => {
    const uri = mailUri(eyesArt("you"), 110, 60);
    expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
    expect(decodeURIComponent(uri)).toContain('viewBox="0 0 110 60"');
  });
});

describe("where things sit on the envelope's face", () => {
  const inside = (b: { x: number; y: number; w: number; h: number }) => b.x > 0 && b.y > ENV.tear && b.x + b.w < ENV.w && b.y + b.h < ENV.h;
  const apart = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
  const stamp = { x: STAMP_PLACE.x, y: STAMP_PLACE.y, w: STAMP_PLACE.s, h: STAMP_PLACE.s };

  it("the window, the stamp's place, and the contents box are all on the face, below the tear line", () => {
    for (const box of [envWindow(5), envWindow(1), stamp, CONTENTS]) expect(inside(box), JSON.stringify(box)).toBe(true);
  });

  it("none of them covers another: “Contents: 5 letters” sits under the stamp, clear of the window", () => {
    expect(apart(stamp, CONTENTS)).toBe(true);
    expect(CONTENTS.y).toBeGreaterThan(stamp.y + stamp.h);
    for (const count of [1, 5]) {
      expect(apart(envWindow(count), CONTENTS)).toBe(true);
      expect(apart(envWindow(count), stamp)).toBe(true);
    }
  });

  it("the window for one letter is narrower than the window for five", () => {
    expect(envWindow(1).w).toBeLessThan(envWindow(5).w);
  });

  it("the strip covers the tear line, so the sealed envelope shows no torn edge", () => {
    expect(STRIP.h).toBeGreaterThan(ENV.tear);
    expect(STRIP.w).toBe(ENV.w);
  });

  it("the two sets of sparkles are different stars, so they can twinkle in turn", () => {
    expect(sparklesArt(0)).not.toBe(sparklesArt(1));
  });
});
