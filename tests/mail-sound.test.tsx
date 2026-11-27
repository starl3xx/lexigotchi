// @vitest-environment jsdom
/**
 * The envelope's sounds, through the real sheet and the practice store (decisions.md #49, part 4).
 * The rules are pure and tested alone (tests/mail-cues.test.ts); this holds the wiring: each cue
 * once, in order, for a pack and for a daily letter; silence for an envelope that waited; and no
 * sound after the sheet has gone.
 */
import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

let reduce = false;
window.matchMedia = ((q: string) => ({ matches: reduce && /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

let soundIsOn = true;
const played: { cue: string; rate?: number }[] = [];
vi.mock("@/lib/sound", () => ({
  SOUND_READY: true,
  CUES: ["drop", "stamp", "postmark", "rustle", "tear", "hop", "rare", "word"],
  soundOn: () => soundIsOn,
  subscribeSound: () => () => {},
  setSoundOn: (v: boolean) => void (soundIsOn = v),
  wakeSound: () => {},
  holdSound: () => () => {},
  play: (cue: string, o: { rate?: number } = {}) => void played.push({ cue, rate: o.rate }),
}));
vi.mock("@/components/game/useMyName", () => ({ useMyName: () => null }));
vi.mock("@/components/game/useWorld", () => ({ useWorld: () => ({ data: undefined, isPending: false }), useMyWallets: () => new Set<string>(), shortAddress: (a: string) => a }));
vi.mock("@/components/game/useLetterSupply", () => ({ useLetterSupply: () => ({ data: undefined }) }));

const { GameProvider, useGame } = await import("@/components/game/state");
const { MailSheet } = await import("@/components/game/sheets/MailSheet");
const { PRACTICE_MAIL_MS, resetSitting } = await import("@/components/game/mail/mailFlow");
type GameApi = ReturnType<typeof useGame>;

let g!: GameApi;
function Host() {
  g = useGame();
  return g.state.sheet?.kind === "mail" ? <MailSheet /> : null;
}
const play = () =>
  render(
    <GameProvider>
      <Host />
    </GameProvider>,
  );
const strip = () => screen.getByRole("button", { name: "Tear the envelope open" }) as HTMLButtonElement;
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
/** Time passing as it does in a browser: a render between timers, not twelve seconds in one batch. */
const run = (ms: number) => {
  for (let t = 0; t < ms; t += 100) tick(100);
};
const cues = () => played.map((p) => p.cue);
const count = (cue: string) => cues().filter((c) => c === cue).length;

beforeEach(() => {
  reduce = false;
  soundIsOn = true;
  played.length = 0;
  resetSitting();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a pack", () => {
  it("drops, takes its stamp and its postmark, tears, and each letter hops, each cue in its place", () => {
    play();
    act(() => void g.buyPack());
    tick(400);
    expect(cues()).toEqual(["drop", "stamp"]);
    tick(PRACTICE_MAIL_MS.found);
    expect(cues()).toEqual(["drop", "stamp", "postmark"]);
    tick(PRACTICE_MAIL_MS.ready);
    // becoming ready is not a sound
    expect(cues()).toEqual(["drop", "stamp", "postmark"]);
    fireEvent.click(strip());
    tick(600);
    expect(count("tear")).toBe(1);
    run(12_000); // every letter out, and the count up
    const letters = cues().filter((c) => c === "hop" || c === "rare");
    expect(letters).toHaveLength(5);
    expect(count("rare")).toBeLessThanOrEqual(1);
    // the marks were pressed once, whatever came after
    expect(count("drop")).toBe(1);
    expect(count("stamp")).toBe(1);
    expect(count("postmark")).toBe(1);
    // the tear comes before any letter
    expect(cues().indexOf("tear")).toBeLessThan(cues().findIndex((c) => c === "hop" || c === "rare"));
    // the seeded first pack finishes a word: the count names it, once, after the letters
    expect(count("word")).toBe(1);
    expect(cues().at(-1)).toBe("word");
  });

  it("the hops climb in pitch along the pack", () => {
    play();
    act(() => void g.buyPack());
    tick(PRACTICE_MAIL_MS.ready + 50);
    fireEvent.click(strip());
    run(12_600);
    const rates = played.filter((p) => p.cue === "hop").map((p) => p.rate as number);
    expect(rates.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeGreaterThan(rates[i - 1]);
  });

  it("a tap that hurries the letters makes one sound for all that come out with it", () => {
    play();
    act(() => void g.buyPack());
    tick(PRACTICE_MAIL_MS.ready + 50);
    fireEvent.click(strip());
    tick(700); // the strip is off, and the first letter may be out
    const before = cues().filter((c) => c === "hop" || c === "rare").length;
    fireEvent.click(document.querySelector(".mail-lift")!);
    tick(50);
    const after = cues().filter((c) => c === "hop" || c === "rare").length;
    expect(after - before).toBe(1);
  });

  it("with reduced motion: the tear, then one sound for the letters", () => {
    reduce = true;
    play();
    act(() => void g.buyPack());
    tick(PRACTICE_MAIL_MS.ready + 50);
    played.length = 0;
    fireEvent.click(strip());
    run(800);
    expect(cues().filter((c) => c !== "word")).toEqual(["tear", expect.stringMatching(/^(hop|rare)$/)]);
  });
});

describe("a daily letter", () => {
  it("makes the same marks, and one sound for its one letter", () => {
    play();
    act(() => void g.dailyMint());
    tick(PRACTICE_MAIL_MS.ready + 50);
    expect(cues()).toEqual(["drop", "stamp", "postmark"]);
    fireEvent.click(strip());
    run(8_000);
    expect(count("tear")).toBe(1);
    expect(cues().filter((c) => c === "hop" || c === "rare")).toHaveLength(1);
  });
});

describe("an envelope that waited", () => {
  it("is silent when it is opened again: its stamp and postmark were pressed before", () => {
    reduce = true;
    play();
    act(() => void g.buyPack());
    tick(PRACTICE_MAIL_MS.ready + 50);
    act(() => g.closeSheet());
    played.length = 0;
    act(() => g.openPending());
    tick(1_000);
    expect(cues()).toEqual([]);
    fireEvent.click(strip());
    run(800);
    expect(cues()[0]).toBe("tear");
  });

  it("is silent when it comes back by itself", () => {
    play();
    act(() => void g.buyPack());
    tick(300);
    act(() => g.closeSheet()); // closed while it is on its way
    played.length = 0;
    tick(PRACTICE_MAIL_MS.ready + 50); // it lands, and its sheet opens again
    expect(g.state.sheet).toEqual({ kind: "mail" });
    expect(cues()).toEqual([]);
  });
});

describe("nothing outlives the envelope", () => {
  it("closing the sheet while the letters climb out stops the sounds", () => {
    play();
    act(() => void g.buyPack());
    tick(PRACTICE_MAIL_MS.ready + 50);
    fireEvent.click(strip());
    tick(900);
    act(() => g.closeSheet());
    const heard = played.length;
    tick(15_000);
    expect(played.length).toBe(heard);
  });

  it("a cue still waiting for its moment is dropped with the sheet", () => {
    play();
    act(() => void g.buyPack()); // drop now, stamp a moment later
    expect(cues()).toEqual(["drop"]);
    act(() => g.closeSheet());
    tick(2_000);
    expect(cues()).toEqual(["drop"]);
  });
});

describe("a development build's double mount", () => {
  // React mounts, unmounts, and mounts again in development. A waiting cue that was cancelled at
  // the "unmount" was lost for good: the stamp never sounded (seen in a real browser).
  it("still plays the stamp after the drop, and each once", () => {
    render(
      <StrictMode>
        <GameProvider>
          <Host />
        </GameProvider>
      </StrictMode>,
    );
    act(() => void g.buyPack());
    run(400);
    expect(cues()).toEqual(["drop", "stamp"]);
    run(PRACTICE_MAIL_MS.found);
    expect(cues()).toEqual(["drop", "stamp", "postmark"]);
  });
});

describe("sound off", () => {
  it("plays nothing at all", () => {
    soundIsOn = false;
    play();
    act(() => void g.buyPack());
    tick(PRACTICE_MAIL_MS.ready + 50);
    fireEvent.click(strip());
    tick(12_000);
    expect(played).toEqual([]);
  });
});
