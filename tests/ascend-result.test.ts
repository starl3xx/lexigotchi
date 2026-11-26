/**
 * What an ascension attempt came to (src/lib/onchain/ascendResult.ts), from the chain's own answer.
 * Each rule here was a way to tell a player the wrong thing about a try they paid for.
 */
import { describe, it, expect } from "vitest";
import { ascendResult } from "@/lib/onchain/ascendResult";

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

  it("a resumed attempt that was already revealed when asked isn't this tap's: ready again, never a miss it didn't make", () => {
    // another tab finished it, or a lagging read called a finished attempt open: the tap paid nothing
    expect(ascendResult({ ...base, resumed: true, commit: null, after: at(1) })).toEqual({ kind: "foreign" });
    expect(ascendResult({ ...base, resumed: true, commit: null, after: at(2) })).toEqual({ kind: "foreign" });
  });

  it("a NEW attempt already revealed when asked is still this tap's: it paid, and the chain's stage gives the result", () => {
    expect(ascendResult({ ...base, resumed: false, commit: null, after: at(2) })).toEqual({ kind: "result", hit: true, level: 2, pity: 0 });
    expect(ascendResult({ ...base, resumed: false, commit: null, after: at(1, 1) })).toEqual({ kind: "result", hit: false, level: 1, pity: 1 });
  });
});
