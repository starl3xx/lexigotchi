// @vitest-environment jsdom
/**
 * Today's pots as drawn (TodayPots in src/components/game/screens/HomeScreen.tsx): three tiles in
 * one row, each one button into its pot's own place. Run on the test network, where the chain
 * game must show "test $WORD" and no dollars, while practice mode shows dollars.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

process.env.NEXT_PUBLIC_CHAIN_ID = "84532";
window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

const { GameCtx, useGame } = await import("@/components/game/state");
const { TodayPots } = await import("@/components/game/screens/HomeScreen");
const { NETWORK } = await import("@/lib/onchain/network");
type GameApi = ReturnType<typeof useGame>;

function fakeGame(state: Partial<GameApi["state"]> = {}) {
  const nav = vi.fn();
  const openSheet = vi.fn();
  const api = {
    state: {
      chainBacked: false,
      potsKnown: true,
      jackpotPot: 18_500_000,
      bountyPool: 9_400_000,
      rewardsPool: 64_000_000,
      bountyTheme: 1,
      jackpotWord: "",
      jackpotRevealed: false,
      words: [],
      wordsLoading: false,
      wordsError: false,
      ...state,
    },
    nav,
    openSheet,
  } as unknown as GameApi;
  render(
    <GameCtx.Provider value={api}>
      <TodayPots />
    </GameCtx.Provider>,
  );
  return { nav, openSheet };
}

const tiles = () => within(screen.getByRole("region", { name: "Today’s pots" })).getAllByRole("button");

afterEach(cleanup);

describe("Today's pots", () => {
  it("runs on the test network (the case the chain game must hide dollars on)", () => {
    expect(NETWORK.isTestnet).toBe(true);
  });

  it("draws the jackpot, the bounty, and the Rewards Pool as three tiles, in that order", () => {
    fakeGame();
    const t = tiles();
    expect(t).toHaveLength(3);
    expect(t[0].textContent).toMatch(/^Jackpot18\.50M\$WORDabout \$/);
    expect(t[1].textContent).toMatch(/^Bounty9\.40M\$WORDabout \$/);
    expect(t[1].textContent).toContain("Has a repeated letter");
    expect(t[2].textContent).toMatch(/^Rewards Pool64\.00M\$WORDabout \$/);
    expect(t[2].textContent).toContain("1% shared every day");
  });

  it("shows test $WORD and no dollars in the chain game on a test network", () => {
    fakeGame({ chainBacked: true });
    for (const t of tiles()) {
      expect(t.textContent).toContain("test $WORD");
      expect(t.textContent).not.toMatch(/about \$/);
    }
  });

  it("shows a dash, never 0, for pots not read yet", () => {
    fakeGame({ chainBacked: true, potsKnown: false, jackpotPot: 0, bountyPool: 0, rewardsPool: 0 });
    for (const t of tiles()) {
      expect(t.textContent).toMatch(/^(Jackpot|Bounty|Rewards Pool)–test \$WORD/);
    }
  });

  it("opens each pot's own place", () => {
    const { nav, openSheet } = fakeGame();
    const [jackpot, bounty, rewards] = tiles();
    fireEvent.click(jackpot);
    expect(nav).toHaveBeenLastCalledWith("jackpot");
    fireEvent.click(bounty);
    expect(nav).toHaveBeenLastCalledWith("jackpot", "bounty");
    fireEvent.click(rewards);
    expect(openSheet).toHaveBeenLastCalledWith({ kind: "earnings" });
  });

  it("tells a player with no words how to get into the jackpot", () => {
    fakeGame();
    expect(tiles()[0].textContent).toContain("Spell a word, stake it, and wake it every day to enter");
  });
});
