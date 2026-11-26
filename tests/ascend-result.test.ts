/**
 * What an ascension attempt came to (src/lib/onchain/ascendResult.ts), from the chain's own answer.
 * Each rule here was a way to tell a player the wrong thing about a try they paid for.
 */
import { describe, it, expect } from "vitest";
import { ascendResult } from "@/lib/onchain/ascendResult";

const OWNER = "0xAbC0000000000000000000000000000000000001";
const base = { level: 1, owner: OWNER, resumed: false, commit: { level: 1, owner: OWNER } };

describe("ascendResult", () => {
  it("a hit is the word standing a stage higher than at the tap", () => {
    expect(ascendResult({ ...base, after: { level: 2 } })).toEqual({ kind: "result", hit: true, level: 2 });
  });

  it("a miss leaves it where it stood", () => {
    expect(ascendResult({ ...base, after: { level: 1 } })).toEqual({ kind: "result", hit: false, level: 1 });
  });

  it("a signed success that no longer counted is not a hit: the chain's stage decides, not the signature", () => {
    // unstaked or sold before the reveal: Prestige.reveal consumes the commit and raises nothing
    expect(ascendResult({ ...base, after: { level: 1 } })).toMatchObject({ kind: "result", hit: false });
  });

  it("a reveal that never showed is unfinished: paid, so no other try may be offered", () => {
    expect(ascendResult({ ...base, after: null })).toEqual({ kind: "unfinished" });
    // even for a resumed attempt that would otherwise be foreign
    expect(ascendResult({ ...base, resumed: true, commit: { level: 0, owner: OWNER }, after: null })).toEqual({ kind: "unfinished" });
  });

  it("a resumed attempt paid at another stage isn't this try's: never reported as a miss", () => {
    expect(ascendResult({ ...base, resumed: true, commit: { level: 0, owner: OWNER }, after: { level: 1 } })).toEqual({ kind: "foreign" });
  });

  it("a resumed attempt made for another owner isn't this try's either", () => {
    const other = "0xdef0000000000000000000000000000000000002";
    expect(ascendResult({ ...base, resumed: true, commit: { level: 1, owner: other }, after: { level: 1 } })).toEqual({ kind: "foreign" });
  });

  it("a resumed attempt that IS this word's own (same stage, same owner, any letter case) gives its result", () => {
    const res = ascendResult({ ...base, resumed: true, commit: { level: 1, owner: OWNER.toLowerCase() }, after: { level: 2 } });
    expect(res).toEqual({ kind: "result", hit: true, level: 2 });
  });

  it("a new attempt is never foreign, whatever the server's answer carried", () => {
    expect(ascendResult({ ...base, resumed: false, commit: { level: 3, owner: "0x0" }, after: { level: 1 } })).toMatchObject({ kind: "result" });
  });

  it("already revealed when asked (no commit facts): the chain's stage still gives the result", () => {
    expect(ascendResult({ ...base, resumed: true, commit: null, after: { level: 2 } })).toEqual({ kind: "result", hit: true, level: 2 });
  });
});
