"use client";
/**
 * Word detail: the word's card (its scene, its back, its scene picker and share buttons), then stake,
 * feed, raise letters to UPPERCASE, ascend (prestige), sell, or dissolve.
 */
import { useState } from "react";
import { Button, Card, Sheet, TierBadge } from "../primitives";
import { StatusMarks } from "../StatusMarks";
import { markInput, moodOfWord, stageMarks } from "../stageMarks";
import { useForSale } from "../useForSale";
import { CaseBadge, LetterTile, PrestigeStars } from "../LetterTile";
import { WordSheetCard } from "../../cards/WordSheetCard";
import { CaretRight, Check, Coins, Alarm, Crown, Star } from "../ui/icons";
import { promptAccountSwitch } from "../walletSwitch";
import { stageName } from "@/lib/ascension";
import { MISS_POINTS, STAGE_SHARE } from "@/lib/howItWorks";
import { useAccount } from "wagmi";
import { usePublicProfile } from "../useProfile";
import {
  fmtUsd,
  fmtWord,
  showsUsd,
  hunger,
  idxToChar,
  jackpotEligible,
  useGame,
  wordCase,
  type Hunger,
  type OwnedWord,
} from "../state";
import { careNote } from "../careNote";
import { usePrefersReducedMotion } from "../motionPrefs";
import { useWakeAct } from "../wake/useWakeAct";
import { useWake } from "../wake/wakeRun";
import { earningLine, earningStatus, earningsRowTarget, payoutWhen } from "../earnings";
import { SellWord } from "../market/SellWord";
import { ascendDoor } from "../ascendFlow";

export function WordSheet({ word: wordKey }: { word: string }) {
  const g = useGame();
  const { state } = g;
  // Staking ties a word to this wallet: only the staker can feed it. Say so before a player stakes
  // from a wallet that isn't their game wallet (lib/db/gameWallet.ts).
  const { address } = useAccount();
  const gameWallet = usePublicProfile().profile?.gameWallet ?? null;
  const offGameWallet = Boolean(gameWallet && address && gameWallet !== address.toLowerCase());
  const word = state.words.find((w) => w.word === wordKey);
  const [confirmDissolve, setConfirmDissolve] = useState(false);
  // This card's part in a wake (../wake): what its letters wear from the tap to the bow.
  const wake = useWake();
  const reduced = usePrefersReducedMotion();
  const act = useWakeAct(wordKey, true);
  // Every hook stands above the early return below: a word can leave the bag while its sheet is
  // open (sold, dissolved, moved), and a hook that ran only while the word was there would change
  // the hook count and crash the sheet in place of showing its fallback (Bugbot on #233).
  const forSale = useForSale();

  if (!word) {
    return (
      <Sheet open onClose={g.closeSheet} title="Word">
        <p className="py-6 text-center text-ink/60">This word is no longer in your bag.</p>
      </Sheet>
    );
  }

  const c = wordCase(word);
  const h = hunger(word);
  const earnedNow = g.earnings?.byWord[word.word];
  const earnedLatest = earnedNow && earnedNow.latest > 0 && g.earnings?.latestAt ? { amount: fmtWord(earnedNow.latest), when: payoutWhen(g.earnings.latestAt) } : undefined;
  const fullyRaised = c === "UPPERCASE";
  const isAnswer = state.jackpotWord === word.word && !state.jackpotRevealed;
  const maxLevel = g.maxPrestigeLevel;
  const canPrestige = fullyRaised && word.staked && word.prestigeLevel < maxLevel;
  // A try on this word ended paid and unfinished (the chain store remembers it for the session).
  const unfinishedAscent = g.unfinishedAscents.has(word.word);
  const door = ascendDoor({ canTry: canPrestige, atTop: word.prestigeLevel >= maxLevel, unfinished: unfinishedAscent });
  // The word ladder: this attempt's price and odds both depend on the stage the word is at now.
  const atTop = word.prestigeLevel >= maxLevel;
  const ascendFee = g.prestigePrice(word.prestigeLevel);
  const ascendOdds = Math.round(g.prestigeProb(word.prestigeLevel, word.prestigePity) * 100);
  const snack = g.price("snack");
  const snackShort =
    word.staked && word.daysUnfed > 0 && state.freeSnackUsed && !g.canAfford(snack)
      ? ` Waking it costs ${fmtWord(snack)} $WORD, and you don’t have enough.`
      : null;
  const { note, feedOff } = careNote(word, h, { snackShort, nowSec: Math.floor(Date.now() / 1000) });

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
      {/* the word's card: its scene (in its care state), its story on the back, and the scene and
          share buttons the Showcase used to hold (components/cards) */}
      <WordSheetCard word={word} act={act} />

      {/* status */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <TierBadge tier={word.tier} />
        <CaseBadge word={word} />
      </div>
      {/* how it stands: the same three marks as the Today placard and the Bag (game/stageMarks) */}
      <div className="tm-host mb-3">
        <StatusMarks marks={stageMarks(markInput(word, moodOfWord(word, h, forSale.has(word.word)), { justFed: act.acting, earned: earnedLatest }))} />
      </div>

      {/* earnings: what this word has earned for the player, and what would make it earn */}
      <EarningsRow word={word} h={h} />

      {isAnswer && jackpotEligible(word) && (
        <Card className="mb-3 bg-candy/10">
          <div className="text-sm">
            <strong className="font-display">You may hold today’s secret word</strong>, staked and awake.
            <button onClick={() => g.nav("jackpot")} className="ml-1 font-bold text-candy-ink underline">
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
              {word.care ? (
                <>
                  {/* Staking.setCaretaker: the staker named this wallet; feed, roll, and ascend here. */}
                  <strong className="font-display">
                    Staked by {word.holder ? `${word.holder.slice(0, 6)}…${word.holder.slice(-4)}` : "your other wallet"}.
                  </strong>{" "}
                  This wallet takes care of it: you can wake, roll, and ascend it here, paying from this wallet. Only that
                  wallet can unstake it.
                </>
              ) : (
                <>
                  <strong className="font-display">Held by {word.holder ? `${word.holder.slice(0, 6)}…${word.holder.slice(-4)}` : "a linked wallet"}.</strong>{" "}
                  It’s part of your bag. Switch to that wallet to stake, wake, or raise it.
                </>
              )}
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

      {/* care: the label says what staking buys THIS word, and the note says why Feed is off */}
      <div className={`grid grid-cols-2 gap-2 ${word.mine || word.care ? "" : "pointer-events-none opacity-40"}`}>
        <Button
          variant={word.staked ? "ghost" : "teal"}
          disabled={!word.mine}
          title={word.mine ? undefined : "Only the wallet that staked it can unstake it"}
          onClick={() => g.toggleStake(word.word)}
        >
          {word.staked ? "Unstake" : fullyRaised ? "Stake to earn" : "Stake for jackpot"}
        </Button>
        <Button
          variant="teal"
          disabled={feedOff !== null}
          title={feedOff ?? undefined}
          onClick={() => wake([word], { focus: word.word, reduced })}
        >
          <Alarm weight="fill" /> Wake {word.staked && h === "fed" && <Check weight="bold" size={14} />}
        </Button>
      </div>
      {word.mine && !word.staked && offGameWallet && (
        <p className="mt-2 text-xs font-bold text-candy-ink">
          This isn’t your game wallet. Once staked here, only this wallet, and the caretakers it names, can wake {word.word}.
        </p>
      )}
      {word.mine && <p className="mb-3 mt-2 text-xs text-ink/60">{note}</p>}
      {word.care && <p className="mb-3 mt-2 text-xs text-ink/60">{note}</p>}
      {!word.mine && !word.care && <div className="mb-3" />}

      {/* raise letters: the owner, or a caretaker of a staked word (Rolls.commitWordRoll) */}
      <Card className={`mb-3 ${word.mine || word.care ? "" : "pointer-events-none opacity-40"}`}>
        <div className="mb-2 flex items-center justify-between">
          <span className="font-display font-extrabold">Raise to UPPERCASE</span>
          <span className="text-xs text-ink/55">{word.upper.filter(Boolean).length}/5 · earns $WORD at 5/5</span>
        </div>
        {fullyRaised ? (
          <div className="flex items-center justify-center gap-1 rounded-xl bg-gold/15 py-2 text-center text-sm font-bold text-gold-ink">
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
        {!fullyRaised && <p className="mt-2 text-center text-xs text-ink/55">tap a lowercase letter to roll it · {fmtWord(g.price("roll"))} $WORD</p>}
      </Card>

      {/* prestige: hidden entirely while the contract has it switched off (maxLevel 0), except for
          a word with a paid, unfinished attempt: that one keeps its way to the sheet that finishes it */}
      {((fullyRaised && maxLevel > 0) || unfinishedAscent) && (
        <Card className={`mb-3 bg-gradient-to-b from-card to-gold/10 ${word.mine || word.care ? "" : "pointer-events-none opacity-40"}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1 font-display font-extrabold">
                Ascend <Star weight="fill" size={14} className="text-gold-ink" />
              </div>
              <div className="text-xs text-ink/55">
                {atTop
                  ? `${stageName(word.prestigeLevel)} · the top stage`
                  : `${stageName(word.prestigeLevel)} → ${stageName(word.prestigeLevel + 1)} · ${ascendOdds}% this try`}
              </div>
            </div>
            {/* Opens the ascend sheet (sheets/AscendSheet), where the try is made and its result
                shows. No price on this button: it spends nothing; the sheet's own button does. It
                opens for a paid, unfinished attempt whatever else is true of the word (unstaked
                since, or at the top): the sheet finishes that attempt with no stake check, and this
                is the only door to it (Bugbot on #229). */}
            <Button variant="gold" disabled={!door.open} onClick={() => g.openSheet({ kind: "ascend", word: word.word })}>
              {door.label}
            </Button>
          </div>
          {!atTop && (
            <p className="mt-2 text-xs text-ink/55">
              A try costs {fmtWord(ascendFee + g.price("prestigeSnack"))} $WORD. A hit raises its share of earnings and the bounty{" "}
              {STAGE_SHARE}. A miss never harms it and raises the next try’s odds {MISS_POINTS} points.
            </p>
          )}
          {/* A try that ended paid and unfinished (the store remembers it for the session): the
              cue the old inline button's "Unfinished" label gave. */}
          {unfinishedAscent && (
            <p className="mt-2 text-xs font-bold text-gold-ink">
              Your last attempt is paid for and may be unfinished. Tap Finish to finish it: it takes no new fee.
            </p>
          )}
          {/* a new try needs the stake; finishing a paid attempt doesn't, so it isn't asked for there */}
          {!word.staked && !unfinishedAscent && <p className="mt-2 text-xs text-candy-ink">Stake it first to ascend.</p>}
        </Card>
      )}

      {/* Sell it on the Market (market/SellWord.tsx; the practice game has a practice Market). */}
      {word.mine && <SellWord word={word} />}

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

/**
 * The word's earnings, in one tappable row: what it has earned for the player and at the latest
 * payout, or the one thing that would make it earn. Opens Your earnings, or, on a row that says how
 * many letters are left to raise, the roll for the next one (earningsRowTarget).
 */
function EarningsRow({ word, h }: { word: OwnedWord; h: Hunger }) {
  const g = useGame();
  const e = g.earnings;
  const mineE = e?.byWord[word.word];
  const status = earningStatus(word, h);
  const when = e?.latestAt ? payoutWhen(e.latestAt) : null;
  const target = earningsRowTarget(word, { earned: mineE?.total ?? 0, status, pity: g.state.pity, rollProb: g.rollProb });
  return (
    <button
      onClick={() =>
        target.kind === "roll"
          ? g.openSheet({ kind: "roll", target: { kind: "word", word: word.word, pos: target.pos } })
          : g.openSheet({ kind: "earnings" })
      }
      className="cel-sm press mb-3 flex w-full items-center gap-2.5 rounded-xl bg-card px-3 py-2 text-left text-sm"
    >
      <Coins weight="fill" size={18} className="shrink-0 text-gold-ink" />
      <span className="min-w-0 flex-1">
        {/* What it earned. Hunger's effect on earning is the care note's to say (under Feed), so
            it isn't repeated here; a word that can't earn yet gets the step that would let it. */}
        {mineE && mineE.total > 0 ? (
          <span className="block">
            Earned you <strong className="font-display">{fmtWord(mineE.total)} $WORD</strong>
            {mineE.latest > 0 && when ? (
              <span className="font-bold text-gold-ink">
                {" "}
                (+{fmtWord(mineE.latest)} {when})
              </span>
            ) : null}
          </span>
        ) : (
          <span className="block">
            {status.kind === "raise" || status.kind === "unstaked"
              ? earningLine(word.word, status)
              : // null earnings are unknown (loading, or the read failed), never "earned nothing"
                e
                ? "Nothing earned yet. Its share comes with each daily payout."
                : "Adding up what it has earned…"}
          </span>
        )}
      </span>
      <CaretRight weight="bold" size={14} className="shrink-0 text-ink/45" />
    </button>
  );
}

