"use client";
/**
 * The shared world (who owns which word, the leaderboards, players' Farcaster faces) from
 * /api/world, cached for a minute like the server's own copy. Empty in the practice game.
 */
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import type { WorldResponse } from "@/app/api/world/route";
import { useViewer } from "./useViewer";

export function useWorld() {
  return useQuery({
    queryKey: ["world"],
    queryFn: async (): Promise<WorldResponse> => {
      const res = await fetch("/api/world");
      if (!res.ok) throw new Error(`world ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

/** The wallets that count as "you": the connected one plus every wallet Farcaster links to you. */
export function useMyWallets(): Set<string> {
  const { address } = useAccount();
  const viewer = useViewer();
  const mine = new Set<string>((viewer.linkedWallets ?? []).map((a) => a.toLowerCase()));
  if (address) mine.add(address.toLowerCase());
  return mine;
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
