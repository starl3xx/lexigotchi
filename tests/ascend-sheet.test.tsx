// @vitest-environment jsdom
/**
 * The ascend sheet (src/components/game/sheets/AscendSheet.tsx): a try, its result passing along
 * the word, and the next try, driven through a store that answers when the test says (as the chain
 * store does). What must hold: nothing says "Ascending" (starl3xx, 2026-11-25: a try may miss);
 * the word keeps the stage it had at the tap until the result reaches it; and another try is
 * offered after a result and never after a try that is paid and unfinished.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { prestigeSuccessProbability } from "@/lib/params";
import type { ActionOutcome } from "@/lib/onchain/guardedAction";

// jsdom has no matchMedia; this viewer doesn't ask for reduced motion
window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

const { GameCtx, GameProvider, useGame } = await import("@/components/game/state");
const { AscendSheet } = await import("@/components/game/sheets/AscendSheet");
type GameApi = ReturnType<typeof useGame>;
type Word = GameApi["state"]["words"][number];

const vivid = (over: Partial<Word> = {}): Word =>
  ({ word: "VIVID", tier: "Legendary", upper: [true, true, true, true, true], staked: true, daysUnfed: 0, prestigeLevel: 1, prestigePity: 0, mine: true, ...over }) as Word;

/** A store whose ascension answers when the test settles it, the way the chain store's does. */
function fakeGame(word: Word, over: Partial<GameApi> = {}) {
  let settle!: (o: ActionOutcome) => void;
  let fail!: (e: unknown) => void;
  const prestige = vi.fn(
    () =>
      new Promise<ActionOutcome>((resolve, reject) => {
        settle = resolve;
        fail = reject;
      }),
  );
  const openSheet = vi.fn();
  const api = {
    state: { words: [word], sheet: { kind: "ascend", word: word.word } },
    maxPrestigeLevel: 5,
    unfinishedAscents: new Set<string>(),
    prestigeProb: (level: number, pity: number) => prestigeSuccessProbability(pity, level),
    prestigePrice: (level: number) => 100 * (level + 1),
    price: () => 2,
    canAfford: () => true,
    openSheet,
    closeSheet: vi.fn(),
    toast: vi.fn(),
    prestige,
    ...over,
  } as unknown as GameApi;
  return { api, prestige, openSheet, settle: (o: ActionOutcome) => settle(o), fail: (e: unknown) => fail(e) };
}

const show = (api: GameApi) =>
  render(
    <GameCtx.Provider value={api}>
      <AscendSheet word="VIVID" />
    </GameCtx.Provider>,
  );
const sheet = () => screen.getByRole("dialog");
const tryButton = () => screen.queryByRole("button", { name: /^Try / });
/** Let a settled promise's handlers run, then run the clock `ms` on. */
const pass = async (ms: number) => {
  await act(async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("before a try", () => {
  it("names the stage it is for, its odds, and its whole price (the fee and the snack it burns)", () => {
    show(fakeGame(vivid({ prestigePity: 1 })).api);
    expect(screen.getByRole("button", { name: "Try for Gilded 2 · 202 $WORD" })).toBeTruthy();
    // Gilded 2's first try is 35%; one miss has added 10 points
    expect(sheet().textContent).toContain("45%");
    expect(sheet().textContent).toContain("+10 points from 1 miss");
    expect(sheet().textContent).toContain("snack, burned with each try");
  });

  it("offers no try on a word that isn't staked, and says why", () => {
    show(fakeGame(vivid({ staked: false })).api);
    expect((tryButton() as HTMLButtonElement).disabled).toBe(true);
    expect(sheet().textContent).toContain("Stake it first to ascend.");
  });

  it("short of $WORD: the try is off, and one tap opens the sheet that gets more, with what it needs", () => {
    const g = fakeGame(vivid(), { canAfford: () => false });
    show(g.api);
    expect((tryButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Get more" }));
    expect(g.openSheet).toHaveBeenCalledWith({ kind: "balance", need: { amount: 202, action: "an ascension try" } });
  });

  it("after a try that ended paid and unfinished, says the next try finishes it first and takes no new fee", () => {
    // the store remembers such a word for the session; the sheet that showed it may be long gone
    show(fakeGame(vivid(), { unfinishedAscents: new Set(["VIVID"]) }).api);
    expect(sheet().textContent).toContain("Your last attempt is paid for. If it is still open, this try finishes it first and takes no new fee.");
    expect(sheet().textContent).not.toContain("snack, burned with each try");
    // the try itself is still there: an open attempt is finished by trying
    expect((tryButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("at the top of the ladder there is nothing to try", () => {
    show(fakeGame(vivid({ prestigeLevel: 5 })).api);
    expect(tryButton()).toBeNull();
    expect(sheet().textContent).toContain("stands at the top of the ladder");
  });

  it("closing goes back to the word's own sheet", () => {
    const g = fakeGame(vivid());
    show(g.api);
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
    expect(g.openSheet).toHaveBeenCalledWith({ kind: "word", word: "VIVID" });
  });
});

describe("while a try is out", () => {
  it("says “Attempting ascension”, never “Ascending”, and takes no second tap", () => {
    const g = fakeGame(vivid());
    show(g.api);
    fireEvent.click(tryButton()!);
    const waiting = screen.getByRole("button", { name: "Attempting ascension…" }) as HTMLButtonElement;
    expect(waiting.disabled).toBe(true);
    expect(sheet().textContent).not.toMatch(/Ascending/);
    expect(tryButton()).toBeNull();
    expect(g.prestige).toHaveBeenCalledTimes(1);
  });

  it("the letters can't look: every one is in the rig's rolling state", () => {
    show(fakeGame(vivid()).api);
    fireEvent.click(tryButton()!);
    const tiles = [...sheet().querySelectorAll("[aria-label*='tile']")];
    expect(tiles).toHaveLength(5);
    for (const t of tiles) expect(t.getAttribute("aria-label")).toContain("rolling");
  });

  it("keeps the stage it had at the tap, though the store has already moved on", () => {
    // the practice store applies a hit the moment it is drawn; a words read can land mid-flight
    const g = fakeGame(vivid());
    const view = show(g.api);
    fireEvent.click(tryButton()!);
    const moved = { ...g.api, state: { ...g.api.state, words: [vivid({ prestigeLevel: 2 })] } } as GameApi;
    view.rerender(
      <GameCtx.Provider value={moved}>
        <AscendSheet word="VIVID" />
      </GameCtx.Provider>,
    );
    expect(sheet().textContent).toContain("Gilded 1");
    expect(sheet().textContent).not.toContain("Gilded 3");
    for (const t of sheet().querySelectorAll("[aria-label*='tile']")) expect(t.getAttribute("aria-label")).toContain("gilded 1");
  });
});

describe("a result", () => {
  it("a hit passes along the word letter by letter, then names the new stage and offers the next", async () => {
    const g = fakeGame(vivid());
    show(g.api);
    fireEvent.click(tryButton()!);
    g.settle({ status: "resolved", success: true });
    // two letters in: they cheer in their new gold; the rest still can't look, in the old
    await pass(230);
    const labels = [...sheet().querySelectorAll("[aria-label*='tile']")].map((t) => t.getAttribute("aria-label")!);
    expect(labels.filter((l) => l.includes("celebrate") && l.includes("gilded 2"))).toHaveLength(2);
    expect(labels.filter((l) => l.includes("rolling") && l.includes("gilded 1"))).toHaveLength(3);
    // nothing is said until the last letter has it
    expect(sheet().textContent).not.toContain("Gilded 2!");
    expect(screen.getByRole("button", { name: "Attempting ascension…" })).toBeTruthy();
    await pass(400);
    expect(sheet().textContent).toContain("Gilded 2!");
    // the next try is the next stage's: its price (3 × the base, plus the snack) and its first-try odds
    expect(screen.getByRole("button", { name: "Try for Gilded 3 · 302 $WORD" })).toBeTruthy();
    expect(sheet().textContent).toContain("30%");
  });

  it("the cheer ends, and the word stands at rest in its new gold", async () => {
    const g = fakeGame(vivid());
    show(g.api);
    fireEvent.click(tryButton()!);
    g.settle({ status: "resolved", success: true });
    await pass(4000);
    for (const t of sheet().querySelectorAll("[aria-label*='tile']")) {
      expect(t.getAttribute("aria-label")).toContain("idle");
      expect(t.getAttribute("aria-label")).toContain("gilded 2");
    }
    expect(sheet().textContent).toContain("Gilded 2!");
  });

  it("a hit at the top offers no further try", async () => {
    const g = fakeGame(vivid({ prestigeLevel: 4 }));
    show(g.api);
    fireEvent.click(tryButton()!);
    g.settle({ status: "resolved", success: true });
    await pass(700);
    expect(sheet().textContent).toContain("Holographic!");
    expect(tryButton()).toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  });

  it("a miss says the word is untouched, shows the raised odds at once, and offers the same try again", async () => {
    const g = fakeGame(vivid());
    show(g.api);
    fireEvent.click(tryButton()!);
    g.settle({ status: "resolved", success: false });
    await pass(700);
    expect(sheet().textContent).toContain("Held its ground");
    expect(sheet().textContent).toContain("VIVID is untouched");
    // 35% first try, one miss: 45%, before any store read says so
    expect(sheet().textContent).toContain("45%");
    fireEvent.click(screen.getByRole("button", { name: "Try again · 202 $WORD" }));
    expect(g.prestige).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Attempting ascension…" })).toBeTruthy();
  });

  it("shows the chain's own numbers when the store hands them over, never a guessed miss", async () => {
    // A signed success that no longer counted (the word was unstaked or moved before the reveal):
    // no hit, and no miss added either. The store read the pity with the reveal: still 2. Guessing
    // "a miss, so one more" showed 65% for a word whose next try is 55% (Bugbot on #229).
    const g = fakeGame(vivid({ prestigePity: 2 }));
    show(g.api);
    fireEvent.click(tryButton()!);
    g.settle({ status: "resolved", success: false, stage: { level: 1, pity: 2 } });
    await pass(700);
    expect(sheet().textContent).toContain("Held its ground");
    expect(sheet().textContent).toContain("55%");
    expect(sheet().textContent).not.toContain("65%");
    expect(sheet().textContent).toContain("+20 points from 2 misses");
  });

  it("a hit shows the stage the chain read back", async () => {
    const g = fakeGame(vivid());
    show(g.api);
    fireEvent.click(tryButton()!);
    g.settle({ status: "resolved", success: true, stage: { level: 2, pity: 0 } });
    await pass(700);
    expect(sheet().textContent).toContain("Gilded 2!");
    expect(screen.getByRole("button", { name: "Try for Gilded 3 · 302 $WORD" })).toBeTruthy();
  });

  it("nothing spent (a cancelled prompt, or an earlier attempt finished instead) is ready again, never a miss", async () => {
    const g = fakeGame(vivid());
    show(g.api);
    fireEvent.click(tryButton()!);
    g.settle({ status: "not-started" });
    await pass(50);
    expect(sheet().textContent).not.toContain("Held its ground");
    expect(screen.getByRole("button", { name: "Try for Gilded 2 · 202 $WORD" })).toBeTruthy();
  });
});

describe("paid, and not known to be finished", () => {
  it("a stranded try shows its note and offers no other try", async () => {
    const g = fakeGame(vivid());
    show(g.api);
    fireEvent.click(tryButton()!);
    g.settle({ status: "stranded", note: "Your attempt is finishing onchain. It’ll show in a moment." });
    await pass(50);
    expect(sheet().textContent).toContain("Still finishing");
    expect(sheet().textContent).toContain("Your attempt is finishing onchain.");
    expect(tryButton()).toBeNull();
  });

  it("a rejection says nothing about the fee, so it is treated as paid: no other try", async () => {
    const g = fakeGame(vivid());
    show(g.api);
    fireEvent.click(tryButton()!);
    g.fail(new Error("rpc"));
    await pass(50);
    expect(sheet().textContent).toContain("Still finishing");
    expect(tryButton()).toBeNull();
  });
});

describe("in the practice game", () => {
  /** The practice store's own VIVID (staked, all UPPERCASE, Gilded 1), with the sheet over it. */
  let g!: GameApi;
  let open = true;
  function Host() {
    g = useGame();
    return open ? <AscendSheet word="VIVID" /> : null;
  }
  beforeEach(() => {
    open = true;
  });

  it("a try takes its fee at the tap, lets the letters be nervous for a moment, then shows the store's result", async () => {
    render(
      <GameProvider>
        <Host />
      </GameProvider>,
    );
    const before = g.state.balance;
    const at = g.state.words.find((w) => w.word === "VIVID")!;
    fireEvent.click(tryButton()!);
    expect(g.state.balance).toBeLessThan(before);
    expect(screen.getByRole("button", { name: "Attempting ascension…" })).toBeTruthy();
    await pass(2200);
    const now = g.state.words.find((w) => w.word === "VIVID")!;
    const hit = now.prestigeLevel > at.prestigeLevel;
    expect(sheet().textContent).toContain(hit ? "Gilded 2!" : "Held its ground");
    // no toast says it a second time
    expect(g.state.toasts).toHaveLength(0);
  });

  it("a sheet closed before the result showed says it in a toast on the way out, once", async () => {
    // the practice store applied the result at the tap; without this it was never said at all
    const view = render(
      <GameProvider>
        <Host />
      </GameProvider>,
    );
    const at = g.state.words.find((w) => w.word === "VIVID")!;
    fireEvent.click(tryButton()!);
    await pass(300);
    open = false;
    view.rerender(
      <GameProvider>
        <Host />
      </GameProvider>,
    );
    await pass(3000);
    const now = g.state.words.find((w) => w.word === "VIVID")!;
    const hit = now.prestigeLevel > at.prestigeLevel;
    expect(g.state.toasts.map((t) => t.text)).toEqual([hit ? "VIVID reached Gilded 2" : "VIVID held its ground. Next try’s odds are higher"]);
  });

  it("a sheet closed after the result showed says nothing more", async () => {
    const view = render(
      <GameProvider>
        <Host />
      </GameProvider>,
    );
    fireEvent.click(tryButton()!);
    await pass(2200);
    open = false;
    view.rerender(
      <GameProvider>
        <Host />
      </GameProvider>,
    );
    await pass(500);
    expect(g.state.toasts).toHaveLength(0);
  });
});
