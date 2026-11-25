// @vitest-environment jsdom
/**
 * A word's card (components/cards/SceneCard): it turns over with its corner button, draws its back
 * only once turned, gives the next word its scene, and opens its word from a button beside the flip
 * button, never around it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { OwnedWord } from "@/components/game/state";

// The back reads the game's state and the chain; the card's own behavior is what's under test.
vi.mock("@/components/cards/CardBack", () => ({
  CardBack: ({ word, mini }: { word: OwnedWord; mini?: boolean }) => <div data-testid="back">{`${word.word}${mini ? " mini" : ""}`}</div>,
}));
const { SceneCard } = await import("@/components/cards/SceneCard");

// jsdom has no matchMedia; this viewer doesn't ask for reduced motion
window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

afterEach(cleanup);

const word = (w: string): OwnedWord => ({
  word: w,
  tier: "Common",
  upper: [false, false, false, false, false],
  staked: true,
  daysUnfed: 0,
  prestigeLevel: 0,
  prestigePity: 0,
  mine: true,
});

describe("a word's card", () => {
  it("draws no back until it's turned over, then shows the back and hides the scene", () => {
    render(<SceneCard word={word("CRANE")} front={<p>scene</p>} />);
    expect(screen.queryByTestId("back")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Turn CRANE over" }));
    expect(screen.getByTestId("back").textContent).toBe("CRANE");
    expect(screen.getByText("scene").closest(".sc-front")?.hasAttribute("inert")).toBe(true);
    expect(screen.getByRole("button", { name: "Show CRANE’s scene" })).toBeTruthy();
  });

  it("gives the next word its scene, not the last word's back", () => {
    const { rerender } = render(<SceneCard word={word("CRANE")} front={<p>scene</p>} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn CRANE over" }));
    rerender(<SceneCard word={word("TEASE")} front={<p>scene</p>} />);
    expect(screen.getByRole("button", { name: "Turn TEASE over" })).toBeTruthy();
    expect(screen.getByText("scene").closest(".sc-front")?.hasAttribute("inert")).toBe(false);
  });

  it("tells its host when it turns, so the host can hold the scene still", () => {
    const onFlip = vi.fn();
    render(<SceneCard word={word("CRANE")} front={<p>scene</p>} flipped={false} onFlip={onFlip} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn CRANE over" }));
    expect(onFlip).toHaveBeenCalledWith(true);
  });

  it("opens its word from a button beside the flip button; turning it doesn't open it", () => {
    const onOpen = vi.fn();
    render(<SceneCard word={word("CRANE")} front={<p>scene</p>} small onOpen={onOpen} />);
    const open = screen.getByRole("button", { name: "Open CRANE" });
    const flip = screen.getByRole("button", { name: "Turn CRANE over" });
    expect(open.contains(flip)).toBe(false);
    expect(flip.contains(open)).toBe(false);
    fireEvent.click(flip);
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByTestId("back").textContent).toBe("CRANE mini");
    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
