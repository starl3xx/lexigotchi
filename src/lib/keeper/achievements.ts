import { LETTERS_BY_FREQUENCY, ALPHABET } from "@/lib/economy";
import { WORD_COUNT } from "@/lib/dictionary";
import type { KeeperWord } from "./shares";

/**
 * On-chain achievements — EAS attestations the keeper issues for milestones.
 *
 * Schema `uint8 achievement,uint32 value` (irrevocable, no resolver), registered on Base Sepolia
 * as config/deployments.base-sepolia.json's `easAchievementsSchema`. Attestations live on the EAS
 * predeploy, so badges are composable reputation: any app can read "this wallet claimed its first
 * word" without asking us. Issuance is keeper-side because the triggering facts (bag contents,
 * dictionary share) are aggregate reads no contract tracks.
 *
 * All pure computation here; the keeper script owns I/O. Determinism matters the usual way:
 * re-running must propose the same set, so the already-attested filter can dedupe.
 */

export const ACHIEVEMENT = {
  /** Claimed a word — the first real step from letters to language. */
  FIRST_WORD: 1,
  /** Holds a grail — one of the five rarest letters, either case. */
  FIRST_GRAIL: 2,
  /** Owns `value` percent of the dictionary (milestones, not every tick). */
  DICTIONARY_PCT: 3,
  /** Ascended a word to its first gilded level. */
  ASCENDED: 4,
} as const;

export const ACHIEVEMENT_META: Record<number, { name: string; emoji: string }> = {
  1: { name: "First Word", emoji: "📜" },
  2: { name: "Grail Holder", emoji: "💎" },
  3: { name: "Lexicographer", emoji: "📖" },
  4: { name: "Ascended", emoji: "⭐" },
};

/** Dictionary-share milestones worth an attestation (percent). */
export const DICTIONARY_MILESTONES = [1, 5, 10, 25, 50, 100] as const;

/** The five rarest letters (the GRAILS 💎 set the Mint screen shows), as 0–25 indexes. */
const GRAIL_INDEXES = new Set(LETTERS_BY_FREQUENCY.slice(-5).map((ch) => ALPHABET.indexOf(ch)));

export interface AchievementLeaf {
  recipient: `0x${string}`;
  achievement: number;
  value: number;
}

/**
 * Everything every wallet has earned, from a world snapshot. `letterCounts` is 52-wide
 * (26 lower + 26 upper) per wallet — a grail counts in either case.
 */
export function computeAchievements(
  words: readonly KeeperWord[],
  letterCounts: ReadonlyMap<string, readonly number[]>,
): AchievementLeaf[] {
  const out: AchievementLeaf[] = [];
  const wordsByOwner = new Map<string, KeeperWord[]>();
  for (const w of words) {
    const key = w.owner.toLowerCase();
    (wordsByOwner.get(key) ?? wordsByOwner.set(key, []).get(key)!).push(w);
  }

  for (const [owner, owned] of [...wordsByOwner.entries()].sort()) {
    const recipient = owner as `0x${string}`;
    out.push({ recipient, achievement: ACHIEVEMENT.FIRST_WORD, value: 1 });
    if (owned.some((w) => w.prestigeLevel >= 1)) {
      out.push({ recipient, achievement: ACHIEVEMENT.ASCENDED, value: 1 });
    }
    const pct = Math.floor((owned.length / WORD_COUNT) * 100);
    for (const m of DICTIONARY_MILESTONES) {
      if (pct >= m) out.push({ recipient, achievement: ACHIEVEMENT.DICTIONARY_PCT, value: m });
    }
  }

  for (const [wallet, counts] of [...letterCounts.entries()].sort()) {
    const holdsGrail = counts.some(
      (c, i) => c > 0 && GRAIL_INDEXES.has(i % 26),
    );
    if (holdsGrail) {
      out.push({ recipient: wallet as `0x${string}`, achievement: ACHIEVEMENT.FIRST_GRAIL, value: 1 });
    }
  }
  return out;
}
