"use client";
/**
 * PreLaunchScreen — the pre-launch campaign splash, shown in place of the ENTIRE game when
 * `NEXT_PUBLIC_PRELAUNCH === "1"` (see the gate in GameApp). Players who add the mini app AND
 * share a cast before launch are promised a free 5-letter pack on day one. A two-step checklist
 * in Lexigotchi's cel / vaudeville aesthetic.
 *
 * Modelled on LHAW's `/splash` "OG Hunter" campaign, ported to Lexigotchi's design language and
 * its no-backend Phase 0. Key difference: there is no server to persist or verify the add/cast,
 * so step completion here is OPTIMISTIC (the SDK's own `added` flag + a localStorage marker for
 * the share). Real launch-day eligibility is reconciled operator-side from Neynar (who added the
 * app + a cast search for the `/play` embed) — NOT from these client flags. The screen makes a
 * promise; the airdrop is fulfilled from Neynar's record at launch.
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
import { TileCharacter, TileWord } from "../TileCharacter";
import { Button } from "../primitives";
import { Check, CircleNotch, Gift, Plus, ShareNetwork, Sparkle } from "../ui/icons";

/** What the player posts. Embeds the /play link so the cast renders a launchable Lexigotchi card. */
const SHARE_TEXT =
  "Lexigotchi is coming to Farcaster — raise letters, own words, chase the daily $WORD jackpot. 🎩\n\n" +
  "Add the app + share before launch and a free 5-letter pack is waiting for you on day one.";

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
          setNote("Cast not shared yet — tap Share to post it.");
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
    } catch {
      setNote("Couldn't open the composer — give it another go.");
    }
  }, [inFarcaster, fid]);

  const heroTitle = done ? "You're on the list!" : "Get in before the doors open";
  const heroSub = done
    ? "Your free 5-letter pack is reserved. We'll raise the curtain soon — see you on opening day."
    : "Lexigotchi opens soon. Add the app and share a cast now, and a free 5-letter pack will be waiting the moment we launch.";

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-ink/95 sm:items-center sm:p-4">
      <div className="relative flex h-full w-full max-w-[430px] flex-col overflow-hidden bg-paper sm:h-[880px] sm:max-h-full sm:rounded-[2.4rem] sm:border-[6px] sm:border-ink sm:shadow-[0_12px_0_#000]">
        {/* faint aged-paper grain */}
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{ backgroundImage: "radial-gradient(#e7d7b0 0.5px, transparent 0.5px)", backgroundSize: "14px 14px" }}
        />

        {/* header — brand + "coming soon" badge */}
        <header className="relative z-10 flex items-center justify-between border-b-[3px] border-ink bg-paper-dark/70 px-4 py-2.5">
          <span className="font-display text-base font-extrabold tracking-tight">LEXIGOTCHI</span>
          <span className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-gold px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-ink">
            <Sparkle weight="fill" size={11} /> Coming soon
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

          {/* reward — the free 5-pack */}
          <div className="cel mt-6 rounded-2xl bg-gradient-to-b from-paper to-gold/20 p-4">
            <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-gold-deep">
              <Gift weight="fill" size={14} /> Your launch-day reward
            </div>
            <div className="flex items-end justify-center py-1">
              <TileWord word="early" upper={[false, false, false, false, false]} detail="bust" size={48} />
            </div>
            <p className="mt-2 text-center text-xs leading-relaxed text-ink/65">
              A free <strong>5-letter pack</strong> — five fresh lowercase letters to start spelling and raising, dropped to you on day one.
            </p>
          </div>

          {/* web heads-up — adding requires a Farcaster client */}
          {!inFarcaster && !loading && (
            <div className="mt-4 rounded-xl border-2 border-gold/50 bg-gold/10 px-3 py-2 text-xs leading-relaxed text-ink/75">
              You&apos;re on the web — open Lexigotchi inside Farcaster to add the app. You can still share from here.
            </div>
          )}

          {/* the two steps */}
          <div className="cel mt-5 rounded-2xl bg-paper p-4">
            <h2 className="font-display text-lg font-extrabold">Two steps to claim it</h2>
            <p className="mb-3 text-xs text-ink/60">Do both before we launch to lock in your pack.</p>

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

            {note && <p className="mt-3 text-center text-xs font-bold text-candy">{note}</p>}
          </div>

          <p className="mx-auto mt-5 max-w-[24rem] text-center text-[11px] leading-relaxed text-ink/55">
            Your pack is tied to your Farcaster account and waiting at launch — no wallet needed yet.
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
        done ? "border-teal/40 bg-teal/10" : "border-ink/15 bg-paper"
      }`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink font-display text-sm font-extrabold ${
          done ? "bg-teal text-paper" : "bg-paper text-ink"
        }`}
      >
        {done ? <Check weight="bold" size={16} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-display text-sm font-extrabold leading-tight">{title}</div>
        <div className="text-[11px] leading-tight text-ink/60">{sub}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function DoneTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-extrabold text-teal">
      <Check weight="bold" size={13} /> {children}
    </span>
  );
}
