/**
 * What the game does with the server's answer to "open this pack" (decisions.md #49).
 *
 * The server finishes a pack as it finishes a roll and an ascension: /api/mint/reveal with
 * `{ relay: true }` sends `Letters.reveal` from the relayer key, so the player confirms ONE
 * transaction. The answer says what happened to that reveal, and this module turns it into the
 * game's next step. Pure, so the rules are tested (tests/pack-reveal.test.ts) apart from a wallet,
 * a chain, and a server.
 *
 * The rule that matters, the same as ascension's (lib/onchain/ascendResult `revealPlan`): ONLY an
 * answer with no `relayed` field sends from the wallet. Once the server has broadcast a reveal, a
 * second one from the wallet would revert when the first lands, for a prompt and a fee that bought
 * nothing, so `relayed` wins even beside a signature.
 */

/** /api/mint/reveal's answer, as far as the game acts on it (the route documents each field). */
export interface PackRevealAnswer {
  relayed?: "mined" | "already" | "pending" | "reverted";
  letterIndexes?: readonly number[];
  signature?: `0x${string}`;
}

/**
 * - `show`: the reveal is on chain, and these are the letters it minted. Show them.
 * - `read`: a reveal is broadcast, or was done before the game asked and the server couldn't say
 *   what it held. The chain has the letters or soon will: wait for it, then ask once more.
 * - `wallet`: nothing was broadcast, and here is the signed draw for the player's wallet to send.
 * - `none`: an answer the game can't act on. The pack is paid for, so it waits; it is never retried
 *   as if nothing had happened.
 */
export type PackRevealPlan =
  | { do: "show"; letters: number[] }
  | { do: "read" }
  | { do: "wallet"; letters: number[]; signature: `0x${string}` }
  | { do: "none" };

/** A pull's letters: one to five alphabet indexes (a pack is five, a daily letter one). */
function lettersOf(indexes: readonly number[] | undefined): number[] | null {
  if (!Array.isArray(indexes) || indexes.length < 1 || indexes.length > 5) return null;
  return indexes.every((i) => Number.isInteger(i) && i >= 0 && i <= 25) ? [...indexes] : null;
}

export function packRevealPlan(r: PackRevealAnswer | null | undefined): PackRevealPlan {
  if (!r) return { do: "none" };
  const letters = lettersOf(r.letterIndexes);
  if (r.relayed) {
    // "pending" and "reverted" never show letters, even if an answer carried some: nothing says
    // that reveal landed, and the pack opens only once its letters exist.
    if ((r.relayed === "mined" || r.relayed === "already") && letters) return { do: "show", letters };
    return { do: "read" };
  }
  if (letters && r.signature) return { do: "wallet", letters, signature: r.signature };
  return { do: "none" };
}

/**
 * Pack commits to leave out of every search for an open one: the ids this browser has SEEN revealed.
 *
 * "Rip another" commits a new pack seconds after a reveal, and an RPC node a block behind can still
 * read the finished commit as open. Taken for "the new pack", it would show the old pack's letters
 * again and leave the new, paid commit unopened. A revealed commit is never open again, so it is
 * always safe to skip (the roll flow keeps the same set, `revealedRolls`).
 */
export function openPacks<T extends { commitId: bigint }>(pending: readonly T[], revealed: ReadonlySet<string>): T[] {
  return pending.filter((c) => !revealed.has(String(c.commitId)));
}
