/**
 * The collab words for a server render that only SHOWS a rarity (a share picture, a card's back, a
 * Telegram answer): quick, and never a failure. If the sets can't be read in time, the derived
 * tiers are drawn, which is what every word had before collab sets existed.
 *
 * Never for a path that PAYS by rarity: the keeper asks `collabNow` and refuses on "unknown"
 * (lib/keeper/jobs.ts). The sets module is loaded only when asked, so a picture route's first load
 * doesn't carry the database client it may never use.
 */
import { NO_COLLAB } from "./rarity";
import type { CollabLooks } from "./collabLook";

export async function collabSoon(ms = 1200): Promise<CollabLooks> {
  try {
    const { collabNow } = await import("@/lib/sets/server");
    const got = await Promise.race([collabNow(), new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
    return got?.known ? got.words : NO_COLLAB;
  } catch {
    return NO_COLLAB;
  }
}
