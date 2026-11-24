/**
 * What the game tells a player about where their things are (the game wallet, lib/db/gameWallet.ts).
 * Pure, so every case is tested (tests/game-wallet-advice.test.ts).
 *
 * Letters, words, and $WORD are onchain, in whichever wallet holds them, and every action spends the
 * CONNECTED wallet's own. So a player with several wallets picks one game wallet and keeps everything
 * there. The advice speaks only when it matters, never just because two wallets differ (the daily
 * letter lands in whatever wallet is connected, so a mismatch rule would nag after every claim):
 * - choose: things are spread out, or sit only outside the connected wallet, and no game wallet is
 *   chosen yet.
 * - move_to_game: the connected wallet isn't the game wallet and holds things: move them there (only
 *   this wallet can send them), or make this the game wallet.
 * - switch_to_game: the connected wallet holds nothing, the game wallet holds things. On the web,
 *   switch. Inside Farcaster the wallet can't change: make this the game wallet and move things here
 *   from the web, or play on the web.
 * - gather: the connected wallet IS the game wallet, and other wallets still hold things (or have
 *   staked words, which only they can feed).
 */

export interface WalletHoldings {
  /** Loose letters, lowercase and UPPERCASE. */
  letters: number;
  /** Words the wallet holds (not staked): these can move. */
  words: number;
  /** Words this wallet staked: they stay, and only this wallet can feed them. */
  staked: number;
  /** $WORD, whole tokens. */
  word: number;
}

export type GameWalletAdvice =
  | { kind: "none" }
  | { kind: "choose" }
  | { kind: "move_to_game"; from: string; to: string; holdings: WalletHoldings }
  | { kind: "switch_to_game"; game: string; inHost: boolean; holdings: WalletHoldings }
  | { kind: "gather"; elsewhere: { wallet: string; holdings: WalletHoldings }[]; inHost: boolean };

/** Things that can move (letters, held words, $WORD). */
export const movableCount = (h?: WalletHoldings) => (h ? h.letters + h.words + (h.word > 0 ? 1 : 0) : 0);
const anything = (h?: WalletHoldings) => movableCount(h) > 0 || (h?.staked ?? 0) > 0;

export function gameWalletAdvice(input: {
  connected: string | null;
  gameWallet: string | null;
  /** Every wallet in the player's profile. */
  wallets: readonly string[];
  /** What each wallet holds (lowercase keys). Missing: not read yet. */
  holdings: Readonly<Record<string, WalletHoldings>>;
  /** Inside a Farcaster host, where the wallet can't be switched. */
  inHost: boolean;
}): GameWalletAdvice {
  const connected = input.connected?.toLowerCase() ?? null;
  const wallets = [...new Set(input.wallets.map((w) => w.toLowerCase()))];
  if (!connected || wallets.length < 2) return { kind: "none" };
  // Advice needs every wallet's holdings; until they're read, say nothing rather than guess.
  if (wallets.some((w) => !input.holdings[w])) return { kind: "none" };
  const h = (w: string) => input.holdings[w];
  const game = input.gameWallet?.toLowerCase() ?? null;

  if (!game || !wallets.includes(game)) {
    const holding = wallets.filter((w) => anything(h(w)));
    const spread = holding.length > 1;
    const onlyElsewhere = holding.length === 1 && holding[0] !== connected;
    return spread || onlyElsewhere ? { kind: "choose" } : { kind: "none" };
  }

  if (connected === game) {
    const elsewhere = wallets
      .filter((w) => w !== game && anything(h(w)))
      .map((w) => ({ wallet: w, holdings: h(w) }));
    return elsewhere.length > 0 ? { kind: "gather", elsewhere, inHost: input.inHost } : { kind: "none" };
  }

  if (movableCount(h(connected)) > 0) return { kind: "move_to_game", from: connected, to: game, holdings: h(connected) };
  if (anything(h(game))) return { kind: "switch_to_game", game, inHost: input.inHost, holdings: h(game) };
  return { kind: "none" };
}

/** "7 letters, 3 words, 120 $WORD": what a wallet holds, for notices and the Wallets card. */
export function holdingsText(h: WalletHoldings): string {
  const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
  const parts = [plural(h.letters, "letter", "letters"), plural(h.words + h.staked, "word", "words")];
  if (h.word > 0) parts.push(`${h.word.toLocaleString("en-US")} $WORD`);
  return parts.join(", ");
}
