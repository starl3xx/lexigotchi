"use client";
/**
 * The free letters' locked state, shared by Home and Mint so the two screens can never disagree about
 * who gets them: a free pack of 5 plus 10 free daily letters (decisions.md #21).
 *
 * Two identities unlock it — a Farcaster sign-in, or a Coinbase-verified wallet — shown as two
 * CTAs, not a hierarchy: a Base App player has no Farcaster context at all (the host dropped FID
 * identity 2026-04-09), so for them the verify path isn't the fallback, it's the door.
 */
import { useAccount } from "wagmi";
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
  const { address } = useAccount();
  const { verified } = useVerifiedWallet();
  const x = usePublicProfile();
  return {
    eligible: viewer.isAuthed || x.xCounts || verified === true,
    // Farcaster context still resolving, the profile still loading, or the attestation check still
    // in flight — during any, the locked row would be a lie about a player about to be eligible.
    // With no wallet there is nothing to check: `verified` stays null for good, so it can't count.
    checking:
      viewer.environment === "loading" || (!viewer.isAuthed && !x.xCounts && ((Boolean(address) && verified === null) || x.loading)),
  };
}

export function DailyUnlock() {
  const viewer = useViewer();
  const { verified, recheck } = useVerifiedWallet();
  const { xEnabled } = usePublicProfile();
  const { openSheet } = useGame();
  const { address } = useAccount();
  // No wallet, nothing to check: useVerifiedWallet keeps `null` until a wallet connects.
  const checking = viewer.environment === "loading" || (Boolean(address) && verified === null);

  return (
    <div className="space-y-2">
      <div className="text-sm text-ink/70">
        A free pack of 5 plus 10 free daily letters, for linking Farcaster{xEnabled ? ", X," : ""} or a Coinbase-verified wallet.
        <div className="text-xs text-ink/70">
          {checking ? "Checking your wallet…" : `${xEnabled ? "Any one" : "Either one"} proves you’re one person.`}
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
          <button onClick={recheck} className="text-xs font-medium text-ink/70 underline">
            I verified. Check again
          </button>
        )}
      </div>
    </div>
  );
}
