// @vitest-environment jsdom
/**
 * A word's card (components/cards/SceneCard): it turns over with its corner button, draws its back
 * only once turned, gives the next word its scene, and opens its word from a button beside the flip
 * button, never around it.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
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
    expect(screen.getByRole("button", { name: "Show CRANE’s front" })).toBeTruthy();
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

describe("a phone's back and the rows under it", () => {
  // Under 470 px the back shows four facts and drops the rest; an opened card must then list them
  // in its rows, at exactly that width, or they are said nowhere (Bugbot on #213 and #230). Both
  // halves are CSS, so the two widths are held together here.
  const css = readFileSync("src/app/globals.css", "utf8");
  const back = readFileSync("src/components/cards/CardBack.tsx", "utf8");
  it("drops the later facts, the rarity's word count, the pips, and the bottom line under 470 px", () => {
    expect(css).toMatch(/@container \(max-width: 469px\) \{\s*\.cb-more, \.cb-foot, \.cb-pips, \.cb-oneof span \{ display: none; \}/);
  });
  it("lists them under an opened card up to that same width, the rarity's word count first", () => {
    expect(css).toMatch(/@container \(min-width: 470px\) \{ \.sc-more \{ display: none; \} \}/);
    const rows = [...back.slice(back.indexOf("export function CardMore")).matchAll(/<Row label="([^"]+)"/g)].map((m) => m[1]);
    // "Set" is a row only for a word released in a reserved set, as on the wide back's bottom line.
    expect(rows).toEqual(["Rarity", "Found by", "Set", "Earned so far", "Earns staked", "Cost to make", "Points", "Jackpot", "Token"]);
  });
  it("keeps every word on the back at 12 px or more, the small \"No.\" beside a thumbnail's digits too", () => {
    expect(css).toMatch(/\.cb-no small \{ font-size: max\(12px, 0\.34em\);/);
    for (const m of css.slice(css.indexOf("/* The words and tiles (CardBack")).matchAll(/\.(cb-[a-z-]+)[^{}]*\{[^}]*font-size: clamp\((\d+)px/g)) expect(Number(m[2]), m[1]).toBeGreaterThanOrEqual(m[1] === "cb-no" ? 18 : 12);
  });
});

describe("the card's own light (decisions.md #34)", () => {
  // One frame at a time: the card asks for a frame, and the test runs it.
  let frames: FrameRequestCallback[] = [];
  const frame = () => act(() => void frames.splice(0).forEach((cb) => cb(0)));
  beforeEach(() => {
    frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => frames.push(cb));
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const box = (el: Element) => {
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 450, right: 800, bottom: 450, x: 0, y: 0, toJSON: () => ({}) });
    return el as HTMLElement;
  };
  const parts = (c: HTMLElement) => ({ sc: box(c.querySelector(".sc")!), lean: c.querySelector<HTMLElement>(".sc-lean")!, glare: c.querySelector<HTMLElement>(".sc-glare"), sheen: c.querySelector(".sc-sheen") });

  it("is on for the card in focus, and leans it toward the pointer with no transition while it follows", () => {
    const { container } = render(<SceneCard word={word("CRANE")} front={<p>scene</p>} />);
    const { sc, lean, glare, sheen } = parts(container);
    expect(sc.className).toContain("is-lit");
    expect(glare).not.toBeNull();
    expect(sheen).not.toBeNull();
    fireEvent.pointerMove(sc, { clientX: 800, clientY: 0, pointerType: "mouse" }); // the upper right corner
    expect(lean.style.transform).toBe(""); // nothing until the frame
    frame();
    expect(lean.style.transform).toBe("rotateX(2.50deg) rotateY(3.50deg)");
    expect(glare!.style.transform).toBe("translate(62.0%, -34.0%)");
    expect(lean.className).not.toContain("sc-ease");
    // and nothing is handed down as a custom property: one there is inherited by every shape inside
    expect(sc.getAttribute("style")).not.toMatch(/--(kx|ky|x|y)\b/);
    expect(lean.getAttribute("style")).not.toContain("--");
  });

  it("stands straight again when the pointer leaves, easing only then", () => {
    const { container } = render(<SceneCard word={word("CRANE")} front={<p>scene</p>} />);
    const { sc, lean } = parts(container);
    fireEvent.pointerMove(sc, { clientX: 0, clientY: 450, pointerType: "mouse" });
    frame();
    expect(lean.style.transform).not.toBe("");
    fireEvent.pointerLeave(sc);
    expect(lean.style.transform).toBe("");
    expect(lean.className).toContain("sc-ease");
  });

  it("does not lean to a touch: a phone has no pointer to lean to", () => {
    const { container } = render(<SceneCard word={word("CRANE")} front={<p>scene</p>} />);
    const { sc, lean } = parts(container);
    fireEvent.pointerMove(sc, { clientX: 800, clientY: 0, pointerType: "touch" });
    expect(frames).toHaveLength(0);
    expect(lean.style.transform).toBe("");
  });

  it("crosses the front with a band of light a moment after the card appears, then rests", () => {
    vi.useFakeTimers();
    const { container } = render(<SceneCard word={word("CRANE")} front={<p>scene</p>} />);
    const { sc } = parts(container);
    expect(sc.className).not.toContain("sc-moment");
    act(() => void vi.advanceTimersByTime(1250));
    expect(sc.className).toContain("sc-moment");
    act(() => void vi.advanceTimersByTime(1400));
    expect(sc.className).not.toContain("sc-moment");
    // and again on the card's own beat (a Common card: every 11 seconds), never as a loop in between
    act(() => void vi.advanceTimersByTime(9000)); // 11.65 s in: the next is due at 12.2 s
    expect(sc.className).not.toContain("sc-moment");
    act(() => void vi.advanceTimersByTime(700));
    expect(sc.className).toContain("sc-moment");
  });

  it("is off for a card in a grid, a covered card, and a hungry word's card (its shine is gone until it is fed)", () => {
    for (const el of [
      <SceneCard key="small" word={word("CRANE")} front={<p>scene</p>} small />,
      <SceneCard key="covered" word={word("CRANE")} front={<p>scene</p>} live={false} />,
      <SceneCard key="hungry" word={{ ...word("CRANE"), daysUnfed: 5 }} front={<p>scene</p>} />,
    ]) {
      const { container, unmount } = render(el);
      const { sc, lean, glare, sheen } = parts(container);
      expect(sc.className).not.toContain("is-lit");
      expect(glare).toBeNull();
      expect(sheen).toBeNull();
      fireEvent.pointerMove(sc, { clientX: 800, clientY: 0, pointerType: "mouse" });
      frame();
      expect(lean.style.transform).toBe("");
      unmount();
    }
  });

  it("rests while the back is up: the lean is outside the flip, and lets go when the card turns", () => {
    const { container } = render(<SceneCard word={word("CRANE")} front={<p>scene</p>} />);
    const { sc, lean } = parts(container);
    // the two faces turn inside the element that leans, so the two turns never share a transform
    expect(lean.querySelector(".sc-inner")).not.toBeNull();
    expect(lean.querySelector(".sc-flip")).not.toBeNull();
    fireEvent.pointerMove(sc, { clientX: 800, clientY: 0, pointerType: "mouse" });
    frame();
    expect(lean.style.transform).not.toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Turn CRANE over" }));
    expect(lean.style.transform).toBe("");
    expect(sc.className).not.toContain("is-lit");
    expect(container.querySelector(".sc-glare")).toBeNull();
  });
});
