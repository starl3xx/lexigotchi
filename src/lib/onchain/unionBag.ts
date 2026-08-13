import type { ChainWord } from "./reads";

/**
 * The union bag — one collection per HUMAN, not per wallet.
 *
 * Jake's ruling (2026-08-13): "there should 1000% be a union bag across any way a user connects."
 * A Farcaster account links several wallets (custody + verified), and inside a Farcaster host the
 * auto-connected wallet is one of them — so a web player with a different wallet was quietly
 * forking their collection across contexts.
 *
 * The split the contracts impose:
 *   DISPLAY unions — letters and words across every linked wallet plus the connected one.
 *   SPENDING stays connected — claim consumes msg.sender's letters, rolls check msg.sender's
 *   balance, staking transfers from msg.sender, feed() is staker-only. No signature, no action.
 *
 * So every unioned item carries `mine` (actionable from the connected wallet) and `holder`
 * (where it actually lives), and the UI gates verbs on `mine` while showing the whole bag.
 */

export interface BagWord extends ChainWord {
  /** The bag wallet this word lives in (holder for held words, staker for staked ones). */
  holder: `0x${string}`;
  /** True when the CONNECTED wallet can act on it (stake/feed/roll/prestige/dissolve). */
  mine: boolean;
}

/** The wallets whose holdings make up one bag: connected first, then the FID's linked ones. */
export function bagWalletsOf(
  connected: string | undefined,
  linked: readonly string[] | null | undefined,
): `0x${string}`[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of [connected, ...(linked ?? [])]) {
    const lower = a?.toLowerCase();
    if (!lower || seen.has(lower)) continue;
    seen.add(lower);
    out.push(lower);
  }
  return out as `0x${string}`[];
}

/**
 * Merge per-wallet word reads into one bag. A word can only be attributed to one wallet at a time
 * on-chain (held by exactly one owner, or staked by exactly one staker) — but paranoid ordering
 * still applies: if reads ever disagree mid-transfer, the CONNECTED wallet's attribution wins, so
 * `mine` errs toward matching what a transaction would actually find.
 */
export function unionWords(
  perWallet: readonly { wallet: `0x${string}`; words: readonly ChainWord[] }[],
  connected: string | undefined,
): BagWord[] {
  const conn = connected?.toLowerCase();
  const byId = new Map<string, BagWord>();
  // Connected wallet first so its attribution wins ties.
  const ordered = [...perWallet].sort((a, b) =>
    a.wallet.toLowerCase() === conn ? -1 : b.wallet.toLowerCase() === conn ? 1 : 0,
  );
  for (const { wallet, words } of ordered) {
    for (const w of words) {
      const key = String(w.tokenId);
      if (byId.has(key)) continue;
      byId.set(key, { ...w, holder: wallet.toLowerCase() as `0x${string}`, mine: wallet.toLowerCase() === conn });
    }
  }
  return [...byId.values()];
}

/** Element-wise sum of letter-count arrays (52 slots: 26 lowercase + 26 uppercase). */
export function sumLetterCounts(counts: readonly (readonly number[])[]): number[] {
  const out = Array.from({ length: 52 }, () => 0);
  for (const arr of counts) for (let i = 0; i < 52; i++) out[i] += arr[i] ?? 0;
  return out;
}
