"use client";
/**
 * Is the connected wallet Coinbase-verified (and therefore daily-eligible without Farcaster)?
 *
 * Three-valued on purpose: `null` means UNKNOWN — still checking, or the check itself failed.
 * The screens gate the daily on this, and the two wrong collapses are both player-hostile:
 * unknown→false hides the daily from a verified player during an RPC blip; unknown→true shows a
 * button whose voucher request is about to 403. `null` renders as "checking…", never as either.
 *
 * Cached per address at module level so Home and Mint don't double-fetch, with `recheck` to bust
 * it — the player who just came back from coinbase.com/onchain-verify needs a way to be re-asked.
 */
import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";

const cache = new Map<string, Promise<boolean | null>>();

async function fetchStatus(wallet: string): Promise<boolean | null> {
  try {
    const res = await fetch(`/api/verify/status?wallet=${wallet}`);
    const data = await res.json();
    // 502 verification_unavailable (or any non-ok) is UNKNOWN, not unverified.
    return data?.ok ? Boolean(data.verified) : null;
  } catch {
    return null;
  }
}

export function useVerifiedWallet(): { verified: boolean | null; recheck: () => void } {
  const { address } = useAccount();
  const [verified, setVerified] = useState<boolean | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!address) {
      setVerified(null);
      return;
    }
    const key = address.toLowerCase();
    let hit = cache.get(key);
    if (!hit) {
      hit = fetchStatus(key);
      cache.set(key, hit);
      // A failed check must not be cached as a permanent "unknown" — let the next mount retry.
      void hit.then((v) => {
        if (v === null) cache.delete(key);
      });
    }
    let cancelled = false;
    void hit.then((v) => {
      if (!cancelled) setVerified(v);
    });
    return () => {
      cancelled = true;
    };
  }, [address, generation]);

  const recheck = useCallback(() => {
    if (address) cache.delete(address.toLowerCase());
    setGeneration((g) => g + 1);
  }, [address]);

  return { verified, recheck };
}
