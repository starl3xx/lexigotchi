/**
 * What an ascension attempt came to, decided from what the CHAIN says after its reveal.
 *
 * The reveal is sent by the player's wallet, and a send returns when the wallet accepts. The game
 * used to report the signed outcome at that moment. Three things went wrong from there: "try again"
 * found the finished attempt still open; a miss kept its old odds; and a resumed attempt that
 * wasn't this word's own (see `foreign` below) was reported as a miss, as if the player had just
 * lost a try they never made. So the provider waits for the reveal to land, reads the word's stage
 * in the same block (`readPrestigeAttempt`), and this decides what to tell the sheet.
 *
 * Pure, so the rules are tested directly (tests/ascend-result.test.ts).
 */

export type AscendResult =
  /** The reveal never showed in the wait. Paid, and not known to be finished: offer no other try. */
  | { kind: "unfinished" }
  /**
   * An earlier attempt was finished instead of a new one, and it wasn't this try's: made before
   * the word changed hands, or at another stage (before it was dissolved and claimed again;
   * Prestige keys attempts by token), or already revealed by the time the game asked (another tab
   * sent it, or a lagging read called a finished attempt open). Prestige voids it or raises
   * today's stage. Nothing was spent by this tap and nothing is left open, so the sheet is ready
   * again: never "you missed".
   */
  | { kind: "foreign" }
  /** This try's result: `hit` is the word standing a stage higher than at the tap, now at `level`. */
  | { kind: "result"; hit: boolean; level: number };

export function ascendResult(a: {
  /** The word's stage at the tap. */
  level: number;
  /** Who the attempt is for: the staker (a caretaker commits in the staker's name). */
  owner: string;
  /** An open attempt was found and finished; no new one was paid for. */
  resumed: boolean;
  /** What the server said the commit was paid at, when it answered (null: it was already revealed). */
  commit: { level?: number; owner?: string } | null;
  /** The chain after the reveal (readPrestigeAttempt), or null if it never showed. */
  after: { level: number } | null;
}): AscendResult {
  if (!a.after) return { kind: "unfinished" };
  // A resumed attempt that turned out to be finished already (no commit facts: the server said
  // "already revealed") is not this tap's either. The tap paid for nothing, and whatever that
  // attempt did was done before it: reporting the word's stage against the tap's would show
  // "held its ground" for a try the player never made.
  const foreign =
    a.resumed && (a.commit === null || a.commit.level !== a.level || (a.commit.owner ?? "").toLowerCase() !== a.owner.toLowerCase());
  if (foreign) return { kind: "foreign" };
  // The chain's own answer, never the signed one: a signed success no longer counts if the word
  // was unstaked or changed hands before the reveal (Prestige.reveal), and then it stands where it did.
  return { kind: "result", hit: a.after.level > a.level, level: a.after.level };
}
