"use client";
/** Bag — your loose letters (tap a lowercase one to raise it) and your claimed words. */
import { useState } from "react";
import { Button, EmptyState, SectionTitle } from "../primitives";
import { LetterTile } from "../LetterTile";
import { WordCard } from "../WordCard";
import { idxToChar, useGame } from "../state";

export function BagScreen() {
  const g = useGame();
  const { state } = g;
  const [tab, setTab] = useState<"letters" | "words">("letters");

  const lowerOwned = state.lower.map((c, i) => ({ i, c })).filter((x) => x.c > 0);
  const upperOwned = state.upper.map((c, i) => ({ i, c })).filter((x) => x.c > 0);
  const lowerCount = state.lower.reduce((a, b) => a + b, 0);
  const upperCount = state.upper.reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-3">
      <div className="flex rounded-xl border-[3px] border-ink bg-paper p-1 text-sm font-bold">
        <Tab on={tab === "letters"} onClick={() => setTab("letters")}>
          Letters · {lowerCount + upperCount}
        </Tab>
        <Tab on={tab === "words"} onClick={() => setTab("words")}>
          Words · {state.words.length}
        </Tab>
      </div>

      {tab === "letters" ? (
        <div className="space-y-4">
          <div>
            <SectionTitle action={<span className="text-xs text-ink/55">tap to raise →</span>}>
              the kids · {lowerCount}
            </SectionTitle>
            {lowerOwned.length === 0 ? (
              <EmptyState emoji="🫙" title="No loose letters" sub="Mint a pack to fill your bag." />
            ) : (
              <div className="grid grid-cols-6 gap-2.5">
                {lowerOwned.map(({ i, c }) => (
                  <LetterTile
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
              <SectionTitle>the glow-ups · {upperCount}</SectionTitle>
              <div className="grid grid-cols-6 gap-2.5">
                {upperOwned.map(({ i, c }) => (
                  <LetterTile key={i} char={idxToChar(i)} upper count={c} title={`${idxToChar(i)} (raised)`} />
                ))}
              </div>
              <p className="mt-2 text-xs text-ink/55">Raised letters spell all-UPPERCASE words — claim them in Spell.</p>
            </div>
          )}

          <Button full variant="ghost" onClick={() => g.nav("mint")}>
            ✨ Mint more letters
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          <SectionTitle action={<Button size="sm" variant="primary" onClick={() => g.nav("claim")}>+ Spell</Button>}>
            Claimed words
          </SectionTitle>
          {state.words.length === 0 ? (
            <EmptyState emoji="🔤" title="No words yet" sub="Spell a dictionary word from 5 letters to claim it forever." />
          ) : (
            state.words.map((w) => <WordCard key={w.id} word={w} />)
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
      className={`flex-1 rounded-lg py-1.5 transition-colors ${on ? "bg-candy text-paper" : "text-ink/70"}`}
    >
      {children}
    </button>
  );
}
