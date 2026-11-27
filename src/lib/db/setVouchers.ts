/**
 * The first-day gate's vouchers in the database (table `set_vouchers`, migration 0022). The rule is
 * lib/sets/voucher.ts; this file makes it hold when two requests arrive at once.
 *
 * One profile's requests for one set run one at a time (an advisory lock for the transaction), so
 * two requests for two different words can't both take the last slot. A failed read THROWS: the
 * route refuses, because read as "no vouchers yet" a failure would hand out a second word.
 */
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "./client";
import { setVouchers } from "./schema";
import { decideVoucher, dueToSettle, type VoucherRow } from "@/lib/sets/voucher";

const lower = (s: string) => s.toLowerCase();

function mine(chainId: number, setId: number, account: string, wallets: readonly string[]) {
  const all = [...new Set([account, ...wallets].map(lower))];
  return and(eq(setVouchers.chainId, chainId), eq(setVouchers.setId, setId), or(inArray(setVouchers.account, all), inArray(setVouchers.wallet, all)));
}

const pick = {
  id: setVouchers.id,
  account: setVouchers.account,
  wallet: setVouchers.wallet,
  word: setVouchers.word,
  deadline: setVouchers.deadline,
  used: setVouchers.used,
};

/** Every voucher row of this set under the profile's account or any of its wallets. Throws on a failed read. */
export async function profileVouchers(chainId: number, setId: number, account: string, wallets: readonly string[]): Promise<VoucherRow[]> {
  return getDb().select(pick).from(setVouchers).where(mine(chainId, setId, account, wallets));
}

/**
 * Take (or renew) the profile's voucher row for `word`, if the rule allows it. Returns the decision
 * that was applied; on "limit" nothing was written.
 */
export async function takeVoucher(a: {
  chainId: number;
  setId: number;
  account: string;
  wallets: readonly string[];
  wallet: string;
  word: string;
  limit: number;
  deadline: Date;
}): Promise<{ ok: true; renewed: boolean } | { ok: false; error: "limit_reached"; words: string[] }> {
  const account = lower(a.account);
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`lexigotchi:set_voucher:${a.chainId}:${a.setId}:${account}`}))`);
    const rows = await tx.select(pick).from(setVouchers).where(mine(a.chainId, a.setId, account, a.wallets));
    const d = decideVoucher(rows, a.word, a.limit);
    if (d.kind === "limit") return { ok: false as const, error: "limit_reached" as const, words: d.words };
    if (d.kind === "renew") {
      // The same word again: the row now names the wallet asking, and the new deadline. `used`
      // stays as it is (a spent slot stays spent; an unsettled one is settled against the newest
      // deadline, since an older voucher for the same word can only claim that same word).
      await tx.update(setVouchers).set({ wallet: lower(a.wallet), deadline: a.deadline }).where(eq(setVouchers.id, d.id));
      return { ok: true as const, renewed: true };
    }
    await tx.insert(setVouchers).values({ chainId: a.chainId, setId: a.setId, account, wallet: lower(a.wallet), word: a.word, deadline: a.deadline });
    return { ok: true as const, renewed: false };
  });
}

/**
 * Read from the chain whether each voucher that can no longer be spent was used, and write it
 * down: `check` answers true (the wallet claimed the word), false (it didn't), or null (couldn't
 * tell: left unsettled, so it still counts). Run BEFORE counting, so an expired, unused voucher
 * gives its slot back.
 */
export async function settleVouchers(
  chainId: number,
  setId: number,
  account: string,
  wallets: readonly string[],
  nowSec: number,
  check: (row: VoucherRow) => Promise<boolean | null>,
): Promise<void> {
  const rows = (await profileVouchers(chainId, setId, account, wallets)).filter((r) => dueToSettle(r, nowSec));
  for (const r of rows) {
    const used = await check(r);
    if (used === null) continue;
    // Only a row still unsettled, with the deadline that was judged: a renewal in between wins.
    await getDb()
      .update(setVouchers)
      .set({ used })
      .where(and(eq(setVouchers.id, r.id), sql`${setVouchers.used} is null`, eq(setVouchers.deadline, r.deadline)));
  }
}
