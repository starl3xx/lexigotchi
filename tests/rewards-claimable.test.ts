/**
 * The claim screen's open-epoch rule (src/lib/keeper/claimables.ts). The keeper stores a tree BEFORE
 * it opens the epoch, so the database can hold leaves the chain will refuse. Serving one of those
 * would hand the player a claim() that reverts.
 */
import { describe, it, expect } from "vitest";
import { buildEpochFile, verifyEntry } from "@/lib/keeper/tree";
import { epochKey, epochsOf, liveLeaves, type EpochState } from "@/lib/keeper/claimables";
import type { RewardLeafRow } from "@/lib/db/schema";

const ALICE = "0x51e29ba3ff9ebdb5e6d32f6ab52f2fd3b21ae1e3" as const;
const BOB = "0xc60062cbc714dbbc570d6a3e33bb7f59c0125490" as const;

/** Rows exactly as storeEpochLeaves writes them, from a real tree. */
function rowsFor(stream: "yield" | "bounty", epochId: string) {
  const file = buildEpochFile([
    { tokenId: 11n, account: ALICE, amount: 500n },
    { tokenId: 22n, account: BOB, amount: 300n },
  ]);
  const rows: RewardLeafRow[] = file.entries.map((e, i) => ({
    id: i + 1,
    chainId: 84532,
    stream,
    epochId,
    root: file.root.toLowerCase(),
    tokenId: e.tokenId,
    account: e.account.toLowerCase(),
    amount: e.amount,
    proof: e.proof,
    createdAt: new Date(0),
  }));
  return { file, rows };
}

describe("liveLeaves", () => {
  it("serves leaves of an epoch that is open with the same root", () => {
    const { file, rows } = rowsFor("yield", "20410");
    const epochs = new Map<string, EpochState>([[epochKey("yield", "20410"), { open: true, root: file.root }]]);
    const live = liveLeaves(rows, epochs);
    expect(live).toHaveLength(2);
    // What we serve still verifies: the stored row round-trips into a valid proof.
    for (const c of live) expect(verifyEntry(file.root, c)).toBe(true);
  });

  it("drops leaves of an epoch that never opened (the open tx failed after the store)", () => {
    const { file, rows } = rowsFor("yield", "20410");
    expect(liveLeaves(rows, new Map([[epochKey("yield", "20410"), { open: false, root: file.root }]]))).toEqual([]);
    expect(liveLeaves(rows, new Map())).toEqual([]);
  });

  it("drops leaves built for a different tree than the one the chain opened", () => {
    const { rows } = rowsFor("yield", "20410");
    const other = buildEpochFile([{ tokenId: 11n, account: ALICE, amount: 999n }]);
    expect(liveLeaves(rows, new Map([[epochKey("yield", "20410"), { open: true, root: other.root }]]))).toEqual([]);
  });

  it("compares roots without caring about hex case", () => {
    const { file, rows } = rowsFor("bounty", "2915");
    const upper = `0x${file.root.slice(2).toUpperCase()}`;
    expect(liveLeaves(rows, new Map([[epochKey("bounty", "2915"), { open: true, root: upper }]]))).toHaveLength(2);
  });

  it("keeps yield and bounty epochs with the same id apart", () => {
    const { file, rows } = rowsFor("bounty", "7");
    expect(liveLeaves(rows, new Map([[epochKey("yield", "7"), { open: true, root: file.root }]]))).toEqual([]);
  });
});

describe("epochsOf", () => {
  it("reads each epoch once, however many leaves it has", () => {
    const a = rowsFor("yield", "1").rows;
    const b = rowsFor("bounty", "1").rows;
    expect(epochsOf([...a, ...b, ...a])).toEqual([
      { stream: "yield", epochId: "1" },
      { stream: "bounty", epochId: "1" },
    ]);
  });
});
