"use client";
/** Spell — build a word from 5 same-case letters (any order); claim a valid dictionary word forever. */
import { useMemo, useState } from "react";
import { wordTier } from "@/lib/economy";
import { Button, Card, EmptyState, SectionTitle, TierBadge } from "../primitives";
import { LetterTile, WordTiles } from "../LetterTile";
import { Basket, Crown, Lock, Sparkle } from "../ui/icons";
import { COST, anagramsOf, fmtWord, idxToChar, mineLower, mineUpper, spellableNow, useGame } from "../state";

export function ClaimScreen() {
  const g = useGame();
  const { state } = g;
  const [useUpper, setUseUpper] = useState(false);
  const [rack, setRack] = useState<number[]>([]);

  // MINE, not the union: Words.claim consumes letters from msg.sender — spelling with a linked
  // wallet's letters would build a transaction the contract is guaranteed to revert.
  const inv = useUpper ? mineUpper(state) : mineLower(state);
  const owned = useMemo(() => new Set(state.words.map((w) => w.word)), [state.words]);

  const rackCount = (i: number) => rack.filter((x) => x === i).length;
  const trayLetters = inv.map((c, i) => ({ i, c })).filter((x) => x.c > 0);

  const spelled = useMemo(
    () => (rack.length === 5 ? anagramsOf(rack.map(idxToChar)).filter((w) => !owned.has(w)) : []),
    [rack, owned],
  );
  const quick = useMemo(() => spellableNow(inv, owned, 8), [inv, owned]);

  const swapCase = (upper: boolean) => {
    setUseUpper(upper);
    setRack([]);
  };
  const claim = (word: string) => {
    g.claim(word, useUpper);
    setRack([]);
  };
  // functional updater so rapid/batched clicks can't push past 5 slots or beyond what you own
  const addLetter = (i: number) =>
    setRack((prev) => {
      if (prev.length >= 5) return prev;
      const used = prev.filter((x) => x === i).length;
      if (inv[i] - used <= 0) return prev;
      return [...prev, i];
    });

  const upperCount = mineUpper(state).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-3">
      <div>
        <h1 className="font-display text-2xl font-extrabold">Spell a word</h1>
        <p className="text-sm text-ink/60">Five letters, one case. A valid dictionary word becomes a permanent NFT.</p>
      </div>

      {/* case toggle */}
      <div className="flex rounded-xl border-[3px] border-ink bg-paper p-1 text-sm font-bold">
        <button onClick={() => swapCase(false)} className={`flex-1 rounded-lg py-1.5 ${!useUpper ? "bg-candy text-paper" : "text-ink/70"}`}>
          lowercase
        </button>
        <button
          onClick={() => swapCase(true)}
          disabled={upperCount < 5}
          className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 disabled:opacity-40 ${useUpper ? "bg-gold text-ink" : "text-ink/70"}`}
        >
          UPPERCASE {upperCount < 5 ? <Lock weight="fill" size={13} /> : <Crown weight="fill" size={13} />}
        </button>
      </div>

      {/* rack */}
      <Card>
        <div className="flex items-center justify-center gap-1.5">
          {Array.from({ length: 5 }).map((_, slot) => {
            const idx = rack[slot];
            return idx === undefined ? (
              <div key={slot} className="h-12 w-12 rounded-lg border-[3px] border-dashed border-ink/30" />
            ) : (
              <LetterTile
                key={slot}
                char={idxToChar(idx)}
                upper={useUpper}
                size={48}
                onClick={() => setRack((prev) => prev.filter((_, s) => s !== slot))}
                title="remove"
              />
            );
          })}
        </div>

        {/* result */}
        <div className="mt-3 min-h-[2.25rem] text-center">
          {rack.length < 5 ? (
            <span className="text-sm text-ink/50">{5 - rack.length} more letter{rack.length === 4 ? "" : "s"}…</span>
          ) : spelled.length > 0 ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="text-xs text-ink/60">spells</span>
              {spelled.map((w) => (
                <button
                  key={w}
                  onClick={() => claim(w)}
                  disabled={!g.canAfford(COST.claim)}
                  className="inline-flex items-center gap-1 rounded-lg border-[3px] border-ink bg-teal px-2 py-1 font-display text-sm font-extrabold text-paper shadow-[2px_2px_0_#1b1714] disabled:opacity-40"
                >
                  {w} <Sparkle weight="fill" size={13} />
                </button>
              ))}
            </div>
          ) : (
            <span className="text-sm font-bold text-candy">not a dictionary word</span>
          )}
        </div>
        {rack.length === 5 && spelled.length > 0 && (
          <div className="mt-1 text-center text-xs text-ink/55">claim fee {fmtWord(COST.claim)} $WORD</div>
        )}
        {rack.length > 0 && (
          <button onClick={() => setRack([])} className="mx-auto mt-2 block text-xs font-bold text-ink/50 underline">
            clear rack
          </button>
        )}
      </Card>

      {/* tray */}
      <div>
        <SectionTitle>{useUpper ? "your raised letters" : "your letters"}</SectionTitle>
        {trayLetters.length === 0 ? (
          <EmptyState Icon={Basket} title={useUpper ? "No raised letters yet" : "No letters"} sub="Mint a pack to fill your bag." />
        ) : (
          <div className="grid grid-cols-6 gap-2.5">
            {trayLetters.map(({ i, c }) => {
              const avail = c - rackCount(i);
              return (
                <LetterTile
                  key={i}
                  char={idxToChar(i)}
                  upper={useUpper}
                  count={avail}
                  dim={avail <= 0}
                  onClick={avail > 0 && rack.length < 5 ? () => addLetter(i) : undefined}
                  title={`add ${idxToChar(i)}`}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* quick spell-now */}
      {quick.length > 0 && (
        <div>
          <SectionTitle>You can spell now</SectionTitle>
          <div className="space-y-2">
            {quick.map((w) => (
              <div key={w} className="cel flex items-center gap-3 rounded-2xl bg-paper p-2.5">
                <WordTiles word={w} upper={Array(5).fill(useUpper)} size={26} />
                <div className="flex-1">
                  <div className="font-display text-sm font-extrabold">{w}</div>
                  <TierBadge tier={wordTier(w)} />
                </div>
                <Button size="sm" variant="teal" disabled={!g.canAfford(COST.claim)} onClick={() => claim(w)}>
                  Claim
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
