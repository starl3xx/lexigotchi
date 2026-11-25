"use client";
/**
 * The player's onchain badges (EAS attestations for the whole bag, lib/keeper/achievements), on
 * their profile. They lived on the Showcase until it folded into the Bag (starl3xx, 2026-11-25).
 * Nothing shows until something is earned: an empty answer is a fine one.
 */
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { ACHIEVEMENT_META } from "@/lib/keeper/achievements";
import { useGame } from "./state";
import { usePlayerWallets } from "./usePlayerWallets";

export function OnchainBadges() {
  const { state } = useGame();
  const { address } = useAccount();
  const wallets = usePlayerWallets();
  const [badges, setBadges] = useState<{ achievement: number; value: number }[]>([]);
  useEffect(() => {
    if (!state.chainBacked || !address || wallets.length === 0) return;
    let dead = false;
    void fetch(`/api/achievements?wallets=${wallets.join(",")}`)
      .then((r) => r.json())
      .then((d) => {
        if (!dead && d?.ok) setBadges(d.achievements);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [state.chainBacked, address, wallets]);

  const shown = badges.filter((b) => ACHIEVEMENT_META[b.achievement]);
  if (shown.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Your onchain badges">
      {shown.map((b) => {
        const meta = ACHIEVEMENT_META[b.achievement];
        return (
          <span
            key={b.achievement}
            className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-gold/15 px-2.5 py-1 text-xs font-bold"
            title="Onchain achievement (EAS attestation)"
          >
            {meta.emoji} {meta.name}
            {b.achievement === 3 && b.value ? ` ${b.value}%` : ""}
          </span>
        );
      })}
    </div>
  );
}
