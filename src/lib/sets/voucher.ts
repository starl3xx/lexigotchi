/**
 * The first-day gate's vouchers: the counting rule (decisions.md, "Reserved word sets"). Pure.
 *
 * For the first day after a set's release a profile may claim at most `perPlayerLimit` DIFFERENT
 * words of it, across all its wallets. `Words.claim` enforces only that a gated word needs a
 * voucher; how many a player gets is this count.
 *
 * What is counted is vouchers ISSUED, never words held. A voucher carries no nonce (Words.sol says
 * why that is safe on the chain: reused, it is the same wallet claiming the same word again), so a
 * count of words held now would let a player claim a word, move it to another wallet, and ask again
 * (the audit's one note on the gate). A slot is given back only when the chain's own history says
 * its voucher was never used and no longer can be.
 */

/** Seconds a voucher stays spendable. Short: a claim is sent right after it is signed. */
export const VOUCHER_TTL_SECONDS = 600;
/**
 * Seconds past a voucher's deadline before "was it used?" is read from the chain for good. A claim
 * mined at the deadline's own second must be visible to the read that decides.
 */
export const SETTLE_AFTER_SECONDS = 120;

export interface VoucherRow {
  id: number;
  account: string;
  wallet: string;
  word: string;
  deadline: Date;
  /** null: not settled yet (it counts). true: claimed (it counts, for good). false: expired unused (free). */
  used: boolean | null;
}

/** Does this row still hold one of the profile's slots? */
export const holdsSlot = (r: Pick<VoucherRow, "used">): boolean => r.used !== false;

/** Is it time to read this row's use from the chain? */
export function dueToSettle(r: Pick<VoucherRow, "used" | "deadline">, nowSec: number): boolean {
  return r.used === null && Math.floor(r.deadline.getTime() / 1000) + SETTLE_AFTER_SECONDS < nowSec;
}

export type VoucherDecision =
  /** The profile already has a voucher row for this word: sign again under the same row. */
  | { kind: "renew"; id: number }
  | { kind: "new" }
  /** Every slot is taken, by these words. */
  | { kind: "limit"; words: string[] };

/**
 * May this profile have a voucher for `word`? `rows` is every row of this set under the profile's
 * account OR any of its wallets (a wallet that took its word and then joined the profile brings
 * its row with it).
 *
 * The same word again is always a renewal, used or not: it can never be a second word.
 */
export function decideVoucher(rows: readonly VoucherRow[], word: string, limit: number): VoucherDecision {
  const held = rows.filter(holdsSlot);
  const same = held.find((r) => r.word === word);
  if (same) return { kind: "renew", id: same.id };
  const words = [...new Set(held.map((r) => r.word))];
  if (words.length >= Math.max(1, limit)) return { kind: "limit", words };
  return { kind: "new" };
}
