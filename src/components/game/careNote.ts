/**
 * What staking does for a word, and why Feed is off when it is (the word sheet's care line).
 * Kept apart from the sheet so the wording rules are tested without rendering (tests/care-note.test.ts).
 */
import type { Hunger, OwnedWord } from "./state";
import { DEFAULT_PARAMS } from "@/lib/params";
import { pct } from "@/lib/howItWorks";

/**
 * What staking does for THIS word, and why Feed is off when it is. A tester read "Stake to earn" on
 * a word with 1/5 letters raised (staking enters the jackpot; only a fully UPPERCASE word earns
 * $WORD), and "fed" plus a greyed "Feed ✓" on a word nobody had fed (a staked word starts full).
 */
export function careNote(
  word: Pick<OwnedWord, "upper" | "staked" | "daysUnfed" | "lastFedAt">,
  h: Hunger,
  opts: { snackShort: string | null; nowSec: number; p?: typeof DEFAULT_PARAMS },
): { note: string; feedOff: string | null } {
  const p = opts.p ?? DEFAULT_PARAMS;
  const raised = word.upper.filter(Boolean).length;
  const full5 = raised === 5;
  const earns = full5 ? "" : ` It earns $WORD only once all 5 letters are UPPERCASE (${raised}/5 now).`;
  const part = p.care.peckishYieldFactor === 0.5 ? "half" : `${pct(p.care.peckishYieldFactor)} of its share`;

  if (!word.staked) {
    // The hunger clock keeps running while a word is unstaked (decisions.md, PR #101), so a
    // neglected word comes back peckish or hungry. Promise only what a restake actually gives.
    const feedOff = "Stake it first. Only a staked word can be fed.";
    if (h === "hungry") {
      return {
        note: `It went hungry while unstaked, so staking alone won’t enter it in the jackpot. Stake it, then feed it.${earns}`,
        feedOff,
      };
    }
    if (h === "peckish") {
      return {
        note: full5
          ? `Staking enters it in the daily jackpot, but it got peckish while unstaked: it earns ${part} until you feed it.`
          : `Staking enters it in the daily jackpot, but it got peckish while unstaked. Feed it soon after staking.${earns}`,
        feedOff,
      };
    }
    return {
      note: full5
        ? "Staking enters it in the daily jackpot and earns $WORD every day while it stays full. Feeding starts once it’s staked."
        : `Staking enters it in the daily jackpot.${earns} Feeding starts once it’s staked.`,
      feedOff,
    };
  }
  if (h === "hungry") {
    return {
      note: `Hungry: out of the jackpot${full5 ? " and earning nothing" : ""} until you feed it.${opts.snackShort ?? ""}`,
      feedOff: opts.snackShort ? "Not enough $WORD for a snack" : null,
    };
  }
  if (h === "peckish") {
    return {
      note: full5
        ? `Peckish: earning ${part} until you feed it. Still in the jackpot.${opts.snackShort ?? ""}`
        : `Peckish: still in the jackpot. Feed it before it goes hungry.${earns}${opts.snackShort ?? ""}`,
      feedOff: opts.snackShort ? "Not enough $WORD for a snack" : null,
    };
  }
  // Full: nothing to feed yet. Say when that changes, when the chain told us the exact time.
  let when = "";
  if (word.lastFedAt) {
    const left = word.lastFedAt + p.care.peckishAfterDays * 86_400 - opts.nowSec;
    if (left > 0) when = left >= 3_600 ? ` in about ${Math.ceil(left / 3_600)} hours` : ` in about ${Math.max(1, Math.ceil(left / 60))} minutes`;
  }
  return {
    note: `Full: in the daily jackpot${full5 ? " and earning $WORD every day" : ""}. No feeding needed until it gets peckish${when}.${earns}`,
    feedOff: "Not hungry yet",
  };
}

/**
 * The case badge on a word card and the word sheet. A fully UPPERCASE word earns only while it is
 * staked and not hungry (half while peckish), so the badge says what it earns NOW. It used to say
 * "UPPERCASE · earns yield" on a hungry or unstaked word, which earns nothing. The gold badge and
 * the raised tiles already say UPPERCASE, so the text is only the earning state: short enough to
 * fit the narrow Bounty card on one line.
 */
export function caseBadgeText(
  word: Pick<OwnedWord, "upper" | "staked">,
  h: Hunger,
  p: typeof DEFAULT_PARAMS = DEFAULT_PARAMS,
): string {
  const raised = word.upper.filter(Boolean).length;
  if (raised === 0) return "lowercase";
  if (raised < word.upper.length) return `${raised}/${word.upper.length} raised`;
  if (!word.staked) return "stake to earn";
  if (h === "hungry") return "feed to earn";
  if (h === "peckish") {
    return p.care.peckishYieldFactor === 0.5 ? "earns half" : `earns ${pct(p.care.peckishYieldFactor)}`;
  }
  return "earning $WORD";
}
