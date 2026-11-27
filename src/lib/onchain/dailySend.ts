/**
 * What became of a daily letter's send (decisions.md #49, part 3). Pure, so every case is a test.
 *
 * The daily's commit and reveal ride ONE send, with the commit's id PREDICTED by the server. So
 * after the wallet says "sent", four things can be true, and the wallet can't tell them apart:
 *
 * - both landed: the predicted slot is this wallet's daily, revealed;
 * - the commit landed and the reveal didn't: the wallet's second prompt was refused, or it is still
 *   on its way, or another commit took the predicted id first, so the reveal named the wrong one;
 * - nothing landed: a batch that goes all or nothing, and the stale id made all of it revert;
 * - the game can't see yet (a node a block behind, a log not served yet).
 *
 * The envelope's marks follow this plan, so each is true: it gets its number only once the chain
 * says whose commit that id is, it can be torn only once the chain says "revealed", and it leaves
 * only once the chain says the daily was never used. The server is asked to open the commit only
 * when the wallet's own reveal can no longer land: two reveals for one commit means one reverts.
 */

/** A Letters commit as the chain has it. */
export interface CommitState {
  buyer: string;
  count: number;
  revealed: boolean;
}

export interface DailyLook {
  /** The wallet that sent it. */
  me: string;
  /** Did the send carry the reveal (the bundle)? Without one the server always opens the commit. */
  bundled: boolean;
  /** Did the wallet accept the whole send? False: it refused a part, and `used` says the commit landed. */
  sent: boolean;
  /** The id the server predicted for the commit (the bundle's), or null. */
  predicted: bigint | null;
  /** `commits(predicted)`, or null: no commit has that id yet, there is no bundle, or the read failed. */
  slot: CommitState | null;
  /** A one-letter commit of this wallet's that the chain has now and didn't before the send. */
  fresh: { commitId: bigint; revealed: boolean } | null;
  /** `dailyUsed` for the key the voucher was signed under; null = the read failed. */
  used: boolean | null;
  /** ms since the wallet answered. */
  waited: number;
  /** ms since this wallet's commit was first seen unrevealed; 0 before that. */
  unrevealedFor: number;
}

export type DailyPlan =
  /** Not known yet: look again. */
  | { do: "wait" }
  /** This wallet's commit, and the wallet's own reveal may still land: look again, ask nobody. */
  | { do: "hold"; commitId: bigint }
  /**
   * This wallet's commit, to be opened through the server: revealed (the server only names the
   * letters the chain minted), or unrevealed with no reveal of the wallet's coming (it relays).
   */
  | { do: "open"; commitId: bigint; revealed: boolean }
  /** Nothing was committed: the envelope leaves, and the letter is still there to pull. */
  | { do: "gone" }
  /** The daily is used but its commit was never found: it is safe, and it waits. */
  | { do: "lost" };

/** How long the wallet's own reveal is waited for once its commit is seen (a second prompt, a slow bundler). */
export const DAILY_HOLD_MS = 15_000;
/** How long the game looks before it decides: used → it waits; never used → it is gone. */
export const DAILY_LOOK_MS = 60_000;
/** The step between looks. */
export const DAILY_STEP_MS = 2_000;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function dailyPlan(look: DailyLook): DailyPlan {
  // Whose is the predicted slot? Only a ONE-letter commit of this wallet's is the daily: a pack
  // bought in another tab between the voucher and the send can sit at that id.
  const slotIsMine = look.predicted !== null && look.slot !== null && same(look.slot.buyer, look.me) && look.slot.count === 1;
  const mine = slotIsMine ? { commitId: look.predicted as bigint, revealed: (look.slot as CommitState).revealed, atPredicted: true } : look.fresh ? { ...look.fresh, atPredicted: false } : null;

  if (mine) {
    if (mine.revealed) return { do: "open", commitId: mine.commitId, revealed: true };
    // Unrevealed. The wallet's reveal names the PREDICTED id: it can still land only if the commit
    // is there, the wallet accepted the reveal, and it hasn't been waited for too long.
    const walletRevealMayLand = look.bundled && look.sent && mine.atPredicted && look.unrevealedFor < DAILY_HOLD_MS;
    return walletRevealMayLand ? { do: "hold", commitId: mine.commitId } : { do: "open", commitId: mine.commitId, revealed: false };
  }

  // No commit of this wallet's is in sight.
  if (look.waited < DAILY_LOOK_MS) return { do: "wait" };
  // Time is up. `dailyUsed` is the exact test of "did a commit land": never guess it from the time.
  if (look.used === false) return { do: "gone" };
  // Used (or the chain couldn't be asked): the money rule. It is treated as committed, and it waits.
  return { do: "lost" };
}
