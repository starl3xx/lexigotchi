/**
 * Every word's card number, on the server: its place in the order words were first made (#0001 the
 * first word anyone spelled; lib/cardFacts, madeOrder). Read from the chain's `Claimed` events
 * (keeper/scan, readMadeOrder) and kept in memory, shared by the share picture, the back picture,
 * and `/api/words/numbers`.
 *
 * A number never changes once given, so a known one is kept for good; a word not numbered yet
 * (claimed a moment ago) reads them again, at most once a minute, and callers that arrive
 * together share one read. Nothing here trusts a caller: the number is the chain's.
 */
import { after } from "next/server";
import { isSuiteDeployed } from "./addresses";
import { readMadeOrder } from "../keeper/scan";

const ORDER_TTL_MS = 60_000;
let order: { at: number; map: Record<string, number> } | null = null;
let orderRead: Promise<Record<string, number>> | null = null;

async function freshOrder(): Promise<Record<string, number> | null> {
  orderRead ??= readMadeOrder()
    .then((map) => {
      order = { at: Date.now(), map };
      return map;
    })
    .finally(() => {
      orderRead = null;
    });
  return orderRead.catch(() => null);
}

/** One word's number, or null when it has none yet, the game isn't deployed, or the read failed. */
export async function cardNumberOf(word: string): Promise<number | null> {
  if (!isSuiteDeployed()) return null;
  const known = order?.map[word];
  if (known) return known;
  if (order && Date.now() - order.at < ORDER_TTL_MS) return null;
  return (await freshOrder())?.[word] ?? null;
}

/** Several words' numbers at once: only the ones that have a number. One read at most. */
export async function cardNumbersOf(words: readonly string[]): Promise<Record<string, number>> {
  if (!isSuiteDeployed() || words.length === 0) return {};
  let map = order?.map ?? null;
  const missing = !map || words.some((w) => !map![w]);
  if (missing && (!order || Date.now() - order.at >= ORDER_TTL_MS)) map = (await freshOrder()) ?? map;
  const out: Record<string, number> = {};
  for (const w of words) if (map?.[w]) out[w] = map[w];
  return out;
}

/**
 * How long a picture or a page waits for a word's number before it is drawn without one. The read
 * behind it scans the chain's events, and a share picture is fetched by X's and Farcaster's
 * crawlers, which don't wait long. The read carries on, so the next request finds the number:
 * the host is asked to keep the instance alive until it lands (`after`), because a serverless
 * instance may otherwise be frozen the moment its answer is sent.
 */
export const NUMBER_WAIT_MS = 1500;

/**
 * One word's number, or null if it isn't known within `ms`: for a caller that must answer soon
 * (the share picture, the share page). Never throws.
 */
export function cardNumberSoon(word: string, ms = NUMBER_WAIT_MS): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  const read = cardNumberOf(word).catch(() => null);
  try {
    after(() => read);
  } catch {
    // not inside a request (a test, a script): there is no instance to keep alive
  }
  return Promise.race([read, late]).finally(() => clearTimeout(timer));
}

/** Tests only: forget what was read. */
export function resetCardNumbers() {
  order = null;
  orderRead = null;
}
