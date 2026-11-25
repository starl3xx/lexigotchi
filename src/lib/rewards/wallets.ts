import { isAddress } from "viem";

/** The union bag is the connected wallet plus a few linked ones; anything longer is not a player. */
export const MAX_REWARD_WALLETS = 20;

/**
 * `?wallets=0xa,0xb` for the rewards routes: lowercase, deduped, valid addresses only. Null when
 * there are none or too many (the route answers 400).
 */
export function parseRewardWallets(raw: string | null): string[] | null {
  const wallets = new Set<string>(
    (raw ?? "").split(",").map((w) => w.trim().toLowerCase()).filter((w) => isAddress(w, { strict: false })),
  );
  if (wallets.size === 0 || wallets.size > MAX_REWARD_WALLETS) return null;
  return [...wallets];
}
