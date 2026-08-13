"use client";
/**
 * The daily's locked state, shared by Home and Mint so the two screens can never disagree about
 * who gets the free letter.
 *
 * Two identities unlock it — a Farcaster sign-in, or a Coinbase-verified wallet — shown as two
 * CTAs, not a hierarchy: a Base App player has no Farcaster context at all (the host dropped FID
 * identity 2026-04-09), so for them the verify path isn't the fallback, it's the door.
 */
import { Button } from "./primitives";
import { Ticket, SealCheck } from "./ui/icons";
import { useViewer } from "./useViewer";
import { useVerifiedWallet } from "./useVerifiedWallet";
import { VERIFY_URL } from "@/lib/onchain/verifications";

/** One answer for "may this player pull the daily?" — both screens branch on this. */
export function useDailyEligibility(): { eligible: boolean; checking: boolean } {
  const viewer = useViewer();
  const { verified } = useVerifiedWallet();
  return {
    eligible: viewer.isAuthed || verified === true,
    // Farcaster context still resolving, or the attestation check still in flight — during either,
    // the locked row would be a lie about a player who is about to be eligible.
    checking: viewer.environment === "loading" || (!viewer.isAuthed && verified === null),
  };
}

export function DailyUnlock() {
  const viewer = useViewer();
  const { verified, recheck } = useVerifiedWallet();
  const checking = viewer.environment === "loading" || verified === null;

  return (
    <div className="space-y-2">
      <div className="text-sm text-ink/70">
        One free letter a day — with Farcaster, or a Coinbase-verified wallet.
        <div className="text-xs text-ink/50">
          {checking ? "Checking your wallet…" : "Either one proves you're one person, once a day."}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="teal" disabled={viewer.environment === "loading"} onClick={viewer.signIn}>
          <Ticket weight="fill" /> Connect Farcaster
        </Button>
        <a
          href={VERIFY_URL}
          target="_blank"
          rel="noreferrer"
          // Coming back attested changes nothing until we re-ask the chain, so the same tap that
          // sends them out also schedules the re-check they'd otherwise have to know to do.
          onClick={() => setTimeout(recheck, 4000)}
          className="cel inline-flex items-center gap-1.5 rounded-xl bg-paper-dark px-3 py-2 text-sm font-extrabold"
        >
          <SealCheck weight="fill" size={15} /> Verify with Coinbase
        </a>
        {verified === false && (
          <button onClick={recheck} className="text-xs font-bold text-ink/45 underline">
            I verified — check again
          </button>
        )}
      </div>
    </div>
  );
}
