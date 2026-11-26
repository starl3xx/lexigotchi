/**
 * What an ascension attempt came to (src/lib/onchain/ascendResult.ts), from the chain's own answer.
 * Each rule here was a way to tell a player the wrong thing about a try they paid for.
 */
import { describe, it, expect } from "vitest";
import { answerLost, ascendResult, revealPlan } from "@/lib/onchain/ascendResult";

const OWNER = "0xAbC0000000000000000000000000000000000001";
const base = { level: 1, owner: OWNER, resumed: false, commit: { level: 1, owner: OWNER } };
/** The chain after a reveal: the word's stage, and its misses in a row. */
const at = (level: number, pity = 0) => ({ level, pity });

describe("ascendResult", () => {
  it("a hit is the word standing a stage higher than at the tap", () => {
    expect(ascendResult({ ...base, after: at(2) })).toEqual({ kind: "result", hit: true, level: 2, pity: 0 });
  });

  it("a miss leaves it where it stood, with the pity the chain now has", () => {
    expect(ascendResult({ ...base, after: at(1, 3) })).toEqual({ kind: "result", hit: false, level: 1, pity: 3 });
  });

  it("a signed success that no longer counted is not a hit, and adds no miss: the chain's numbers, not a guess", () => {
    // unstaked or sold before the reveal: Prestige.reveal consumes the commit, raises nothing,
    // and leaves the pity as it was. Inferring "a miss, so one more" showed odds the word didn't
    // have (Bugbot on #229).
    expect(ascendResult({ ...base, after: at(1, 2) })).toEqual({ kind: "result", hit: false, level: 1, pity: 2 });
  });

  it("a reveal that never showed is unfinished: paid, so no other try may be offered", () => {
    expect(ascendResult({ ...base, after: null })).toEqual({ kind: "unfinished" });
    // even for a resumed attempt that would otherwise be foreign
    expect(ascendResult({ ...base, resumed: true, commit: { level: 0, owner: OWNER }, after: null })).toEqual({ kind: "unfinished" });
  });

  it("a resumed attempt paid at another stage isn't this try's: never reported as a miss", () => {
    expect(ascendResult({ ...base, resumed: true, commit: { level: 0, owner: OWNER }, after: at(1) })).toEqual({ kind: "foreign" });
  });

  it("a resumed attempt made for another owner isn't this try's either", () => {
    const other = "0xdef0000000000000000000000000000000000002";
    expect(ascendResult({ ...base, resumed: true, commit: { level: 1, owner: other }, after: at(1) })).toEqual({ kind: "foreign" });
  });

  it("a resumed attempt that IS this word's own (same stage, same owner, any letter case) gives its result", () => {
    const res = ascendResult({ ...base, resumed: true, commit: { level: 1, owner: OWNER.toLowerCase() }, after: at(2) });
    expect(res).toEqual({ kind: "result", hit: true, level: 2, pity: 0 });
  });

  it("a new attempt is never foreign, whatever the server's answer carried", () => {
    expect(ascendResult({ ...base, resumed: false, commit: { level: 3, owner: "0x0" }, after: at(1) })).toMatchObject({ kind: "result" });
  });

  it("a NEW attempt already revealed when asked is still this tap's: it paid, and the chain's stage gives the result", () => {
    expect(ascendResult({ ...base, resumed: false, already: true, commit: null, after: at(2) })).toEqual({ kind: "result", hit: true, level: 2, pity: 0 });
    expect(ascendResult({ ...base, resumed: false, already: true, commit: null, after: at(1, 1) })).toEqual({ kind: "result", hit: false, level: 1, pity: 1 });
  });
});

describe("ascendResult: a resumed attempt that was already revealed", () => {
  it("with nothing to say it was this player's own, isn't this tap's: ready again, never a miss it didn't make", () => {
    // a lagging read called a finished attempt open: the tap paid nothing
    expect(ascendResult({ ...base, resumed: true, already: true, commit: null, after: at(1) })).toEqual({ kind: "foreign" });
    expect(ascendResult({ ...base, resumed: true, already: true, commit: null, after: at(2) })).toEqual({ kind: "foreign" });
  });

  it("stays foreign when the server names the commit: the relay's “already” answer carries its facts", () => {
    // Under relay the answer is ok:true with the commit's stage and owner, where it used to be a
    // 409 with nothing. Matching facts must not turn "already revealed, not ours" into a miss.
    expect(ascendResult({ ...base, resumed: true, already: true, commit: { level: 1, owner: OWNER }, after: at(1, 1) })).toEqual({ kind: "foreign" });
  });

  it("is owed its result when it is the player's own unfinished attempt: the server finished it and the answer was lost", () => {
    // `level` is the stage the attempt was MARKED at, so a hit that landed while nobody was told is still a hit
    expect(ascendResult({ ...base, resumed: true, own: true, already: true, commit: { level: 1, owner: OWNER }, after: at(2) })).toEqual({
      kind: "result",
      hit: true,
      level: 2,
      pity: 0,
    });
    expect(ascendResult({ ...base, resumed: true, own: true, already: true, commit: null, after: at(1, 4) })).toEqual({
      kind: "result",
      hit: false,
      level: 1,
      pity: 4,
    });
  });

  it("an own attempt whose commit turns out to be another stage's is still foreign", () => {
    expect(ascendResult({ ...base, resumed: true, own: true, already: true, commit: { level: 0, owner: OWNER }, after: at(1) })).toEqual({ kind: "foreign" });
  });

  it("a resumed attempt with nothing known of its commit (the answer was lost) is foreign unless it is the player's own", () => {
    expect(ascendResult({ ...base, resumed: true, commit: null, after: at(1, 1) })).toEqual({ kind: "foreign" });
    expect(ascendResult({ ...base, resumed: true, own: true, commit: null, after: at(1, 1) })).toMatchObject({ kind: "result", hit: false });
  });
});

describe("revealPlan (what the game does with the server's answer)", () => {
  const SIG = `0x${"ab".repeat(65)}` as const;

  it("mined, with where it left the word: show that", () => {
    expect(revealPlan({ relayed: "mined", success: true, stage: 2, pity: 0 })).toEqual({ do: "use", stage: { level: 2, pity: 0 } });
    expect(revealPlan({ relayed: "mined", success: false, stage: 1, pity: 3 })).toEqual({ do: "use", stage: { level: 1, pity: 3 } });
  });

  it("mined, but the server couldn't read the level: read the chain, never fill it in", () => {
    expect(revealPlan({ relayed: "mined", success: false, stage: null, pity: 3 })).toEqual({ do: "read", already: false });
  });

  it("pending, reverted, already: a reveal is out or done, so read the chain", () => {
    expect(revealPlan({ relayed: "pending" })).toEqual({ do: "read", already: false });
    expect(revealPlan({ relayed: "reverted" })).toEqual({ do: "read", already: false });
    expect(revealPlan({ relayed: "already" })).toEqual({ do: "read", already: true });
  });

  it("only an answer with NOTHING broadcast reaches the wallet", () => {
    expect(revealPlan({ success: true, signature: SIG })).toEqual({ do: "wallet", success: true, signature: SIG });
    // a second reveal from the wallet would revert when the server's lands: `relayed` wins, even
    // beside a signature
    for (const relayed of ["mined", "pending", "reverted", "already"] as const) {
      expect(revealPlan({ relayed, success: true, signature: SIG }).do).not.toBe("wallet");
    }
  });

  it("an answer it can't act on is none of these: the attempt stays unfinished, and nothing is sent", () => {
    expect(revealPlan({})).toEqual({ do: "none" });
    expect(revealPlan({ success: true })).toEqual({ do: "none" });
    expect(revealPlan({ signature: SIG })).toEqual({ do: "none" });
  });
});

describe("answerLost", () => {
  it("a failed fetch, or a 5xx with no JSON, says nothing about whether the server finished the attempt", () => {
    expect(answerLost("request_failed")).toBe(true);
    expect(answerLost("http_504")).toBe(true);
    expect(answerLost("http_502")).toBe(true);
  });

  it("an error the server stated means it refused before sending anything", () => {
    for (const e of ["rate_limited", "unknown_commit", "bad_commit_id", "already_revealed", "http_404", "http_429", undefined]) {
      expect(answerLost(e)).toBe(false);
    }
  });
});
