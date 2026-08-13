"use client";
/**
 * The current player's Farcaster identity, unified across the two ways they can arrive:
 *   - inside a Farcaster client → the Mini App SDK context (auto-authenticated, no prompt)
 *   - on the open web → Sign In With Farcaster, exchanged for a Quick Auth JWT (lib/auth/siwfWeb)
 *
 * The web path replaced Sign In With Neynar, which retires 2026-08-14. It is not merely a
 * like-for-like swap: SIWN gave a display identity and nothing else, whereas the SIWF exchange
 * yields a token the API routes already accept — so a web player can actually mint.
 *
 * Screens use this to greet the player, gate the FID-only daily mint, and decide whether to show a
 * "connect Farcaster" affordance. `environment` is "loading" until the SDK resolves.
 */
import { useCallback, useEffect, useState } from "react";
import { useMiniApp } from "@neynar/react";
import { clearWebSession, webSession } from "@/lib/auth/siwfWeb";
import type { FarcasterProfile } from "@/lib/neynar";

export type Environment = "loading" | "farcaster" | "web";

/** Fired by `signIn()`; WebSignInHost listens and renders the approval UI. */
export const SIGN_IN_EVENT = "lexi:signin";
/** Fired when a web session is established or cleared, so every useViewer re-reads. */
export const SESSION_EVENT = "lexi:session";

export interface Viewer {
  fid: number | null;
  username: string | null;
  pfpUrl: string | null;
  displayName: string | null;
  isAuthed: boolean;
  environment: Environment;
  /**
   * The wallets Farcaster links to this account (custody + verified, lowercase) — null until the
   * profile resolves, and always null inside a Farcaster host (the connected wallet there IS a
   * linked one). Lets the web UI warn when letters are about to mint into an unlinked wallet and
   * fork the player's bag across contexts.
   */
  linkedWallets: string[] | null;
  /** Start Sign In With Farcaster (web only; a no-op inside a Farcaster client). */
  signIn: () => void;
  signOut: () => void;
}

export function useViewer(): Viewer {
  const mini = useMiniApp();
  const [session, setSession] = useState(() => webSession());
  const [profile, setProfile] = useState<FarcasterProfile | null>(null);

  // Re-read on session changes so a completed sign-in updates every consumer at once.
  useEffect(() => {
    const sync = () => setSession(webSession());
    window.addEventListener(SESSION_EVENT, sync);
    return () => window.removeEventListener(SESSION_EVENT, sync);
  }, []);

  // A SIWF credential proves the FID but carries no username or avatar — fetch them once.
  useEffect(() => {
    const fid = session?.fid;
    if (!fid) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    void fetch(`/api/auth/profile?fid=${fid}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.ok) setProfile(d.profile as FarcasterProfile);
      })
      .catch(() => {
        /* cosmetic — the FID alone is enough to play */
      });
    return () => {
      cancelled = true;
    };
  }, [session?.fid]);

  const signIn = useCallback(() => {
    window.dispatchEvent(new Event(SIGN_IN_EVENT));
  }, []);

  const signOut = useCallback(() => {
    clearWebSession();
    window.dispatchEvent(new Event(SESSION_EVENT));
  }, []);

  // In a Farcaster client: the SDK context is the source of truth.
  const ctxUser = mini.context?.user;
  if (mini.isSDKLoaded && ctxUser?.fid) {
    return {
      fid: ctxUser.fid,
      username: ctxUser.username ?? null,
      pfpUrl: ctxUser.pfpUrl ?? null,
      displayName: ctxUser.displayName ?? ctxUser.username ?? null,
      isAuthed: true,
      environment: "farcaster",
      linkedWallets: null, // in-host the connected wallet is a linked one by construction
      signIn,
      signOut,
    };
  }

  // On the web: a SIWF session, if present. The profile fills in a moment later; the FID is what
  // actually gates play, so an unresolved profile never blocks anything.
  if (session) {
    return {
      fid: session.fid,
      username: profile?.username ?? null,
      pfpUrl: profile?.pfpUrl ?? null,
      displayName: profile?.displayName ?? profile?.username ?? `fid ${session.fid}`,
      isAuthed: true,
      environment: "web",
      linkedWallets: profile?.linkedWallets ?? null,
      signIn,
      signOut,
    };
  }

  return {
    fid: null,
    username: null,
    pfpUrl: null,
    displayName: null,
    isAuthed: false,
    environment: mini.isSDKLoaded ? "web" : "loading",
    linkedWallets: null,
    signIn,
    signOut,
  };
}
