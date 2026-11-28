"use client";
/**
 * PreLaunchScreen — the pre-launch campaign splash, shown in place of the ENTIRE game when
 * `NEXT_PUBLIC_PRELAUNCH === "1"` (see the gate in GameApp). A two-step checklist (add the mini app,
 * share a cast) in Lexigotchi's cel / vaudeville aesthetic. The free pack is no longer this campaign's
 * reward: every verified player gets a pack of 5 plus 10 daily letters at launch (decisions.md #21),
 * so nothing here promises it. The adds and verified shares are still recorded: they'll mark the
 * players who were there before opening night (a future "Opening Night" Wordmark, parked).
 *
 * Modelled on LHAW's `/splash` "OG Hunter" campaign, in Lexigotchi's design language. Step state is
 * now SERVER-BACKED: on mount we hydrate from `/api/campaign/status`, the add is persisted via
 * `record-add` (through `useAddMiniApp`), and the share is Neynar-verified via `verify-cast` (the
 * recorded proof = launch-day eligibility). The localStorage flags remain only as an optimistic
 * echo for instant UI; the database is the source of truth for the airdrop.
 *
 * It renders OUTSIDE GameProvider (the gate short-circuits before the store mounts), so it must
 * NOT use `useGame` / `useShare` / the game Toaster. It talks to the Farcaster SDK directly and
 * keeps its own local UI state. The Farcaster SDK is still available because `<Providers>` (which
 * loads it) sits above GameApp in `play/page.tsx`.
 */
import { useCallback, useEffect, useState } from "react";
import { SITE_URL } from "@/lib/site";
import { useViewer } from "../useViewer";
import { useAddMiniApp } from "../useAddMiniApp";
import { confirmShareCast, fetchCampaignStatus } from "../campaignClient";
import { TileCharacter, TileWord } from "../TileCharacter";
import { Button } from "../primitives";
import { Lockup } from "../../brand/Lockup";
import { Check, CircleNotch, Gift, Plus, ShareNetwork } from "../ui/icons";
import { EngravedMark } from "../EngravedMark";

/** What the player posts. Embeds the /play link so the cast renders a launchable Lexigotchi card. */
const SHARE_TEXT =
  "Lexigotchi opens soon: raise letters, own words, and chase the daily $WORD jackpot. 🎩\n\n" +
  "Every verified player starts with a free pack of 5 plus 10 free daily letters.";

type Step = "added" | "shared";

// Optimistic step flags (no backend in Phase 0). Loosely keyed by FID so a returning player sees
// their own progress; these are NOT the source of truth for the launch airdrop (Neynar is).
const flagKey = (step: Step, fid: number | null) => `lexigotchi:prelaunch:${step}:${fid ?? "anon"}`;
function readFlag(step: Step, fid: number | null): boolean {
  try {
    return localStorage.getItem(flagKey(step, fid)) === "1";
  } catch {
    return false;
  }
}
function writeFlag(step: Step, fid: number | null) {
  try {
    localStorage.setItem(flagKey(step, fid), "1");
  } catch {
    /* storage unavailable — keep the optimistic in-memory flag only */
  }
}

export function PreLaunchScreen() {
  const viewer = useViewer();
  const { add, adding, added: addedRemote, inFarcaster, ready } = useAddMiniApp();
  const fid = viewer.fid;
  const loading = !ready;

  const [addedLocal, setAddedLocal] = useState(false);
  const [sharedLocal, setSharedLocal] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Hydrate optimistic flags client-side only (matches OnboardingHost — no SSR/first-paint mismatch).
  useEffect(() => {
    setAddedLocal(readFlag("added", fid));
    setSharedLocal(readFlag("shared", fid));
  }, [fid]);

  // Server is the source of truth: promote to confirmed once the DB says added/shared (never demote).
  useEffect(() => {
    if (!inFarcaster) return;
    let alive = true;
    fetchCampaignStatus().then((s) => {
      if (!alive || !s) return;
      if (s.added) setAddedLocal(true);
      if (s.shared) setSharedLocal(true);
    });
    return () => {
      alive = false;
    };
  }, [inFarcaster]);

  const added = addedRemote || addedLocal;
  const shared = sharedLocal;
  const done = added && shared;

  const handleAdd = useCallback(async () => {
    setNote(null);
    const { ok, error } = await add();
    if (ok) {
      setAddedLocal(true);
      writeFlag("added", fid);
    } else if (error) {
      setNote(error);
    }
  }, [add, fid]);

  const handleShare = useCallback(async () => {
    setNote(null);
    const embeds = [`${SITE_URL}/play`] as [string];
    try {
      if (inFarcaster) {
        const sdk = (await import("@farcaster/miniapp-sdk")).default;
        // composeCast resolves with { cast: null } if the user closes the composer without posting.
        const result = await sdk.actions.composeCast({ text: SHARE_TEXT, embeds });
        if (!result?.cast) {
          setNote("Cast not shared yet. Tap Share to post it.");
          return;
        }
      } else {
        // Web fallback: open the Warpcast composer in a new tab (can't confirm the post here).
        const url = new URL("https://warpcast.com/~/compose");
        url.searchParams.set("text", SHARE_TEXT);
        embeds.forEach((e) => url.searchParams.append("embeds[]", e));
        window.open(url.toString(), "_blank", "noopener,noreferrer");
      }
      setSharedLocal(true);
      writeFlag("shared", fid);
      if (inFarcaster) void confirmShareCast(); // server-verify the cast (Neynar) → records the proof
    } catch {
      setNote("Couldn’t open the composer. Give it another go.");
    }
  }, [inFarcaster, fid]);

  const heroTitle = done ? "You’re on the list!" : "Get in before the doors open";
  const heroSub = done
    ? "You were here before the doors opened. We’ll raise the curtain soon. See you on opening night."
    : "Lexigotchi opens soon. Add the app and share a cast now to be there for opening night.";

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-paper">
      <div className="relative flex h-full w-full max-w-[560px] flex-col overflow-hidden bg-paper">
        {/* faint aged-paper grain */}
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{ backgroundImage: "radial-gradient(#e7d7b0 0.5px, transparent 0.5px)", backgroundSize: "14px 14px" }}
        />

        {/* header — brand + "coming soon" badge */}
        <header className="relative z-10 flex items-center justify-between border-b-[3px] border-ink bg-paper-dark/70 px-4 py-2.5">
          <Lockup alive height={28} />
          <span className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-gold px-2 py-0.5 text-xs font-medium text-ink">
            {/* on a gold chip a gold mark is lost: this one is filled with the twinkle's own cream */}
            <EngravedMark kind="twinkle" size={13} fill="#fff6dd" /> Coming soon
          </span>
        </header>

        <main className="relative flex-1 overflow-y-auto px-5 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-6">
          {/* hero — the mascot tile + the pitch (adapts once both steps are done) */}
          <div className="flex flex-col items-center gap-4 text-center">
            <TileCharacter char="L" detail="full" state={done ? "celebrate" : "idle"} size={132} />
            <div>
              <h1 className="font-display text-2xl font-extrabold leading-tight">{heroTitle}</h1>
              <p className="mx-auto mt-1.5 max-w-[22rem] text-sm leading-relaxed text-ink/70">{heroSub}</p>
            </div>
          </div>

          {/* what every verified player gets at launch (not exclusive to this campaign) */}
          <div className="cel mt-6 rounded-2xl bg-wash-gold p-4">
            <div className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-gold-ink">
              <Gift weight="fill" size={14} /> Free letters at launch
            </div>
            <div className="flex items-end justify-center py-1">
              <TileWord word="early" upper={[false, false, false, false, false]} detail="bust" size={48} />
            </div>
            <p className="mt-2 text-center text-xs leading-relaxed text-ink/70">
              Every verified player gets a <strong>free pack of 5</strong> plus <strong>10 free daily letters</strong>: prove you’re one person
              when the game opens.
            </p>
          </div>

          {/* web heads-up — adding requires a Farcaster client */}
          {!inFarcaster && !loading && (
            <div className="mt-4 rounded-xl border-2 border-gold/50 bg-gold/10 px-3 py-2 text-xs leading-relaxed text-ink/70">
              You’re on the web. Open Lexigotchi inside Farcaster to add the app. You can still share from here.
            </div>
          )}

          {/* the two steps */}
          <div className="cel mt-5 rounded-2xl bg-card p-4">
            <h2 className="font-display text-lg font-extrabold">Be there for opening night</h2>
            <p className="mb-3 text-xs text-ink/70">Do both before we launch, and we’ll remember you were here first.</p>

            <div className="space-y-2.5">
              <StepRow n={1} done={added} title="Add Lexigotchi" sub="Save it to your Farcaster mini apps.">
                {added ? (
                  <DoneTag>Added</DoneTag>
                ) : (
                  <Button size="sm" onClick={handleAdd} disabled={adding || loading || !inFarcaster}>
                    {adding ? <CircleNotch weight="bold" size={15} className="animate-spin" /> : <Plus weight="bold" size={15} />}
                    Add
                  </Button>
                )}
              </StepRow>

              <StepRow n={2} done={shared} title="Share a cast" sub="Post Lexigotchi so friends can join too.">
                {shared ? (
                  <DoneTag>Shared</DoneTag>
                ) : (
                  <Button size="sm" variant="teal" onClick={handleShare} disabled={loading}>
                    <ShareNetwork weight="fill" size={15} /> Share
                  </Button>
                )}
              </StepRow>
            </div>

            {note && <p className="mt-3 text-center text-xs font-medium text-candy-ink">{note}</p>}
          </div>

          <p className="mx-auto mt-5 max-w-[24rem] text-center text-xs leading-relaxed text-ink/70">
            We note it on your Farcaster account. No wallet needed yet.
          </p>
        </main>
      </div>
    </div>
  );
}

/** One checklist row: a numbered chip that flips to a green check, the label, and a right-side CTA. */
function StepRow({
  n,
  done,
  title,
  sub,
  children,
}: {
  n: number;
  done: boolean;
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border-2 p-3 transition-colors ${
        done ? "border-teal/40 bg-teal/10" : "border-ink/15 bg-card"
      }`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink font-display text-sm font-medium ${
          done ? "bg-teal text-ink" : "bg-card text-ink"
        }`}
      >
        {done ? <Check weight="bold" size={16} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-display text-sm font-extrabold leading-tight">{title}</div>
        <div className="text-xs leading-tight text-ink/70">{sub}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function DoneTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-teal-ink">
      <Check weight="bold" size={13} /> {children}
    </span>
  );
}
