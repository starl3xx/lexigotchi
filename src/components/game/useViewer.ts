"use client";
/**
 * The current player's Farcaster identity, unified across the two ways they can arrive:
 *   - inside a Farcaster client → the Mini App SDK context (auto-authenticated, no prompt)
 *   - on the open web → Sign In With Neynar (the `signIn` action opens the SIWN flow)
 *
 * Screens use this to greet the player, gate the FID-only daily mint, and decide whether to show
 * a "connect Farcaster" affordance. `environment` is "loading" until the SDK resolves.
 */
import { useCallback } from "react";
import { useMiniApp, useNeynarContext } from "@neynar/react";

export type Environment = "loading" | "farcaster" | "web";

export interface Viewer {
  fid: number | null;
  username: string | null;
  pfpUrl: string | null;
  displayName: string | null;
  isAuthed: boolean;
  environment: Environment;
  /** Open Sign In With Neynar (web only; a no-op inside a Farcaster client). */
  signIn: () => void;
  signOut: () => void;
}

export function useViewer(): Viewer {
  const mini = useMiniApp();
  const neynar = useNeynarContext();

  const signIn = useCallback(() => {
    // NeynarAuthButton drives the actual popup; expose a programmatic entry where useful.
    const btn = document.querySelector<HTMLButtonElement>("[data-lexi-siwn] button");
    btn?.click();
  }, []);
  const signOut = useCallback(() => neynar.logoutUser?.(), [neynar]);

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
      signIn,
      signOut,
    };
  }

  // On the web: a Sign In With Neynar session, if present.
  if (neynar.isAuthenticated && neynar.user) {
    const u = neynar.user;
    return {
      fid: u.fid,
      username: u.username,
      pfpUrl: u.pfp_url ?? null,
      displayName: u.display_name ?? u.username,
      isAuthed: true,
      environment: "web",
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
    signIn,
    signOut,
  };
}
