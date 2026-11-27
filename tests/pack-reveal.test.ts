/**
 * What the game does with the server's answer to "open this pack" (src/lib/onchain/packReveal.ts,
 * decisions.md #49). The rule that costs money if it breaks: once the server has broadcast a
 * reveal, the player's wallet must never send a second one, and no letter is shown before a reveal
 * is known to be on chain.
 */
import { describe, it, expect } from "vitest";
import { waitingCommits, failedAsk, openPacks, packRevealPlan } from "@/lib/onchain/packReveal";

const SIG = `0x${"11".repeat(65)}` as const;
const FIVE = [17, 8, 3, 3, 0];

describe("packRevealPlan", () => {
  it("mined: shows the letters the chain minted", () => {
    expect(packRevealPlan({ relayed: "mined", letterIndexes: FIVE })).toEqual({ do: "show", letters: FIVE });
  });

  it("already: shows the letters when the server could read them back", () => {
    expect(packRevealPlan({ relayed: "already", letterIndexes: [16] })).toEqual({ do: "show", letters: [16] });
  });

  it("already, with no letters read back: the chain has them, so read", () => {
    expect(packRevealPlan({ relayed: "already" })).toEqual({ do: "read" });
  });

  it("pending and reverted: read the chain, and never show letters even if an answer carried some", () => {
    for (const relayed of ["pending", "reverted"] as const) {
      expect(packRevealPlan({ relayed })).toEqual({ do: "read" });
      expect(packRevealPlan({ relayed, letterIndexes: FIVE })).toEqual({ do: "read" });
    }
  });

  it("a broadcast reveal never reaches the wallet, even beside a signature", () => {
    for (const relayed of ["mined", "already", "pending", "reverted"] as const) {
      expect(packRevealPlan({ relayed, letterIndexes: FIVE, signature: SIG }).do).not.toBe("wallet");
      expect(packRevealPlan({ relayed, signature: SIG }).do).not.toBe("wallet");
    }
  });

  it("no `relayed` field: nothing was broadcast, so the wallet sends the signed draw", () => {
    expect(packRevealPlan({ letterIndexes: FIVE, signature: SIG })).toEqual({ do: "wallet", letters: FIVE, signature: SIG });
  });

  it("an answer it can't act on is `none`: a signature without letters, letters without a signature, nothing", () => {
    expect(packRevealPlan({ signature: SIG })).toEqual({ do: "none" });
    expect(packRevealPlan({ letterIndexes: FIVE })).toEqual({ do: "none" });
    expect(packRevealPlan({})).toEqual({ do: "none" });
    expect(packRevealPlan(null)).toEqual({ do: "none" });
    expect(packRevealPlan(undefined)).toEqual({ do: "none" });
  });

  it("letters that are not a pull are not shown: an uppercase id, a fraction, none, six", () => {
    for (const bad of [[26], [1.5], [], [0, 1, 2, 3, 4, 5], [-1]]) {
      expect(packRevealPlan({ relayed: "mined", letterIndexes: bad })).toEqual({ do: "read" });
      expect(packRevealPlan({ letterIndexes: bad, signature: SIG })).toEqual({ do: "none" });
    }
  });

  it("the plan's letters are a copy: changing them never changes the answer", () => {
    const answer = { relayed: "mined" as const, letterIndexes: [...FIVE] };
    const plan = packRevealPlan(answer);
    if (plan.do !== "show") throw new Error("expected show");
    plan.letters.push(9);
    expect(answer.letterIndexes).toEqual(FIVE);
  });
});

describe("openPacks", () => {
  const pending = [{ commitId: 176n }, { commitId: 177n }, { commitId: 178n }];

  it("leaves out a commit this browser has seen revealed, whatever a lagging node says", () => {
    expect(openPacks(pending, new Set(["177"]))).toEqual([{ commitId: 176n }, { commitId: 178n }]);
  });

  it("keeps every commit when none is known revealed, and keeps the order (oldest first)", () => {
    expect(openPacks(pending, new Set())).toEqual(pending);
  });

  it("an id from another list changes nothing", () => {
    expect(openPacks(pending, new Set(["9"]))).toEqual(pending);
  });
});

describe("failedAsk: what a failed request to open a pack means", () => {
  it("“already revealed” is not a refusal: the pack is open (a server from before the relay answers that way)", () => {
    expect(failedAsk("already_revealed")).toBe("open");
  });

  it("a lost answer is lost: the fetch failed, or no JSON came back", () => {
    expect(failedAsk("request_failed")).toBe("lost");
    expect(failedAsk("http_502")).toBe("lost");
    expect(failedAsk("http_504")).toBe("lost");
  });

  it("anything else the server stated is a refusal before it sent anything", () => {
    for (const e of ["rate_limited", "unknown_commit", "bad_commit_id", "no_supply", "http_404", "http_429", undefined]) expect(failedAsk(e)).toBe("refused");
  });
});

// The card on Today and Mint counts these (Bugbot on #273: a pack that was mined, and not yet seen
// by its own flow, showed as waiting, and the card's Open could only say "Still working on").
describe("which open commits are waiting for the player", () => {
  const c = (id: bigint) => ({ commitId: id });
  const ids = (list: { commitId: bigint }[]) => list.map((x) => x.commitId);

  it("with no piece on its way, every open commit waits", () => {
    expect(ids(waitingCommits([c(7n), c(9n)], null))).toEqual([7n, 9n]);
  });

  it("while a pack is on its way, its own commit never counts, at any step", () => {
    const known = new Set(["7"]); // what was waiting before the tap
    // the wallet is open, or the commit is sent: its number isn't known yet, and the commit shows up
    expect(ids(waitingCommits([c(7n), c(9n)], { known, own: null }))).toEqual([7n]);
    // the flow has found it
    expect(ids(waitingCommits([c(7n), c(9n)], { known, own: 9n }))).toEqual([7n]);
  });

  it("an older pack that was waiting still counts while a new one is on its way", () => {
    expect(ids(waitingCommits([c(3n), c(7n), c(9n)], { known: new Set(["3", "7"]), own: null }))).toEqual([3n, 7n]);
  });

  it("mail being opened from the card is not waiting while it is opened", () => {
    // it WAS waiting before (the card listed it), and it is the piece's own commit
    expect(ids(waitingCommits([c(7n), c(9n)], { known: new Set(["7", "9"]), own: 7n }))).toEqual([9n]);
  });

  it("once the piece settles, a pack that ended up waiting counts again", () => {
    expect(ids(waitingCommits([c(9n)], null))).toEqual([9n]);
  });

  it("gives back a list of its own", () => {
    const open = [c(7n)];
    expect(waitingCommits(open, null)).not.toBe(open);
  });
});
