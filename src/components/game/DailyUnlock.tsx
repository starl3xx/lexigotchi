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
import { Ticket, SealCheck, XLogo } from "./ui/icons";
import { useGame } from "./state";
import { useViewer } from "./useViewer";
import { useVerifiedWallet } from "./useVerifiedWallet";
import { usePublicProfile } from "./useProfile";
import { VERIFY_URL } from "@/lib/onchain/verifications";

/** One answer for "may this player pull the daily?" — both screens branch on this. */
export function useDailyEligibility(): { eligible: boolean; checking: boolean } {
  const viewer = useViewer();
  const { verified } = useVerifiedWallet();
  const x = usePublicProfile();
  return {
    eligible: viewer.isAuthed || x.xCounts || verified === true,
    // Farcaster context still resolving, the profile still loading, or the attestation check still
    // in flight — during any, the locked row would be a lie about a player about to be eligible.
    checking: viewer.environment === "loading" || (!viewer.isAuthed && !x.xCounts && (verified === null || x.loading)),
  };
}

export function DailyUnlock() {
  const viewer = useViewer();
  const { verified, recheck } = useVerifiedWallet();
  const { xEnabled } = usePublicProfile();
  const { openSheet } = useGame();
  const checking = viewer.environment === "loading" || verified === null;

  return (
    <div className="space-y-2">
      <div className="text-sm text-ink/70">
        One free letter a day, with Farcaster{xEnabled ? ", X," : ""} or a Coinbase-verified wallet.
        <div className="text-xs text-ink/50">
          {checking ? "Checking your wallet…" : `${xEnabled ? "Any one" : "Either one"} proves you’re one person, once a day.`}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="teal" disabled={viewer.environment === "loading"} onClick={viewer.signIn}>
          <Ticket weight="fill" /> Connect Farcaster
        </Button>
        {/* Linking X needs a wallet signature and a trip to X, which the Profile sheet runs. */}
        {xEnabled && (
          <Button variant="ghost" onClick={() => openSheet({ kind: "profile" })}>
            <XLogo weight="bold" /> Link X
          </Button>
        )}
        <a
          href={VERIFY_URL}
          target="_blank"
          rel="noreferrer"
          // Coming back attested changes nothing until we re-ask the chain, so the same tap that
          // sends them out also schedules the re-check they'd otherwise have to know to do.
          onClick={() => setTimeout(recheck, 4000)}
          className="cel press inline-flex items-center gap-1.5 rounded-xl bg-paper-dark px-3 py-2 text-sm font-extrabold"
        >
          <SealCheck weight="fill" size={15} /> Verify with Coinbase
        </a>
        {verified === false && (
          <button onClick={recheck} className="text-xs font-bold text-ink/45 underline">
            I verified. Check again
          </button>
        )}
      </div>
    </div>
  );
}
