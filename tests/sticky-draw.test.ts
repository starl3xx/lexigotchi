/**
 * One valid letter draw per commit (src/lib/onchain/stickyDraw.ts). The draw depends on which
 * letters are still uncapped, so without a stored first draw, a cap-out between two requests could
 * hand one unrevealed pack two different valid signatures to choose from.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { drawFits, stickyDraw, type DrawStore } from "@/lib/onchain/stickyDraw";

beforeAll(() => {
  process.env.SIGNER_DRAW_SECRET = "test-secret-not-a-real-one";
});
const signer = () => import("@/lib/onchain/signer");

const FULL = Array.from({ length: 26 }, () => 100);
const LETTERS = "0x00000000000000000000000000000000000000a1" as const;

/** An in-memory store with the same first-write-wins semantics as the database one. */
function memoryStore(): DrawStore & { rows: Map<string, number[]> } {
  const rows = new Map<string, number[]>();
  return {
    rows,
    read: async (c, k) => rows.get(`${c}:${k}`) ?? null,
    claim: async (c, k, l) => {
      if (!rows.has(`${c}:${k}`)) rows.set(`${c}:${k}`, l);
      return rows.get(`${c}:${k}`)!;
    },
    replaceIf: async (c, k, expected, next) => {
      if (JSON.stringify(rows.get(`${c}:${k}`)) !== JSON.stringify(expected)) return false;
      rows.set(`${c}:${k}`, next);
      return true;
    },
  };
}

/** A commit whose draw CHANGES when some letter outside it caps out: the case that needs fixing. */
async function findShiftingCommit() {
  const { drawLetters } = await signer();
  for (let id = 0n; id < 500n; id++) {
    const before = drawLetters(LETTERS, id, 5, FULL);
    for (let capped = 0; capped < 26; capped++) {
      if (before.includes(capped)) continue;
      const after = FULL.map((n, i) => (i === capped ? 0 : n));
      const redrawn = drawLetters(LETTERS, id, 5, after);
      if (redrawn.join() !== before.join()) return { id, before, after, redrawn };
    }
  }
  throw new Error("no shifting commit found in range");
}

describe("drawFits", () => {
  it("counts repeated letters against what is left", () => {
    const avail = FULL.map((n, i) => (i === 16 ? 1 : n)); // one q left
    expect(drawFits([16, 0, 1], avail)).toBe(true);
    expect(drawFits([16, 16, 1], avail)).toBe(false);
    expect(drawFits([0], FULL.map(() => 0))).toBe(false);
  });
});

describe("stickyDraw", () => {
  it("without it, a cap-out elsewhere really does change a commit's letters", async () => {
    const s = await findShiftingCommit();
    expect(drawFits(s.before, s.after)).toBe(true); // the first draw is STILL mintable…
    expect(s.redrawn).not.toEqual(s.before); // …and yet a fresh draw differs: two valid choices
  });

  it("serves the first draw again after that cap-out, so there is only one", async () => {
    const { drawLetters } = await signer();
    const s = await findShiftingCommit();
    const store = memoryStore();
    const ask = (available: number[]) =>
      stickyDraw({ chainId: 84532, key: `c:${s.id}`, count: 5, available, draw: () => drawLetters(LETTERS, s.id, 5, available) }, store);

    expect(await ask(FULL)).toEqual(s.before);
    expect(await ask(s.after)).toEqual(s.before);
  });

  it("draws again only when the stored draw can no longer be minted", async () => {
    const { drawLetters } = await signer();
    const store = memoryStore();
    const first = await stickyDraw({ chainId: 84532, key: "c:7", count: 5, available: FULL, draw: () => drawLetters(LETTERS, 7n, 5, FULL) }, store);
    const dead = FULL.map((n, i) => (i === first[0] ? 0 : n)); // one of its letters capped out
    const second = await stickyDraw({ chainId: 84532, key: "c:7", count: 5, available: dead, draw: () => drawLetters(LETTERS, 7n, 5, dead) }, store);
    expect(drawFits(first, dead)).toBe(false); // the old signature would revert CapExceeded
    expect(drawFits(second, dead)).toBe(true);
    expect(store.rows.get("84532:c:7")).toEqual(second);
  });

  it("two first requests racing agree on whichever was stored first", async () => {
    const store = memoryStore();
    await store.claim(84532, "d:42:20410", [3]);
    const got = await stickyDraw(
      { chainId: 84532, key: "d:42:20410", count: 1, available: FULL, draw: () => [9] },
      { ...store, read: async () => null }, // this request read before the other one wrote
    );
    expect(got).toEqual([3]);
  });

  it("two requests replacing the same stale draw: the loser serves the winner's draw", async () => {
    // Both saw a stale stored draw S. A (fresher supply) replaces it first; B (older supply) loses
    // the compare-and-set and must serve A's draw, never sign its own.
    const store = memoryStore();
    await store.claim(84532, "c:9", [0, 0, 0, 0, 0]); // S: five a's
    const noA = FULL.map((n, i) => (i === 0 ? 0 : n)); // 'a' capped: S is dead
    const a = await stickyDraw({ chainId: 84532, key: "c:9", count: 5, available: noA, draw: () => [1, 2, 3, 4, 5] }, store);
    const staleRead: DrawStore = { ...store, read: (() => { let first = true; return async (c: number, k: string) => { if (first) { first = false; return [0, 0, 0, 0, 0]; } return store.read(c, k); }; })() };
    const b = await stickyDraw({ chainId: 84532, key: "c:9", count: 5, available: noA, draw: () => [6, 7, 8, 9, 10] }, staleRead);
    expect(a).toEqual([1, 2, 3, 4, 5]);
    expect(b).toEqual(a); // one draw signed, not two
  });

  it("a claim race whose winner is already unmintable is replaced, not signed beside it", async () => {
    const store = memoryStore();
    const deadForUs = FULL.map((n, i) => (i === 3 ? 0 : n)); // 'd' capped in our (fresher) view
    await store.claim(84532, "c:11", [3, 3, 3, 3, 3]); // a racing request stored all-d a moment ago
    const got = await stickyDraw(
      { chainId: 84532, key: "c:11", count: 5, available: deadForUs, draw: () => [1, 1, 1, 1, 1] },
      { ...store, read: async () => null }, // we read before that write landed
    );
    expect(got).toEqual([1, 1, 1, 1, 1]);
    expect(store.rows.get("84532:c:11")).toEqual(got); // what we sign is what the row holds
  });

  it("keeps chains apart and ignores a stored draw of the wrong size", async () => {
    const store = memoryStore();
    await store.claim(8453, "c:1", [1, 2, 3, 4, 5]);
    expect(await stickyDraw({ chainId: 84532, key: "c:1", count: 5, available: FULL, draw: () => [6, 6, 6, 6, 6] }, store)).toEqual([6, 6, 6, 6, 6]);
    await store.claim(84532, "c:2", [1]);
    expect(await stickyDraw({ chainId: 84532, key: "c:2", count: 5, available: FULL, draw: () => [7, 7, 7, 7, 7] }, store)).toEqual([7, 7, 7, 7, 7]);
  });

  it("still draws through a database outage, so a paid commit stays revealable", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken: DrawStore = {
      read: async () => { throw new Error("db down"); },
      claim: async () => { throw new Error("db down"); },
      replaceIf: async () => { throw new Error("db down"); },
    };
    expect(await stickyDraw({ chainId: 84532, key: "c:3", count: 1, available: FULL, draw: () => [4] }, broken)).toEqual([4]);
    spy.mockRestore();
  });

  it("with no database configured, it is the plain draw", async () => {
    expect(await stickyDraw({ chainId: 84532, key: "c:4", count: 1, available: FULL, draw: () => [5] }, null)).toEqual([5]);
  });
});
