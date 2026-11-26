// @vitest-environment jsdom
/**
 * A purchase on the Market celebrates (starl3xx, 2026-11-25: "we need an animation or popup ... when
 * a user purchases a word or letter"). A bought word stands in its scene on the "is yours" sheet
 * (sheets/CelebrateSheet); bought letters hop in over the word they now finish
 * (sheets/BoughtLettersSheet). Driven here through the practice store, the way a player does it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { WORDS } from "@/lib/dictionary";
import { oneLetterShort } from "@/lib/market/deals";

// jsdom has no matchMedia; this viewer doesn't ask for reduced motion
window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

let world: { drawn?: Record<string, number> } | undefined;
vi.mock("@/components/game/useWorld", () => ({ useWorld: () => ({ data: world }), useMyWallets: () => new Set<string>(), shortAddress: (a: string) => a }));
// The scene pick is its own subject (tests/scenes.test.tsx); here every word stands on the stage.
vi.mock("@/components/scenes/useWordScene", () => ({ useWordScene: () => ({ scene: "stage" }) }));

const { GameProvider, useGame, mineLower, mineUpper } = await import("@/components/game/state");
const { CelebrateSheet, stakeStep } = await import("@/components/game/sheets/CelebrateSheet");
const { BoughtLettersSheet, newlySpellable } = await import("@/components/game/sheets/BoughtLettersSheet");
type GameApi = ReturnType<typeof useGame>;

/** The two sheets, routed as GameApp routes them, and the store handed out for the test to drive. */
let g!: GameApi;
function Host() {
  g = useGame();
  const s = g.state.sheet;
  if (s?.kind === "celebrate") return <CelebrateSheet word={s.word} bought={s.bought} />;
  if (s?.kind === "boughtLetters") return <BoughtLettersSheet letterId={s.letterId} count={s.count} unitPrice={s.unitPrice} />;
  return null;
}
const play = () =>
  render(
    <GameProvider>
      <Host />
    </GameProvider>,
  );
const listing = (word: string) => g.wordBoard.find((l) => l.word === word)!;
const ask = (letterId: number) => g.market.letterBook[letterId].asks[0];
const X = "X".charCodeAt(0) - 65;
const E = "E".charCodeAt(0) - 65;

afterEach(() => {
  cleanup();
  world = undefined;
});

describe("a word bought on the Market", () => {
  it("stands in its scene on the “is yours” sheet, over what the player paid", () => {
    play();
    const ocean = listing("OCEAN");
    act(() => g.buyWord(ocean.orderHash));
    expect(g.state.sheet).toEqual({ kind: "celebrate", word: "OCEAN", bought: { price: ocean.price } });
    expect(screen.getByText("Congrats!")).toBeTruthy();
    expect(screen.getByText("OCEAN is yours.")).toBeTruthy();
    expect(screen.getByText(/Bought for/).textContent).toContain("2.40M $WORD");
    // the word is drawn in a scene, celebrating
    expect(document.querySelector('[role="dialog"] svg')).toBeTruthy();
    // no toast says it a second time
    expect(g.state.toasts).toHaveLength(0);
  });

  it("offers the stake, which a bought word always needs (a staked word can’t be listed)", () => {
    play();
    act(() => g.buyWord(listing("TIGER").orderHash));
    expect(screen.getByText(/Stake it to enter it in the daily jackpot and start earning \$WORD\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Stake it/ }));
    expect(g.state.sheet).toBeNull();
    expect(g.state.words.find((w) => w.word === "TIGER")?.staked).toBe(true);
  });

  it("opens the word’s own sheet (its card, Scene, Share) from “See its card”", () => {
    play();
    act(() => g.buyWord(listing("OCEAN").orderHash));
    fireEvent.click(screen.getByRole("button", { name: /See its card/ }));
    expect(g.state.sheet).toEqual({ kind: "word", word: "OCEAN" });
  });

  it("never promises the jackpot to a word the jackpot already drew", () => {
    world = { drawn: { OCEAN: 12, TIGER: 13 } };
    play();
    // lowercase and drawn: staking does nothing for it yet, so no Stake button
    act(() => g.buyWord(listing("OCEAN").orderHash));
    expect(screen.getByText(/The jackpot already drew it/)).toBeTruthy();
    expect(screen.queryByText(/enter it in the daily jackpot/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Stake it/ })).toBeNull();
    act(() => g.closeSheet());
    // all UPPERCASE and drawn: it still earns, staked
    act(() => g.buyWord(listing("TIGER").orderHash));
    expect(screen.getByText(/Stake it to start earning \$WORD\. The jackpot already drew it/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Stake it/ })).toBeTruthy();
  });

  it("says it with a toast when another sheet is open, and leaves that sheet alone", () => {
    play();
    act(() => g.openSheet({ kind: "cheatsheet" }));
    act(() => g.buyWord(listing("OCEAN").orderHash));
    expect(g.state.sheet).toEqual({ kind: "cheatsheet" });
    expect(g.state.toasts.map((t) => t.text)).toEqual(["OCEAN is yours."]);
  });

  it("celebrates nothing when the purchase didn’t happen", () => {
    play();
    act(() => g.buyWord(listing("JAZZY").orderHash)); // 310M: more than the practice bag holds
    expect(g.state.sheet?.kind).toBe("balance");
    expect(g.state.words.some((w) => w.word === "JAZZY")).toBe(false);
  });
});

describe("letters bought on the Market", () => {
  it("hop in over the word they finish, the same word the Market’s pick named", async () => {
    play();
    // What the Market's "For you" says an x finishes, before the purchase.
    const taken = new Set(g.state.words.map((w) => w.word));
    const picked = oneLetterShort(mineLower(g.state), mineUpper(g.state), WORDS.filter((w) => !taken.has(w))).get(X)!;
    expect(picked.length).toBeGreaterThan(1);
    const x = ask(X);
    await act(async () => void (await g.market.buyLetters(x, 1)));
    expect(g.state.sheet).toEqual({ kind: "boughtLetters", letterId: X, count: 1, unitPrice: x.unitPrice });
    expect(screen.getByText("x is yours.")).toBeTruthy();
    expect(screen.getByText(/Bought for/).textContent).toContain("9.80M $WORD");
    expect(screen.getByText("Now you can spell")).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(`^Claim ${picked[0]} ·`) })).toBeTruthy();
    expect(screen.getByText(`and ${picked.length - 1} more new words on Spell`)).toBeTruthy();
    expect(g.state.toasts).toHaveLength(0);
  });

  it("claim that word from the sheet, and the new word celebrates as a claim does", async () => {
    play();
    await act(async () => void (await g.market.buyLetters(ask(X), 1)));
    const claim = screen.getByRole("button", { name: /^Claim / });
    const word = claim.textContent!.match(/^Claim (\w+)/)![1];
    fireEvent.click(claim);
    expect(g.state.words.some((w) => w.word === word)).toBe(true);
    expect(g.state.sheet).toEqual({ kind: "celebrate", word });
    expect(screen.getByText("A new word")).toBeTruthy();
  });

  it("draw a row of tiles and a number for the rest, with the price for each", async () => {
    play();
    const e = ask(E);
    expect(e.available).toBe(6);
    await act(async () => void (await g.market.buyLetters(e, 6)));
    expect(screen.getByText("6 × e are yours.")).toBeTruthy();
    expect(screen.getByText("+2")).toBeTruthy();
    const paid = screen.getByText(/Bought for/).textContent!;
    expect(paid).toContain("1.50M $WORD");
    expect(paid).toContain("250.0K each.");
  });

  it("celebrate what arrived when the listing had fewer than asked for", async () => {
    play();
    const e = ask(E);
    await act(async () => void (await g.market.buyLetters(e, 4)));
    act(() => g.closeSheet());
    // 2 are left of that listing; the row the player tapped is older and still says 6
    await act(async () => void (await g.market.buyLetters(e, 6)));
    expect(g.state.sheet).toMatchObject({ kind: "boughtLetters", count: 2 });
    expect(screen.getByText("2 × e are yours.")).toBeTruthy();
  });

  it("celebrate nothing when the listing is gone", async () => {
    play();
    const e = ask(E);
    await act(async () => void (await g.market.buyLetters(e, 6)));
    act(() => g.closeSheet());
    let ok = true;
    await act(async () => void (ok = await g.market.buyLetters(e, 1)));
    expect(ok).toBe(false);
    expect(g.state.sheet).toBeNull();
  });

  it("an UPPERCASE letter is drawn and named in its case", async () => {
    play();
    const E_UP = E + 26;
    await act(async () => void (await g.market.buyLetters(ask(E_UP), 1)));
    expect(screen.getByText("E is yours.")).toBeTruthy();
  });
});

describe("stakeStep", () => {
  type Word = Parameters<typeof stakeStep>[0];
  const word = (over: Partial<Word> = {}): Word => ({
    word: "OCEAN", tier: "Common", upper: [false, false, false, false, false], staked: false, daysUnfed: 0, prestigeLevel: 0, prestigePity: 0, mine: true, ...over,
  });
  const UP = [true, true, true, true, true];

  it("a bought word that arrives hungry is told to feed too: staking alone wouldn’t put it in the running", () => {
    // The hunger clock keeps running while a word is unstaked and for sale (Staking.stake).
    expect(stakeStep(word({ daysUnfed: 5 }), false, true)).toEqual({ line: "It arrives hungry: stake it and feed it to enter it in the daily jackpot.", offer: true });
    expect(stakeStep(word({ daysUnfed: 5, upper: UP }), false, true).line).toBe("It arrives hungry: stake it and feed it to enter it in the daily jackpot and start earning $WORD.");
    expect(stakeStep(word({ daysUnfed: 5, upper: UP }), true, true).line).toMatch(/^It arrives hungry: stake it and feed it to start earning \$WORD\./);
    // fed, or only peckish (still in the running): the plain line
    expect(stakeStep(word({ daysUnfed: 1 }), false, true).line).toBe("Stake it to enter it in the daily jackpot.");
  });

  it("a claimed word’s first stake starts fed, so a claim never says hungry", () => {
    expect(stakeStep(word({ daysUnfed: 5 }), false).line).toBe("Stake it to enter it in the daily jackpot.");
  });

  it("a staked word is never offered the stake again (it would unstake it)", () => {
    expect(stakeStep(word({ staked: true }), false).offer).toBe(false);
    expect(stakeStep(word({ staked: true, upper: UP }), true)).toEqual({ line: "It’s staked and earning $WORD.", offer: false });
  });
});

describe("newlySpellable", () => {
  const bag = (letters: string) => {
    const n = new Array<number>(26).fill(0);
    for (const ch of letters) n[ch.toUpperCase().charCodeAt(0) - 65]++;
    return n;
  };
  const none = new Array<number>(26).fill(0);

  it("names only the words the bag could not spell before the letters came", () => {
    // "unbo" + the bought x spells UNBOX; nothing else is new.
    expect(newlySpellable(bag("unbox"), none, X, 1, new Set()).map((s) => s.word)).toEqual(["UNBOX"]);
    // The bag already held an x: a second x finishes nothing new.
    expect(newlySpellable(bag("unboxx"), none, X, 1, new Set())).toEqual([]);
  });

  it("leaves out a word someone owns", () => {
    expect(newlySpellable(bag("unbox"), none, X, 1, new Set(["UNBOX"]))).toEqual([]);
  });

  it("claims with the bought letter UPPERCASE when that is what was bought", () => {
    const upper = bag("x");
    expect(newlySpellable(bag("unbo"), upper, X + 26, 1, new Set())).toEqual([{ word: "UNBOX", cases: [false, false, false, false, true] }]);
  });

  it("says nothing new while the bag doesn’t show the letters yet (a slow read)", () => {
    expect(newlySpellable(bag("unbo"), none, X, 1, new Set())).toEqual([]);
  });
});
