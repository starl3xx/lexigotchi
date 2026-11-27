/**
 * The earnings route's side of an earnings share (lib/earningsShare.ts): what it computed, as the
 * snapshot that gets signed, and the check that the wallets it added up are one player's.
 */
import { NETWORK } from "@/lib/onchain/network";
import { wordOfTokenId } from "@/lib/market/sales";
import { SNAPSHOT_WORDS, type EarningsSnapshot } from "@/lib/earningsShare";
import type { EarningsSummary } from "./earnings";

const wholeWord = (wei: bigint) => Number(wei / 10n ** 18n);

/**
 * What the earnings route computed, as a snapshot: the totals in whole $WORD (rounded DOWN, never
 * up), and the top earning words by name (a token id is a dictionary word's hash; one that is no
 * dictionary word is left out).
 */
export function snapshotOf(
  summary: EarningsSummary,
  chainId: number = NETWORK.id,
  more: {
    /** A named word's ascension stage, read from the chain; null or absent when it isn't known. */
    stageOf?: (word: string) => number | null | undefined;
    /** What the total is worth, in whole cents (`usdCentsOf`); null for none. */
    usdCents?: number | null;
  } = {},
): EarningsSnapshot {
  const words: [string, number][] = [];
  for (const w of summary.words) {
    if (words.length >= SNAPSHOT_WORDS) break;
    const word = wordOfTokenId(BigInt(w.tokenId));
    const total = wholeWord(w.total);
    if (word && total > 0) words.push([word, total]);
  }
  const stage = (word: string) => {
    const g = more.stageOf?.(word);
    return typeof g === "number" && Number.isInteger(g) && g >= 0 && g <= 5 ? g : null;
  };
  return {
    chainId,
    latestDay: summary.latestDay,
    total: wholeWord(summary.total),
    latest: wholeWord(summary.latest),
    words,
    stages: words.map(([word]) => stage(word)),
    ...(more.usdCents && more.usdCents > 0 ? { usdCents: more.usdCents } : {}),
  };
}

/** The top earning words a snapshot of this summary will name: the ones whose stage is worth reading. */
export function snapshotWords(summary: EarningsSummary): string[] {
  return snapshotOf(summary).words.map(([word]) => word);
}

/** How old a price may be and still be put on a picture that is kept for good. */
export const PRICE_FRESH_MS = 15 * 60_000;

/**
 * What a total is worth, in whole US cents (rounded DOWN), for the share picture's "about $X"; or
 * null, and the picture says nothing in dollars. Null on a test network (test $WORD is worth
 * nothing: decisions.md #46), and unless the price is LIVE and RECENT: the oracle answers with an
 * old copy or a constant when its source fails (lib/oracle/wordPrice `fetchWordPrice`), and neither
 * belongs on a posted picture.
 */
export function usdCentsOf(
  totalWhole: number,
  price: { priceUsd: number; fetchedAt: number | null; source: string } | null,
  o: { testnet: boolean; now?: number },
): number | null {
  if (o.testnet || !price || price.source !== "geckoterminal" || price.fetchedAt === null) return null;
  if ((o.now ?? Date.now()) - price.fetchedAt > PRICE_FRESH_MS) return null;
  const cents = Math.floor(totalWhole * price.priceUsd * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

/**
 * The wallets of the FIRST wallet's account, among those asked for (`accounts`: wallet → its
 * account, lib/db/walletLinks `accountsOf`). The earnings route adds up any list of wallets it is
 * given, so a signed total over the whole list could be a sum of strangers: a number no player
 * earned, on the game's card. The snapshot covers one account only: the first wallet's (the game
 * sends the connected wallet first). A wallet the game counts as the player's but the links don't
 * (a Farcaster wallet that hasn't joined the account) is left out of the picture, not refused.
 */
export function accountWalletsOf(wallets: readonly string[], accounts: ReadonlyMap<string, string>): string[] {
  const all = wallets.map((w) => w.toLowerCase());
  if (all.length === 0) return [];
  const of = (w: string) => accounts.get(w) ?? w;
  const home = of(all[0]);
  return all.filter((w) => of(w) === home);
}
