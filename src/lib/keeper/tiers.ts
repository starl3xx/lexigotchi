/**
 * The tiers an epoch is weighed with (decisions.md, "Collab sets", item 2).
 *
 * The keeper's yield and bounty splits weigh a word by its rarity AS THE GAME TREATS IT: a collab
 * word is Legendary from its set's reveal (lib/rarity.ts). That needs the collab words, read from
 * the sets. An epoch is money and can't be reopened, so it is weighed only with a read THIS run
 * made (`collabStrict`: never a copy kept from before a failure). The read is tried a few times;
 * if it still fails this throws and no epoch is opened. Never the derived tiers "for now": a
 * collab word's holder would be paid a Common's share for that day, for good.
 *
 * What a refusal costs: the keeper runs once a day (vercel.json), and each job fails alone (the
 * others still run). So a day whose yield job is refused has NO yield epoch unless the operator
 * runs the job again that day; the pool keeps the funds, and the following days pay from a larger
 * pool. A bounty week that is refused is retried each day until it opens. This adds no new way to
 * lose a day: an epoch's proofs are stored in the same database before it is opened, so a
 * database that can't be read already opened nothing.
 */
import { tierFn, type CollabWords } from "@/lib/rarity";
import type { TierOf } from "./shares";

/** How many times the sets are asked before the job gives up, and the wait between. */
export const TIER_READ_TRIES = 3;
const WAIT_MS = 1_500;

export async function epochTiers(
  what: string,
  read: () => Promise<CollabWords> = async () => (await import("@/lib/sets/server")).collabStrict(),
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<TierOf> {
  for (let attempt = 1; ; attempt++) {
    try {
      return tierFn(await read());
    } catch {
      if (attempt >= TIER_READ_TRIES) break;
      await wait(WAIT_MS);
    }
  }
  throw new Error(`${what}: the collab sets couldn't be read, so no epoch is opened on guessed rarities (run the job again once the database answers)`);
}
