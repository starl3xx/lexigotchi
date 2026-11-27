// @vitest-environment jsdom
/**
 * A word's card in its plastic case (components/cards/CardCase, decisions.md #42): which side
 * shows at an angle, where a let-go case rests, what the label says (never the word), and the
 * rules its styles keep (no loop, no transition on the turn).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import type { OwnedWord } from "@/components/game/state";

/**
 * A turn settles frame by frame on the real clock, in well under a second on an idle machine. On a
 * busy one (other suites and browsers running beside this) the frames come late: three seconds was
 * not always enough, and these tests failed for no reason of their own. The wait is long, and it
 * ends the moment the case has settled, so a passing run is no slower.
 */
const SETTLE_MS = 20_000;
vi.setConfig({ testTimeout: 60_000 });

let number: number | null = 20;
let found: { kind: "you" } | { kind: "unknown" } | { kind: "other"; address: string; name?: string } = { kind: "you" };

// The back reads the game's state and the chain; the case's own behavior is what's under test.
vi.mock("@/components/cards/CardBack", () => ({
  CardBack: ({ word, live }: { word: OwnedWord; live?: boolean }) => <div data-testid="back">{`${word.word} back${live ? " live" : ""}`}</div>,
  foundBySays: (f: typeof found) => (f.kind === "you" ? "you" : f.kind === "other" ? `@${f.name}` : "–"),
}));
vi.mock("@/components/cards/useCardNumber", () => ({ useCardNumber: () => number }));
vi.mock("@/components/cards/useCardFacts", () => ({ useCardFacts: () => ({ found }) }));
const { CardCase, CaseThumb, CASE_REST, isBackSide, nearestSide, restAngle, showsBack } = await import("@/components/cards/CardCase");
const { flipKey, useFlipOf } = await import("@/components/cards/useFlipOf");

// jsdom has no matchMedia. This viewer doesn't ask for reduced motion, unless a test says so.
let reducedMotion = false;
window.matchMedia = ((q: string) => ({ matches: reducedMotion && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

afterEach(() => {
  cleanup();
  reducedMotion = false;
  vi.restoreAllMocks();
  number = 20;
  found = { kind: "you" };
});

const word = (w: string, tier: OwnedWord["tier"] = "Mythic"): OwnedWord => ({
  word: w,
  tier,
  upper: [true, true, true, true, true],
  staked: true,
  daysUnfed: 0,
  prestigeLevel: 0,
  prestigePity: 0,
  mine: true,
});
const css = readFileSync("src/app/globals.css", "utf8");

describe("which side of the case shows", () => {
  it("is the front until the case is past edge-on, either way round", () => {
    for (const a of [0, CASE_REST.y, 45, 89, -89, 271, 360, -360, 720 - 14]) expect(showsBack(a), String(a)).toBe(false);
    for (const a of [91, 180, 166, 269, -91, -180, -269, 540]) expect(showsBack(a), String(a)).toBe(true);
  });

  it("rests each side at an angle that shows that side", () => {
    for (let turns = -6; turns <= 6; turns++) expect(showsBack(restAngle(turns)), String(turns)).toBe(isBackSide(turns));
  });

  it("rests a let-go case on the side that is showing, so settling never passes edge-on", () => {
    // every half degree over three turns each way, but the edge-on angles themselves
    for (let a = -1080; a <= 1080; a += 0.5) {
      if (Math.abs(((a % 180) + 180) % 180 - 90) < 0.01) continue;
      const side = nearestSide(a);
      expect(isBackSide(side), String(a)).toBe(showsBack(a));
      // and the way from there to its rest angle stays on that side
      const end = restAngle(side);
      for (let k = 0; k <= 10; k++) expect(showsBack(a + ((end - a) * k) / 10), `${a} → ${end}`).toBe(showsBack(a));
    }
  });

  it("counts half-turns either way", () => {
    expect([0, 2, -2, 4].map(isBackSide)).toEqual([false, false, false, false]);
    expect([1, 3, -1, -3].map(isBackSide)).toEqual([true, true, true, true]);
  });
});

describe("a card in its case", () => {
  it("says on its label what the ribbon says, in the ribbon's order, and never the word", () => {
    const { container } = render(<CardCase word={word("JAZZY")} front={<p>scene</p>} />);
    const label = container.querySelector(".cc-label-front")!;
    expect(label.textContent).toBe("One of oneNo.0020Mythic");
    expect(label.textContent).not.toMatch(/jazzy/i);
  });

  it("leaves the number off the label while it isn't known", () => {
    number = null;
    const { container } = render(<CardCase word={word("JAZZY")} front={<p>scene</p>} />);
    expect(container.querySelector(".cc-label-front")!.textContent).toBe("One of oneMythic");
    expect(container.querySelector(".cc-num")!.textContent).toBe("");
  });

  it("rules its label in the rarity's ink", () => {
    const { container, rerender } = render(<CardCase word={word("JAZZY", "Mythic")} front={<p>scene</p>} />);
    const ink = () => (container.querySelector(".cc") as HTMLElement).style.getPropertyValue("--cc-ink");
    const mythic = ink();
    rerender(<CardCase word={word("JAZZY", "Rare")} front={<p>scene</p>} />);
    expect(ink()).not.toBe(mythic);
  });

  it("draws no back and reads no story until it is turned over", () => {
    const { container } = render(<CardCase word={word("JAZZY")} front={<p>scene</p>} since={Date.UTC(2026, 10, 16)} />);
    expect(screen.queryByTestId("back")).toBeNull();
    expect(container.querySelector(".cc-label-back")!.textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Turn JAZZY over" }));
    // the card's own back, still: the live light isn't drawn under the plastic
    expect(screen.getByTestId("back").textContent).toBe("JAZZY back");
  });

  it("says on the back's label who found the word, when it was cased, and that the game sealed it", () => {
    const { container } = render(<CardCase word={word("JAZZY")} front={<p>scene</p>} since={Date.UTC(2026, 10, 16)} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn JAZZY over" }));
    const label = container.querySelector(".cc-label-back")!;
    expect(label.textContent).toBe("Found by youCased 16 Nov 2026Sealed by Lexigotchi");
    expect(label.textContent).not.toMatch(/jazzy/i);
    // the game's seal, as a picture, its rim in the label's ink (globals.css)
    expect((label.querySelector(".cc-seal") as HTMLElement).style.backgroundImage).toContain("data:image/svg+xml");
    expect(css).toMatch(/\.cc-seal \{[^}]*border: [^;]*var\(--cc-ink\)/);
  });

  it("leaves out when it was cased while that isn't known, and never guesses who found it", () => {
    found = { kind: "unknown" };
    const { container } = render(<CardCase word={word("JAZZY")} front={<p>scene</p>} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn JAZZY over" }));
    expect(container.querySelector(".cc-label-back")!.textContent).toBe("Found by –Sealed by Lexigotchi");
  });

  it("is the card's one turn: the button turns the case, tells the host, and the side turned away can't be reached", async () => {
    const onFlip = vi.fn();
    const { container } = render(<CardCase word={word("JAZZY")} front={<p>scene</p>} onFlip={onFlip} />);
    const side = (q: string) => container.querySelector(q)!;
    expect(side(".cc-frontface").hasAttribute("inert")).toBe(false);
    expect(side(".cc-backface").hasAttribute("inert")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Turn JAZZY over" }));
    expect(onFlip).toHaveBeenLastCalledWith(true);
    expect(container.querySelector(".cc")!.classList.contains("is-back")).toBe(true);
    expect(side(".cc-frontface").hasAttribute("inert")).toBe(true);
    expect(side(".cc-backface").hasAttribute("inert")).toBe(false);
    // the turn is drawn a frame at a time: the back shows once the case is past edge-on, and the
    // case comes to rest on it, the pressed button's twin holding the focus
    const slab = side(".cc-slab") as HTMLElement;
    await waitFor(() => expect(slab.style.transform).toBe(`rotateX(${CASE_REST.x.toFixed(1)}deg) rotateY(${restAngle(1).toFixed(1)}deg)`), { timeout: SETTLE_MS });
    expect((side(".cc-backface") as HTMLElement).style.visibility).toBe("visible");
    expect((side(".cc-frontface") as HTMLElement).style.visibility).toBe("hidden");
    const home = screen.getByRole("button", { name: "Show JAZZY’s scene" });
    // (the last frames round to the rest angle before the turn's end hands the focus over)
    await waitFor(() => expect(document.activeElement).toBe(home), { timeout: SETTLE_MS });
    fireEvent.click(home);
    expect(onFlip).toHaveBeenLastCalledWith(false);
    // it goes on round the same way, to the front again
    await waitFor(() => expect(slab.style.transform).toBe(`rotateX(${CASE_REST.x.toFixed(1)}deg) rotateY(${restAngle(2).toFixed(1)}deg)`), { timeout: SETTLE_MS });
    expect((side(".cc-frontface") as HTMLElement).style.visibility).toBe("visible");
    // no flip of the card inside the case
    expect(container.querySelector(".sc-inner")).toBeNull();
  });

  it("under reduced motion swaps its sides at once, and hands the focus over only once the new side can take it", async () => {
    reducedMotion = true;
    const { container } = render(<CardCase word={word("JAZZY")} front={<p>scene</p>} />);
    const slab = container.querySelector(".cc-slab") as HTMLElement;
    // whether the button was reachable when the focus was sent to it (an inert one refuses a focus)
    const sent: { label: string | null; inert: boolean }[] = [];
    const focus = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, ...args) {
      sent.push({ label: this.getAttribute("aria-label"), inert: !!this.closest("[inert]") });
      return focus.apply(this, args);
    });
    const turn = screen.getByRole("button", { name: "Turn JAZZY over" });
    turn.focus();
    sent.length = 0;
    fireEvent.click(turn);
    // no turn is drawn: the back is up in the same instant
    expect(slab.style.transform).toBe(`rotateX(${CASE_REST.x.toFixed(1)}deg) rotateY(${restAngle(1).toFixed(1)}deg)`);
    expect((container.querySelector(".cc-backface") as HTMLElement).style.visibility).toBe("visible");
    const home = screen.getByRole("button", { name: "Show JAZZY’s scene" });
    await waitFor(() => expect(document.activeElement).toBe(home), { timeout: SETTLE_MS });
    expect(sent).toEqual([{ label: "Show JAZZY’s scene", inert: false }]);
  });

  it("turns with a drag only where its host says so", () => {
    const { container, rerender } = render(<CardCase word={word("JAZZY")} front={<p>scene</p>} />);
    expect(container.querySelector(".cc")!.classList.contains("cc-drag")).toBe(false);
    rerender(<CardCase word={word("JAZZY")} front={<p>scene</p>} drag />);
    expect(container.querySelector(".cc")!.classList.contains("cc-drag")).toBe(true);
  });

  // Pointer events as the game's handlers read them (jsdom's own carry no pointer type).
  const pointer = (el: Element, type: string, at: { x: number; y: number }, pointerType: "mouse" | "touch", buttons = 1) => {
    const e = new MouseEvent(type, { bubbles: true, clientX: at.x, clientY: at.y, button: 0, buttons });
    Object.defineProperty(e, "pointerType", { value: pointerType });
    Object.defineProperty(e, "pointerId", { value: 1 });
    el.dispatchEvent(e);
  };
  const angleOf = (slab: HTMLElement) => Number(slab.style.transform.match(/rotateY\((-?[\d.]+)deg\)/)![1]);

  it("turns under a finger that moves sideways, and rests on the side it was left showing", async () => {
    const onFlip = vi.fn();
    const { container } = render(<CardCase word={word("JAZZY")} front={<p>scene</p>} drag onFlip={onFlip} />);
    const stage = container.querySelector(".cc")!;
    const slab = container.querySelector(".cc-slab") as HTMLElement;
    pointer(stage, "pointerdown", { x: 300, y: 200 }, "touch");
    pointer(stage, "pointermove", { x: 290, y: 201 }, "touch"); // the move that starts the turn
    pointer(stage, "pointermove", { x: 90, y: 204 }, "touch"); // 200 px on: 110 degrees round
    expect(angleOf(slab)).toBeCloseTo(restAngle(0) - 110, 0);
    expect(showsBack(angleOf(slab))).toBe(true);
    expect((container.querySelector(".cc-backface") as HTMLElement).style.visibility).toBe("visible");
    expect((container.querySelector(".cc-frontface") as HTMLElement).style.visibility).toBe("hidden");
    // a finger doesn't tilt it: only a mouse does
    expect(slab.style.transform).toContain(`rotateX(${CASE_REST.x.toFixed(1)}deg)`);
    pointer(stage, "pointerup", { x: 90, y: 204 }, "touch", 0);
    expect(onFlip).toHaveBeenLastCalledWith(true);
    await waitFor(() => expect(angleOf(slab)).toBe(restAngle(-1)), { timeout: SETTLE_MS });
  });

  it("leaves a finger's up-and-down move to the page, even one that drifts sideways", () => {
    const { container } = render(<CardCase word={word("JAZZY")} front={<p>scene</p>} drag />);
    const stage = container.querySelector(".cc")!;
    const slab = container.querySelector(".cc-slab") as HTMLElement;
    const before = slab.style.transform;
    pointer(stage, "pointerdown", { x: 300, y: 200 }, "touch");
    pointer(stage, "pointermove", { x: 302, y: 230 }, "touch");
    pointer(stage, "pointermove", { x: 306, y: 260 }, "touch"); // 6 px sideways, 60 down: a scroll
    pointer(stage, "pointermove", { x: 200, y: 262 }, "touch"); // the page has the gesture now
    expect(slab.style.transform).toBe(before);
    expect(container.querySelector(".cc")!.classList.contains("is-dragging")).toBe(false);
  });

  it("doesn't turn for a press on its button, a mouse with no button held, or where its host gave it no drag", () => {
    const { container, rerender } = render(<CardCase word={word("JAZZY")} front={<p>scene</p>} drag />);
    const stage = container.querySelector(".cc")!;
    const slab = container.querySelector(".cc-slab") as HTMLElement;
    const before = slab.style.transform;
    // a press on the corner button is a press on the button
    pointer(screen.getByRole("button", { name: "Turn JAZZY over" }), "pointerdown", { x: 300, y: 200 }, "mouse");
    pointer(stage, "pointermove", { x: 200, y: 200 }, "mouse");
    expect(slab.style.transform).toBe(before);
    // a press let go somewhere else, then the mouse comes back with no button held
    pointer(stage, "pointerdown", { x: 300, y: 200 }, "mouse");
    pointer(stage, "pointermove", { x: 200, y: 200 }, "mouse", 0);
    pointer(stage, "pointermove", { x: 100, y: 200 }, "mouse", 0);
    expect(slab.style.transform).toBe(before);
    // on the Today stage a drag is the swipe between words
    rerender(<CardCase word={word("JAZZY")} front={<p>scene</p>} />);
    pointer(stage, "pointerdown", { x: 300, y: 200 }, "mouse");
    pointer(stage, "pointermove", { x: 200, y: 200 }, "mouse");
    expect(slab.style.transform).toBe(before);
  });

  it("ends a turn whose release it never saw: a mouse that comes back with no button held", async () => {
    const { container } = render(<CardCase word={word("JAZZY")} front={<p>scene</p>} drag />);
    const stage = container.querySelector(".cc")!;
    const slab = container.querySelector(".cc-slab") as HTMLElement;
    pointer(stage, "pointerdown", { x: 300, y: 200 }, "mouse");
    pointer(stage, "pointermove", { x: 290, y: 200 }, "mouse");
    pointer(stage, "pointermove", { x: 240, y: 200 }, "mouse"); // turning
    expect(angleOf(slab)).toBeLessThan(restAngle(0) - 20);
    await waitFor(() => expect(container.querySelector(".cc")!.classList.contains("is-dragging")).toBe(true));
    // let go outside the case (no release reaches it), then the mouse passes over again
    pointer(stage, "pointermove", { x: 100, y: 200 }, "mouse", 0);
    await waitFor(() => expect(container.querySelector(".cc")!.classList.contains("is-dragging")).toBe(false));
    await waitFor(() => expect(angleOf(slab)).toBe(restAngle(0)), { timeout: SETTLE_MS });
    const rested = slab.style.transform;
    pointer(stage, "pointermove", { x: 40, y: 200 }, "mouse", 0);
    expect(slab.style.transform).toBe(rested);
  });

  it("is shown with nothing in it on the Shop's card, with no word and no number", () => {
    const { container } = render(
      <CaseThumb>
        <p>art</p>
      </CaseThumb>,
    );
    expect(container.querySelector(".cc-label")!.textContent).toBe("One of one");
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("the case's styles", () => {
  const rules = css.split("\n").filter((l) => /^\s*\.cc[\w-]*|^\s*\.cc\b/.test(l) || l.includes(".cc-"));

  it("never loop, and leave the turn to the component: no animation and no transition", () => {
    expect(rules.length).toBeGreaterThan(20);
    for (const rule of rules) {
      expect(rule, rule.slice(0, 60)).not.toMatch(/animation\s*:/);
      expect(rule, rule.slice(0, 60)).not.toMatch(/infinite/);
      expect(rule, rule.slice(0, 60)).not.toMatch(/transition\s*:/);
    }
  });

  it("show one side at a time from the component, never by backface-visibility (WebKit drew the back mirrored)", () => {
    for (const rule of rules) expect(rule, rule.slice(0, 60)).not.toMatch(/backface-visibility/);
    expect(css).toMatch(/\.cc-backface \{[^}]*visibility: hidden/);
  });

  it("let a finger scroll the page over a draggable case, and keep a drag from selecting the label", () => {
    expect(css).toMatch(/\.cc-drag \{[^}]*touch-action: pan-y;[^}]*user-select: none/);
  });

  it("keep listing a cased card's dropped rows until its back is the full one (the two widths must agree)", () => {
    // The card in its case is narrower than its host: the stage's side padding, then the side's
    // border and padding and the well's padding, all read from the styles themselves.
    const num = (re: RegExp) => Number(css.match(re)![1]);
    const stage = num(/\.cc \{[^}]*padding: [\d.]+% ([\d.]+)%;/) / 100;
    const border = num(/\.cc-face \{[^}]*border: (\d+)px solid/);
    const facePad = num(/\.cc-face \{[^}]*padding: ([\d.]+)cqw;/) / 100;
    const wellPad = num(/\.cc-well \{[^}]*padding: ([\d.]+)cqw;/) / 100;
    const cardWidth = (host: number) => host * (1 - 2 * stage) * (1 - 2 * (facePad + wellPad)) - 2 * border;
    // the back is the short one under 470 px (tests/scene-card.test.tsx holds that number)
    const upTo = num(/@container \(min-width: 470px\) and \(max-width: (\d+)px\) \{ \.cc-host \.sc-more \{ display: grid; \} \}/);
    expect(cardWidth(upTo)).toBeLessThan(470);
    expect(cardWidth(upTo + 1)).toBeGreaterThanOrEqual(470);
  });

  it("keep a narrow back's values on the card: a wider ledger, seated low, and a long value on two lines (measured at 320 px)", () => {
    // every card under 340 px, bare or cased: at the wider measures a date ran past the card's edge
    const narrow = css.match(/@container \(max-width: 339px\) \{\s*\.cb-body \{([^}]*)\}\s*\.cb-stats \{([^}]*)\}\s*\.cb-stat dd \{([^}]*)\}/);
    expect(narrow, "the rule for a card under 340 px").not.toBeNull();
    const [, body, stats, value] = narrow!;
    const [name, ledger] = body.match(/grid-template-columns: ([\d.]+)fr ([\d.]+)fr/)!.slice(1).map(Number);
    expect(ledger).toBeGreaterThan(name * 1.5);
    expect(stats).toContain("align-self: end"); // clear of the corner button
    expect(value).toContain("white-space: normal");
    // a thumbnail's back is one column, whatever the width: its rule must still win
    expect(css).toMatch(/\.sc-small \.cb-body \{ grid-template-columns: 1fr;/);
  });

  it("give the third button its own row where three don't fit side by side", () => {
    expect(css).toMatch(/@container \(max-width: 339px\) \{\s*\.sc-actions-3 \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}\s*\.sc-actions-3 > :last-child \{ grid-column: 1 \/ -1; \}/);
  });
});

describe("whether a card is turned over, for what is shown now", () => {
  it("is \"not turned\" on the very first render with something else, never a frame late", () => {
    const seen: [string | null, boolean][] = [];
    const { result, rerender } = renderHook(
      ({ k }: { k: string | null }) => {
        const r = useFlipOf(k);
        seen.push([k, r[0]]);
        return r;
      },
      { initialProps: { k: flipKey("JAZZY", true) as string | null } },
    );
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    // the word comes out of its case: the bare card takes the case's place, on its front
    rerender({ k: flipKey("JAZZY", false) });
    expect(result.current[0]).toBe(false);
    expect(seen.filter(([k, back]) => k === flipKey("JAZZY", false) && back)).toEqual([]);
    // back in a case: a new case, on its front (the old one's turn is forgotten)
    rerender({ k: flipKey("JAZZY", true) });
    expect(result.current[0]).toBe(false);
    expect(seen.filter(([k]) => k === flipKey("JAZZY", true)).at(-1)).toEqual([flipKey("JAZZY", true), false]);
  });

  it("follows the card it is asked about, and nothing is turned with no card", () => {
    const { result, rerender } = renderHook(({ k }: { k: string | null }) => useFlipOf(k), { initialProps: { k: flipKey("CRANE", false) as string | null } });
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    rerender({ k: null });
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(false);
  });

  it("tells a word's bare card from its case, and one word from another", () => {
    expect(flipKey("JAZZY", true)).not.toBe(flipKey("JAZZY", false));
    expect(flipKey("JAZZY", false)).not.toBe(flipKey("CRANE", false));
  });
});
