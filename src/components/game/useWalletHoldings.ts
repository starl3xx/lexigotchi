"use client";
/**
 * What each wallet in the player's profile holds: loose letters and $WORD (one multicall), and words
 * (from the bag, which already tags each word with its holder: undefined = the connected wallet).
 * Feeds the Wallets card, Move here, and the game wallet notices (lib/profile/gameWalletAdvice.ts).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { readWalletBalances } from "@/lib/onchain/reads";
import { NETWORK } from "@/lib/onchain/network";
import type { WalletHoldings } from "@/lib/profile/gameWalletAdvice";
import { useGame } from "./state";
import { usePublicProfile } from "./useProfile";

export function useWalletHoldings(): {
  /** The profile's wallets, the first first (just the connected one when nothing is linked). */
  wallets: string[];
  /** Lowercase wallet → holdings; a wallet is missing until its read lands. */
  holdings: Record<string, WalletHoldings>;
  gameWallet: string | null;
  refetch: () => void;
} {
  const { address } = useAccount();
  const { state } = useGame();
  const pub = usePublicProfile();
  const connected = address?.toLowerCase() ?? null;
  const wallets = useMemo(
    () => (pub.profile?.wallets?.length ? pub.profile.wallets : connected ? [connected] : []).map((w) => w.toLowerCase()),
    [pub.profile?.wallets, connected],
  );
  const q = useQuery({
    queryKey: ["walletHoldings", NETWORK.id, wallets.join(",")],
    queryFn: () => readWalletBalances(wallets as `0x${string}`[]),
    enabled: state.chainBacked && wallets.length > 0,
    staleTime: 15_000,
  });
  const holdings = useMemo(() => {
    const out: Record<string, WalletHoldings> = {};
    if (!q.data) return out;
    for (const w of wallets) {
      const b = q.data[w];
      if (!b) continue;
      const words = state.words.filter((x) => (x.holder ?? connected ?? "").toLowerCase() === w);
      out[w] = {
        letters: b.letters.reduce((a, n) => a + n, 0),
        words: words.filter((x) => !x.staked).length,
        staked: words.filter((x) => x.staked).length,
        word: Number(b.word / 10n ** 18n),
      };
    }
    return out;
  }, [q.data, wallets, state.words, connected]);
  return { wallets, holdings, gameWallet: pub.profile?.gameWallet ?? null, refetch: () => void q.refetch() };
}
