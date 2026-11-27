// @vitest-environment jsdom
/**
 * The jackpot's secret word is a card (decisions.md #50, part 4; starl3xx: "it reinforces that a
 * card has to be held, not individual letters"): face down until it is revealed, then face up.
 *
 * The face-down card must say nothing about the word: it is given no word and no rarity, so it
 * cannot. These tests hold that, and that the Jackpot page shows a card in every state.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FaceDownCard } from "@/components/cards/FaceDownCard";

afterEach(cleanup);
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const css = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
};

describe("a card, face down", () => {
  it("is a card's back with the seal, and not one letter, number, or word", () => {
    const { container } = render(<FaceDownCard label="Today’s secret word: a card, face down" />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.getAttribute("role")).toBe("img");
    expect(card.getAttribute("aria-label")).toBe("Today’s secret word: a card, face down");
    // nothing to read: no letters, no number, no facts
    expect(card.textContent).toBe("");
    expect(card.querySelector(".cb-no, .cb-stats, .cb-tiles, .cb-tier, .cb-foot, svg text")).toBeNull();
    // the back's own stock, on Common's plate (rules and a ruled ground, which are its frame), and the seal
    expect(card.querySelector(".cb .cb-mat .cb-tex")).not.toBeNull();
    expect((card.querySelector(".cb .cb-mat") as HTMLElement).style.backgroundImage).toContain("data:image/svg+xml");
    expect(card.querySelector(".cb .cb-frame")).toBeNull();
    expect((card.querySelector(".fd-seal") as HTMLElement).style.backgroundImage).toContain("data:image/svg+xml");
  });

  it("always wears the plain material: it is given no word and no rarity, so it can show neither", () => {
    const src = read("src/components/cards/FaceDownCard.tsx");
    // its whole input: what a screen reader says, and where it sits
    expect(src).toMatch(/export function FaceDownCard\(\{ label, className = "" \}/);
    expect(src).not.toMatch(/\bword\b\s*[:}=,]|tier\s*[:}=,]|materialOf|wordTier/);
    const { container } = render(<FaceDownCard label="x" />);
    const back = container.querySelector(".cb") as HTMLElement;
    expect(back.className).toBe("cb m-common");
  });

  it("stands on the page as a card does: the shadow on its own box, the ink edge and the clip on the face inside", () => {
    const { container } = render(<FaceDownCard label="x" className="mx-auto" />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toBe("fd card-stand mx-auto");
    expect((card.firstElementChild as HTMLElement).className).toBe("fd-face card-corner");
    // the box is the card, and the container the back measures itself in; it neither clips nor has the edge
    expect(rule(".fd")).toContain("aspect-ratio: 16 / 9");
    expect(rule(".fd")).toContain("container-type: inline-size");
    expect(rule(".fd")).not.toMatch(/overflow|border/);
    // the face is opaque to its edge (the shadow under it is solid)
    const face = rule(".fd-face");
    expect(face).toContain("overflow: hidden");
    expect(face).toContain("border: 3px solid #1b1714");
    expect(face).toContain("background: #1b1714");
  });
});

describe("the Jackpot page's secret word", () => {
  const page = read("src/components/game/screens/JackpotScreen.tsx");
  const hidden = page.slice(page.indexOf("{!state.jackpotRevealed ? ("), page.indexOf(") : won ? ("));

  it("is a card face down before it is revealed, given nothing of the word", () => {
    expect(hidden.length).toBeGreaterThan(100);
    expect(hidden).toMatch(/<FaceDownCard label="[^"{]*" className="[^"{]*" \/>/);
    // the word reaches nothing in this branch but the reveal's own toast wording
    expect(hidden).not.toMatch(/state\.jackpotWord|wordTier/);
    // no row of dark tiles with a "?"
    expect(page).not.toMatch(/bg-ink\/80/);
    expect(page).not.toMatch(/>\s*\?\s*</);
  });

  it("is a card face up after: the winner's own card, or the word in the plain scene", () => {
    expect(page).not.toContain("WordTiles");
    const shown = page.slice(page.indexOf(") : won ? ("));
    // a win: the card the player holds (their scene, their cases, their gilding)
    expect(shown).toContain("{ownedAnswer && <WonCard word={ownedAnswer} />}");
    expect(page).toMatch(/<SceneFrame scene=\{scene\} word=\{word\.word\} upper=\{word\.upper\} state="celebrate" gild=\{gild\} tier=\{word\.tier\} \/>/);
    // a loss: nobody's card, in lowercase, in the plain scene
    expect(shown).toMatch(/<SceneFrame scene=\{DEFAULT_SCENE\} word=\{state\.jackpotWord\} upper=\{Array\(5\)\.fill\(false\)\}/);
    // both stand on the page as cards, and arrive without changing size
    expect(page).toMatch(/className=\{`card-stand animate-drop /);
    expect(page).toContain('className="card-corner overflow-hidden border-[3px] border-ink"');
  });
});
