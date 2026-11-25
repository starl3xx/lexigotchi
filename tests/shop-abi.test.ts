import { describe, expect, it } from "vitest";
import { shopAbi } from "@/lib/onchain/abis";

/**
 * The Shop's whole state-changing surface, pinned (decisions.md #22: "No owner function can withdraw
 * USDC or $WORD from the Shop"). The forge tests prove what these functions do; this test fails the
 * moment a function is added, so a withdraw, rescue, or skim can't slip in unreviewed. Adding one on
 * purpose means changing this list in the same PR, where a reviewer sees it.
 *
 * shopAbi is generated from the Foundry artifact (`npm run derive:abis`), so it can't drift from
 * contracts/src/Shop.sol.
 */
const ALLOWED = [
  // Buying, and the waiting swap.
  "buy",
  "buyWithPermit",
  "sweep",
  "swapAndRoute", // reverts unless the Shop calls itself (the try/catch frame)
  // The registry.
  "addItem",
  "updateItem",
  "setActive",
  // Money settings: where the 80% goes, the floor's allowance, a sweep's size; none moves a held token.
  "setRevenueWallet",
  "setSplit",
  "setMaxSlippageBps",
  "setMaxSweepUsdc",
  // The route (the adapter and the floor's peg), behind ROUTE_DELAY.
  "proposeRoute",
  "acceptRoute",
  "cancelRoute",
  // Pause and Ownable2Step.
  "pause",
  "unpause",
  "transferOwnership",
  "acceptOwnership",
  "renounceOwnership",
].sort();

// Read as plain entries: the generated `as const` types already rule out what these tests check for,
// and the point is to check the artifact, not the types.
type Entry = { type: string; name?: string; stateMutability?: string };
const entries = shopAbi as readonly Entry[];

const writes = entries
  .filter((e) => e.type === "function" && e.stateMutability !== "view" && e.stateMutability !== "pure")
  .map((e) => e.name!)
  .sort();

describe("Shop ABI", () => {
  it("has exactly the reviewed state-changing functions", () => {
    expect(writes).toEqual(ALLOWED);
  });

  it("has no function that sounds like taking tokens out", () => {
    const names = entries.filter((e) => e.type === "function").map((e) => e.name!);
    for (const n of names) {
      expect(n).not.toMatch(/withdraw|rescue|recover|skim|drain|claim|collect|send|transfer(?!Ownership)/i);
    }
  });

  it("takes no ETH", () => {
    expect(entries.some((e) => e.stateMutability === "payable")).toBe(false);
    expect(entries.some((e) => e.type === "receive" || e.type === "fallback")).toBe(false);
  });
});
