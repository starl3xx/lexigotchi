/**
 * A word's ascension stage, on the server, for the pictures of its card (decisions.md #48): the
 * letters on a link picture, a saved picture, and the share video wear the word's gilding, as they
 * do in the game. Read from the chain (`Words.prestigeLevel`) and kept for a few minutes: a stage
 * can change, so it is never kept for good, unlike a card's number.
 *
 * Nothing here trusts a caller. A picture's address may carry a stage (`g`, lib/showcase), but only
 * so that a word's picture gets a new address when its stage changes: what is DRAWN is the chain's.
 */
import { after } from "next/server";
import { addressOf, isSuiteDeployed } from "./addresses";
import { wordsAbi } from "./abis";
import { getPublicClient } from "./reads";
import { tokenIdOf } from "./tokenId";

const LEVEL_TTL_MS = 5 * 60_000;
/** How long a picture or a page waits for the stage before it is drawn without one: as long as it waits for the number (cardNumbers, NUMBER_WAIT_MS). */
export const LEVEL_WAIT_MS = 1500;
const known = new Map<string, { at: number; level: number }>();
const reading = new Map<string, Promise<number>>();

/** One word's stage (0 to 5), or null when the game isn't deployed or the read failed. */
export async function cardLevelOf(word: string): Promise<number | null> {
  if (!isSuiteDeployed()) return null;
  const w = word.toUpperCase();
  const hit = known.get(w);
  if (hit && Date.now() - hit.at < LEVEL_TTL_MS) return hit.level;
  let read = reading.get(w);
  if (!read) {
    read = getPublicClient()
      .readContract({ address: addressOf("words"), abi: wordsAbi, functionName: "prestigeLevel", args: [tokenIdOf(w)] })
      .then((l) => {
        const level = Math.max(0, Math.min(5, Number(l) || 0));
        known.set(w, { at: Date.now(), level });
        return level;
      })
      .finally(() => reading.delete(w));
    reading.set(w, read);
  }
  return read.catch(() => null);
}

/**
 * One word's stage, or null if it isn't known within `ms`: for a caller that must answer soon (the
 * share picture, the share page), as `cardNumberSoon` is for the number. The read carries on, so
 * the next request finds it. Never throws.
 */
export function cardLevelSoon(word: string, ms = LEVEL_WAIT_MS): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  const read = cardLevelOf(word).catch(() => null);
  try {
    after(() => read);
  } catch {
    // not inside a request (a test, a script): there is no instance to keep alive
  }
  return Promise.race([read, late]).finally(() => clearTimeout(timer));
}

/** Tests only: forget what was read. */
export function resetCardLevels() {
  known.clear();
  reading.clear();
}
