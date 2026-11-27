/**
 * The lockup, everywhere the name was set in type (decisions.md #56, part 2). starl3xx, 2026-11-27,
 * of a share video whose corner still said LEXIGOTCHI in plain type: "the wordmark didn't make it
 * onto the share cards... did you implement everywhere including email, share cards, OG images".
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_MARK, lockup, lockupDoc, lockupTag } from "@/lib/cardArt/logo";
import { svgDoc } from "@/lib/cardArt/engrave";
import { BLINK_S, FRONT_AWAY, MARK_BLINKS, MARK_LOOK, eyesAt, markEyes } from "@/components/cards/loop/score";
import { LOOP_SECONDS } from "@/components/cards/loop/loopRenderer";

const read = (p: string) => readFileSync(p, "utf8");

describe("a still pose, for something drawn frame by frame", () => {
  it("leaves the plain drawing exactly as it was", () => {
    expect(lockup({ pose: "open" }).markup).toBe(lockup().markup);
    expect(lockupDoc().svg).toContain(lockup().markup);
  });

  it("shut: the shut eyes show and the open ones are not drawn; a glance moves the pupils and nothing else", () => {
    const shut = lockup({ pose: "shut" }).markup;
    expect(shut.match(/class="lk-shut"/g)).toHaveLength(2);
    expect(shut).not.toMatch(/lk-open|visibility="hidden"/);
    const left = lockup({ pose: "left" }).markup;
    const right = lockup({ pose: "right" }).markup;
    expect(left.match(/<g class="lk-pupil" transform="translate\(-11 1\)">/g)).toHaveLength(2);
    expect(right.match(/<g class="lk-pupil" transform="translate\(10 -1\)">/g)).toHaveLength(2);
    expect(left.replace(/ transform="translate\(-11 1\)"/g, "")).toBe(lockup().markup);
    // a still drawing needs no stylesheet: nothing in it is hidden
    for (const m of [shut, left, right]) expect(m).not.toContain("visibility");
  });
});

describe("the share video's corner", () => {
  it("lives by the written score: open at the loop's seam, two blinks, one look at the card", () => {
    expect(markEyes(0)).toBe("open");
    expect(markEyes(LOOP_SECONDS)).toBe("open");
    expect(markEyes(LOOP_SECONDS - 0.001)).toBe("open");
    for (const b of MARK_BLINKS) {
      expect(markEyes(b + BLINK_S / 2)).toBe("shut");
      expect(markEyes(b + BLINK_S + 0.01)).not.toBe("shut");
    }
    expect(markEyes((MARK_LOOK[0] + MARK_LOOK[1]) / 2)).toBe("left"); // the card is up and to its left
    expect(markEyes(MARK_LOOK[1] + 0.01)).toBe("open");
    // never by chance or by a clock: the same time always gives the same eyes
    for (let t = 0; t < 12; t += 0.07) expect(markEyes(t)).toBe(markEyes(t + LOOP_SECONDS));
  });

  it("has its moments while the back is up, when the word's own letters are out of sight", () => {
    for (const t of [...MARK_BLINKS, ...MARK_LOOK]) {
      expect(t).toBeGreaterThan(FRONT_AWAY[0]);
      expect(t).toBeLessThan(FRONT_AWAY[1]);
    }
    // and while it moves, no letter of a five-letter word does anything
    for (let t = MARK_BLINKS[0]; t < MARK_LOOK[1]; t += 0.05) for (let i = 0; i < 5; i++) expect(eyesAt(i, 5, t)).toBe("open");
  });

  it("draws the lockup's own pictures, and sets the name in type only if they fail: a video is always made", () => {
    const src = read("src/components/cards/loop/makeLoop.ts");
    expect(src).toContain("lockupDoc({ pose })");
    expect(src).toMatch(/drawImage\(mark\.eyes\[markEyes\(t\)\]/);
    expect(src).toMatch(/catch \(err\) \{\s*if \(err instanceof LoopCancelled\) throw err;\s*return null;/);
    expect(src).toMatch(/if \(mark\) \{[\s\S]*?return;\s*\}\s*g\.save\(\);[\s\S]*?fillText\("LEXIGOTCHI"/);
    expect(src).toContain("drawMark(g, mark, i / VIDEO_FPS)");
  });
});

describe("the pictures the server draws", () => {
  it("a SAVED picture's corner is the lockup on the dark table, for a word's card and the earnings picture; a link card has no name", () => {
    expect(read("src/app/_og/wordCard.tsx")).toContain('lockupDoc({ tone: "dark" })');
    for (const route of ["src/app/s/[text]/card/route.tsx", "src/app/e/[token]/card/route.tsx"]) {
      const src = read(route);
      expect(src, route).toContain("{saved && cornerMark(tall)}");
      expect(src.match(/cornerMark\(/g), route).toHaveLength(1);
      expect(src, route).not.toMatch(/>\s*LEXIGOTCHI\s*</);
    }
  });

  it("the game's link picture is the lockup, once: no letters spelling the name beside it", () => {
    const src = read("src/app/embed-image/route.tsx");
    expect(src).toContain("const MARK = lockupDoc();");
    expect(src).toContain("<img src={MARK_SRC} width={MARK_W} height={MARK_H} />");
    expect(src).not.toMatch(/OgTile|>\s*LEXIGOTCHI\s*</);
  });
});

describe("the email's picture, and the docs' logo", () => {
  it("the email's picture is a file the site serves, three pixels to the point of the size the email gives it, with no clear ground", () => {
    const png = readFileSync(join("public", EMAIL_MARK.path));
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([EMAIL_MARK.width * 3, EMAIL_MARK.height * 3]);
    // colour type 2 is plain RGB: no alpha channel, so there is nothing clear for a dark page to show through
    expect(png[25]).toBe(2);
    expect(EMAIL_MARK.paper).toBe("#fcf7ea"); // the card's paper (lib/cardArt/looks CARD_PAPER), as the email's card is
    const l = lockup();
    expect(Math.abs(EMAIL_MARK.width / EMAIL_MARK.height - l.width / l.height)).toBeLessThan(0.02);
    const email = read("src/lib/notify/email.ts");
    expect(email).toContain('<img src="${SITE}${EMAIL_MARK.path}" width="${EMAIL_MARK.width}" height="${EMAIL_MARK.height}" alt="LEXIGOTCHI"');
    expect(email).toContain('const SITE = "https://lexigotchi.fun";'); // an absolute address, with nothing of the reader's in it
  });

  it("the docs' logo is the source's drawing, light and dark, and still", () => {
    const doc = (l: { markup: string; width: number; height: number }) => svgDoc(l.markup, l.width, l.height);
    expect(read("docs-site/logo/lockup.svg").trimEnd()).toBe(doc(lockup()));
    expect(read("docs-site/logo/lockup-on-dark.svg").trimEnd()).toBe(doc(lockup({ tone: "dark" })));
    expect(JSON.parse(read("docs-site/docs.json")).logo).toEqual({ light: "/logo/lockup.svg", dark: "/logo/lockup-on-dark.svg", href: "https://lexigotchi.fun" });
    // a file is never alive: nothing in it moves by itself
    for (const f of ["lockup.svg", "lockup-on-dark.svg"]) expect(read(`docs-site/logo/${f}`)).not.toMatch(/<style|<animate|@keyframes|<script/);
  });
});

describe("the pages a player lands on outside the game (part 3)", () => {
  it("a word's share page and the earnings page carry the living lockup at their head, linking home", () => {
    for (const f of ["src/app/s/[text]/page.tsx", "src/app/e/[token]/page.tsx"]) {
      const src = read(f);
      expect(src, f).toMatch(/<Link href="\/" aria-label="Lexigotchi: how it works">\s*<Lockup alive height=\{40\} \/>\s*<\/Link>/);
      // it is the first thing in the page, above the card
      expect(src.indexOf("<Lockup alive"), f).toBeLessThan(src.search(/<SceneFrame |<img src=\{earningsCardPath/));
    }
    // the share page's gold label in capitals is gone: the mark says whose page it is
    expect(read("src/app/s/[text]/page.tsx")).not.toMatch(/uppercase tracking-wider|A Lexigotchi showcase\s*<\/p>/);
  });

  it("the page after linking X and the unsubscribe page carry it still: they are strings and run no script", () => {
    for (const f of ["src/app/api/x/callback/route.ts", "src/app/api/email/unsubscribe/route.ts"]) {
      const src = read(f);
      expect(src, f).toContain("const MARK = lockupTag(34);");
      expect(src, f).toMatch(/<body><main>\$\{MARK\}<h1>/);
      expect(src, f).toContain("main>svg{display:block;margin:0 auto 16px}");
      expect(src, f).not.toContain("<script");
    }
    const tag = lockupTag(34);
    expect(tag).toMatch(/^<svg [^>]*width="160" height="34" role="img" aria-label="Lexigotchi">/);
    expect(tag).toContain(lockup().markup);
    expect(tag).not.toMatch(/<script|<style|lk-shut/);
  });

  it("the living lockup asks the motion hooks from their own small file, never from the letter rig", () => {
    const src = read("src/components/brand/Lockup.tsx");
    expect(src).toContain('from "../game/motionPrefs"');
    expect(src).not.toMatch(/from "[^"]*TileCharacter"/);
    // and the small file brings nothing of the rig with it
    expect(read("src/components/game/motionPrefs.ts").match(/^import .*$/gm)).toEqual(['import { useEffect, useState } from "react";']);
    // the rig still offers them, for everything that asks it
    expect(read("src/components/game/TileCharacter.tsx")).toContain("export { useLowPower, usePrefersReducedMotion };");
  });
});

describe("the name is never set in type again", () => {
  it("no player-facing file sets LEXIGOTCHI as text, but for the video's fallback and the email's alt text", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) {
          if (!/admin$/.test(p)) walk(p);
        } else if (/\.(ts|tsx)$/.test(n)) files.push(p);
      }
    };
    for (const d of ["src/app", "src/components", "src/lib"]) walk(d);
    const hits = files.filter((f) => read(f).split("\n").some((line) => /LEXIGOTCHI/.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)));
    expect(hits.sort()).toEqual(["src/components/cards/loop/makeLoop.ts", "src/lib/notify/email.ts"]);
  });
});
