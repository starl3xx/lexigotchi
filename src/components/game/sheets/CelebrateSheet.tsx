"use client";
/**
 * A new word celebrates. Claiming is the biggest spend in the loop and used to end with a toast;
 * now the word stands up at full size in the rig's celebrate state, with staking as the one next
 * step. Opened by both stores when a claim lands (the chain store once the word reads back).
 */
import { TileWord } from "../TileCharacter";
import { Button, Sheet } from "../primitives";
import { Ticket } from "../ui/icons";
import { useGame } from "../state";

export function CelebrateSheet({ word }: { word: string }) {
  const g = useGame();
  const w = g.state.words.find((x) => x.word === word);
  if (!w) return null;
  const allUpper = w.upper.every(Boolean);
  return (
    <Sheet open onClose={g.closeSheet} title="A new word">
      <div className="flex flex-col items-center gap-3 pb-2 text-center">
        <div className="pt-2">
          <TileWord word={w.word} upper={w.upper} state="celebrate" size={54} detail="full" />
        </div>
        <div className="font-display text-2xl font-extrabold">{w.word} is yours.</div>
        <p className="max-w-[30ch] text-sm text-ink/70">
          One of one: nobody else can own it while you do. Stake it to enter it in the daily jackpot
          {allUpper ? " and start earning $WORD" : ""}.
        </p>
        <div className="flex w-full gap-2 pt-1">
          <Button variant="ghost" className="flex-1" onClick={g.closeSheet}>
            Later
          </Button>
          <Button
            variant="teal"
            className="flex-1"
            onClick={() => {
              g.closeSheet();
              g.toggleStake(w.word);
            }}
          >
            <Ticket weight="fill" /> Stake it
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
