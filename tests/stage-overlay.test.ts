/**
 * A word's new stage, or its miss, shows at once, before the slower words read
 * (src/lib/onchain/stageOverlay.ts). A hit that keeps its old gold reads as "nothing happened",
 * and "try again" from the old stage would show the wrong price and odds.
 */
import { describe, it, expect } from "vitest";
import { HOLD_MS, caughtUp, overlayStage, pruneStageNotes, pruneUnfinished } from "@/lib/onchain/stageOverlay";

describe("caughtUp", () => {
  it("is the stage first, then the misses at that stage", () => {
    expect(caughtUp({ level: 1, pity: 2 }, { level: 1, pity: 2 })).toBe(true);
    expect(caughtUp({ level: 1, pity: 3 }, { level: 1, pity: 2 })).toBe(true);
    expect(caughtUp({ level: 1, pity: 1 }, { level: 1, pity: 2 })).toBe(false);
  });

  it("a hit starts the next stage at zero, which is still past every miss of the stage before", () => {
    expect(caughtUp({ level: 2, pity: 0 }, { level: 1, pity: 4 })).toBe(true);
    expect(caughtUp({ level: 1, pity: 4 }, { level: 2, pity: 0 })).toBe(false);
  });
});

describe("overlayStage", () => {
  const stale = { level: 1, pity: 2 };

  it("shows a hit over a words read that still has the old stage", () => {
    expect(overlayStage(stale, { level: 2, pity: 0, at: 1_000 }, 2_000)).toEqual({ level: 2, pity: 0 });
  });

  it("shows a miss's new pity over a words read that still has the old one", () => {
    expect(overlayStage(stale, { level: 1, pity: 3, at: 1_000 }, 2_000)).toEqual({ level: 1, pity: 3 });
  });

  it("is the chain's own answer with no note, and once the chain is at or past the note", () => {
    expect(overlayStage(stale, undefined, 0)).toBe(stale);
    const ahead = { level: 3, pity: 1 };
    expect(overlayStage(ahead, { level: 2, pity: 0, at: 0 }, 10)).toBe(ahead);
  });

  it("trusts the chain again once the note is older than the hold", () => {
    expect(overlayStage(stale, { level: 2, pity: 0, at: 0 }, HOLD_MS + 1)).toBe(stale);
  });
});

describe("pruneUnfinished", () => {
  const marks = { vivid: { level: 1, pity: 2 } };

  it("keeps the mark while the word stands where it did when the try was made", () => {
    expect(pruneUnfinished({ vivid: { level: 1, pity: 2 } }, marks)).toBe(marks);
  });

  it("drops it once the read shows the word past that: the reveal landed on its own", () => {
    expect(pruneUnfinished({ vivid: { level: 1, pity: 3 } }, marks)).toEqual({}); // a late miss
    expect(pruneUnfinished({ vivid: { level: 2, pity: 0 } }, marks)).toEqual({}); // a late hit
  });

  it("keeps it when the read is only behind the mark: the read lags, the attempt hasn't moved", () => {
    // the try was made from a stage the store had just read back (level 2), before the words read caught up
    const fresh = { vivid: { level: 2, pity: 0 } };
    expect(pruneUnfinished({ vivid: { level: 1, pity: 4 } }, fresh)).toBe(fresh);
  });

  it("drops the mark of a word that left the bag", () => {
    expect(pruneUnfinished({}, marks)).toEqual({});
  });
});

describe("pruneStageNotes", () => {
  it("drops a note the words read caught up with, and keeps one it hasn't", () => {
    const notes = { funky: { level: 2, pity: 0, at: 0 }, vivid: { level: 1, pity: 3, at: 0 } };
    const pruned = pruneStageNotes({ funky: { level: 2, pity: 0 }, vivid: { level: 1, pity: 2 } }, notes, 10);
    expect(pruned).toEqual({ vivid: notes.vivid });
  });

  it("drops a note for a word that left the bag, and one that aged out", () => {
    const notes = { gone: { level: 2, pity: 0, at: 0 }, old: { level: 2, pity: 0, at: 0 } };
    expect(pruneStageNotes({ old: { level: 1, pity: 0 } }, notes, HOLD_MS + 1)).toEqual({});
  });

  it("hands back the same object when nothing changes, so a state setter can skip the render", () => {
    const notes = { vivid: { level: 1, pity: 3, at: 0 } };
    expect(pruneStageNotes({ vivid: { level: 1, pity: 2 } }, notes, 10)).toBe(notes);
  });
});
