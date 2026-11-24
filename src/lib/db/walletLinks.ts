/**
 * Linked wallets (schema `walletLinks`, `walletLinkCodes`): several wallets as one account.
 *
 * The account is named by its first wallet. Every read here treats a database without migration 0008
 * (or one that's down) as "no links", so the daily, the profile, and the world keep working exactly
 * as before for every player: a wallet is then its own one-wallet account.
 */
import { randomBytes } from "node:crypto";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "./client";
import { walletLinkCodes, walletLinks } from "./schema";

/** An account's wallets, the first included. Bounds the daily's lookups and the bag's reads. */
export const MAX_ACCOUNT_WALLETS = 5;
/** How long a link code waits for the second wallet's signature. */
export const LINK_CODE_TTL_MS = 15 * 60_000;

const lower = (a: string) => a.toLowerCase();

/** The account a wallet belongs to (its first wallet), or the wallet itself. Never throws. */
export async function accountOf(address: string): Promise<string> {
  const a = lower(address);
  try {
    const rows = await getDb().select({ account: walletLinks.account }).from(walletLinks).where(eq(walletLinks.address, a)).limit(1);
    return rows[0]?.account ?? a;
  } catch {
    return a;
  }
}

/** Accounts for many wallets at once (wallet → account; an unlinked wallet maps to itself). Never throws. */
export async function accountsOf(addresses: readonly string[]): Promise<Map<string, string>> {
  const list = [...new Set(addresses.map(lower))];
  const out = new Map(list.map((a) => [a, a]));
  if (list.length === 0) return out;
  try {
    const rows = await getDb()
      .select({ address: walletLinks.address, account: walletLinks.account })
      .from(walletLinks)
      .where(inArray(walletLinks.address, list));
    for (const r of rows) out.set(r.address, r.account);
  } catch {
    /* no links: every wallet is its own account */
  }
  return out;
}

/** An account's wallets, the account's own first, capped. Never throws. */
export async function walletsOfAccount(account: string): Promise<string[]> {
  const acct = lower(account);
  try {
    const rows = await getDb()
      .select({ address: walletLinks.address })
      .from(walletLinks)
      .where(eq(walletLinks.account, acct))
      .orderBy(walletLinks.linkedAt)
      .limit(MAX_ACCOUNT_WALLETS - 1);
    return [acct, ...rows.map((r) => r.address)];
  } catch {
    return [acct];
  }
}

/** A wallet's account and every wallet in it (the wallet's own account if it isn't linked). */
export async function accountWallets(address: string): Promise<{ account: string; wallets: string[] }> {
  const account = await accountOf(address);
  return { account, wallets: await walletsOfAccount(account) };
}

// ── every link at once (the world, the keeper, the reminder cron) ──────────────────────────────

/** Every link, resolved both ways. A wallet with no link is its own one-wallet account. */
export interface LinkMap {
  /** The wallet's account (its first wallet), lowercase. */
  accountOf(address: string): string;
  /** The account's wallets, the first wallet first, then by link time. */
  walletsOf(account: string): string[];
  /** How many links there are (0 before migration 0008). */
  size: number;
}

/** Pure: a LinkMap from link rows (in link order). Exported for tests. */
export function linkMapFrom(rows: readonly { address: string; account: string }[]): LinkMap {
  const accountByWallet = new Map<string, string>();
  const walletsByAccount = new Map<string, string[]>();
  for (const r of rows) {
    const a = lower(r.address);
    const acct = lower(r.account);
    accountByWallet.set(a, acct);
    const list = walletsByAccount.get(acct) ?? [acct];
    if (!list.includes(a)) list.push(a);
    walletsByAccount.set(acct, list.slice(0, MAX_ACCOUNT_WALLETS));
  }
  return {
    accountOf: (address) => accountByWallet.get(lower(address)) ?? lower(address),
    walletsOf: (account) => walletsByAccount.get(lower(account)) ?? [lower(account)],
    size: accountByWallet.size,
  };
}

/** The whole link table, read once. Small: only linked wallets have a row. Never throws. */
export async function loadLinkMap(): Promise<LinkMap> {
  try {
    const rows = await getDb()
      .select({ address: walletLinks.address, account: walletLinks.account })
      .from(walletLinks)
      .orderBy(walletLinks.linkedAt);
    return linkMapFrom(rows);
  } catch {
    return linkMapFrom([]);
  }
}

// ── link codes ───────────────────────────────────────────────────────────────────────────────────

/** A fresh code for this account. Alphanumeric, so it can be a Sign-In with Ethereum nonce. Throws. */
export async function createLinkCode(account: string, now = Date.now()): Promise<{ code: string; expiresAt: Date }> {
  const code = randomBytes(12).toString("hex");
  const expiresAt = new Date(now + LINK_CODE_TTL_MS);
  await getDb().insert(walletLinkCodes).values({ code, account: lower(account), expiresAt });
  return { code, expiresAt };
}

/** The account a live, unused code belongs to, without using it up. Throws on a database error. */
export async function peekLinkCode(code: string): Promise<{ account: string; expiresAt: Date } | null> {
  const rows = await getDb()
    .select({ account: walletLinkCodes.account, expiresAt: walletLinkCodes.expiresAt })
    .from(walletLinkCodes)
    .where(and(eq(walletLinkCodes.code, code), isNull(walletLinkCodes.usedAt), gt(walletLinkCodes.expiresAt, sql`now()`)))
    .limit(1);
  return rows[0] ?? null;
}

/** Use a code up, once: the account it named, or null if it was already used or expired. Throws. */
export async function consumeLinkCode(code: string): Promise<string | null> {
  const rows = await getDb()
    .update(walletLinkCodes)
    .set({ usedAt: sql`now()` })
    .where(and(eq(walletLinkCodes.code, code), isNull(walletLinkCodes.usedAt), gt(walletLinkCodes.expiresAt, sql`now()`)))
    .returning({ account: walletLinkCodes.account });
  return rows[0]?.account ?? null;
}

// ── link / unlink ────────────────────────────────────────────────────────────────────────────────

export type LinkRefusal = "same_wallet" | "linked_elsewhere" | "has_wallets" | "too_many";

/**
 * Can `address` join `account`? Pure, for the route and the tests: the wallet's current account and
 * how many wallets each side has. A wallet already in the account is fine (a repeat link is a no-op).
 */
export function linkRefusal(opts: {
  account: string;
  address: string;
  addressAccount: string;
  addressAccountSize: number;
  accountSize: number;
}): LinkRefusal | "already" | null {
  const account = lower(opts.account);
  const address = lower(opts.address);
  if (address === account) return "same_wallet";
  if (lower(opts.addressAccount) === account) return "already";
  if (lower(opts.addressAccount) !== address) return "linked_elsewhere"; // it's in someone else's account
  if (opts.addressAccountSize > 1) return "has_wallets"; // it heads an account of its own
  if (opts.accountSize >= MAX_ACCOUNT_WALLETS) return "too_many";
  return null;
}

/** Add the wallet to the account. The primary key keeps a wallet in one account. Throws. */
export async function linkWallet(account: string, address: string): Promise<void> {
  await getDb().insert(walletLinks).values({ address: lower(address), account: lower(account) }).onConflictDoNothing();
}

/** Take the wallet out of the account (it becomes its own account again). Throws. */
export async function unlinkWallet(account: string, address: string): Promise<boolean> {
  const rows = await getDb()
    .delete(walletLinks)
    .where(and(eq(walletLinks.address, lower(address)), eq(walletLinks.account, lower(account))))
    .returning({ address: walletLinks.address });
  return rows.length > 0;
}
