"use client";
/** Mint — pull lowercase letters. Daily single (FID-gated) + packs of 5. Odds mirror the dictionary. */
import { LETTERS_BY_FREQUENCY } from "@/lib/economy";
import { Button, Card, Countdown, SectionTitle } from "../primitives";
import { LetterTile } from "../LetterTile";
import { Check, Package, Sparkle, Ticket } from "../ui/icons";
import { COST, fmtUsd, fmtWord, useGame } from "../state";

export function MintScreen() {
  const g = useGame();
  const { state } = g;
  const common = LETTERS_BY_FREQUENCY.slice(0, 5);
  const rare = LETTERS_BY_FREQUENCY.slice(-5);

  return (
    <div className="space-y-3">
      <div>
        <h1 className="font-display text-2xl font-extrabold">Mint letters</h1>
        <p className="text-sm text-ink/60">
          Every pull is <strong>lowercase</strong>. Capitals are <em>raised</em> in the Roll, never pulled.
        </p>
      </div>

      {/* daily single */}
      <Card className="bg-paper">
        <SectionTitle action={<span className="text-xs text-ink/55">1 / day · FID</span>}>Daily single</SectionTitle>
        {state.dailyMinted ? (
          <div className="flex items-center justify-between text-sm text-ink/70">
            <span className="inline-flex items-center gap-1">
              Pulled today <Check weight="bold" size={13} className="text-teal" />
            </span>
            <span className="text-xs text-ink/50">resets in <Countdown /></span>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink/70">The cheap habit pull. {fmtWord(COST.daily)} $WORD</span>
            <Button disabled={!g.canAfford(COST.daily)} onClick={() => g.dailyMint()}>
              <Ticket weight="fill" /> Pull
            </Button>
          </div>
        )}
      </Card>

      {/* pack of 5 */}
      <Card className="bg-gradient-to-b from-paper to-candy/10">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-display text-xl font-extrabold">Pack of 5</div>
            <div className="text-xs text-ink/60">{fmtWord(COST.pack)} $WORD · {fmtUsd(COST.pack)}</div>
          </div>
          <Package weight="fill" size={40} className="text-candy" />
        </div>
        <Button
          full
          size="lg"
          variant="primary"
          className="mt-3"
          disabled={!g.canAfford(COST.pack)}
          onClick={() => {
            const idxs = g.openPack();
            if (idxs.length) g.openSheet({ kind: "pack", letters: idxs });
          }}
        >
          {g.canAfford(COST.pack) ? (
            <>
              <Package weight="fill" /> Rip a pack open
            </>
          ) : (
            "Not enough $WORD"
          )}
        </Button>
      </Card>

      {/* odds preview */}
      <Card>
        <SectionTitle>The odds mirror the dictionary</SectionTitle>
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-ink/50">most common</div>
            <div className="flex gap-2">
              {common.map((L) => <LetterTile key={L} char={L} size={38} />)}
            </div>
          </div>
          <div>
            <div className="mb-1 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-ink/50">
              the chase <Sparkle weight="fill" size={11} className="text-gold-deep" />
            </div>
            <div className="flex gap-2">
              {rare.map((L) => <LetterTile key={L} char={L} size={38} />)}
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-ink/55">
          A letter&apos;s pull rate = its share of the 22,190 dictionary slots. Q is the Charizard.
        </p>
      </Card>
    </div>
  );
}
