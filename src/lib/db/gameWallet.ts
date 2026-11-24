/**
 * The player's game wallet (schema `gameWallets`, migration 0010): where they choose to keep their
 * letters, words, and $WORD. Every onchain action spends the CONNECTED wallet's own holdings, so the
 * game helps the player gather everything in one wallet and play from it.
 *
 * Reads never throw: before the migration, or with the database down, there is no choice yet. A
 * stored wallet that has since left the account (unlinked, or dropped by Farcaster) reads as no
 * choice, so the game never points a player at a wallet that isn't theirs anymore.
 */
import { sql } from "drizzle-orm";
import { getDb } from "./client";
import { gameWallets } from "./schema";
import { walletsOfAccount } from "./walletLinks";

/** The account's game wallet, if one is chosen and still in the account. Never throws. */
export async function gameWalletOf(account: string, wallets?: readonly string[]): Promise<string | null> {
  const acct = account.toLowerCase();
  try {
    const rows = await getDb().select({ wallet: gameWallets.wallet }).from(gameWallets).where(sql`${gameWallets.account} = ${acct}`).limit(1);
    const w = rows[0]?.wallet ?? null;
    if (!w) return null;
    const inAccount = wallets ?? (await walletsOfAccount(acct));
    return inAccount.includes(w) ? w : null;
  } catch {
    return null;
  }
}

/** Choose the account's game wallet. The caller checks the wallet is in the account. Throws. */
export async function setGameWallet(account: string, wallet: string): Promise<void> {
  const acct = account.toLowerCase();
  const w = wallet.toLowerCase();
  await getDb()
    .insert(gameWallets)
    .values({ account: acct, wallet: w })
    .onConflictDoUpdate({ target: gameWallets.account, set: { wallet: w, chosenAt: sql`now()` } });
}
