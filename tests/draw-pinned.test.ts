/**
 * The letters a draw gives are PINNED here, for fixed seeds, against three supplies: every letter
 * open, one sold out, one that runs out inside a 5-draw pack, and only the rarest four left.
 *
 * The draw's weights moved into lib/letterOdds.ts so the Mint tab can show each letter's actual odds
 * from the same numbers (starl3xx, 2026-11-25). A paid commit's letters are a function of its id and
 * the supply, and a stored draw is only kept on a healthy database (stickyDraw fails open), so a
 * refactor that changed even the order of an addition could hand an unrevealed commit other letters.
 * These values were recorded BEFORE the weights moved; a change here is a change to live draws.
 */
import { describe, it, expect, beforeAll } from "vitest";

const LETTERS = "0x00000000000000000000000000000000000000c1" as const;
const FULL = new Array<number>(26).fill(1000);
const E = 4;
const R = 17;

let drawLetters: typeof import("@/lib/onchain/signer").drawLetters;
beforeAll(async () => {
  process.env.SIGNER_DRAW_SECRET = "pinned-draw-test-secret";
  // A draw's bytes name the network (signer.ts outcomeBytes), so the pins hold on Base only: fixed
  // here, or a shell with NEXT_PUBLIC_CHAIN_ID set to the testnet would fail them for no reason.
  process.env.NEXT_PUBLIC_CHAIN_ID = "8453";
  ({ drawLetters } = await import("@/lib/onchain/signer"));
});

const SUPPLIES: Record<string, number[]> = {
  open: FULL,
  "e sold out": FULL.map((n, i) => (i === E ? 0 : n)),
  // r runs out INSIDE a pack: the first seed draws r, and its later r must become another letter
  "e sold out, one r left": FULL.map((n, i) => (i === E ? 0 : i === R ? 1 : n)),
  // only the rarest letters remain: each draw's sum is tiny, where rounding would show first
  "only j, q, x, z": FULL.map((n, i) => ([9, 16, 23, 25].includes(i) ? n : 0)),
};
const IDS = [0n, 1n, 7n, 42n, 1000n, 123456789n];

/** Six packs of 5, then six dailies, per supply. Re-record with DRAW_RECORD=1 only for a change that MEANS to move the draw. */
const PINNED: Record<string, string[]> = {
  "open": ["15,8,17,0,1","19,6,17,12,11","0,7,6,24,5","12,8,1,12,0","19,24,17,20,2","0,5,8,17,19","5","18","19","1","18","18"],
  "e sold out": ["17,11,17,0,0","19,8,17,13,12","0,8,8,24,8","13,11,0,13,0","19,24,17,20,2","0,8,10,18,19","8","18","19","0","18","18"],
  "e sold out, one r left": ["17,10,18,0,0","19,8,17,13,11","0,8,8,24,8","13,11,0,13,0","19,24,17,20,2","0,8,10,18,19","8","18","19","0","18","18"],
  "only j, q, x, z": ["23,23,25,9,9","25,16,25,23,23","9,16,16,25,16","23,23,9,23,9","25,25,25,25,9","9,16,16,25,25","16","25","25","9","25","25"],
};

describe("drawLetters, pinned", () => {
  for (const [name, available] of Object.entries(SUPPLIES)) {
    it(`gives the recorded letters: ${name}`, () => {
      const got = IDS.map((id) => drawLetters(LETTERS, id, 5, available).join(","));
      const daily = IDS.map((id) => drawLetters(LETTERS, id, 1, available, "daily").join(","));
      if (process.env.DRAW_RECORD) console.log(`RECORD ${JSON.stringify(name)}: ${JSON.stringify([...got, ...daily])},`);
      else expect([...got, ...daily]).toEqual(PINNED[name]);
    });
  }
});
