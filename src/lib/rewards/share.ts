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
export function snapshotOf(summary: EarningsSummary, chainId: number = NETWORK.id): EarningsSnapshot {
  const words: [string, number][] = [];
  for (const w of summary.words) {
    if (words.length >= SNAPSHOT_WORDS) break;
    const word = wordOfTokenId(BigInt(w.tokenId));
    const total = wholeWord(w.total);
    if (word && total > 0) words.push([word, total]);
  }
  return { chainId, latestDay: summary.latestDay, total: wholeWord(summary.total), latest: wholeWord(summary.latest), words };
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
