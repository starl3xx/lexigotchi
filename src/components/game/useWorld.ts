"use client";
/**
 * The shared world (who owns which word, the leaderboards, players' Farcaster faces) from
 * /api/world, cached for a minute like the server's own copy. Empty in the practice game.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WorldResponse } from "@/app/api/world/route";
import { usePlayerWallets } from "./usePlayerWallets";

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

/** The wallets that count as "you": the connected one, every wallet Farcaster links to you, and every wallet in your account. */
export function useMyWallets(): Set<string> {
  const wallets = usePlayerWallets();
  return useMemo(() => new Set<string>(wallets), [wallets]);
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
