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

/** Things that can move (letters, held words, $WORD): what the Move panel offers. */
export const movableCount = (h?: WalletHoldings) => (h ? h.letters + h.words + (h.word > 0 ? 1 : 0) : 0);
/**
 * What makes a notice worth showing: letters and held words, which only their wallet can play. $WORD
 * alone never does: each wallet pays its own fees, so a caretaker or a Farcaster wallet keeps its own
 * $WORD on purpose (starl3xx: "is this top message still necessary?" over 50M $WORD and nothing else).
 */
const playable = (h?: WalletHoldings) => (h ? h.letters + h.words : 0);

export function gameWalletAdvice(input: {
  connected: string | null;
  gameWallet: string | null;
  /** Every wallet in the player's profile. */
  wallets: readonly string[];
  /** What each wallet holds (lowercase keys). Missing: not read yet. */
  holdings: Readonly<Record<string, WalletHoldings>>;
  /** Inside a Farcaster host, where the wallet can't be switched. */
  inHost: boolean;
  /** Stakers that named the CONNECTED wallet a caretaker: their staked words are cared for from here. */
  caretakerOf?: ReadonlySet<string>;
}): GameWalletAdvice {
  const connected = input.connected?.toLowerCase() ?? null;
  const wallets = [...new Set(input.wallets.map((w) => w.toLowerCase()))];
  if (!connected || wallets.length < 2) return { kind: "none" };
  // Advice needs every wallet's holdings; until they're read, say nothing rather than guess.
  if (wallets.some((w) => !input.holdings[w])) return { kind: "none" };
  const h = (w: string) => input.holdings[w];
  const game = input.gameWallet?.toLowerCase() ?? null;
  // Staked words need their staker, unless the connected wallet is its caretaker (it feeds them here).
  const needsCare = (w: string) => (h(w)?.staked ?? 0) > 0 && w !== connected && !input.caretakerOf?.has(w);
  const anything = (w: string) => playable(h(w)) > 0 || needsCare(w);

  if (!game || !wallets.includes(game)) {
    const holding = wallets.filter((w) => anything(w) || (w === connected && (h(w)?.staked ?? 0) > 0));
    const spread = holding.length > 1;
    const onlyElsewhere = holding.length === 1 && holding[0] !== connected;
    return spread || onlyElsewhere ? { kind: "choose" } : { kind: "none" };
  }

  if (connected === game) {
    const elsewhere = wallets
      .filter((w) => w !== game && anything(w))
      .map((w) => ({ wallet: w, holdings: h(w) }));
    return elsewhere.length > 0 ? { kind: "gather", elsewhere, inHost: input.inHost } : { kind: "none" };
  }

  if (playable(h(connected)) > 0) return { kind: "move_to_game", from: connected, to: game, holdings: h(connected) };
  if (playable(h(game)) > 0 || (h(game)?.staked ?? 0) > 0) {
    return { kind: "switch_to_game", game, inHost: input.inHost, holdings: h(game) };
  }
  return { kind: "none" };
}

/**
 * What a notice is ABOUT, so a player who hides it doesn't see it again until it would say something
 * new. One key per wallet it names (kind, the wallet they're connected with, that wallet): the notice
 * stays hidden while every wallet it names was named when it was hidden. So a notice with LESS to
 * say stays hidden (the player emptied one of the wallets it named, or unlinked one), and a wallet it
 * never named brings it back (another wallet now holds things, a daily letter included). Counts are
 * left out, and so is the host (the same advice). Empty for "none": there is nothing to hide, and
 * "none" is also what the advice says while holdings load, so it must never clear a hidden notice.
 */
export function adviceKeys(advice: GameWalletAdvice, connected: string | null, wallets: readonly string[]): string[] {
  const me = connected?.toLowerCase() ?? "";
  const each = (kind: string, ws: readonly string[]) => [...new Set(ws.map((w) => `${kind}:${me}:${w.toLowerCase()}`))];
  switch (advice.kind) {
    case "none":
      return [];
    case "choose":
      // Names no wallet, so its subject is the whole profile: a newly linked wallet is news.
      return each("choose", wallets);
    case "move_to_game":
      return [`move:${advice.from.toLowerCase()}:${advice.to.toLowerCase()}`];
    case "switch_to_game":
      return each("switch", [advice.game]);
    case "gather":
      return each("gather", advice.elsewhere.map((e) => e.wallet));
  }
}

/**
 * Hidden keys kept per browser: a player with five wallets has at most about 85 (four kinds, each
 * wallet connected in turn), so this keeps them all with room; past it the oldest go first.
 */
export const HIDDEN_NOTICES_MAX = 200;

/** The hidden keys in what storage holds; anything unreadable is "none hidden". */
export function parseHiddenNotices(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

/** Whether the notice with these keys is hidden: every one of them was hidden before. */
export function noticeHidden(raw: string | null, keys: readonly string[]): boolean {
  if (keys.length === 0) return false;
  const hidden = new Set(parseHiddenNotices(raw));
  return keys.every((k) => hidden.has(k));
}

/** Storage's new value once these keys are hidden: the newest last, the oldest dropped past the limit. */
export function hideNotice(raw: string | null, keys: readonly string[]): string {
  const adding = new Set(keys);
  const kept = parseHiddenNotices(raw).filter((k) => !adding.has(k));
  return JSON.stringify([...kept, ...adding].slice(-HIDDEN_NOTICES_MAX));
}

/** "7 letters, 3 words, 120 $WORD": what a wallet holds, for notices and the Wallets card. */
export function holdingsText(h: WalletHoldings): string {
  const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
  const parts = [plural(h.letters, "letter", "letters"), plural(h.words + h.staked, "word", "words")];
  if (h.word > 0) parts.push(`${h.word.toLocaleString("en-US")} $WORD`);
  return parts.join(", ");
}
