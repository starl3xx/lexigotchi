/**
 * What an ascension attempt came to, decided from what the CHAIN says after its reveal.
 *
 * The game used to report the signed outcome at the moment the wallet took the reveal. Three things
 * went wrong from there: "try again" found the finished attempt still open; a miss kept its old
 * odds; and a resumed attempt that wasn't this word's own (see `foreign` below) was reported as a
 * miss, as if the player had just lost a try they never made. So the provider learns where the
 * reveal left the word (from the server's relayed reveal, or by reading the chain once a reveal has
 * landed), and this decides what to tell the sheet.
 *
 * Pure, so the rules are tested directly (tests/ascend-result.test.ts).
 */

export type AscendResult =
  /** The reveal never showed in the wait. Paid, and not known to be finished: offer no other try. */
  | { kind: "unfinished" }
  /**
   * An earlier attempt was finished instead of a new one, and it wasn't this try's: made before
   * the word changed hands, or at another stage (before it was dissolved and claimed again;
   * Prestige keys attempts by token), or already revealed by the time the game asked, with nothing
   * to say it was this player's own unfinished try (a lagging read called a finished attempt
   * open). Prestige voids it or raises today's stage. Nothing was spent by this tap and nothing is
   * left open, so the sheet is ready again: never "you missed".
   */
  | { kind: "foreign" }
  /**
   * This try's result: `hit` is the word standing a stage higher than at the tap. `level` and
   * `pity` are where the chain has it now. A miss usually adds one to the pity, but not always: a
   * signed success that no longer counted leaves the pity as it was, so it is read, never inferred.
   */
  | { kind: "result"; hit: boolean; level: number; pity: number };

export function ascendResult(a: {
  /**
   * The stage the try was made at: the word's stage at the tap, or, for an attempt this browser
   * left unfinished earlier (`own`), the stage it marked then.
   */
  level: number;
  /** Who the attempt is for: the staker (a caretaker commits in the staker's name). */
  owner: string;
  /** An open attempt was found and finished; no new one was paid for. */
  resumed: boolean;
  /**
   * The finished attempt is one this browser knows the player paid for and never saw the end of
   * (it carries the unfinished mark, by its commit). Its result is owed, even when it turns out to
   * be revealed already: that is what a lost answer from the server looks like.
   */
  own?: boolean;
  /** The attempt was already revealed when the game asked for it. */
  already?: boolean;
  /** What the server said the commit was paid at (its stage, its owner), or null when it said nothing. */
  commit: { level?: number; owner?: string } | null;
  /** Where the reveal left the word, or null if it never showed. */
  after: { level: number; pity: number } | null;
}): AscendResult {
  if (!a.after) return { kind: "unfinished" };
  if (a.resumed) {
    // Finished already, or with nothing known of the commit, and nothing says it was this
    // player's own: the tap paid for nothing, and whatever that attempt did was done before it.
    // Reporting the word's stage against the tap's would show "held its ground" for a try the
    // player never made.
    if (!a.own && (a.already || a.commit === null)) return { kind: "foreign" };
    // The commit is known, and it isn't this word's at this stage.
    if (a.commit && (a.commit.level !== a.level || (a.commit.owner ?? "").toLowerCase() !== a.owner.toLowerCase())) return { kind: "foreign" };
  }
  // The chain's own answer, never the signed one: a signed success no longer counts if the word
  // was unstaked or changed hands before the reveal (Prestige.reveal), and then it stands where it did.
  return { kind: "result", hit: a.after.level > a.level, level: a.after.level, pity: a.after.pity };
}

/** /api/prestige/reveal's answer, as far as the game acts on it (the route documents each field). */
export interface RevealAnswer {
  relayed?: "mined" | "already" | "pending" | "reverted";
  success?: boolean;
  signature?: `0x${string}`;
  stage?: number | null;
  pity?: number;
}

/**
 * What the game does with the server's answer to "finish this attempt".
 * - `use`: the server's reveal is on chain, and it read where that left the word. Show it.
 * - `read`: a reveal is broadcast, or was done before the game asked (or it mined, but the server
 *   couldn't read the word's level). The chain has the result or soon will: read it there.
 * - `wallet`: nothing was broadcast, and here is the signed outcome for the player's wallet to send.
 * - `none`: an answer the game can't act on. Paid, so the attempt is unfinished, never retried.
 *
 * The rule that matters: ONLY an answer with no `relayed` field sends from the wallet. Once the
 * server has broadcast a reveal, a second one from the wallet would revert when the first lands,
 * for a prompt and a fee that bought nothing, so `relayed` wins even beside a signature.
 */
export type RevealPlan =
  | { do: "use"; stage: { level: number; pity: number } }
  | { do: "read"; already: boolean }
  | { do: "wallet"; success: boolean; signature: `0x${string}` }
  | { do: "none" };

export function revealPlan(r: RevealAnswer): RevealPlan {
  if (r.relayed) {
    if (r.relayed === "mined" && Number.isInteger(r.stage) && Number.isInteger(r.pity)) return { do: "use", stage: { level: r.stage as number, pity: r.pity as number } };
    return { do: "read", already: r.relayed === "already" };
  }
  if (typeof r.success === "boolean" && r.signature) return { do: "wallet", success: r.success, signature: r.signature };
  return { do: "none" };
}

/**
 * Did the request for a reveal fail in a way that says nothing about whether the server acted?
 *
 * The server holds the request while it sends the reveal and waits for its block (up to about 20
 * seconds), so a dropped connection or a timed-out function can leave the attempt FINISHED with the
 * answer lost. Those errors (`request_failed`: the fetch itself failed; `http_5xx`: no JSON came
 * back) mean "ask the chain", never "nothing happened". An error the server stated in JSON
 * (rate_limited, unknown_commit, …) means it refused before sending anything.
 */
export function answerLost(error: string | undefined): boolean {
  return error === "request_failed" || /^http_5\d\d$/.test(error ?? "");
}
