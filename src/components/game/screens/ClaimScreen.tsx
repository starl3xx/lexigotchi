"use client";
/**
 * Spell: build a word from 5 same-case letters (any order) and claim a valid dictionary word.
 *
 * A claim COSTS $WORD (params `prices.claim`, the contract's live price via g.price) on top of the 5
 * letters it locks inside the Word NFT. A tester found out from the wallet's "−2.3M WORD" line, so
 * the fee is said up front: in the intro, on every Claim button, and, when the balance is short,
 * with a way to get more.
 */
import { useEffect, useMemo, useState } from "react";
import { wordScore, wordTier, type Tier } from "@/lib/economy";
import { Button, Card, EmptyState, Pill, SectionTitle, TierBadge, Segmented } from "../primitives";
import { useWorld } from "../useWorld";
import { LetterTile, WordTiles } from "../LetterTile";
import { Basket, Crown, Lock, Sparkle } from "../ui/icons";
import { anagramsOf, fmtUsd, fmtWord, idxToChar, mineLower, mineUpper, spellableNow, useGame } from "../state";

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
  // EVERY word these letters spell (it used to stop at the first 8, all early in A), minus words
  // another player already owns: a claim of one reverts (AlreadyClaimed). Until the owners are
  // known, a word stays listed, as the Dictionary does.
  const world = useWorld();
  const owners = world.data?.owners;
  // Owners are KNOWN only once the world read succeeds (always, in the practice game). Until then
  // a word may belong to someone, so its Claim waits: a claim of an owned word reverts and can
  // still cost gas (Bugbot on #146; the Dictionary does the same).
  const ownersKnown = !state.chainBacked || world.data?.live === true;
  // A failed read is not a check in progress: say so, as the Dictionary does. The read retries on
  // its own (useWorld refetches), so the Claims come back when it lands (Bugbot on #146).
  const ownerWait = world.isError || (world.data && !world.data.live) ? "Can’t check owner yet" : "Checking owner…";
  const spellable = useMemo(
    () => spellableNow(inv, owned, Infinity).filter((w) => !owners?.[w]),
    [inv, owned, owners],
  );
  const [order, setOrder] = useState<"rarest" | "az">("rarest");
  const [tier, setTier] = useState<Tier | "All">("All");
  const tierCounts = useMemo(() => {
    const c: Partial<Record<Tier, number>> = {};
    for (const w of spellable) c[wordTier(w)] = (c[wordTier(w)] ?? 0) + 1;
    return c;
  }, [spellable]);
  // A chosen rarity with nothing left in it (its last word claimed, or the case switched) shows
  // All rather than an empty list under a heading that counts words (Bugbot on #146).
  const activeTier: Tier | "All" = tier !== "All" && !tierCounts[tier] ? "All" : tier;
  const quick = useMemo(() => {
    const list = activeTier === "All" ? spellable : spellable.filter((w) => wordTier(w) === activeTier);
    // The dictionary is alphabetical already; rarest first ranks by the same score that sets tiers.
    return order === "rarest" ? [...list].sort((a, b) => wordScore(b) - wordScore(a) || a.localeCompare(b)) : list;
  }, [spellable, activeTier, order]);
  // A full bag spells hundreds of words; render them a page at a time so a phone stays smooth.
  const [shown, setShown] = useState(SPELL_PAGE);
  useEffect(() => setShown(SPELL_PAGE), [activeTier, order, useUpper]);

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
  const fee = g.price("claim");
  const feeText = `${fmtWord(fee)} $WORD (${fmtUsd(fee)})`;
  const canClaim = g.canAfford(fee);
  const getWord = () => g.openSheet({ kind: "balance", need: { amount: fee, action: "a claim" } });

  return (
    <div className="space-y-3">
      <div>
        <h1 className="font-display text-2xl font-extrabold md:hidden">Spell a word</h1>
        <p className="text-sm text-ink/60">
          Five letters, one case. Claiming a dictionary word costs{" "}
          <strong className="font-bold text-ink">{feeText}</strong> and locks its five letters inside your
          Word NFT.
        </p>
      </div>

      {/* case toggle */}
      <Segmented
        className="md:max-w-sm"
        value={useUpper ? "upper" : "lower"}
        onChange={(v) => swapCase(v === "upper")}
        options={[
          { value: "lower", label: "lowercase" },
          {
            value: "upper",
            disabled: upperCount < 5,
            label: (
              <>
                UPPERCASE {upperCount < 5 ? <Lock weight="fill" size={13} /> : <Crown weight="fill" size={13} />}
              </>
            ),
          },
        ]}
      />

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
              {spelled.map((w) =>
                // Someone else's word: say so, rather than offer a claim the contract reverts.
                owners?.[w] ? (
                  <span key={w} className="rounded-lg border-2 border-ink/30 px-2 py-1 text-sm font-bold text-ink/55">
                    {w} is already owned
                  </span>
                ) : (
                  <button
                    key={w}
                    onClick={() => claim(w)}
                    disabled={!canClaim || !ownersKnown}
                    className="inline-flex items-center gap-1 rounded-lg border-[3px] border-ink bg-teal px-2 py-1 font-display text-sm font-extrabold text-ink shadow-[2px_2px_0_#1b1714] disabled:opacity-40"
                  >
                    {ownersKnown ? (
                      <>
                        Claim {w} <Sparkle weight="fill" size={13} />
                      </>
                    ) : (
                      `${w}: ${ownerWait.toLowerCase()}`
                    )}
                  </button>
                ),
              )}
            </div>
          ) : (
            <span className="text-sm font-bold text-candy-ink">not a dictionary word</span>
          )}
        </div>
        {/* The fee only when the rack spells a word you could claim, not one someone else owns. */}
        {rack.length === 5 && spelled.some((w) => !owners?.[w]) && <FeeLine feeText={feeText} canClaim={canClaim} onGetWord={getWord} />}
        {rack.length > 0 && (
          <button onClick={() => setRack([])} className="mx-auto mt-2 block text-xs font-bold text-ink/50 underline">
            clear rack
          </button>
        )}
      </Card>

      {/* tray */}
      <div>
        {/* Unused: letters already spelled into your words are locked inside them and never show
            here. "your letters" read as everything you own. */}
        <SectionTitle>{useUpper ? "Your unused UPPERCASE letters" : "Your unused letters"}</SectionTitle>
        <p className="-mt-1 mb-2 text-xs text-ink/50">Letters already in your words stay in them, so they aren’t listed.</p>
        {trayLetters.length === 0 ? (
          <EmptyState Icon={Basket} title={useUpper ? "No raised letters yet" : "No letters"} sub="Mint a pack to fill your bag." />
        ) : (
          <div className="grid grid-cols-6 gap-2.5 md:grid-cols-[repeat(auto-fill,52px)]">
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

      {/* every word you can spell now */}
      {spellable.length > 0 && (
        <div>
          <SectionTitle>
            You can spell {spellable.length === 1 ? "1 word" : `${spellable.length.toLocaleString("en-US")} words`} now
          </SectionTitle>
          <FeeLine feeText={feeText} canClaim={canClaim} onGetWord={getWord} each />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Segmented
              className="w-full sm:w-64"
              value={order}
              onChange={setOrder}
              options={[
                { value: "rarest", label: "Rarest first" },
                { value: "az", label: "A–Z" },
              ]}
            />
            <div className="flex flex-wrap gap-1.5">
              {SPELL_TIERS.filter((t) => t === "All" || tierCounts[t]).map((t) => (
                <button key={t} onClick={() => setTier(t)} className="group round-btn rounded-full">
                  <Pill className={activeTier === t ? "bg-ink text-paper" : "bg-card transition-colors group-hover:bg-paper-dark"}>
                    {t}
                    <span className={activeTier === t ? "text-paper/60" : "text-ink/40"}>·{t === "All" ? spellable.length : tierCounts[t]}</span>
                  </Pill>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 space-y-2 lg:grid lg:grid-cols-2 lg:gap-2.5 lg:space-y-0">
            {quick.slice(0, shown).map((w) => (
              <div key={w} className="cel-sm flex items-center gap-3 rounded-2xl bg-card p-2.5">
                <WordTiles word={w} upper={Array(5).fill(useUpper)} size={26} />
                <div className="flex-1">
                  <div className="font-display text-sm font-extrabold">{w}</div>
                  <TierBadge tier={wordTier(w)} />
                </div>
                <Button size="sm" variant="teal" disabled={!canClaim || !ownersKnown} onClick={() => claim(w)}>
                  {ownersKnown ? `Claim · ${fmtWord(fee)}` : ownerWait}
                </Button>
              </div>
            ))}
          </div>
          {quick.length > shown && (
            <Button full variant="ghost" className="mt-3" onClick={() => setShown((n) => n + SPELL_PAGE)}>
              Show {Math.min(SPELL_PAGE, quick.length - shown)} more · {(quick.length - shown).toLocaleString("en-US")} left
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

const SPELL_TIERS: (Tier | "All")[] = ["All", "Legendary", "Epic", "Rare", "Uncommon", "Common"];
const SPELL_PAGE = 60;

/** The claim fee, said plainly; when the balance can't cover it, the way to get more. */
function FeeLine({ feeText, canClaim, onGetWord, each = false }: { feeText: string; canClaim: boolean; onGetWord: () => void; each?: boolean }) {
  return (
    <div className={`text-xs text-ink/60 ${each ? "" : "mt-1 text-center"}`}>
      {each ? "Each claim costs" : "Claiming costs"} <strong className="font-bold text-ink">{feeText}</strong>.
      {!canClaim && (
        <>
          {" "}You don’t have enough.{" "}
          <button onClick={onGetWord} className="font-bold text-candy-ink underline">
            Get $WORD
          </button>
        </>
      )}
    </div>
  );
}
