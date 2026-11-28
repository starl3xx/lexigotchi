/**
 * A word's status as three marks, always in the same order and place (decisions.md #39; the
 * "Cards, Scenes, and Logo" proposal, starl3xx, 2026-11-25: "placard looks great"):
 *
 *   Fed · Jackpot · Earns
 *
 * It replaces the one sentence in a speech bubble over the scene ("TEASE is full, in the jackpot,
 * and earning $WORD."): three facts that had to be read out of one line, in a bubble that covered
 * the art and existed on Today only. Each mark is a few words and the colour of its meaning:
 * teal for care and growth, gold for chance (and for "soon"), candy when it needs the player now,
 * quiet when there is nothing to say yet. The same marks follow the word everywhere: in full on the
 * Today placard and the word's sheet, as three small icons in the Bag.
 *
 * Pure, so every wording is tested. A mark never names the word: the card above it does.
 */
import type { Hunger, OwnedWord } from "./state";
import type { StageMood } from "./stagePick";

export type MarkTone = "teal" | "gold" | "candy" | "quiet";
export type MarkKey = "fed" | "jackpot" | "earns";
export interface StageMark {
  key: MarkKey;
  /** what the mark is about: its small label, and its name for a screen reader */
  about: string;
  value: string;
  tone: MarkTone;
}

export interface MarkInput {
  mood: StageMood;
  /** letters raised to UPPERCASE, of how many */
  raised: number;
  of: number;
  /** days since it last ate (a staked word) */
  daysUnfed: number;
  /** it ate a moment ago, and is still chewing on stage */
  justFed?: boolean;
  /** what it earned at the latest payout, already formatted ("40.2K", "today"), when it earned something */
  earned?: { amount: string; when: string };
}

export function stageMarks(i: MarkInput): [StageMark, StageMark, StageMark] {
  const all = i.raised >= i.of;
  const left = i.of - i.raised;
  const raise = `Raise ${left} more ${left === 1 ? "letter" : "letters"}`;

  const fed: StageMark =
    i.mood === "full"
      ? { key: "fed", about: "Awake", value: i.justFed ? "Awake again" : "Wide awake", tone: "teal" }
      : i.mood === "peckish"
        ? { key: "fed", about: "Awake", value: `Sleepy, day ${i.daysUnfed}`, tone: "gold" }
        : i.mood === "hungry"
          ? { key: "fed", about: "Awake", value: `Asleep, day ${i.daysUnfed}`, tone: "candy" }
          : i.mood === "forSale"
            ? { key: "fed", about: "Awake", value: "For sale", tone: "quiet" }
            : { key: "fed", about: "Awake", value: "Not staked", tone: "quiet" };

  // "In the running", never a draw or a ticket (docs/messaging.md). A word is in while it is staked and fed.
  const jackpot: StageMark =
    i.mood === "full" || i.mood === "peckish"
      ? { key: "jackpot", about: "Jackpot", value: "In the running", tone: "gold" }
      : i.mood === "hungry"
        ? { key: "jackpot", about: "Jackpot", value: "Out while asleep", tone: "candy" }
        : i.mood === "forSale"
          ? { key: "jackpot", about: "Jackpot", value: "Out while for sale", tone: "quiet" }
          : { key: "jackpot", about: "Jackpot", value: "Stake to enter", tone: "quiet" };

  // Only an all-UPPERCASE word earns, staked and not hungry; a peckish one earns half.
  const earns: StageMark =
    i.mood === "forSale"
      ? { key: "earns", about: "Earns", value: "Nothing while for sale", tone: "quiet" }
      : i.mood === "unstaked"
        ? { key: "earns", about: "Earns", value: all ? "Stake to earn" : raise, tone: "quiet" }
        : !all
          ? { key: "earns", about: "Earns", value: raise, tone: "quiet" }
          : i.mood === "full"
            ? { key: "earns", about: "Earns", value: i.earned ? `+${i.earned.amount} ${i.earned.when}` : "$WORD every day", tone: "teal" }
            : i.mood === "peckish"
              ? { key: "earns", about: "Earns", value: "Half while sleepy", tone: "gold" }
              : { key: "earns", about: "Earns", value: "Nothing while asleep", tone: "candy" };

  return [fed, jackpot, earns];
}

/** A word's mood away from the Today stage (the Bag, its sheet): how hungry it is if staked, else whether it is for sale. */
export function moodOfWord(word: Pick<OwnedWord, "staked">, hungerNow: Hunger, forSale: boolean): StageMood {
  if (!word.staked) return forSale ? "forSale" : "unstaked";
  return hungerNow === "fed" ? "full" : hungerNow;
}

/** What the marks need to know of a word. */
export function markInput(word: Pick<OwnedWord, "upper" | "daysUnfed">, mood: StageMood, more: Pick<MarkInput, "justFed" | "earned"> = {}): MarkInput {
  return { mood, raised: word.upper.filter(Boolean).length, of: word.upper.length, daysUnfed: word.daysUnfed, ...more };
}

/** The marks as one sentence, for a screen reader and a tooltip: "Fed: Full. Jackpot: In the running. Earns: $WORD every day." */
export function marksSentence(marks: readonly StageMark[]): string {
  return marks.map((m) => `${m.about}: ${m.value}.`).join(" ");
}
