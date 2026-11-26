/**
 * The ascend sheet's rules (src/components/game/ascendFlow.ts). The one that costs players money
 * if it breaks: a try is paid whatever it gives back, so another try is offered only after a
 * result, never after "paid, and we lost track of it".
 */
import { describe, it, expect } from "vitest";
import { ascendDoor, nextTry, phaseAfter, resultToast, shownStage, stageAfter, strandedToast, waveOf } from "@/components/game/ascendFlow";

describe("phaseAfter", () => {
  it("a result is a hit or a miss", () => {
    expect(phaseAfter({ status: "resolved", success: true })).toBe("hit");
    expect(phaseAfter({ status: "resolved", success: false })).toBe("miss");
  });

  it("nothing spent goes back to ready: a cancelled wallet prompt, or an earlier attempt finished instead", () => {
    expect(phaseAfter({ status: "not-started" })).toBe("ready");
  });

  it("paid and unfinished is stranded, never ready and never a miss", () => {
    expect(phaseAfter({ status: "stranded", note: "x" })).toBe("stranded");
  });
});

describe("nextTry", () => {
  it("a miss can always try again: it never touches the word", () => {
    expect(nextTry("miss", 1, 5)).toBe("again");
  });

  it("a hit can go for the next stage, unless it reached the top", () => {
    expect(nextTry("hit", 2, 5)).toBe("next");
    expect(nextTry("hit", 5, 5)).toBeNull();
  });

  it("offers nothing while a try is out, and nothing on a stranded one (it would pay twice)", () => {
    expect(nextTry("trying", 1, 5)).toBeNull();
    expect(nextTry("stranded", 1, 5)).toBeNull();
    expect(nextTry("ready", 1, 5)).toBeNull();
  });

  it("offers nothing when ascension is off (the contract's maxLevel is 0)", () => {
    expect(nextTry("miss", 0, 0)).toBeNull();
  });
});

describe("stageAfter", () => {
  it("a hit starts the next stage with no misses; a miss adds one where it stands", () => {
    expect(stageAfter({ level: 1, pity: 3 }, true)).toEqual({ level: 2, pity: 0 });
    expect(stageAfter({ level: 1, pity: 3 }, false)).toEqual({ level: 1, pity: 4 });
  });
});

describe("shownStage", () => {
  const from = { level: 1, pity: 2 };

  it("holds the stage at the tap while a try is out, though the store has already moved", () => {
    // the practice store applies a result the moment it is drawn
    expect(shownStage("trying", { level: 2, pity: 0 }, from, null)).toBe(from);
  });

  it("shows what a result leaves until the store has caught up, then the store's own", () => {
    const expected = { level: 2, pity: 0 };
    const stale = { level: 1, pity: 2 };
    expect(shownStage("hit", stale, from, expected)).toBe(expected);
    const caught = { level: 2, pity: 0 };
    expect(shownStage("hit", caught, from, expected)).toBe(caught);
    // a store that is further on than the result wins too
    const further = { level: 3, pity: 1 };
    expect(shownStage("hit", further, from, expected)).toBe(further);
  });

  it("a miss shows its new pity at once", () => {
    expect(shownStage("miss", { level: 1, pity: 2 }, from, { level: 1, pity: 3 })).toEqual({ level: 1, pity: 3 });
  });

  it("is the store's own when nothing is out and nothing is expected", () => {
    const live = { level: 1, pity: 2 };
    expect(shownStage("ready", live, null, null)).toBe(live);
    expect(shownStage("stranded", live, from, { level: 2, pity: 0 })).toBe(live);
  });
});

describe("ascendDoor (the word sheet's button into the ascend sheet)", () => {
  it("opens for a word that can try, and stays shut for one that can't", () => {
    expect(ascendDoor({ canTry: true, atTop: false, unfinished: false })).toEqual({ label: "Ascend", open: true });
    expect(ascendDoor({ canTry: false, atTop: false, unfinished: false })).toEqual({ label: "Ascend", open: false });
  });

  it("is shut and says so at the top of the ladder", () => {
    expect(ascendDoor({ canTry: false, atTop: true, unfinished: false })).toEqual({ label: "Maxed", open: false });
  });

  it("a paid, unfinished attempt always has its door: unstaked since, or at the top, it still opens", () => {
    // the sheet finishes that attempt with no stake check; a shut button locked the only way to it
    expect(ascendDoor({ canTry: false, atTop: false, unfinished: true })).toEqual({ label: "Finish", open: true });
    expect(ascendDoor({ canTry: false, atTop: true, unfinished: true })).toEqual({ label: "Finish", open: true });
    expect(ascendDoor({ canTry: true, atTop: false, unfinished: true })).toEqual({ label: "Finish", open: true });
  });
});

describe("resultToast", () => {
  it("names the stage a hit reached, and Holographic by its own line", () => {
    expect(resultToast("VIVID", true, 2, false)).toEqual({ text: "VIVID reached Gilded 2", tone: "good" });
    expect(resultToast("VIVID", true, 5, false)).toEqual({ text: "VIVID turned Holographic!", tone: "good" });
  });

  it("a miss is not bad news in red: the word is untouched and its odds rose", () => {
    expect(resultToast("VIVID", false, 1, true)).toEqual({ text: "VIVID held its ground. Next try’s odds are higher", tone: "info" });
  });

  it("claims higher odds only when they are: not for a signed success that no longer counted, nor at the cap", () => {
    expect(resultToast("VIVID", false, 1, false)).toEqual({ text: "VIVID held its ground", tone: "info" });
  });
});

describe("strandedToast", () => {
  it("names the word over the note, for a try that ended unfinished after its sheet had gone", () => {
    expect(strandedToast("VIVID", "Your attempt is paid for. Reopen to finish it")).toBe("VIVID: Your attempt is paid for. Reopen to finish it");
  });
});

describe("waveOf", () => {
  it("the letters a result has reached wear it; the rest still can't look, in their old gold", () => {
    const { states, gilds } = waveOf(5, 2, "celebrate", 1, 2);
    expect(states).toEqual(["celebrate", "celebrate", "rolling", "rolling", "rolling"]);
    expect(gilds).toEqual([2, 2, 1, 1, 1]);
  });

  it("starts with every letter waiting, and ends with every letter told", () => {
    expect(waveOf(5, 0, "peckish", 3, 3).states).toEqual(Array(5).fill("rolling"));
    expect(waveOf(5, 5, "peckish", 3, 3).states).toEqual(Array(5).fill("peckish"));
  });
});
