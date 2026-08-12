/**
 * Running a money-moving action so its result can always be trusted.
 *
 * This module exists because the same bug appeared six times on one branch, each time in a
 * different disguise, and every time the tests were green. The shape of it never changed:
 *
 *   the caller could not tell "nothing was spent" from "the fee is gone and the commit is open"
 *
 * and so re-enabled its button and sold a second paid commit on top of the first. The contracts
 * have no reveal expiry, so an unresolved commit stays open forever and the money stays spent.
 *
 * The rule, stated once: **when you do not know whether money moved, assume it did.** Withholding a
 * retry costs a player one extra tap. Offering one costs them a second fee for nothing.
 */

export type ActionOutcome =
  | { status: "not-started" }
  | { status: "resolved"; success: boolean }
  | { status: "stranded"; note: string };

export const NOT_STARTED: ActionOutcome = { status: "not-started" };

export function resolved(success: boolean): ActionOutcome {
  return { status: "resolved", success };
}

export function stranded(note: string): ActionOutcome {
  return { status: "stranded", note };
}

/** True when the caller must NOT offer a retry — the fee is spent and the commit may still be open. */
export function isPaid(outcome: ActionOutcome): boolean {
  return outcome.status === "stranded";
}

/** True when nothing was spent, so retrying is free and safe. */
export function isRetryable(outcome: ActionOutcome): boolean {
  return outcome.status === "not-started";
}

export interface GuardOptions {
  /** Reports a message to the player. */
  onError?: (message: string) => void;
  /** Note attached when a throw happens after payment. */
  strandedNote?: string;
}

/**
 * Run a flow that may spend money, and ALWAYS resolve to an outcome — never reject.
 *
 * The flow is handed a `markPaid` callback and must call it the instant the fee is committed. That
 * single fact is what lets a thrown RPC error be classified correctly: before `markPaid` nothing was
 * spent and the action stays retryable; after it, the money is gone and the caller must be told so.
 *
 * A rejected promise carries none of that information, which is precisely why this returns rather
 * than throws — every caller that had to guess, guessed wrong.
 */
export async function guardedAction(
  flow: (markPaid: () => void) => Promise<ActionOutcome>,
  { onError, strandedNote = "Paid, but we lost track of it — reopen to finish it" }: GuardOptions = {},
): Promise<ActionOutcome> {
  let paid = false;
  try {
    return await flow(() => {
      paid = true;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "unknown error");
    onError?.(message);
    return paid ? stranded(strandedNote) : NOT_STARTED;
  }
}
