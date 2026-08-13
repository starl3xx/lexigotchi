"use client";
/** Pack reveal — the 5 freshly-pulled letters pop in one by one. */
import { LETTERS_BY_FREQUENCY } from "@/lib/economy";
import { Button, Sheet } from "../primitives";
import { LetterTile } from "../LetterTile";
import { Package, Sparkle } from "../ui/icons";
import { idxToChar, useGame } from "../state";

const RAREST = new Set(LETTERS_BY_FREQUENCY.slice(-6));

export function PackReveal({ letters }: { letters: number[] }) {
  const g = useGame();
  const gotRare = letters.some((i) => RAREST.has(idxToChar(i)));
  return (
    <Sheet open onClose={g.closeSheet} title={<span className="inline-flex items-center gap-1.5">Fresh pull <Package weight="fill" /></span>}>
      <div className="flex flex-wrap items-center justify-center gap-3 py-4">
        {letters.map((i, k) => (
          <div key={k} className="animate-pop" style={{ animationDelay: `${k * 0.11}s` }}>
            <LetterTile char={idxToChar(i)} size={64} />
          </div>
        ))}
      </div>
      <p className="flex items-center justify-center gap-1 text-center text-sm text-ink/60">
        {gotRare ? (
          <>
            Ooh — a rare one in there <Sparkle weight="fill" size={13} className="text-gold-deep" />
          </>
        ) : letters.length === 1 ? (
          // The sheet is shared by the 5-pack AND the daily single — the copy has to count.
          "One fresh lowercase kid for the bag."
        ) : (
          `${["", "One", "Two", "Three", "Four", "Five"][letters.length] ?? letters.length} fresh lowercase kids for the bag.`
        )}
      </p>
      <div className="mt-4 flex gap-2">
        <Button full variant="ghost" onClick={g.closeSheet}>
          Stash it
        </Button>
        <Button full variant="primary" onClick={() => g.nav("claim")}>
          Spell something →
        </Button>
      </div>
    </Sheet>
  );
}
