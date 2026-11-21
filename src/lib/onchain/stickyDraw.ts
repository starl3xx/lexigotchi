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
  /** First write wins; returns the draw the row holds afterwards (ours, or a racing request's). */
  claim: (chainId: number, key: string, letterIndexes: number[]) => Promise<number[]>;
  /** Compare-and-set: replace only if the row still holds `expected`. False = someone beat us. */
  replaceIf: (chainId: number, key: string, expected: number[], next: number[]) => Promise<boolean>;
}

/** How many times to re-read after losing a race before giving up and drawing unstored. */
const MAX_ATTEMPTS = 5;

/**
 * The draw to sign for `key`. Every path returns what the ROW holds, never a private draw: a stored
 * draw that still fits is served; a missing one is claimed (first write wins); a stale one is
 * replaced only by compare-and-set, and a request that loses that race re-reads and serves the
 * winner. Supply only ever shrinks, so a winner computed from fresher supply also fits an older
 * view, and one that doesn't fit a fresher view is already unmintable onchain.
 */
export async function stickyDraw(
  args: { chainId: number; key: string; count: number; available: readonly number[]; draw: () => number[] },
  store: DrawStore | null = defaultStore(),
): Promise<number[]> {
  if (!store) return args.draw();
  const fits = (d: number[] | null): d is number[] => !!d && d.length === args.count && drawFits(d, args.available);
  try {
    let current = await store.read(args.chainId, args.key);
    if (fits(current)) return current;
    const fresh = args.draw();
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (current === null) {
        current = await store.claim(args.chainId, args.key, fresh);
        if (fits(current)) return current;
        continue; // a racing request stored a draw that is already unmintable: replace it
      }
      if (fits(current)) return current;
      if (await store.replaceIf(args.chainId, args.key, current, fresh)) return fresh;
      current = await store.read(args.chainId, args.key); // lost the race: serve the winner if it fits
    }
    console.error(`[draws] ${args.key}: could not settle the stored draw in ${MAX_ATTEMPTS} attempts`);
    return fresh;
  } catch (err) {
    // A paid commit must stay revealable through a database outage; the cost is that, for the
    // length of the outage, a draw can again differ after a cap-out. Say so loudly.
    console.error("[draws] the stored draw is unavailable, drawing without it:", err);
    return args.draw();
  }
}

function defaultStore(): DrawStore | null {
  if (!isCampaignConfigured()) return null;
  return {
    read: async (chainId, key) => (await import("@/lib/db/draws")).readDraw(chainId, key),
    claim: async (chainId, key, letterIndexes) => (await import("@/lib/db/draws")).claimDraw(chainId, key, letterIndexes),
    replaceIf: async (chainId, key, expected, next) =>
      (await import("@/lib/db/draws")).replaceDrawIf(chainId, key, expected, next),
  };
}
