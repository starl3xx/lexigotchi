/**
 * What the game does with the server's answer to "open this pack" (src/lib/onchain/packReveal.ts,
 * decisions.md #49). The rule that costs money if it breaks: once the server has broadcast a
 * reveal, the player's wallet must never send a second one, and no letter is shown before a reveal
 * is known to be on chain.
 */
import { describe, it, expect } from "vitest";
import { openPacks, packRevealPlan } from "@/lib/onchain/packReveal";

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
