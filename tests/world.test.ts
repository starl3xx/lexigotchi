/**
 * The world read behind the leaderboard and the Dictionary's owners (src/lib/world.ts): letter
 * balances rebuilt from transfer events, and the rankings.
 */
import { describe, it, expect } from "vitest";
import { buildLeaderboards, letterTotals, type WorldSnapshot } from "@/lib/world";
import { linkMapFrom } from "@/lib/db/walletLinks";

const ZERO = "0x0000000000000000000000000000000000000000";
const WORDS_CONTRACT = "0x00000000000000000000000000000000000000aa";
const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const skip = new Set([ZERO, WORDS_CONTRACT]);

describe("letterTotals", () => {
  it("replays mints, an upgrade, and an escrow into each wallet's loose letters", () => {
    const totals = letterTotals(
      [
        { from: ZERO, to: A, ids: [0n, 1n, 2n, 3n, 4n], values: [1n, 1n, 1n, 1n, 2n] }, // a pack: a b c d e e
        { from: A, to: ZERO, ids: [4n], values: [1n] }, // a roll hit burns one lowercase e…
        { from: ZERO, to: A, ids: [30n], values: [1n] }, // …and mints an UPPERCASE E
        { from: A, to: WORDS_CONTRACT, ids: [0n, 1n, 2n], values: [1n, 1n, 1n] }, // three go into a word
        { from: ZERO, to: B, ids: [25n], values: [1n] },
      ],
      skip,
    );
    expect(totals[A.toLowerCase()]).toEqual({ lower: 2, upper: 1 }); // d, e loose; E loose
    expect(totals[B.toLowerCase()]).toEqual({ lower: 1, upper: 0 });
    expect(totals[WORDS_CONTRACT]).toBeUndefined(); // the game's contracts aren't players
    expect(totals[ZERO]).toBeUndefined();
  });

  it("drops a wallet that holds nothing anymore", () => {
    const totals = letterTotals(
      [
        { from: ZERO, to: A, ids: [7n], values: [1n] },
        { from: A, to: B, ids: [7n], values: [1n] },
      ],
      skip,
    );
    expect(totals[A]).toBeUndefined();
    expect(totals[B]).toEqual({ lower: 1, upper: 0 });
  });
});

describe("buildLeaderboards", () => {
  const snap: WorldSnapshot = {
    words: [
      { word: "AGLOW", owner: A, staked: true, raised: 1 },
      { word: "CRANE", owner: A, staked: false, raised: 5 },
      { word: "ENROL", owner: B, staked: true, raised: 0 },
    ],
    letters: { [A]: { lower: 3, upper: 0 }, [B]: { lower: 20, upper: 2 } },
    wins: { [B]: { count: 1, amount: 500 }, [A]: { count: 1, amount: 900 } },
    yieldWeight: 0, weights: {},
  };
  const boards = buildLeaderboards(snap);

  it("words counts each owner's words", () => {
    expect(boards.words).toEqual([{ address: A, value: 2 }, { address: B, value: 1 }]);
  });

  it("letters counts loose letters plus five per word", () => {
    expect(boards.letters).toEqual([{ address: B, value: 27 }, { address: A, value: 13 }]);
  });

  it("raised counts UPPERCASE letters, loose or in words", () => {
    expect(boards.raised).toEqual([{ address: A, value: 6 }, { address: B, value: 2 }]);
  });

  it("wins ties are broken by the $WORD won", () => {
    expect(boards.wins.map((r) => r.address)).toEqual([A, B]);
    expect(boards.wins[0]).toEqual({ address: A, value: 1, amount: 900 });
  });

  it("caps each board", () => {
    expect(buildLeaderboards(snap, 1).words).toHaveLength(1);
  });
});

describe("buildLeaderboards with linked wallets", () => {
  // Made-up wallets: A heads an account that B joined; C plays alone.
  const A = "0x1111111111111111111111111111111111111111";
  const B = "0x2222222222222222222222222222222222222222";
  const C = "0x3333333333333333333333333333333333333333";
  const links = linkMapFrom([{ address: B, account: A }]);
  const snap: WorldSnapshot = {
    words: [
      { word: "CRANE", owner: A, staked: true, raised: 1 },
      { word: "SLATE", owner: B, staked: false, raised: 0 },
      { word: "TRACE", owner: C, staked: true, raised: 5 },
    ],
    letters: { [B]: { lower: 3, upper: 2 }, [C]: { lower: 1, upper: 0 } },
    wins: { [B]: { count: 1, amount: 100 }, [A]: { count: 1, amount: 50 } },
    yieldWeight: 0, weights: {},
  };

  it("sums every wallet in an account into one row, named by the account", () => {
    const boards = buildLeaderboards(snap, 25, links.accountOf);
    expect(boards.words).toEqual([{ address: A, value: 2, wallets: 2 }, { address: C, value: 1 }]);
    expect(boards.letters[0]).toEqual({ address: A, value: 15, wallets: 2 });
    expect(boards.raised).toEqual([{ address: C, value: 5 }, { address: A, value: 3, wallets: 2 }]);
    expect(boards.wins).toEqual([{ address: A, value: 2, amount: 150, wallets: 2 }]);
  });

  it("sums before the cut, so two wallets that each miss it can make it together", () => {
    expect(buildLeaderboards(snap, 1, links.accountOf).words).toEqual([{ address: A, value: 2, wallets: 2 }]);
  });

  it("with no links, every wallet is its own row (as before)", () => {
    expect(buildLeaderboards(snap).words.map((r) => r.address).sort()).toEqual([A, B, C].sort());
  });
});
