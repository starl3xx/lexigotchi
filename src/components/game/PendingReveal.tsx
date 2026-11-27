"use client";
/**
 * Mail that waits to be opened, on Home and Mint (decisions.md #49).
 *
 * Two kinds, said the same way because to the player they are the same thing, an envelope that
 * hasn't been torn open:
 * - a paid pull whose reveal never landed (the page closed, the chain was slow). The letters are
 *   fixed by the commit, so opening late yields exactly what opening promptly would have, which is
 *   why the copy says "waiting", never "failed";
 * - a pack that arrived and whose sheet was closed before it was torn. Those letters are already in
 *   the bag: this is the ceremony, and nothing depends on it.
 */
import { Card, Button } from "./primitives";
import { useGame } from "./state";
import { MailThumb } from "./mail/MailThumb";

export function PendingReveal() {
  const g = useGame();
  if (g.pendingReveals === 0) return null;

  return (
    <Card className="border-gold bg-gold/10">
      <div className="flex items-center gap-3">
        <MailThumb width={92} />
        <div className="min-w-0 flex-1 text-sm text-ink/80">
          <span className="font-display font-extrabold leading-tight">
            {g.pendingReveals === 1 ? "Your mail is waiting" : `${g.pendingReveals} pieces of mail are waiting`}
          </span>
          <div className="text-xs text-ink/60">Yours, and safe onchain.</div>
        </div>
        <Button variant="primary" className="shrink-0" onClick={() => g.openPending()}>
          Open
        </Button>
      </div>
    </Card>
  );
}
