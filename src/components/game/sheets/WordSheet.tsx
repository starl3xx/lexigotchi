"use client";
/** Word detail — stake, feed, raise letters to UPPERCASE, ascend (prestige), or dissolve. */
import { useState } from "react";
import { Button, Card, HungerBadge, Sheet, TierBadge } from "../primitives";
import { CaseBadge, LetterTile, PrestigeStars, WordTiles, careState } from "../LetterTile";
import { Check, Cookie, Crown, Star, Ticket } from "../ui/icons";
import { promptAccountSwitch } from "../walletSwitch";
import {
  COST,
  PRESTIGE_LEVELS,
  fmtWord,
  hunger,
  idxToChar,
  jackpotEligible,
  useGame,
  wordCase,
} from "../state";

export function WordSheet({ word: wordKey }: { word: string }) {
  const g = useGame();
  const { state } = g;
  const word = state.words.find((w) => w.word === wordKey);
  const [confirmDissolve, setConfirmDissolve] = useState(false);
  // Guards against a second tap during the async chain flow — each tap is a PAID commit.
  const [ascending, setAscending] = useState(false);
  const [strandedNote, setStrandedNote] = useState("");

  if (!word) {
    return (
      <Sheet open onClose={g.closeSheet} title="Word">
        <p className="py-6 text-center text-ink/60">This word is no longer in your bag.</p>
      </Sheet>
    );
  }

  const c = wordCase(word);
  const h = hunger(word);
  const fullyRaised = c === "UPPERCASE";
  const isAnswer = state.jackpotWord === word.word && !state.jackpotRevealed;
  const canPrestige = fullyRaised && word.staked && word.prestigeLevel < PRESTIGE_LEVELS;

  return (
    <Sheet
      open
      onClose={g.closeSheet}
      title={
        <span className="flex items-center gap-1.5">
          {word.word} <PrestigeStars level={word.prestigeLevel} />
        </span>
      }
    >
      {/* hero — the word as a row of tiles wearing the word's current care state */}
      <div className={`mb-3 flex justify-center rounded-2xl border-[3px] border-ink py-5 ${fullyRaised ? "bg-gold/15" : "bg-paper-dark/40"}`}>
        <WordTiles word={word.word} upper={word.upper} size={54} state={careState(word)} gild={word.prestigeLevel} detail="bust" />
      </div>

      {/* status */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <TierBadge tier={word.tier} />
        <CaseBadge word={word} />
        {word.staked ? <HungerBadge state={h} /> : null}
        {word.staked && jackpotEligible(word) && (
          <span className="inline-flex items-center gap-0.5 text-xs text-teal">
            <Ticket weight="fill" size={12} /> jackpot-ready
          </span>
        )}
      </div>

      {isAnswer && jackpotEligible(word) && (
        <Card className="mb-3 bg-candy/10">
          <div className="text-sm">
            <strong className="font-display">You may hold today&apos;s secret word</strong> — staked & fed.
            <button onClick={() => g.nav("jackpot")} className="ml-1 font-bold text-candy underline">
              Open the jackpot →
            </button>
          </div>
        </Card>
      )}

      {/* union-bag word held by a linked wallet — yours to admire, not to sign for. Every verb
          below (stake, feed, roll, ascend, dissolve) acts on msg.sender's assets, so the sheet
          says where it lives instead of offering buttons that would build guaranteed reverts. */}
      {!word.mine && (
        <Card className="mb-3 border-gold bg-gold/10 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <strong className="font-display">Held by {word.holder ? `${word.holder.slice(0, 6)}…${word.holder.slice(-4)}` : "a linked wallet"}.</strong>{" "}
              It&apos;s part of your bag — switch to that wallet to stake, feed, or raise it.
            </div>
            {/* Opens the wallet's own account picker — the app can't choose the account, but it
                can put the choice one tap away. wagmi follows accountsChanged, and `mine`
                re-attributes across the whole bag the moment the switch lands. */}
            <Button variant="teal" onClick={() => void promptAccountSwitch()}>
              Switch
            </Button>
          </div>
        </Card>
      )}

      {/* care */}
      <div className={`mb-3 grid grid-cols-2 gap-2 ${word.mine ? "" : "pointer-events-none opacity-40"}`}>
        <Button variant={word.staked ? "ghost" : "teal"} onClick={() => g.toggleStake(word.word)}>
          {word.staked ? "Unstake" : "Stake to earn"}
        </Button>
        <Button
          variant="teal"
          disabled={!word.staked || word.daysUnfed === 0 || (state.freeSnackUsed && !g.canAfford(COST.snack))}
          onClick={() => g.feed(word.word)}
        >
          <Cookie weight="fill" /> Feed {word.daysUnfed === 0 && <Check weight="bold" size={14} />}
        </Button>
      </div>

      {/* raise letters */}
      <Card className={`mb-3 ${word.mine ? "" : "pointer-events-none opacity-40"}`}>
        <div className="mb-2 flex items-center justify-between">
          <span className="font-display font-extrabold">Raise to UPPERCASE</span>
          <span className="text-xs text-ink/55">{word.upper.filter(Boolean).length}/5 · yield unlocks at 5/5</span>
        </div>
        {fullyRaised ? (
          <div className="flex items-center justify-center gap-1 rounded-xl bg-gold/15 py-2 text-center text-sm font-bold text-gold-deep">
            Fully raised <Crown weight="fill" />
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1.5">
            {[...word.word].map((ch, i) =>
              word.upper[i] ? (
                <LetterTile key={i} char={ch} upper size={42} />
              ) : (
                <LetterTile
                  key={i}
                  char={ch}
                  size={42}
                  onClick={() => g.openSheet({ kind: "roll", target: { kind: "word", word: word.word, pos: i } })}
                  title={`raise ${ch}`}
                />
              ),
            )}
          </div>
        )}
        {!fullyRaised && <p className="mt-2 text-center text-xs text-ink/55">tap a lowercase letter to roll it · {fmtWord(COST.roll)} $WORD</p>}
      </Card>

      {/* prestige */}
      {fullyRaised && (
        <Card className={`mb-3 bg-gradient-to-b from-paper to-gold/10 ${word.mine ? "" : "pointer-events-none opacity-40"}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1 font-display font-extrabold">
                Ascend <Star weight="fill" size={14} className="text-gold-deep" />
              </div>
              <div className="text-xs text-ink/55">
                Gilded L{word.prestigeLevel}
                {word.prestigeLevel < PRESTIGE_LEVELS ? ` → L${word.prestigeLevel + 1} · +yield & bounty weight` : " · maxed"}
              </div>
            </div>
            <Button
              variant="gold"
              disabled={ascending || !canPrestige || !g.canAfford(COST.prestige + COST.snack)}
              onClick={() => {
                const res = g.prestige(word.word);
                // A promise means it resolves later; announcing success now would celebrate a
                // gilded glow-up before the wallet prompt has even appeared. The chain store toasts
                // its own outcome, so only the synchronous (mock) result is announced here.
                if (res instanceof Promise) {
                  setAscending(true);
                  void res
                    .then((r) => {
                      // Only re-enable when NOTHING was spent. A stranded commit is paid and still
                      // open, so re-enabling would sell a second ascension on top of it.
                      if (r.status === "stranded") setStrandedNote(r.note);
                      else setAscending(false);
                    })
                    // A rejection does not say whether the fee was taken, so it must not re-enable
                    // the button — that would sell a second ascension on top of an open commit.
                    // Unknown is treated as paid, which is the safe direction.
                    .catch(() => setStrandedNote("We lost track of this ascension — reopen to check"));
                  return;
                }
                if (res === null) return; // didn't attempt (ineligible / unaffordable — api toasted)
                g.toast(res ? "Ascended! A gilded glow-up" : "Ascension failed — no harm done", res ? "good" : "info");
              }}
            >
              {strandedNote ? "Unfinished" : ascending ? "Ascending…" : word.prestigeLevel >= PRESTIGE_LEVELS ? "Maxed" : `Ascend · ${fmtWord(COST.prestige)}`}
            </Button>
          </div>
          {strandedNote && <p className="mt-2 text-xs text-gold-deep">{strandedNote}</p>}
          {!word.staked && <p className="mt-2 text-xs text-candy">Stake it first to ascend.</p>}
        </Card>
      )}

      {/* dissolve — hidden entirely for a linked wallet's word (msg.sender-only, like the rest) */}
      <div className={`pt-1 ${word.mine ? "" : "hidden"}`}>
        {confirmDissolve ? (
          <div className="flex items-center gap-2">
            <Button full variant="danger" onClick={() => g.dissolve(word.word)}>
              Burn & recover 5 letters
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDissolve(false)}>
              Keep
            </Button>
          </div>
        ) : (
          <button onClick={() => setConfirmDissolve(true)} className="mx-auto block text-xs font-bold text-ink/45 underline">
            dissolve this word
          </button>
        )}
      </div>
    </Sheet>
  );
}
