/**
 * One valid letter draw per pack commit (or per identity-day for the daily), not one per request.
 *
 * `drawLetters` is deterministic in its seed AND in which letters are still uncapped, so the same
 * commit drawn twice can differ once a letter caps out in between. Both signatures would then be
 * valid onchain, and a player holding an unrevealed pack could pick the better one. So the first
 * draw is stored (schema.ts → letterDraws) and served again for as long as it can still be minted.
 * When it no longer fits the supply, its own signature is dead too (the reveal would revert
 * CapExceeded), so drawing again creates no second valid option.
 */
import { isCampaignConfigured } from "@/lib/db/client";

/** True when every letter of `draw` still has supply left (counting repeats). */
export function drawFits(draw: readonly number[], available: readonly number[]): boolean {
  const need = new Map<number, number>();
  for (const i of draw) need.set(i, (need.get(i) ?? 0) + 1);
  for (const [i, n] of need) if ((available[i] ?? 0) < n) return false;
  return true;
}

export interface DrawStore {
  read: (chainId: number, key: string) => Promise<number[] | null>;
  /** First write wins; returns the draw the store holds afterwards. */
  claim: (chainId: number, key: string, letterIndexes: number[]) => Promise<number[]>;
  /** Overwrite a stored draw that no longer fits the supply. */
  replace: (chainId: number, key: string, letterIndexes: number[]) => Promise<void>;
}

export async function stickyDraw(
  args: { chainId: number; key: string; count: number; available: readonly number[]; draw: () => number[] },
  store: DrawStore | null = defaultStore(),
): Promise<number[]> {
  if (!store) return args.draw();
  let stored: number[] | null = null;
  try {
    stored = await store.read(args.chainId, args.key);
  } catch (err) {
    // A paid commit must stay revealable through a database outage; the cost is that, for the
    // length of the outage, a draw can again differ after a cap-out. Say so loudly.
    console.error("[draws] reading the stored draw failed, drawing without it:", err);
    return args.draw();
  }
  if (stored && stored.length === args.count && drawFits(stored, args.available)) return stored;

  const fresh = args.draw();
  try {
    if (stored) {
      await store.replace(args.chainId, args.key, fresh);
      return fresh;
    }
    // First draw for this key. If a racing request stored one a moment ago, serve that one.
    const winner = await store.claim(args.chainId, args.key, fresh);
    return winner.length === args.count && drawFits(winner, args.available) ? winner : fresh;
  } catch (err) {
    console.error("[draws] storing the draw failed:", err);
    return fresh;
  }
}

function defaultStore(): DrawStore | null {
  if (!isCampaignConfigured()) return null;
  return {
    read: async (chainId, key) => (await import("@/lib/db/draws")).readDraw(chainId, key),
    claim: async (chainId, key, letterIndexes) => (await import("@/lib/db/draws")).claimDraw(chainId, key, letterIndexes),
    replace: async (chainId, key, letterIndexes) => (await import("@/lib/db/draws")).writeDraw(chainId, key, letterIndexes),
  };
}
