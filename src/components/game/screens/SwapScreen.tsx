"use client";
/** Swap — a direct two-sided letter escrow ("my Q for your two Z's"), shareable to Farcaster/X. */
import { useState } from "react";
import { ALPHABET } from "@/lib/economy";
import { Button, Card, SectionTitle } from "../primitives";
import { LetterTile } from "../LetterTile";
import { charToIdx, fmtWord, idxToChar, useGame } from "../state";

const QUICK_WORD = [0, 500_000, 1_000_000, 2_500_000];

export function SwapScreen() {
  const g = useGame();
  const { state } = g;
  const [give, setGive] = useState<number[]>([]);
  const [want, setWant] = useState<number[]>([]);
  const [ask, setAsk] = useState(0);
  const [created, setCreated] = useState(false);

  const giveUsed = (i: number) => give.filter((x) => x === i).length;
  const myLetters = state.lower.map((c, i) => ({ i, c })).filter((x) => x.c > 0);
  // functional updater so batched taps can't offer more of a letter than the bag holds
  const addGive = (i: number) =>
    setGive((prev) => {
      const usedInGive = prev.filter((x) => x === i).length;
      if (state.lower[i] - usedInGive <= 0) return prev;
      return [...prev, i];
    });
  const fmtSet = (arr: number[]) =>
    arr.length ? arr.map((i) => idxToChar(i)).join(" ") : "—";

  const reset = () => {
    setGive([]);
    setWant([]);
    setAsk(0);
    setCreated(false);
  };

  if (created) {
    return (
      <div className="space-y-3">
        <h1 className="font-display text-2xl font-extrabold">Swap created</h1>
        <Card className="bg-gradient-to-b from-candy/10 to-paper">
          <div className="text-center text-xs font-bold uppercase tracking-wide text-ink/55">a Lexigotchi swap</div>
          <div className="my-3 space-y-3">
            <div className="text-center">
              <div className="text-xs text-ink/55">they give you</div>
              <div className="font-display text-lg font-extrabold">{fmtSet(want)}</div>
            </div>
            <div className="text-center text-2xl" aria-hidden>⇅</div>
            <div className="text-center">
              <div className="text-xs text-ink/55">you give</div>
              <div className="font-display text-lg font-extrabold">
                {fmtSet(give)} {ask > 0 && <span className="text-teal">+ {fmtWord(ask)} $WORD</span>}
              </div>
            </div>
          </div>
        </Card>
        <Button full size="lg" variant="primary" onClick={() => g.toast("Swap link copied — cast it 🟣", "good")}>
          Share to Farcaster / X
        </Button>
        <Button full variant="ghost" onClick={reset}>
          New swap
        </Button>
        <p className="text-center text-xs text-ink/50">
          Direct two-sided escrow — not a marketplace. Open price discovery still lives on any 1155 venue.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="font-display text-2xl font-extrabold">Propose a swap</h1>
        <p className="text-sm text-ink/60">Trade exact letters with a friend. Shareable as a cast.</p>
      </div>

      {/* you give */}
      <Card>
        <SectionTitle action={give.length > 0 ? <button onClick={() => setGive([])} className="text-xs font-bold text-ink/45 underline">clear</button> : undefined}>
          You give: {fmtSet(give)}
        </SectionTitle>
        {myLetters.length === 0 ? (
          <p className="text-sm text-ink/55">No loose letters to offer.</p>
        ) : (
          <div className="grid grid-cols-6 gap-2.5">
            {myLetters.map(({ i, c }) => {
              const avail = c - giveUsed(i);
              return <LetterTile key={i} char={idxToChar(i)} count={avail} dim={avail <= 0} onClick={avail > 0 ? () => addGive(i) : undefined} />;
            })}
          </div>
        )}
        <div className="mt-3">
          <div className="mb-1 text-xs font-bold text-ink/55">…and add $WORD?</div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_WORD.map((amt) => (
              <button key={amt} onClick={() => setAsk(amt)}>
                <span className={`inline-block rounded-full border-2 border-ink px-2.5 py-1 text-xs font-bold ${ask === amt ? "bg-teal text-paper" : "bg-paper"}`}>
                  {amt === 0 ? "none" : `+${fmtWord(amt)}`}
                </span>
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* you want */}
      <Card>
        <SectionTitle action={want.length > 0 ? <button onClick={() => setWant([])} className="text-xs font-bold text-ink/45 underline">clear</button> : undefined}>
          You want: {fmtSet(want)}
        </SectionTitle>
        <div className="grid grid-cols-7 gap-1.5">
          {ALPHABET.map((L) => (
            <LetterTile key={L} char={L} size={38} selected={want.includes(charToIdx(L))} onClick={() => setWant((prev) => [...prev, charToIdx(L)])} />
          ))}
        </div>
      </Card>

      <Button full size="lg" variant="primary" disabled={give.length === 0 && ask === 0} onClick={() => setCreated(true)}>
        Create swap link →
      </Button>
    </div>
  );
}
