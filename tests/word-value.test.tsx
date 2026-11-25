// @vitest-environment jsdom
/**
 * The reference numbers beside a word for sale (components/game/WordValue.tsx): the cost to make and
 * its parts, "Use this price", what it would earn staked, and the jackpot-drawn flag. The arithmetic
 * is lib/wordCost.ts's (tests/word-cost.test.ts); this pins what the player reads.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { roundPrice } from "@/lib/wordCost";

let world: Record<string, unknown> | undefined;
let prices: Record<string, number> = {};
vi.mock("@/components/game/useWorld", () => ({ useWorld: () => ({ data: world }) }));
vi.mock("@/components/game/state", async (orig) => {
  const real = await orig<typeof import("@/components/game/state")>();
  return {
    ...real,
    // A testnet chain game: amounts in $WORD only, no dollar figure.
    showsUsd: () => false,
    useGame: () => ({
      state: { chainBacked: true },
      price: (item: string) => prices[item],
      prestigePrice: (level: number) => 2_000_000 * (level + 1),
    }),
  };
});

const { WordValue, useCostToMake } = await import("@/components/game/WordValue");

const PRICES = { pack: 4_000_000, roll: 1_000_000, claim: 2_000_000, prestigeSnack: 80_000 };
const upper = [true, true, true, true, true];
const lower = [false, false, false, false, false];

function Harness({ word, compact, onUse }: { word: { word: string; upper: boolean[]; prestigeLevel: number }; compact?: boolean; onUse?: (n: number) => void }) {
  const cost = useCostToMake(word);
  return <WordValue word={word} cost={cost} compact={compact} onUse={onUse} />;
}

afterEach(() => {
  cleanup();
  world = undefined;
  prices = {};
});

describe("WordValue", () => {
  it("shows the cost to make, its parts, and offers it as the price, rounded", () => {
    prices = PRICES;
    const onUse = vi.fn();
    render(<Harness word={{ word: "CRANE", upper, prestigeLevel: 2 }} onUse={onUse} />);
    expect(screen.getByText(/Costs about/)).toBeTruthy();
    expect(screen.getByText(/Letters .* raises .* claim .* ascension/)).toBeTruthy();
    expect(screen.getByText(/isn’t what you paid/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use this price" }));
    expect(onUse).toHaveBeenCalledTimes(1);
    const offered = onUse.mock.calls[0][0] as number;
    expect(offered).toBe(roundPrice(offered));
    expect(offered).toBeGreaterThan(PRICES.claim);
  });

  it("leaves ascension out of the parts for a word that hasn't ascended", () => {
    prices = PRICES;
    render(<Harness word={{ word: "CRANE", upper: lower, prestigeLevel: 0 }} />);
    expect(screen.queryByText(/ascension/)).toBeNull();
  });

  it("says nothing about the cost while a price is still loading", () => {
    prices = {}; // every price undefined → NaN
    render(<Harness word={{ word: "CRANE", upper, prestigeLevel: 0 }} />);
    expect(screen.queryByText(/to make/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/NaN/);
  });

  it("says what an UPPERCASE word would earn from today's pot, and what a mixed one needs", () => {
    prices = PRICES;
    world = { yieldToday: { pot: 1_000_000, weight: 9 } };
    render(<Harness word={{ word: "CRANE", upper, prestigeLevel: 0 }} compact />);
    expect(screen.getByText(/Earns about/).textContent).toContain("100.0K $WORD a day"); // weight 1 of 10
    cleanup();
    render(<Harness word={{ word: "CRANE", upper: lower, prestigeLevel: 0 }} compact />);
    expect(screen.getByText("Earns $WORD once all five letters are UPPERCASE.")).toBeTruthy();
  });

  it("flags a word the jackpot has already drawn", () => {
    prices = PRICES;
    const nov26 = Date.UTC(2026, 10, 26) / 86_400_000;
    world = { drawn: { CRANE: nov26 } };
    render(<Harness word={{ word: "CRANE", upper, prestigeLevel: 0 }} compact />);
    expect(screen.getByText(/Drawn for the jackpot on Nov 26/)).toBeTruthy();
    expect(screen.getByText(/can’t win the jackpot again/)).toBeTruthy();
  });
});
