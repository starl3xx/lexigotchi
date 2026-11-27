"use client";
/**
 * The player's name as the game shows it everywhere: the handle of the linked account they chose,
 * with its @ ("@mabel": Farcaster's or X's, `useProfile`'s `resolveIdentity`), or null for a player
 * with neither. The envelope a pack comes in is addressed with it (decisions.md #49; starl3xx:
 * "@username (with the @) if they have one", else "For you").
 */
import { useViewer } from "./useViewer";
import { resolveIdentity, useProfile } from "./useProfile";

export function useMyName(): string | null {
  const viewer = useViewer();
  const profile = useProfile();
  return resolveIdentity(viewer, profile.profile).name;
}
