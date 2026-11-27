/**
 * The tiers an epoch is weighed with (decisions.md, "Collab sets", item 2).
 *
 * The keeper's yield and bounty splits weigh a word by its rarity AS THE GAME TREATS IT: a collab
 * word is Legendary from its set's reveal (lib/rarity.ts). That needs the collab words, read from
 * the sets. An epoch is money and can't be reopened, so when the sets can't be read NOTHING is
 * opened: this throws, the job fails loudly, and the next run tries again. Never the derived tiers
 * "for now": a collab word's holder would be paid a Common's share for that day, for good.
 */
import { tierFn, type CollabWords } from "@/lib/rarity";
import type { TierOf } from "./shares";

export async function epochTiers(
  what: string,
  read: () => Promise<{ known: boolean; words: CollabWords }> = async () => (await import("@/lib/sets/server")).collabNow(),
): Promise<TierOf> {
  let collab: { known: boolean; words: CollabWords };
  try {
    collab = await read();
  } catch {
    collab = { known: false, words: new Set() };
  }
  if (!collab.known) throw new Error(`${what}: the collab sets couldn't be read, so no epoch is opened on guessed rarities (the next run tries again)`);
  return tierFn(collab.words);
}
