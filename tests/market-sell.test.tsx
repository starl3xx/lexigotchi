// @vitest-environment jsdom
/**
 * The Market's Sell page (components/game/market/SellDesk.tsx), in the practice game. Two things a
 * tester couldn't do on the first build (starl3xx, 2026-11-25): find their loose letters (they sat
 * under the list of words) and close a sell form once it was open (the only way out was a faint
 * "Not now" under everything).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

// jsdom has no matchMedia; this viewer doesn't ask for reduced motion
window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

vi.mock("@/components/game/useWorld", () => ({ useWorld: () => ({ data: undefined }), useMyWallets: () => new Set<string>(), shortAddress: (a: string) => a }));

const { GameProvider } = await import("@/components/game/state");
const { SellDesk } = await import("@/components/game/market/SellDesk");
type SellKind = import("@/components/game/market/SellDesk").SellKind;

function Page({ start = "words" as SellKind }) {
  const [kind, setKind] = useState<SellKind>(start);
  const [letter, setLetter] = useState<number | null>(null);
  return <SellDesk kind={kind} setKind={setKind} letter={letter} setLetter={setLetter} />;
}
const show = (start?: SellKind) =>
  render(
    <GameProvider>
      <Page start={start} />
    </GameProvider>,
  );

afterEach(cleanup);

describe("the Market's Sell page", () => {
  it("offers the player's words and their letters as two tabs, each with its count", () => {
    show();
    // The practice bag: one unstaked word (MOTEL), and 19 loose letters.
    expect(screen.getByRole("button", { name: "Your words · 1" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Your letters · 19" })).toBeTruthy();
    // On words, the letters form's tray isn't in the way, and the reverse.
    expect(screen.queryByText(/Tap a letter to sell it/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Your letters · 19" }));
    expect(screen.getByText(/Tap a letter to sell it/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sell" })).toBeNull();
  });

  it("opens on the letters when asked to (the Bag's link, a letter's Sell some)", () => {
    show("letters");
    expect(screen.getByRole("button", { name: "Your letters · 19" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/Tap a letter to sell it/)).toBeTruthy();
  });

  it("a word's sell form closes with its × and with Cancel", () => {
    show();
    for (const way of ["Close", "Cancel"]) {
      fireEvent.click(screen.getByRole("button", { name: "Sell" }));
      expect(screen.getByRole("heading", { name: "Sell MOTEL" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: way }));
      expect(screen.queryByRole("heading", { name: "Sell MOTEL" })).toBeNull();
      expect(screen.getByRole("button", { name: "Sell" })).toBeTruthy();
    }
  });

  it("a letter's sell form closes with its × and with Cancel, and lists nothing", () => {
    const { container } = show("letters");
    const tiles = () => container.querySelectorAll<HTMLElement>('[data-section="sellLetters"] [role="button"], [data-section="sellLetters"] button.tile-press, [data-section="sellLetters"] .tile-press');
    expect(tiles().length).toBeGreaterThan(5);
    for (const way of ["Close", "Cancel"]) {
      fireEvent.click(tiles()[0]);
      const form = container.querySelector("form")!;
      expect(form).toBeTruthy();
      fireEvent.click(within(form).getByRole("button", { name: way }));
      expect(container.querySelector("form")).toBeNull();
    }
    expect(screen.getByText("Nothing of yours is for sale yet.")).toBeTruthy();
  });

  it("listing a letter puts it under For sale by you, with a way to take it off sale", async () => {
    const { container } = show("letters");
    fireEvent.click(container.querySelector<HTMLElement>('[data-section="sellLetters"] .tile-press')!);
    const form = container.querySelector("form")!;
    fireEvent.change(within(form).getByRole("textbox"), { target: { value: "250,000" } });
    fireEvent.submit(form);
    expect(await screen.findByText(/left to sell/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take off sale" }));
    expect(screen.getByText("Nothing of yours is for sale yet.")).toBeTruthy();
  });
});
