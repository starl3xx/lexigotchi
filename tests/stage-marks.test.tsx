// @vitest-environment jsdom
/**
 * A word's three status marks (components/game/stageMarks, decisions.md #39): Fed, Jackpot, Earns,
 * always in that order, on the Today placard, the word's sheet, and (as icons) the Bag.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { markInput, marksSentence, moodOfWord, stageMarks, type MarkInput } from "@/components/game/stageMarks";
import { StatusMarks } from "@/components/game/StatusMarks";

afterEach(cleanup);

const ALL: Pick<MarkInput, "raised" | "of" | "daysUnfed"> = { raised: 5, of: 5, daysUnfed: 0 };
const values = (i: MarkInput) => stageMarks(i).map((m) => m.value);
const tones = (i: MarkInput) => stageMarks(i).map((m) => m.tone);

describe("a word's three marks", () => {
  it("are always Fed, Jackpot, Earns, in that order", () => {
    for (const mood of ["full", "peckish", "hungry", "unstaked", "forSale"] as const) {
      expect(stageMarks({ ...ALL, mood }).map((m) => [m.key, m.about])).toEqual([["fed", "Fed"], ["jackpot", "Jackpot"], ["earns", "Earns"]]);
    }
  });

  it("a full, all-UPPERCASE word: full, in the running, earning", () => {
    expect(values({ ...ALL, mood: "full" })).toEqual(["Full", "In the running", "$WORD every day"]);
    expect(tones({ ...ALL, mood: "full" })).toEqual(["teal", "gold", "teal"]);
  });

  it("says what it earned at the latest payout, when it earned something", () => {
    expect(values({ ...ALL, mood: "full", earned: { amount: "40.2K", when: "today" } })[2]).toBe("+40.2K today");
  });

  it("a word that just ate says so", () => {
    expect(values({ ...ALL, mood: "full", justFed: true })[0]).toBe("Full again");
  });

  it("a peckish word: still in the running, earning half, and it says which day", () => {
    expect(values({ ...ALL, mood: "peckish", daysUnfed: 2 })).toEqual(["Peckish, day 2", "In the running", "Half until fed"]);
    expect(tones({ ...ALL, mood: "peckish", daysUnfed: 2 })).toEqual(["gold", "gold", "gold"]);
  });

  it("a hungry word needs the player: out of the jackpot, earning nothing, all three in candy", () => {
    expect(values({ ...ALL, mood: "hungry", daysUnfed: 4 })).toEqual(["Hungry, day 4", "Out until fed", "Nothing until fed"]);
    expect(tones({ ...ALL, mood: "hungry", daysUnfed: 4 })).toEqual(["candy", "candy", "candy"]);
  });

  it("a word that isn't all UPPERCASE says what would make it earn, whatever its mood", () => {
    for (const mood of ["full", "peckish", "hungry", "unstaked"] as const) {
      expect(values({ mood, raised: 3, of: 5, daysUnfed: 1 })[2]).toBe("Raise 2 more letters");
      expect(tones({ mood, raised: 3, of: 5, daysUnfed: 1 })[2]).toBe("quiet");
    }
    expect(values({ mood: "full", raised: 4, of: 5, daysUnfed: 0 })[2]).toBe("Raise 1 more letter");
  });

  it("a word waiting to be staked: nothing to say yet, and how to start", () => {
    expect(values({ ...ALL, mood: "unstaked" })).toEqual(["Not staked", "Stake to enter", "Stake to earn"]);
    expect(tones({ ...ALL, mood: "unstaked" })).toEqual(["quiet", "quiet", "quiet"]);
  });

  it("a word for sale is out of both until it comes off the Market", () => {
    expect(values({ ...ALL, mood: "forSale" })).toEqual(["For sale", "Out while for sale", "Nothing while for sale"]);
  });

  it("never calls the jackpot a draw, a ticket, or a lottery (docs/messaging.md), and never names the word", () => {
    for (const mood of ["full", "peckish", "hungry", "unstaked", "forSale"] as const) {
      for (const raised of [0, 3, 5]) {
        const text = marksSentence(stageMarks({ mood, raised, of: 5, daysUnfed: 3 }));
        expect(text).not.toMatch(/\b(draw|ticket|lottery|yield)\b/i);
        expect(text).not.toMatch(/—/);
      }
    }
  });
});

describe("a word's mood away from the Today stage", () => {
  it("a staked word is as hungry as it is; an unstaked one is waiting, or for sale", () => {
    expect(moodOfWord({ staked: true }, "fed", false)).toBe("full");
    expect(moodOfWord({ staked: true }, "peckish", false)).toBe("peckish");
    expect(moodOfWord({ staked: true }, "hungry", false)).toBe("hungry");
    expect(moodOfWord({ staked: false }, "fed", false)).toBe("unstaked");
    expect(moodOfWord({ staked: false }, "fed", true)).toBe("forSale");
  });

  it("counts a word's raised letters from the word", () => {
    expect(markInput({ upper: [true, true, true, false, false], daysUnfed: 2 }, "peckish")).toEqual({ mood: "peckish", raised: 3, of: 5, daysUnfed: 2 });
  });
});

describe("the marks, drawn", () => {
  const marks = stageMarks({ ...ALL, mood: "hungry", daysUnfed: 3 });

  it("in full: each mark's label and its words, three in a row", () => {
    const { container } = render(<StatusMarks marks={marks} />);
    const items = [...container.querySelectorAll(".tm > .tm-mark")];
    expect(items.map((li) => li.textContent)).toEqual(["FedHungry, day 3", "JackpotOut until fed", "EarnsNothing until fed"]);
    expect(container.querySelector(".tm-compact")).toBeNull();
  });

  it("compact (the Bag): three icons, with every word of them for a screen reader and on hover", () => {
    const { container } = render(<StatusMarks marks={marks} compact />);
    const list = container.querySelector(".tm-compact")!;
    expect(list.getAttribute("aria-label")).toBe("Fed: Hungry, day 3. Jackpot: Out until fed. Earns: Nothing until fed.");
    const items = [...list.querySelectorAll(".tm-mark")];
    expect(items.map((li) => li.getAttribute("title"))).toEqual(["Fed: Hungry, day 3", "Jackpot: Out until fed", "Earns: Nothing until fed"]);
    expect(list.textContent).toBe(""); // the icons alone
  });

  it("wears the colour of each mark's meaning", () => {
    const { container } = render(<StatusMarks marks={stageMarks({ ...ALL, mood: "full" })} />);
    const cls = [...container.querySelectorAll(".tm-mark")].map((li) => li.className);
    expect(cls[0]).toContain("text-teal-ink");
    expect(cls[1]).toContain("text-gold-ink");
    expect(cls[2]).toContain("text-teal-ink");
  });
});
