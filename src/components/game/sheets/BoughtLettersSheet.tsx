"use client";
/**
 * Letters bought on the Market arrive (starl3xx, 2026-11-25: a purchase used to end with a toast).
 * They hop in the way a pack's letters do, over what the player paid, and the sheet says the one
 * thing a buyer wants next: the word these letters finish. That is what most letters are bought
 * for (the Market's "For you" picks a letter the bag is one short of), so the claim is right here.
 *
 * "Now you can spell" is only said of a word the bag could NOT spell before these letters came: a
 * word it could already spell is in Today's next steps, and saying "now" of it would be untrue.
 */
import { useMemo } from "react";
import { isUpperId, letterLabel, letterOf, rarestFirst, rarestFirstBy } from "@/lib/market/deals";
import { Button, Sheet, TierBadge } from "../primitives";
import { LetterTile, WordTiles } from "../LetterTile";
import { claimCase, fmtWord, mineLower, mineUpper, spellableNow, useGame } from "../state";
import { useTakenWords } from "../useTodayPlan";
import { useWorld } from "../useWorld";
import { useAmount } from "../market/bits";
import { useTierOf } from "../useRarity";
import { claimAction } from "@/lib/claimFee";

/**
 * Tiles drawn before the rest become a number (a listing can sell thousands of one letter): up to
 * five stand in a row on a phone; past that, four and "+N", so the number is never a lone "+1".
 */
const ROW = 5;
/** One letter stands at full size, limbs and all; a row keeps its faces (the rig drops them under 60 px). */
const tileSize = (shown: number) => (shown === 1 ? 104 : shown <= 3 ? 72 : 60);

/**
 * The words these letters newly finish, rarest first: the order of the Market's own
 * `oneLetterShort` (lib/market/deals `rarestFirst`, the one comparator both use), so an "An x
 * finishes UNBOX" pick ends on UNBOX here. Pure, so the rule is tested. `lower`/`upper` are the bag as it reads now, and `had` is how many of the letter the
 * wallet held before the purchase.
 *
 * "Before" is the bag with that letter set back to `had`, never "now minus `count`": a bag that
 * hasn't caught up with the chain still holds only the old copies, and taking `count` off THOSE
 * called words the player could already spell new (Bugbot on #223). Until the bag shows
 * `had + count` of the letter, nothing is named: the sheet draws again when the bag lands.
 */
export function newlySpellable(
  lower: readonly number[],
  upper: readonly number[],
  letterId: number,
  count: number,
  had: number,
  taken: ReadonlySet<string>,
  order: (a: string, b: string) => number = rarestFirst,
): { word: string; cases: boolean[] }[] {
  return newlySpellableWith(lower, upper, [{ letterId, count, had }], taken, order);
}

/**
 * The same, for several letters arriving at once (a pack in the mail): the words the bag can spell
 * now and could not before ANY of them came. The same two rules hold for each letter: "before" is
 * the bag with that letter set back to `had`, and nothing at all is named until the bag shows
 * `had + count` of every one of them (a bag that hasn't caught up with the chain would call words
 * the player could already spell new).
 */
export function newlySpellableWith(
  lower: readonly number[],
  upper: readonly number[],
  added: readonly { letterId: number; count: number; had: number }[],
  taken: ReadonlySet<string>,
  /** Rarest first. The game passes the order with its own tiers on top (`rarestFirstBy`), so a collab word sorts as Legendary. */
  order: (a: string, b: string) => number = rarestFirst,
): { word: string; cases: boolean[] }[] {
  const before = { lower: lower.slice(), upper: upper.slice() };
  for (const { letterId, count, had } of added) {
    const i = letterId % 26;
    const side = isUpperId(letterId) ? before.upper : before.lower;
    if ((side[i] ?? 0) < had + count) return [];
    side[i] = had;
  }
  const was = new Set(spellableNow(before.lower, before.upper, taken, Infinity));
  return spellableNow(lower, upper, taken, Infinity)
    .filter((w) => !was.has(w))
    .sort(order)
    .map((word) => ({ word, cases: claimCase(word, upper) }));
}

export function BoughtLettersSheet({ letterId, count, unitPrice, had }: { letterId: number; count: number; unitPrice: number; had: number }) {
  const tierOf = useTierOf();
  const g = useGame();
  const { state } = g;
  const amount = useAmount();
  const taken = useTakenWords();
  const world = useWorld();
  const lower = mineLower(state);
  const upper = mineUpper(state);
  // In the chain game a word someone else owns can't be claimed, so while the world's owners are
  // still loading the sheet says it is checking, and names nothing. If that read FAILED, it does
  // what Spell does (useTakenWords: only the player's own words are taken), so the claim is never
  // hidden for good (Bugbot on #223).
  const checking = state.chainBacked && !world.data?.owners && world.isPending === true;
  const fresh = useMemo(
    () => (checking ? [] : newlySpellable(lower, upper, letterId, count, had, taken, rarestFirstBy(tierOf))),
    [checking, lower, upper, letterId, count, had, taken, tierOf],
  );
  const first = fresh[0];
  const name = letterLabel(letterId);
  const shown = count <= ROW ? count : ROW - 1;
  // The fee for THIS word, by its tier (decisions.md #60).
  const claim = first ? g.claimFee(first.word) : g.tierClaimFee("Common");

  return (
    <Sheet open onClose={g.closeSheet} title="Congrats!">
      <div className="flex flex-col items-center gap-3 pb-2 text-center">
        <div className="flex flex-wrap items-center justify-center gap-2 pt-3">
          {Array.from({ length: shown }, (_, k) => (
            <div key={k} className="animate-drop" style={{ animationDelay: `${k * 0.11}s` }}>
              <LetterTile char={letterOf(letterId)} upper={isUpperId(letterId)} size={tileSize(shown)} state="celebrate" />
            </div>
          ))}
          {count > shown && (
            <span className="animate-drop font-display text-xl font-extrabold text-ink/70" style={{ animationDelay: `${shown * 0.11}s` }}>
              +{(count - shown).toLocaleString("en-US")}
            </span>
          )}
        </div>
        <div className="font-display text-2xl font-extrabold">{count === 1 ? `${name} is yours.` : `${count.toLocaleString("en-US")} × ${name} are yours.`}</div>
        <p className="text-sm text-ink/70">
          Bought for <strong className="font-display text-ink">{amount(unitPrice * count)}</strong>
          {count > 1 ? `, ${fmtWord(unitPrice)} each.` : "."}
        </p>

        {first ? (
          <div className="w-full border-t-2 border-dashed border-ink/25 pt-3">
            <p className="text-sm text-ink/70">Now you can spell</p>
            <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2">
              <WordTiles word={first.word} upper={first.cases} size={38} still />
              <TierBadge tier={tierOf(first.word)} />
            </div>
            {fresh.length > 1 && (
              <button
                type="button"
                className="mt-2 text-xs font-bold text-teal-ink underline"
                onClick={() => {
                  g.closeSheet();
                  g.nav("claim");
                }}
              >
                and {fresh.length - 1} more new {fresh.length === 2 ? "word" : "words"} on Spell
              </button>
            )}
            <div className="mt-3 flex w-full gap-2">
              {/* Narrow, so "Claim UNBOX · 2.12M" keeps one line on a phone. */}
              <Button variant="ghost" className="shrink-0 px-5" onClick={g.closeSheet}>
                Later
              </Button>
              {g.canAfford(claim) ? (
                <Button
                  variant="teal"
                  className="flex-1"
                  onClick={() => {
                    g.closeSheet();
                    g.claim(first.word, first.cases);
                  }}
                >
                  Claim {first.word} · {fmtWord(claim)}
                </Button>
              ) : (
                <Button variant="primary" className="flex-1" onClick={() => g.openSheet({ kind: "balance", need: { amount: claim, action: claimAction(tierOf(first.word)) } })}>
                  Get $WORD to claim it
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            <p className="max-w-[30ch] text-balance text-sm text-ink/70" aria-live="polite">
              {checking ? "Checking what you can spell now…" : `${count === 1 ? "It’s" : "They’re"} in your bag, ready to spell with.`}
            </p>
            <Button variant="ghost" full onClick={g.closeSheet}>
              Done
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}
