// @vitest-environment jsdom
/**
 * A pack comes by mail (src/components/game/sheets/MailSheet.tsx, decisions.md #49), driven here
 * through the practice store, the way a player does it. What must hold:
 * - the tap is answered by the envelope, and each mark on it shows only when it is true;
 * - the envelope can be torn only once the letters exist;
 * - the letters that come out are exactly the ones the purchase put in the bag;
 * - closing the sheet stops nothing: the envelope waits, and says so when it lands;
 * - a tile's size never changes: nothing in the envelope's styles scales.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

let reduce = false;
window.matchMedia = ((q: string) => ({ matches: reduce && /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

let name: string | null = null;
vi.mock("@/components/game/useMyName", () => ({ useMyName: () => name }));
vi.mock("@/components/game/useWorld", () => ({ useWorld: () => ({ data: undefined, isPending: false }), useMyWallets: () => new Set<string>(), shortAddress: (a: string) => a }));
vi.mock("@/components/game/useLetterSupply", () => ({ useLetterSupply: () => ({ data: undefined }) }));

const { GameProvider, useGame } = await import("@/components/game/state");
const { MailSheet } = await import("@/components/game/sheets/MailSheet");
const { PendingReveal } = await import("@/components/game/PendingReveal");
const { PRACTICE_MAIL_MS } = await import("@/components/game/mail/mailFlow");
type GameApi = ReturnType<typeof useGame>;

let g!: GameApi;
function Host() {
  g = useGame();
  return (
    <>
      <PendingReveal />
      {g.state.sheet?.kind === "mail" && <MailSheet />}
      {g.state.sheet?.kind === "cheatsheet" && <div role="dialog">another sheet</div>}
    </>
  );
}
const play = () =>
  render(
    <GameProvider>
      <Host />
    </GameProvider>,
  );
const sheet = () => screen.getByRole("dialog");
const said = () => sheet().textContent ?? "";
const strip = () => screen.getByRole("button", { name: "Tear the envelope open" }) as HTMLButtonElement;
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const buy = () => act(() => void g.buyPack());
const arrive = () => tick(PRACTICE_MAIL_MS.ready + 50);
/** Letters the bag holds now and didn't before, as sorted indexes. */
const gained = (before: readonly number[]) => g.state.lower.flatMap((n, i) => Array.from({ length: n - before[i] }, () => i));

beforeEach(() => {
  reduce = false;
  name = null;
  // setTimeout and the clock both move with the test, so a drawn-out tear and each letter's beat
  // can be stepped through; a frame is a 16 ms timer.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the envelope answers the tap, and takes each mark when it is true", () => {
  it("opens at once, stamped and addressed, with no number, and it can't be torn yet", () => {
    play();
    buy();
    expect(g.state.sheet).toEqual({ kind: "mail" });
    expect(said()).toContain("Paid. It’s in the mail.");
    expect(said()).toContain("For you");
    expect(said()).toContain("from the Lexigotchi Mint");
    expect(said()).toContain("Contents:");
    expect(said()).toContain("5 letters");
    expect(said()).not.toContain("No.");
    expect(strip().disabled).toBe(true);
    expect(g.mail).toMatchObject({ phase: "paid", number: null, letters: null, torn: false });
  });

  it("gets its number when the commit is on chain, and still can't be torn", () => {
    play();
    buy();
    tick(PRACTICE_MAIL_MS.found + 20);
    expect(said()).toMatch(/No\. \d+ is yours\. Minting your letters…/);
    expect(strip().disabled).toBe(true);
    expect(g.mail?.letters).toBeNull();
  });

  it("can be torn once the letters exist, and not a moment before", () => {
    play();
    buy();
    tick(PRACTICE_MAIL_MS.ready - 50);
    expect(strip().disabled).toBe(true);
    tick(100);
    expect(said()).toContain("They’re here. Tear along the top.");
    expect(strip().disabled).toBe(false);
    expect(g.mail?.letters).toHaveLength(5);
  });

  it("is addressed to the player's handle, with its @, when they have one", () => {
    name = "@mabel";
    play();
    buy();
    expect(said()).toContain("For @mabel");
    expect(said()).not.toContain("For you");
  });

  it("never says “post”", () => {
    play();
    buy();
    arrive();
    expect(said()).not.toMatch(/\bpost\b/i);
  });
});

describe("tearing it open", () => {
  it("the letters that come out are exactly the ones the purchase put in the bag", () => {
    reduce = true;
    play();
    const before = g.state.lower.slice();
    buy();
    expect(g.mail?.had).toEqual(before);
    arrive();
    const letters = [...(g.mail?.letters ?? [])].sort((a, b) => a - b);
    expect(letters).toEqual(gained(before));
    fireEvent.click(strip());
    tick(600);
    // five letters stand out of the envelope, each one of the pack's
    const tiles = [...sheet().querySelectorAll(".mail-letter")];
    expect(tiles).toHaveLength(5);
    expect(tiles.every((t) => t.getAttribute("data-pos") === "out")).toBe(true);
    expect(g.mail?.torn).toBe(true);
  });

  it("ends on a count: what came out, and what to do next", () => {
    reduce = true;
    play();
    buy();
    arrive();
    fireEvent.click(strip());
    tick(600);
    expect(said()).toMatch(/Five lowercase letters\.|came out\./);
    // either the word these letters finish, with its claim, or another pack
    expect(screen.queryByRole("button", { name: /^Claim / }) ?? screen.queryByRole("button", { name: /^Rip another/ })).toBeTruthy();
    expect(said()).toMatch(/rip another/i);
    // the strip is gone with the envelope
    expect(screen.queryByRole("button", { name: "Tear the envelope open" })).toBeNull();
  });

  it("with motion, they come out one at a time, and a tap hurries them", () => {
    play();
    buy();
    arrive();
    fireEvent.click(strip());
    tick(520); // the strip comes off
    expect(g.mail?.torn).toBe(true);
    tick(700);
    const out = () => [...sheet().querySelectorAll(".mail-letter")].filter((t) => t.getAttribute("data-pos") === "out").length;
    expect(out()).toBeGreaterThan(0);
    expect(out()).toBeLessThan(5);
    expect(said()).toContain("Tap to hurry them along.");
    fireEvent.click(sheet().querySelector(".mail-lift")!);
    expect(out()).toBe(5);
    tick(400);
    expect(said()).toMatch(/Five lowercase letters\.|came out\./);
  });

  it("one long drag to the end opens it without waiting for the finger to lift", () => {
    play();
    buy();
    arrive();
    const el = strip();
    el.setPointerCapture = () => {};
    fireEvent.pointerDown(el, { clientX: 20, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 200, pointerId: 1 });
    expect(g.mail?.torn).toBe(false);
    fireEvent.pointerMove(el, { clientX: 700, pointerId: 1 });
    // no pointerup: the strip has gone from under the finger
    expect(g.mail?.torn).toBe(true);
    expect(screen.queryByRole("button", { name: "Tear the envelope open" })).toBeNull();
  });

  it("a short drag springs back and opens nothing", () => {
    play();
    buy();
    arrive();
    const el = strip();
    el.setPointerCapture = () => {};
    fireEvent.pointerDown(el, { clientX: 20, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 60, pointerId: 1 });
    fireEvent.pointerUp(el, { pointerId: 1 });
    tick(400);
    expect(g.mail?.torn).toBe(false);
    expect(strip().disabled).toBe(false);
  });

  it("“Rip another” is a new envelope from the start", () => {
    reduce = true;
    play();
    buy();
    arrive();
    const first = g.mail!.seq;
    fireEvent.click(strip());
    tick(600);
    const again = screen.queryByRole("button", { name: /^Rip another/ }) ?? screen.getByRole("button", { name: /or rip another pack/ });
    fireEvent.click(again);
    expect(g.mail).toMatchObject({ phase: "paid", torn: false, letters: null });
    expect(g.mail!.seq).toBeGreaterThan(first);
    expect(strip().disabled).toBe(true);
  });
});

describe("the purchase outlives the sheet", () => {
  it("closed before it was torn, the envelope waits, and the card opens it again", () => {
    reduce = true;
    play();
    buy();
    arrive();
    expect(g.pendingReveals).toBe(0); // it is on screen, not waiting
    act(() => g.closeSheet());
    expect(g.pendingReveals).toBe(1);
    expect(screen.getByText("Your mail is waiting")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(g.state.sheet).toEqual({ kind: "mail" });
    expect(strip().disabled).toBe(false);
    fireEvent.click(strip());
    tick(600);
    act(() => g.closeSheet());
    // torn open: nothing waits any more
    expect(g.pendingReveals).toBe(0);
    expect(screen.queryByText("Your mail is waiting")).toBeNull();
  });

  it("closed while it was on its way, it opens again when it lands", () => {
    play();
    buy();
    act(() => g.closeSheet());
    expect(g.state.sheet).toBeNull();
    arrive();
    expect(g.state.sheet).toEqual({ kind: "mail" });
    expect(said()).toContain("They’re here. Tear along the top.");
    expect(g.state.toasts).toHaveLength(0);
  });

  it("if another sheet is open when it lands, a toast says so and the envelope waits", () => {
    play();
    buy();
    act(() => g.openSheet({ kind: "cheatsheet" }));
    arrive();
    expect(g.state.sheet).toEqual({ kind: "cheatsheet" });
    expect(g.state.toasts.map((t) => t.text)).toEqual(["Your mail is here."]);
    act(() => g.closeSheet());
    expect(g.pendingReveals).toBe(1);
  });
});

describe("a tile's size never changes (decisions.md #48)", () => {
  const css = readFileSync(resolve(__dirname, "../src/app/globals.css"), "utf8");
  // the envelope's own section: from its title to the cards' section, which follows it
  const mail = css.slice(css.indexOf("The mail (decisions.md #49"), css.indexOf("Scene cards (components/cards/SceneCard.tsx)"));

  it("the envelope's styles move and turn, and never scale", () => {
    expect(mail.length).toBeGreaterThan(1000);
    expect(mail).not.toMatch(/scale\(/);
    expect(mail).not.toMatch(/\bzoom\b/);
  });

  it("every bit of travel sits behind prefers-reduced-motion: no-preference", () => {
    const gated = mail.slice(mail.indexOf("@media (prefers-reduced-motion: no-preference)"), mail.indexOf("@keyframes mailDrop"));
    const outside = mail.slice(0, mail.indexOf("@media (prefers-reduced-motion: no-preference)"));
    expect(gated).toMatch(/animation:/);
    expect(outside).not.toMatch(/animation:|transition:/);
  });

  it("no loop but the pull tab's nudge and the blink, each on a whole picture", () => {
    const loops = [...mail.matchAll(/\.([\w-]+)[^{]*\{[^}]*infinite[^}]*\}/g)].map((m) => m[1]);
    expect(new Set(loops)).toEqual(new Set(["mail-nudge", "mail-eyes"]));
  });
});
