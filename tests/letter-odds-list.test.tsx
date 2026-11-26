// @vitest-environment jsdom
/**
 * The Mint tab's odds list (components/game/LetterOdds.tsx): the whole alphabet, A to Z, each letter
 * with its actual odds (starl3xx, 2026-11-25). With the chain's supply, a sold-out letter says so and
 * the rest rise; only a letter running low says how many are left ("only for the low ones").
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { ALPHABET, LETTER_SUPPLY_CAP } from "@/lib/economy";
import { LetterOdds, supplyStatus } from "@/components/game/LetterOdds";

window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

const idx = (ch: string) => ch.toUpperCase().charCodeAt(0) - 65;
const caps = ALPHABET.map((ch) => LETTER_SUPPLY_CAP[ch]);
const plenty = caps.map((c) => Math.floor(c * 0.6));
const row = (letter: string) => document.querySelector<HTMLElement>(`li[data-letter="${letter}"]`)!;
const rows = () => [...document.querySelectorAll<HTMLElement>("li[data-letter]")];

afterEach(cleanup);

describe("the Mint tab’s letter odds", () => {
  it("lists the whole alphabet, A to Z, each with its odds", () => {
    render(<LetterOdds />);
    expect(rows().map((r) => r.dataset.letter).join("")).toBe("abcdefghijklmnopqrstuvwxyz");
    expect(within(row("e")).getByText("10.4%")).toBeTruthy();
    expect(within(row("q")).getByText("0.20%")).toBeTruthy();
    expect(within(row("j")).getByText("0.31%")).toBeTruthy();
    expect(screen.getByText("About 1 pack in 100 has a q.")).toBeTruthy();
    // nothing about supply where there is none (the practice game)
    expect(screen.queryByText(/left$/)).toBeNull();
    expect(screen.queryByText("Sold out")).toBeNull();
    expect(screen.queryByText(/Checking|Couldn’t check/)).toBeNull();
  });

  it("says “pull”, the Mint tab’s word, and never “draw” (docs/messaging.md)", () => {
    const supply = plenty.map((n, i) => (i === idx("q") ? 0 : n));
    for (const props of [{}, { available: supply, caps }, { status: "checking" as const }, { status: "failed" as const }]) {
      const { container, unmount } = render(<LetterOdds {...props} />);
      expect(container.textContent).not.toMatch(/\bdraw(s|n)?\b/i);
      unmount();
    }
    render(<LetterOdds />);
    expect(screen.getByText("A pack is 5 pulls")).toBeTruthy();
  });

  it("is not a card, and nothing in it moves", () => {
    const { container } = render(<LetterOdds />);
    expect(container.querySelector(".cel, .cel-sm")).toBeNull();
    expect(container.innerHTML).not.toMatch(/animate-/);
  });

  it("a sold-out letter says so, shows no odds, and the other letters’ odds rise", () => {
    render(<LetterOdds available={plenty.map((n, i) => (i === idx("e") ? 0 : n))} caps={caps} />);
    expect(within(row("e")).getByText("Sold out")).toBeTruthy();
    expect(within(row("e")).getByText("–")).toBeTruthy();
    expect(within(row("e")).queryByText(/%/)).toBeNull();
    // a was 8.5% with e in the draw
    expect(within(row("a")).getByText("9.5%")).toBeTruthy();
    expect(screen.getByText(/^e is sold out and can’t be pulled, so every other letter comes up more often\./)).toBeTruthy();
  });

  it("only a letter running low says how many are left", () => {
    const available = plenty.map((n, i) => (i === idx("x") ? 7 : n));
    render(<LetterOdds available={available} caps={caps} />);
    expect(within(row("x")).getByText("7 left")).toBeTruthy();
    expect(screen.getAllByText(/ left$/)).toHaveLength(1);
    // a plentiful letter: its odds, and nothing else
    expect(row("a").textContent).toBe("a:a8.5%");
  });

  it("names the rarest letter STILL in the draw, with the article its name takes", () => {
    render(<LetterOdds available={plenty.map((n, i) => (i === idx("q") || i === idx("j") ? 0 : n))} caps={caps} />);
    expect(screen.getByText(/^About 1 pack in \d+ has an x\.$/)).toBeTruthy();
    expect(screen.getByText(/^j and q are sold out/)).toBeTruthy();
  });

  it("counts the sold-out letters when there are many", () => {
    render(<LetterOdds available={plenty.map((n, i) => (i < 6 ? 0 : n))} caps={caps} />);
    expect(screen.getByText(/^6 letters are sold out/)).toBeTruthy();
  });

  it("with every letter sold out, shows no odds and promises nothing", () => {
    render(<LetterOdds available={caps.map(() => 0)} caps={caps} />);
    expect(screen.getAllByText("Sold out")).toHaveLength(26);
    expect(screen.queryByText(/About 1 pack/)).toBeNull();
    // nothing "comes up more often" when nothing can be pulled (Bugbot on #228)
    expect(screen.queryByText(/comes up more often|already count/)).toBeNull();
    expect(screen.getByText("Every letter is sold out, so nothing is left to pull. Letters still change hands in the Market.")).toBeTruthy();
  });

  it("says what the odds are while the supply read loads, and after it fails", () => {
    const { unmount } = render(<LetterOdds status="checking" />);
    expect(screen.getByText("Checking which letters can still be pulled…")).toBeTruthy();
    expect(within(row("e")).getByText("10.4%")).toBeTruthy();
    unmount();
    render(<LetterOdds status="failed" />);
    expect(screen.getByText(/^Couldn’t check which letters have sold out\. These are the odds with none sold out/)).toBeTruthy();
  });
});

describe("supplyStatus", () => {
  it("the practice game has no supply read, though its disabled query reads as pending", () => {
    expect(supplyStatus(false, false, true)).toBeUndefined();
  });
  it("the chain game: checking while it loads, failed when it has no answer, nothing once it has one", () => {
    expect(supplyStatus(true, false, true)).toBe("checking");
    expect(supplyStatus(true, false, false)).toBe("failed");
    expect(supplyStatus(true, true, false)).toBeUndefined();
  });
});
