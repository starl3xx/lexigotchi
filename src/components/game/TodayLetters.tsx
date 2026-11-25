"use client";
/**
 * The Today tab's letters card, second only to the words (starl3xx, 2026-11-24: "Top right (second)
 * should be letters: daily letter plus the players' loose letters (uppercase first) to a limit,
 * with a Spell button and/or a mint more").
 *
 * Today's free letter (pull it, see it, or how to unlock it), then the loose letters as tiles,
 * UPPERCASE first (they spell words that earn), each with its count; a lowercase tile opens the roll
 * to raise it, as in the Bag. Past the limit, one tile says how many more and opens the Bag. Then
 * the two ways forward: Spell (when the letters spell a word now) and Mint more.
 */
import { Button, Card, Countdown, SectionTitle } from "./primitives";
import { LetterTile } from "./LetterTile";
import { DailyUnlock, useDailyEligibility } from "./DailyUnlock";
import { Check, Fire, Sparkle, TextAa, Ticket } from "./ui/icons";
import { idxToChar, useGame } from "./state";
import { useCanSpell, useEmptyStageCase } from "./useTodayPlan";
import { wordsUnknown } from "./WordsPending";

/** Letter tiles before the "+N" tile: two rows of six on a phone. */
const SHOWN = 12;

export function TodayLetters() {
  const g = useGame();
  const { state } = g;
  const daily = useDailyEligibility();
  // Spelling uses the connected wallet's own letters, and only a word nobody owns (useTodayPlan).
  const canSpell = useCanSpell();
  const stage = useEmptyStageCase();
  if (state.status !== "ready") return null;

  const loose = [
    ...state.upper.map((c, i) => ({ i, c, upper: true })),
    ...state.lower.map((c, i) => ({ i, c, upper: false })),
  ].filter((l) => l.c > 0);
  const total = loose.reduce((s, l) => s + l.c, 0);
  const over = loose.length > SHOWN;
  const shown = over ? loose.slice(0, SHOWN - 1) : loose;
  // The "+N" counts letters, not kinds of letter: an e×3 that didn't fit is three more.
  const hidden = loose.slice(shown.length).reduce((s, l) => s + l.c, 0);
  // One loud "get letters" button on Today at a time. With no word of the player's own on stage, the
  // empty stage asks for letters when they have none or too few ("start", "more"); otherwise (their
  // words on stage, or all in a linked wallet) this card asks, unless they can spell already.
  const stageAsks = !state.words.some((w) => w.mine) && (stage === "start" || stage === "more");
  const mintLoud = !canSpell && !stageAsks;

  return (
    <Card>
      <SectionTitle action={<span className="text-xs font-bold text-ink/55">{total} loose</span>}>Your letters</SectionTitle>

      {/* today's free letter */}
      <div className="mb-3 rounded-xl border-2 border-dashed border-ink/25 p-2.5">
        {state.dailyMinted ? (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-ink/70">
              {/* the letter today's daily gave, when this browser saw it */}
              {state.dailyLetter != null && (
                <LetterTile char={idxToChar(state.dailyLetter)} size={30} title={`Today’s letter: ${idxToChar(state.dailyLetter).toLowerCase()}`} />
              )}
              <span>
                Today’s free letter: claimed <Check weight="bold" size={13} className="inline text-teal-ink" />
                {/* streak is a mock-only stat: on chain it would always read 0, which looks broken */}
                {!state.chainBacked && (
                  <>
                    {" "}· streak <Fire weight="fill" size={13} className="inline text-candy-ink" /> {state.streak}
                  </>
                )}
              </span>
            </span>
            <span className="shrink-0 text-xs text-ink/50">
              next in <Countdown />
            </span>
          </div>
        ) : !daily.eligible ? (
          // A signed-out web player can't claim it from here: the shared DailyUnlock offers both
          // identities (Farcaster, or a Coinbase-verified wallet). Inside a Farcaster client the
          // viewer is signed in already, so this never shows there.
          <DailyUnlock />
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-ink/70">
              <span className="font-bold text-ink">Your free letter is ready.</span>
              <div className="text-xs text-ink/50">One a day, on the house</div>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                const idx = g.dailyMint();
                // "pending" = the onchain flow started; only a real null means "already pulled".
                if (idx === null) g.toast("Already claimed today", "info");
              }}
            >
              <Ticket weight="fill" /> Pull
            </Button>
          </div>
        )}
      </div>

      {/* the loose letters, UPPERCASE first */}
      {loose.length === 0 ? (
        <p className="py-2 text-center text-sm text-ink/60">
          {/* "yet" is for a newcomer; while the words still load, the player may well have some */}
          No loose letters{state.words.length > 0 || wordsUnknown(state) ? " right now" : " yet"}. Mint a pack of 5
          {state.dailyMinted ? "" : ", or take your free letter"}.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 md:gap-2.5">
          {shown.map((l) => {
            const props = {
              char: idxToChar(l.i),
              upper: l.upper,
              count: l.c,
              title: l.upper ? `${idxToChar(l.i)} (raised)` : `Raise ${idxToChar(l.i).toLowerCase()} → ${idxToChar(l.i)}`,
              onClick: l.upper ? undefined : () => g.openSheet({ kind: "roll", target: { kind: "loose", idx: l.i } }),
            };
            // Phones: six tiles a row. Wider screens: bigger tiles, as in the Bag.
            return (
              <div key={`${l.upper ? "U" : "l"}${l.i}`}>
                <div className="md:hidden">
                  <LetterTile {...props} />
                </div>
                <div className="hidden md:block">
                  <LetterTile {...props} size={52} />
                </div>
              </div>
            );
          })}
          {hidden > 0 && (
            <button
              onClick={() => g.nav("bag")}
              aria-label={`${hidden} more letters in your Bag`}
              className="cel-sm press grid h-11 w-11 place-items-center rounded-lg bg-card font-display text-sm font-extrabold text-ink/70 md:h-[52px] md:w-[52px]"
            >
              +{hidden}
            </button>
          )}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        {canSpell && (
          <Button variant="teal" className="flex-1" onClick={() => g.nav("claim")}>
            <TextAa weight="bold" /> Spell a word
          </Button>
        )}
        <Button variant={mintLoud ? "primary" : "ghost"} className="flex-1" onClick={() => g.nav("mint")}>
          <Sparkle weight="fill" /> {total > 0 ? "Mint more" : "Mint letters"}
        </Button>
      </div>
    </Card>
  );
}
