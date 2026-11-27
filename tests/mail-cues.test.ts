/**
 * Which sound an envelope makes, and when (src/components/game/mail/mailCues.ts, decisions.md #49
 * part 4). A cue comes from a STEP, never from what the envelope shows when it appears: an
 * envelope that waited, or one that came back by itself, must not press its stamp a second time.
 */
import { describe, it, expect } from "vitest";
import { CUE_GAP_MS, HOP_CLIMB, cuesForStep, type MailView } from "@/components/game/mail/mailCues";

const view = (over: Partial<MailView> = {}): MailView => ({ phase: "wallet", numbered: false, torn: false, fidget: false, out: 0, rareOut: false, word: false, ...over });
const names = (prev: MailView | null, next: MailView) => cuesForStep(prev, next).map((c) => c.cue);

describe("when the envelope appears", () => {
  it("drops in when its wallet prompt opens (the chain game)", () => {
    expect(names(null, view({ phase: "wallet" }))).toEqual(["drop"]);
  });

  it("drops in and takes its stamp when it arrives stamped (practice), one after the other", () => {
    const cues = cuesForStep(null, view({ phase: "paid" }));
    expect(cues.map((c) => c.cue)).toEqual(["drop", "stamp"]);
    expect(cues.map((c) => c.delay)).toEqual([0, CUE_GAP_MS]);
  });

  it("is silent when it appears further along: it was seen before, or it waited", () => {
    // came back by itself with its number on; opened from the card; stored and reopened; stranded
    expect(names(null, view({ phase: "found", numbered: true }))).toEqual([]);
    expect(names(null, view({ phase: "ready", numbered: true }))).toEqual([]);
    expect(names(null, view({ phase: "waiting" }))).toEqual([]);
    expect(names(null, view({ phase: "finishing", numbered: true }))).toEqual([]);
  });
});

describe("the marks", () => {
  it("the stamp, when the pack is sent", () => {
    expect(names(view({ phase: "wallet" }), view({ phase: "paid" }))).toEqual(["stamp"]);
  });

  it("the postmark, when the number is on", () => {
    expect(names(view({ phase: "paid" }), view({ phase: "found", numbered: true }))).toEqual(["postmark"]);
  });

  it("both, in order and apart, when a fast chain gives them in one step", () => {
    const cues = cuesForStep(view({ phase: "wallet" }), view({ phase: "found", numbered: true }));
    expect(cues.map((c) => c.cue)).toEqual(["stamp", "postmark"]);
    expect(cues[1].delay).toBeGreaterThan(cues[0].delay);
  });

  it("nothing when nothing changed, and nothing for becoming ready", () => {
    const found = view({ phase: "found", numbered: true });
    expect(names(found, found)).toEqual([]);
    expect(names(found, view({ phase: "ready", numbered: true }))).toEqual([]);
  });

  it("a pack that ends up waiting makes no sound of its own", () => {
    expect(names(view({ phase: "paid" }), view({ phase: "waiting" }))).toEqual([]);
  });
});

describe("the wait", () => {
  it("a rustle each time somebody shifts inside, quieter than the rest", () => {
    const still = view({ phase: "found", numbered: true });
    const cues = cuesForStep(still, { ...still, fidget: true });
    expect(cues).toEqual([{ cue: "rustle", gain: 0.5, delay: 0 }]);
    // settling again is silent
    expect(names({ ...still, fidget: true }, still)).toEqual([]);
  });
});

describe("the tear and the letters", () => {
  const ready = view({ phase: "ready", numbered: true });
  const torn = { ...ready, torn: true };

  it("the tear, once", () => {
    expect(names(ready, torn)).toEqual(["tear"]);
    expect(names(torn, torn)).toEqual([]);
  });

  it("a hop for each letter that comes out, climbing in pitch", () => {
    const rates = [1, 2, 3, 4].map((out) => cuesForStep({ ...torn, out: out - 1 }, { ...torn, out })[0]);
    expect(rates.map((c) => c.cue)).toEqual(["hop", "hop", "hop", "hop"]);
    expect(rates.map((c) => c.rate)).toEqual([1, 1 + HOP_CLIMB, 1 + 2 * HOP_CLIMB, 1 + 3 * HOP_CLIMB]);
  });

  it("ONE hop when a tap hurries several out at once: five at once would be a noise", () => {
    const cues = cuesForStep({ ...torn, out: 1 }, { ...torn, out: 5 });
    expect(cues.map((c) => c.cue)).toEqual(["hop"]);
  });

  it("the bell for the rare best letter, and it replaces that step's hop", () => {
    expect(names({ ...torn, out: 4 }, { ...torn, out: 5, rareOut: true })).toEqual(["rare"]);
    // hurried: plain letters and the rare one in the same step ring the bell once
    expect(names({ ...torn, out: 1 }, { ...torn, out: 5, rareOut: true })).toEqual(["rare"]);
  });

  it("the bell rings once: letters after the rare one hop", () => {
    expect(names({ ...torn, out: 1, rareOut: true }, { ...torn, out: 2, rareOut: true })).toEqual(["hop"]);
  });

  it("reduced motion shows the tear and every letter in one step: the tear, then one sound for the letters", () => {
    expect(names(ready, { ...torn, out: 5 })).toEqual(["tear", "hop"]);
    expect(names(ready, { ...torn, out: 5, rareOut: true })).toEqual(["tear", "rare"]);
  });
});

describe("the word", () => {
  const out = view({ phase: "ready", numbered: true, torn: true, out: 5 });

  it("when the count names a word the letters finish", () => {
    expect(names(out, { ...out, word: true })).toEqual(["word"]);
  });

  it("also when the word shows late, after the count is already up", () => {
    // the bag's read caught up a moment after the count appeared
    expect(names(out, out)).toEqual([]);
    expect(names(out, { ...out, word: true })).toEqual(["word"]);
  });

  it("never twice", () => {
    expect(names({ ...out, word: true }, { ...out, word: true })).toEqual([]);
  });
});

describe("a whole pack, step by step", () => {
  it("plays each cue once, in order", () => {
    const steps: MailView[] = [
      view({ phase: "wallet" }),
      view({ phase: "paid" }),
      view({ phase: "found", numbered: true }),
      view({ phase: "found", numbered: true, fidget: true }),
      view({ phase: "found", numbered: true }),
      view({ phase: "ready", numbered: true }),
      view({ phase: "ready", numbered: true, torn: true }),
      ...[1, 2, 3, 4].map((out) => view({ phase: "ready", numbered: true, torn: true, out })),
      view({ phase: "ready", numbered: true, torn: true, out: 5, rareOut: true }),
      view({ phase: "ready", numbered: true, torn: true, out: 5, rareOut: true, word: true }),
    ];
    const played: string[] = [];
    let prev: MailView | null = null;
    for (const next of steps) {
      played.push(...names(prev, next));
      prev = next;
    }
    expect(played).toEqual(["drop", "stamp", "postmark", "rustle", "tear", "hop", "hop", "hop", "hop", "rare", "word"]);
  });
});
