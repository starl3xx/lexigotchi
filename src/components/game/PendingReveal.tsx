"use client";
/**
 * The stranded-pull recovery card, shared by Home and Mint.
 *
 * Renders only when the chain says this wallet has a paid, unrevealed commit — a pull whose
 * second transaction never landed (page closed between wallet prompts, reveal rejected, RPC
 * blip). The letters are deterministic in the commitId, so opening late yields exactly what
 * opening promptly would have — which is why the copy says "waiting", never "failed".
 */
import { Card, Button } from "./primitives";
import { Gift } from "./ui/icons";
import { useGame } from "./state";

export function PendingReveal() {
  const g = useGame();
  if (!g.state.chainBacked || g.pendingReveals === 0) return null;

  return (
    <Card className="border-gold bg-gold/10">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-ink/80">
          <span className="font-display font-extrabold">
            {g.pendingReveals === 1 ? "An unopened pull is waiting" : `${g.pendingReveals} unopened pulls are waiting`}
          </span>
          <div className="text-xs text-ink/55">Paid for and safe on-chain — open it to get your letters.</div>
        </div>
        <Button variant="primary" onClick={() => g.openPending()}>
          <Gift weight="fill" /> Open
        </Button>
      </div>
    </Card>
  );
}
