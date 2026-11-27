/**
 * One corner for every card (decisions.md #48, part 4; starl3xx: "everywhere the cards are pictured
 * in the app and downloads and anywhere, we need to make sure they have consistent round corner
 * sizes", then "2.6% is the way to go"): 2.6% of the card's width, in the game's CSS, the server's
 * pictures, and the share video. A corner was a fixed 16, 12, or 8 px, so it ran from 2.1% of the
 * width on the share page to 7.1% in the scene picker, and cut into the frame's corner pieces.
 */
import { PLATE_BORDER } from "@/lib/cardArt/plate";
import { materialPlate } from "@/components/cards/material";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { CARD_CORNER } from "@/lib/cardArt/looks";
import { CARD_H, CARD_W } from "@/lib/cardArt/engrave";
import { cardFrame } from "@/lib/cardArt/scenes";
import { LOOP_CORNER } from "@/components/cards/loop/loopRenderer";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const css = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
/** The declarations of every rule with exactly this selector (a selector may have more than one rule). */
const rule = (selector: string) => {
  const all = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((x) => x[1].trim() === selector);
  if (all.length === 0) throw new Error(`no rule ${selector}`);
  return all.map((x) => x[2]).join("\n");
};

describe("the card's corner is 2.6% of its width", () => {
  it("comes from the frame's own shapes: its outer line runs parallel to it, and its corner pieces sit inside it", () => {
    const units = CARD_CORNER * CARD_W; // 31.2 of 1,200
    const frame = cardFrame("Legendary");
    // the outer line: a rounded rectangle 13 units in, with a corner of 18
    const outer = /<rect x="13" y="13" width="1174" height="649" rx="(\d+)"/.exec(frame);
    expect(outer, "the frame's outer line").not.toBeNull();
    expect(13 + Number(outer![1])).toBeCloseTo(units, 0);
    // the corner pieces: squares at the same 13 units, with a corner of 8: they need 21 units and have 31
    const piece = /<rect x="13" y="13" width="33" height="33" rx="(\d+)"/.exec(frame);
    expect(piece, "a corner piece").not.toBeNull();
    expect(13 + Number(piece![1])).toBeLessThan(units);
  });

  it("is one value in the game's CSS, written as a share of the box's own width and of its height", () => {
    const pct = CARD_CORNER * 100;
    expect(rule(":root")).toContain(`--card-r: ${pct}% / ${((pct * CARD_W) / CARD_H).toFixed(4)}%`);
    expect(rule(".card-corner")).toContain("border-radius: var(--card-r)");
  });

  it.each([".tt-card", ".sc-framed .sc-face", ".sc-open", ".cc-card"])("%s takes it, and no pixel radius", (selector) => {
    const body = rule(selector);
    expect(body).toContain("border-radius: var(--card-r)");
    expect(body).not.toMatch(/border-radius:\s*\d+px/);
  });

  it("a thumbnail's card has no corner of its own", () => {
    expect(rule(".sc-framed.sc-small .sc-face")).not.toContain("border-radius");
  });

  it("the back's border is its plate's, drawn as the front's frame is: an edge rule with the same corner", () => {
    // The back had a frame line of its own in the styles, with a corner worked out from the card's.
    // A back is an engraved plate now (decisions.md #58): its border is in the drawing, as the
    // front's frame is, and the two edge rules share one corner so a card's two sides agree.
    const front = /<rect x="13" y="13" [^>]*rx="(\d+)"/.exec(cardFrame("Common"))?.[1];
    const back = new RegExp(`<rect x="${PLATE_BORDER.edge}" y="${PLATE_BORDER.edge}" [^>]*rx="(\\d+)"`).exec(materialPlate("common"))?.[1];
    expect(front).toBe("18");
    expect(back).toBe(front);
    // and no style rule draws a frame line on a back any more
    expect(css).not.toMatch(/\.cb-frame|\.cb-fire|--cb-frame-r|--cb-edge/);
  });

  it("nothing that clips a card rounds it with a Tailwind class: every wrapper of a card takes .card-corner", () => {
    // the files that put a card's front in a box of their own
    const wrappers: Record<string, RegExp> = {
      "src/components/game/sheets/SceneSheet.tsx": /className="card-corner border-\[3px\]/,
      "src/components/scenes/ScenePicker.tsx": /card-corner block overflow-hidden/,
      "src/components/game/screens/ShopScreen.tsx": /className="card-corner mb-2 overflow-hidden/,
      "src/components/game/sheets/CelebrateSheet.tsx": /className="card-corner overflow-hidden border-\[3px\] border-ink"/,
      "src/app/s/[text]/page.tsx": /className="card-corner overflow-hidden border-\[3px\] border-ink"/,
    };
    for (const [file, has] of Object.entries(wrappers)) expect(read(file), file).toMatch(has);
    // and no box anywhere clips a card's front with a rounded-* class on the same element
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx$/.test(f)) files.push(p);
      }
    };
    walk(join(process.cwd(), "src/components"));
    walk(join(process.cwd(), "src/app"));
    const bad: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        // a box that hides its overflow and is rounded, right before a card's front
        if (/overflow-hidden[^"`]*rounded-(lg|xl|2xl|3xl|\[)|rounded-(lg|xl|2xl|3xl|\[)[^"`]*overflow-hidden/.test(line) && /<Scene(Frame|Thumb)\b/.test(lines.slice(i + 1, i + 3).join(" "))) bad.push(`${f.replace(process.cwd() + "/", "")}:${i + 1}`);
        // a card's front rounded by its own class
        if (/<SceneFrame\b/.test(line) || /className="rounded-/.test(line)) {
          const near = lines.slice(Math.max(0, i - 8), i + 1).join(" ");
          if (/<SceneFrame\b[^>]*className="[^"]*rounded-/.test(near.replace(/\s+/g, " "))) bad.push(`${f.replace(process.cwd() + "/", "")}:${i + 1}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });

  it("is the same number on the server's pictures and in the share video", () => {
    expect(read("src/app/_og/wordCard.tsx")).toContain("borderRadius: Math.round(CARD_CORNER * cardW)");
    // the server's picture of a back clips its plate to the card's own corner
    expect(read("src/app/s/[text]/back/route.tsx")).toContain("<img src={plate} width={W} height={H} style={{ position: \"absolute\", left: 0, top: 0, borderRadius: CARD_CORNER * W }} />");
    // the video's shader measures in the card's height
    expect(Number(LOOP_CORNER)).toBeCloseTo((CARD_CORNER * CARD_W) / CARD_H, 4);
    expect(read("src/components/cards/loop/loopRenderer.ts")).toContain("rounded(vUv, ${LOOP_CORNER})");
  });
});
