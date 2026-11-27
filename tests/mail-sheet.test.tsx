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
const { PRACTICE_MAIL_MS, resetSitting } = await import("@/components/game/mail/mailFlow");
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
  resetSitting(); // each test is a new sitting: the short version starts after a few envelopes
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

  it("Claim at the count claims that word, and the envelope gives way to the word's own moment", () => {
    reduce = true;
    play();
    buy();
    arrive();
    fireEvent.click(strip());
    tick(600);
    // the seeded first pack finishes a word
    const claim = screen.getByRole("button", { name: /^Claim / });
    const word = /Claim ([A-Z]{5})/.exec(claim.textContent ?? "")![1];
    expect(g.state.words.some((w) => w.word === word)).toBe(false);
    fireEvent.click(claim);
    expect(g.state.words.some((w) => w.word === word)).toBe(true);
    // the mail sheet is gone, and the claim's own sheet (the word, celebrating) took its place
    expect(g.state.sheet?.kind).not.toBe("mail");
    expect(g.state.sheet).toMatchObject({ kind: "celebrate", word });
    // nothing waits: the envelope was torn
    expect(g.pendingReveals).toBe(0);
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

describe("the daily letter comes by mail too (decisions.md #49, part 3)", () => {
  const pull = () => {
    let got: unknown;
    act(() => void (got = g.dailyMint()));
    return got;
  };

  it("opens a one-letter envelope, and is never “Paid”: it is free", () => {
    play();
    const got = pull();
    // not null: null is "already claimed today", and the button toasts that
    expect(typeof got).toBe("number");
    expect(g.state.sheet).toEqual({ kind: "mail" });
    expect(g.mail).toMatchObject({ count: 1, free: true, phase: "paid", number: null, letters: null });
    expect(said()).toContain("Your letter");
    expect(said()).toContain("Contents:");
    expect(said()).toContain("1 letter");
    expect(said()).not.toContain("5 letters");
    expect(said()).toContain("It’s in the mail.");
    expect(said()).not.toMatch(/Paid/);
    expect(strip().disabled).toBe(true);
  });

  it("says which letter only at the tear: no toast names it, and Today's tile waits", () => {
    reduce = true;
    play();
    const idx = pull() as number;
    expect(g.state.toasts).toHaveLength(0);
    expect(g.state.dailyMinted).toBe(true); // claimed, and the card says so
    expect(g.state.dailyLetter).toBeNull(); // which letter is the envelope's to say
    tick(PRACTICE_MAIL_MS.found + 20);
    expect(said()).toMatch(/No\. \d+ is yours\. Minting your letter…/);
    arrive();
    expect(said()).toContain("It’s here. Tear along the top.");
    expect(g.mail?.letters).toEqual([idx]);
    expect(g.state.dailyLetter).toBeNull();
    fireEvent.click(strip());
    tick(600);
    expect(g.state.dailyLetter).toBe(idx);
    const ch = String.fromCharCode(97 + idx);
    expect(said()).toMatch(new RegExp(`It’s an? ${ch}\\.|An? ${ch} came out\\.`));
    expect(sheet().querySelectorAll(".mail-letter")).toHaveLength(1);
  });

  it("the count offers a pack, not “another”: a daily letter is not a pack", () => {
    reduce = true;
    play();
    pull();
    arrive();
    fireEvent.click(strip());
    tick(600);
    expect(said()).not.toMatch(/another/i);
    expect(said()).toMatch(/rip a pack/i);
  });

  it("a second pull the same day is null, and opens nothing", () => {
    play();
    pull();
    const first = g.mail!.seq;
    expect(pull()).toBeNull();
    expect(g.mail!.seq).toBe(first);
  });

  it("the daily and the next pack have different numbers", () => {
    reduce = true;
    play();
    pull();
    arrive();
    const daily = g.mail!.number;
    fireEvent.click(strip());
    tick(600);
    act(() => g.closeSheet());
    buy();
    arrive();
    expect(g.mail!.number).not.toBe(daily);
    expect(g.mail!.number).toBe((daily as number) + 1);
  });

  it("closed before it was torn, the card shows a one-letter envelope, and opens it", () => {
    reduce = true;
    play();
    pull();
    arrive();
    act(() => g.closeSheet());
    expect(g.pendingReveals).toBe(1);
    expect(g.nextMail).toBe(1);
    // one pair of eyes at the card's window, not five
    const card = screen.getByText("Your mail is waiting").closest("div")!.parentElement!.parentElement!;
    expect(card.querySelectorAll("img")).toHaveLength(4); // the face, the strip, the stamp, one pair of eyes
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(g.state.sheet).toEqual({ kind: "mail" });
    expect(g.nextMail).toBeNull();
  });

  it("a waiting pack's card shows five pairs of eyes", () => {
    reduce = true;
    play();
    buy();
    arrive();
    act(() => g.closeSheet());
    expect(g.nextMail).toBe(5);
    const card = screen.getByText("Your mail is waiting").closest("div")!.parentElement!.parentElement!;
    expect(card.querySelectorAll("img")).toHaveLength(8);
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

// Bugbot on #273: practice kept one piece of mail, and a second purchase dropped the first if it
// had not been torn. The chain store keeps such envelopes in the mailbox; practice sets them aside.
describe("an untorn envelope is never dropped by the next one", () => {
  it("buying another pack while one waits keeps both, and the card opens the older first", () => {
    reduce = true;
    play();
    buy();
    arrive();
    const first = { number: g.mail!.number, letters: g.mail!.letters };
    act(() => g.closeSheet()); // untorn: it waits
    expect(g.pendingReveals).toBe(1);
    buy();
    arrive();
    const second = { number: g.mail!.number, letters: g.mail!.letters };
    expect(second.number).not.toBe(first.number);
    // the new one is on screen; the first still waits
    expect(g.pendingReveals).toBe(1);
    act(() => g.closeSheet());
    expect(g.pendingReveals).toBe(2);
    expect(screen.getByText("2 pieces of mail are waiting")).toBeTruthy();
    // the older envelope first, with its own letters
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(g.mail).toMatchObject({ number: first.number, letters: first.letters, phase: "ready", torn: false });
    expect(g.pendingReveals).toBe(1); // the second went back to waiting
    fireEvent.click(strip());
    tick(600);
    act(() => g.closeSheet());
    expect(g.pendingReveals).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(g.mail).toMatchObject({ number: second.number, letters: second.letters, phase: "ready", torn: false });
    fireEvent.click(strip());
    tick(600);
    act(() => g.closeSheet());
    expect(g.pendingReveals).toBe(0);
  });

  it("an envelope set aside while it was still on its way waits whole, with its letters", () => {
    reduce = true;
    play();
    const before = g.state.lower.slice();
    buy();
    act(() => g.closeSheet()); // closed mid-way
    buy(); // at once: the first never finished arriving
    // the first is not lost: it waits behind the new one, complete
    expect(g.pendingReveals).toBe(1);
    arrive();
    act(() => g.closeSheet());
    expect(g.pendingReveals).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(g.mail).toMatchObject({ phase: "ready", torn: false });
    expect(g.mail!.letters).toHaveLength(5);
    expect(strip().disabled).toBe(false);
    // and every letter of both packs is in the bag, as it was from each tap
    expect(gained(before)).toHaveLength(10);
    // its timers were cleared with it: nothing arrives a second time
    tick(5000);
    expect(g.state.toasts).toHaveLength(0);
  });

  it("a torn envelope is not set aside: it was opened", () => {
    reduce = true;
    play();
    buy();
    arrive();
    fireEvent.click(strip());
    tick(600);
    act(() => g.closeSheet());
    buy();
    arrive();
    act(() => g.closeSheet());
    expect(g.pendingReveals).toBe(1);
  });
});

describe("a daily letter set aside keeps its secret (part 3, with the shelf)", () => {
  const pull = () => {
    let got: unknown;
    act(() => void (got = g.dailyMint()));
    return got as number;
  };

  it("Today's tile stays hidden while the daily's envelope waits on the shelf, and shows at its tear", () => {
    reduce = true;
    play();
    const idx = pull();
    arrive();
    act(() => g.closeSheet()); // the daily waits, untorn
    buy(); // a pack takes its place in hand: the daily goes on the shelf
    arrive();
    expect(g.state.dailyLetter).toBeNull();
    act(() => g.closeSheet());
    expect(g.pendingReveals).toBe(2);
    // the card opens the older piece first, and draws it: one letter
    expect(g.nextMail).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(g.mail).toMatchObject({ count: 1, letters: [idx], torn: false });
    expect(g.state.dailyLetter).toBeNull();
    fireEvent.click(strip());
    tick(600);
    expect(g.state.dailyLetter).toBe(idx);
    act(() => g.closeSheet());
    // the pack still waits, and the card now draws five
    expect(g.pendingReveals).toBe(1);
    expect(g.nextMail).toBe(5);
  });
});
