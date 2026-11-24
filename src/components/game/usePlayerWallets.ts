"use client";
/**
 * Every wallet that is this player, one list for the whole app: the connected wallet first, then
 * the wallets their Farcaster account verified, then every wallet linked into their profile (Link
 * another wallet). The bag, the dictionary's "yours", the swap board, and the badges all read it, so
 * "you" means the same thing on every screen. Display only: the contracts still act on the
 * connected wallet alone.
 */
import { useMemo } from "react";
import { useAccount } from "wagmi";
import { bagWalletsOf } from "@/lib/onchain/unionBag";
import { useViewer } from "./useViewer";
import { usePublicProfile } from "./useProfile";

export function usePlayerWallets(): `0x${string}`[] {
  const { address } = useAccount();
  const viewer = useViewer();
  const accountWallets = usePublicProfile().profile?.wallets;
  return useMemo(
    () => bagWalletsOf(address, [...(viewer.linkedWallets ?? []), ...(accountWallets ?? [])]),
    [address, viewer.linkedWallets, accountWallets],
  );
}
