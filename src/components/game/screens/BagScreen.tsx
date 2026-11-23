"use client";
/** Bag — your loose letters (tap a lowercase one to raise it) and your claimed words. */
import { useState } from "react";
import { Button, EmptyState, SectionTitle } from "../primitives";
import { LetterTile } from "../LetterTile";
import { WordCard } from "../WordCard";
import { Basket, Sparkle, TextAa } from "../ui/icons";
import { idxToChar, useGame, mineLower, mineUpper } from "../state";

export function BagScreen() {
  const g = useGame();
  const { state } = g;
  const [tab, setTab] = useState<"letters" | "words">("letters");

  const lowerOwned = state.lower.map((c, i) => ({ i, c })).filter((x) => x.c > 0);
  const upperOwned = state.upper.map((c, i) => ({ i, c })).filter((x) => x.c > 0);
  const lowerCount = state.lower.reduce((a, b) => a + b, 0);
  const upperCount = state.upper.reduce((a, b) => a + b, 0);

  // The union bag counts everything the player's linked wallets hold; the difference from the
  // connected wallet's own counts is what spelling/rolling can't touch from here.
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const elsewhere =
    lowerCount + upperCount - (sum(mineLower(state)) + sum(mineUpper(state)));

  return (
    <div className="space-y-3">
      <div className="flex rounded-xl border-[3px] border-ink bg-paper p-1 text-sm font-bold md:max-w-sm">
        <Tab on={tab === "letters"} onClick={() => setTab("letters")}>
          Letters · {lowerCount + upperCount}
        </Tab>
        <Tab on={tab === "words"} onClick={() => setTab("words")}>
          Words · {state.words.length}
        </Tab>
      </div>

      {tab === "letters" ? (
        <div className="space-y-4">
          {elsewhere > 0 && (
            <p className="text-xs text-ink/55">
              {elsewhere} of these live in your linked wallets. They count in your bag, but
              spelling and rolling use the connected wallet’s letters.
            </p>
          )}
          <div>
            <SectionTitle action={<span className="text-xs text-ink/55">tap to raise →</span>}>
              lowercase · {lowerCount}
            </SectionTitle>
            {lowerOwned.length === 0 ? (
              <EmptyState Icon={Basket} title="No loose letters" sub="Mint a pack to fill your bag." />
            ) : (
              <div className={LETTER_GRID}>
                {lowerOwned.map(({ i, c }) => (
                  <BagLetter
                    key={i}
                    char={idxToChar(i)}
                    count={c}
                    title={`Raise ${idxToChar(i).toLowerCase()} → ${idxToChar(i)}`}
                    onClick={() => g.openSheet({ kind: "roll", target: { kind: "loose", idx: i } })}
                  />
                ))}
              </div>
            )}
          </div>

          {upperCount > 0 && (
            <div>
              <SectionTitle>UPPERCASE · {upperCount}</SectionTitle>
              <div className={LETTER_GRID}>
                {upperOwned.map(({ i, c }) => (
                  <BagLetter key={i} char={idxToChar(i)} upper count={c} title={`${idxToChar(i)} (raised)`} />
                ))}
              </div>
              <p className="mt-2 text-xs text-ink/55">Raised letters spell all-UPPERCASE words. Claim them in Spell.</p>
            </div>
          )}

          <Button full variant="ghost" onClick={() => g.nav("mint")}>
            <Sparkle weight="fill" /> Mint more letters
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
          {/* the heading and the empty state span both columns; only the cards pair up (Bugbot) */}
          <div className="lg:col-span-2">
            <SectionTitle action={<Button size="sm" variant="primary" onClick={() => g.nav("claim")}>+ Spell</Button>}>
              Claimed words
            </SectionTitle>
          </div>
          {state.words.length === 0 ? (
            <div className="lg:col-span-2">
              <EmptyState Icon={TextAa} title="No words yet" sub="Spell a dictionary word from 5 letters to claim it forever." />
            </div>
          ) : (
            state.words.map((w) => <WordCard key={w.word} word={w} />)
          )}
        </div>
      )}
    </div>
  );
}

function Tab({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-lg py-1.5 transition-colors ${on ? "bg-candy-deep text-paper" : "text-ink/70"}`}
    >
      {children}
    </button>
  );
}

/** Phones: six flat tiles a row. Desktop: the letters as characters (the rig's bust art), sized to
 *  fill the wider column instead of a thin row of small squares across an empty page. */
const LETTER_GRID = "grid grid-cols-6 gap-2.5 md:grid-cols-[repeat(auto-fill,76px)] md:gap-3";

function BagLetter(props: { char: string; upper?: boolean; count: number; title: string; onClick?: () => void }) {
  return (
    <>
      <div className="md:hidden">
        <LetterTile {...props} />
      </div>
      <div className="hidden md:block">
        <LetterTile {...props} size={68} />
      </div>
    </>
  );
}
