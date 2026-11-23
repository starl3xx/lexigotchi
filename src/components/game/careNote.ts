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
    return {
      note: full5
        ? "Staking enters it in the daily jackpot and earns $WORD every day while it stays full. Feeding starts once it’s staked."
        : `Staking enters it in the daily jackpot.${earns} Feeding starts once it’s staked.`,
      feedOff: "Stake it first. Only a staked word gets hungry.",
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
