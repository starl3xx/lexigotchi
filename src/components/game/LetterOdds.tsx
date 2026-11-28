"use client";
/**
 * Every letter's odds in a draw, the whole alphabet, A to Z (starl3xx, 2026-11-25: "mint letter odds
 * should show the whole alphabet in Mint tab, not styled as a card... the actual odds % per letter";
 * "order should be A-Z"). It replaced a card that pictured only the five most common letters and the
 * five rarest, with no numbers.
 *
 * - **The numbers are the draw's own** (lib/letterOdds.ts, the weights `drawLetters` uses), so the
 *   screen can't drift from what a pack does.
 * - **Actual, not nominal:** with the chain's supply (`available`, `caps`), a sold-out letter says so
 *   and shows no odds, and every other letter's odds are what they are WITHOUT it. A letter with a
 *   tenth of its supply or less left says how many (`isLow`); a plentiful one says nothing about
 *   supply (the owner: "only for the low ones").
 * - **It says what it knows.** `status` is the chain game's supply read: while it loads or after it
 *   fails the list shows the odds with every letter in the draw, and says that is what they are.
 * - **The copy says "pull", never "draw"** (the Mint tab's own word; docs/messaging.md keeps "draw"
 *   away from the player, where it reads as a lottery). The code keeps the draw's name.
 * - **Not a card:** a ruled heading and dashed rows (the Market's `Part`). The bars are gold, the
 *   game's color for chance. Still: 26 tiles, none of them moving (a list never does).
 */
import { ALPHABET, TOTAL_SLOTS } from "@/lib/economy";
import { PACK_DRAWS, fmtOdds, isLow, letterOdds, packsPer } from "@/lib/letterOdds";
import { article } from "@/lib/wordNeed";
import { TileCharacter } from "./TileCharacter";
import { Part } from "./market/bits";

/** "q", "q and x", "q, x, and z": every name, with the Oxford comma. */
function allOf(names: readonly string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * What the list says about the chain's supply read while it has no answer. The practice game has no
 * supply (and its disabled query reads as pending forever), so it is asked first.
 */
export function supplyStatus(chainBacked: boolean, hasData: boolean, isPending: boolean): "checking" | "failed" | undefined {
  if (!chainBacked || hasData) return undefined;
  return isPending ? "checking" : "failed";
}

export function LetterOdds({
  available,
  caps,
  status,
  className = "",
}: {
  /** Per letter, A to Z: how many can still be minted. Absent = every letter is in the draw. */
  available?: readonly number[];
  /** Per letter, A to Z: how many can ever exist, from the chain. Needed to call a letter low. */
  caps?: readonly number[];
  /** The chain game's supply read, while it has no answer: still loading, or failed. */
  status?: "checking" | "failed";
  className?: string;
}) {
  const odds = letterOdds(available);
  const max = Math.max(...odds);
  const soldOut = available ? ALPHABET.filter((_, i) => (available[i] ?? 0) <= 0).map((ch) => ch.toLowerCase()) : [];
  // The rarest letter still in the draw: the one a player asks "how often?" about.
  let rarest = -1;
  odds.forEach((p, i) => {
    if (p > 0 && (rarest < 0 || p < odds[rarest])) rarest = i;
  });

  return (
    <Part title="Letter odds" aside={`A pack is ${PACK_DRAWS} pulls`} className={className}>
      <p className="text-sm text-ink/70">
        Every pull gets one letter, at these odds. A letter’s odds are its share of the {TOTAL_SLOTS.toLocaleString("en-US")} letters in the
        dictionary’s words.
      </p>

      {/* A to Z, read DOWN each column: two columns on a phone, three from lg. */}
      <ul className="mt-2 grid auto-cols-fr grid-flow-col grid-rows-[repeat(13,auto)] gap-x-5 lg:grid-rows-[repeat(9,auto)] lg:gap-x-8">
        {ALPHABET.map((ch, i) => {
          const p = odds[i];
          const left = available?.[i];
          const gone = left !== undefined && left <= 0;
          const low = left !== undefined && caps?.[i] !== undefined && isLow(left, caps[i]);
          return (
            <li key={ch} data-letter={ch.toLowerCase()} className="flex items-center gap-2 border-b border-dashed border-ink/15 py-1.5">
              <span className="sr-only">{ch.toLowerCase()}:</span>
              <span aria-hidden className={`shrink-0 ${gone ? "opacity-35" : ""}`}>
                <TileCharacter char={ch.toLowerCase()} size={28} detail="tile" still />
              </span>
              <span className="min-w-0 flex-1">
                {gone ? (
                  <span className="text-xs font-bold text-ink/55">Sold out</span>
                ) : (
                  <>
                    {/* Scaled to the most common letter, with a floor so q's bar is still a bar. */}
                    <span aria-hidden className="block h-3 rounded-full border-2 border-ink bg-gold" style={{ width: `max(10px, ${(max > 0 ? p / max : 0) * 100}%)` }} />
                    {low && <span className="mt-0.5 block text-xs font-bold leading-tight text-candy-ink">{left!.toLocaleString("en-US")} left</span>}
                  </>
                )}
              </span>
              <span className="fig w-[3.25rem] shrink-0 text-right text-sm">{gone ? "–" : fmtOdds(p)}</span>
            </li>
          );
        })}
      </ul>

      <div className="mt-2 space-y-1 text-xs text-ink/60">
        {rarest >= 0 && (
          <p>
            About 1 pack in {Math.round(packsPer(odds[rarest])).toLocaleString("en-US")} has {article(ALPHABET[rarest])} {ALPHABET[rarest].toLowerCase()}.
          </p>
        )}
        {soldOut.length === ALPHABET.length ? (
          // Nothing is left to pull, so nothing "comes up more often" (Bugbot on #228).
          <p>Every letter is sold out, so nothing is left to pull. Letters still change hands in the Market.</p>
        ) : (
          soldOut.length > 0 && (
            <p>
              {soldOut.length > 4 ? `${soldOut.length} letters` : allOf(soldOut)} {soldOut.length === 1 ? "is" : "are"} sold out and can’t be pulled,
              so every other letter comes up more often. The odds above already count that.
            </p>
          )
        )}
        {status === "checking" && <p aria-live="polite">Checking which letters can still be pulled…</p>}
        {status === "failed" && <p>Couldn’t check which letters have sold out. These are the odds with none sold out; a sold-out letter is never pulled.</p>}
      </div>
    </Part>
  );
}
