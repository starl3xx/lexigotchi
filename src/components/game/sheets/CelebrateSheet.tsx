"use client";
/**
 * A new word celebrates. Claiming is the biggest spend in the loop and used to end with a toast;
 * now the word stands up at full size in the rig's celebrate state, with staking as the one next
 * step. Opened by both stores when a claim lands (the chain store once the word reads back).
 *
 * A word BOUGHT on the Market celebrates here too (starl3xx, 2026-11-25: "Congrats, it's yours!" +
 * scene/card): it arrives finished, so it stands in its scene, the way it will on the Today stage
 * and in the Bag, over what the player paid. Its card (the back, Scene, Share) is one tap away in
 * the word's own sheet, so this sheet doesn't repeat it.
 */
import { SceneFrame } from "../../scenes/SceneFrame";
import { useWordScene } from "../../scenes/useWordScene";
import { TileWord, type Gild } from "../TileCharacter";
import { Button, Sheet } from "../primitives";
import { Eye, Ticket } from "../ui/icons";
import { hunger, useGame, type OwnedWord } from "../state";
import { useWorld } from "../useWorld";
import { useCostToMake } from "../WordValue";
import { Versus, useAmount } from "../market/bits";

export function CelebrateSheet({ word, bought }: { word: string; bought?: { price: number } }) {
  const g = useGame();
  const w = g.state.words.find((x) => x.word === word);
  if (!w) return null;
  return bought ? <BoughtWord w={w} price={bought.price} /> : <ClaimedWord w={w} />;
}

/**
 * What staking does for this word, as far as it's true. The jackpot's locked order never repeats a
 * word (WordValue says the same on a listing), so a word it already drew isn't promised the jackpot;
 * only a word with every letter UPPERCASE earns; and a BOUGHT word can arrive hungry, because the
 * hunger clock keeps running while a word is unstaked and for sale (Staking.stake starts only a
 * word's first stake fed), so staking alone wouldn't put it in the running. Pure, so it's tested.
 */
export function stakeStep(w: OwnedWord, drawn: boolean, bought = false): { line: string; offer: boolean } {
  const allUpper = w.upper.every(Boolean);
  if (w.staked) {
    if (drawn) return { line: allUpper ? "It’s staked and earning $WORD." : "It’s staked.", offer: false };
    return { line: `It’s staked and in the daily jackpot${allUpper ? ", earning $WORD" : ""}.`, offer: false };
  }
  const hungry = bought && hunger(w) === "hungry";
  const stake = hungry ? "It arrives hungry: stake it and feed it" : "Stake it";
  if (!drawn) return { line: `${stake} to enter it in the daily jackpot${allUpper ? " and start earning $WORD" : ""}.`, offer: true };
  if (allUpper) return { line: `${stake} to start earning $WORD. The jackpot already drew it, so it won’t be drawn again.`, offer: true };
  return { line: "The jackpot already drew it, so it won’t be drawn again. It earns $WORD once every letter is UPPERCASE and it’s staked.", offer: false };
}

function useStakeStep(w: OwnedWord, bought = false) {
  const drawn = useWorld().data?.drawn?.[w.word] !== undefined;
  return stakeStep(w, drawn, bought);
}

function StakeButton({ w, className = "" }: { w: OwnedWord; className?: string }) {
  const g = useGame();
  return (
    <Button
      variant="teal"
      className={className}
      onClick={() => {
        g.closeSheet();
        g.toggleStake(w.word);
      }}
    >
      <Ticket weight="fill" /> Stake it
    </Button>
  );
}

function ClaimedWord({ w }: { w: OwnedWord }) {
  const g = useGame();
  const step = useStakeStep(w);
  return (
    <Sheet open onClose={g.closeSheet} title="A new word">
      <div className="flex flex-col items-center gap-3 pb-2 text-center">
        <div className="pt-2">
          <TileWord word={w.word} upper={w.upper} state="celebrate" size={54} detail="full" tier={w.tier} />
        </div>
        <div className="font-display text-2xl font-extrabold">{w.word} is yours.</div>
        {/* The practice store stakes a word as it is claimed, so ask only when it isn't staked:
            toggleStake on a staked word would UNstake it (Bugbot on #125). */}
        <p className="max-w-[30ch] text-sm text-ink/70">One of one: nobody else can own it while you do. {step.line}</p>
        {step.offer ? (
          <div className="flex w-full gap-2 pt-1">
            <Button variant="ghost" className="flex-1" onClick={g.closeSheet}>
              Later
            </Button>
            <StakeButton w={w} className="flex-1" />
          </div>
        ) : (
          <Button variant="ghost" full onClick={g.closeSheet}>
            Done
          </Button>
        )}
      </div>
    </Sheet>
  );
}

function BoughtWord({ w, price }: { w: OwnedWord; price: number }) {
  const g = useGame();
  const amount = useAmount();
  const { scene } = useWordScene(w.word);
  const cost = useCostToMake(w);
  const step = useStakeStep(w, true);
  const gild = Math.max(0, Math.min(5, Math.round(w.prestigeLevel))) as Gild;
  const seeCard = () => g.openSheet({ kind: "word", word: w.word });
  return (
    <Sheet open onClose={g.closeSheet} title="Congrats!">
      <div className="flex flex-col items-center gap-3 pb-2 text-center">
        {/* The scene pops in once (the game's `pop`); the word inside it celebrates. */}
        <div className="animate-pop w-full overflow-hidden rounded-2xl border-[3px] border-ink shadow-[0_5px_0_#1b1714]">
          <SceneFrame scene={scene} word={w.word} upper={w.upper} state="celebrate" gild={gild} tier={w.tier} />
        </div>
        <div className="pt-1 font-display text-2xl font-extrabold">{w.word} is yours.</div>
        <p className="text-balance text-sm text-ink/70">
          Bought for <strong className="font-display text-ink">{amount(price)}</strong>
          <BoughtUnder price={price} reference={cost?.total} />
        </p>
        <p className="max-w-[36ch] text-balance text-sm text-ink/70">One of one: nobody else can own it while you do. {step.line}</p>
        <div className="flex w-full gap-2 pt-1">
          <Button variant="ghost" className="flex-1" onClick={seeCard}>
            <Eye weight="fill" /> See its card
          </Button>
          {step.offer && <StakeButton w={w} className="flex-1" />}
        </div>
      </div>
    </Sheet>
  );
}

/** ", 12% under what it costs to make": said only for a price under the cost, where it is news. */
function BoughtUnder({ price, reference }: { price: number; reference: number | undefined }) {
  if (!reference || price > reference * 0.97) return <>.</>;
  return (
    <>
      , <Versus price={price} reference={reference} />.
    </>
  );
}
