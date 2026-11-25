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
  // Money settings: where the 80% goes and how the floor reads; none moves a held token.
  "setRevenueWallet",
  "setSplit",
  "setMaxSlippageBps",
  "setPeg",
  // The route, behind ADAPTER_DELAY.
  "proposeAdapter",
  "acceptAdapter",
  "cancelAdapter",
  // Pause and Ownable2Step.
  "pause",
  "unpause",
  "transferOwnership",
  "acceptOwnership",
  "renounceOwnership",
].sort();

const writes = shopAbi
  .filter((e) => e.type === "function" && e.stateMutability !== "view" && e.stateMutability !== "pure")
  .map((e) => (e as { name: string }).name)
  .sort();

describe("Shop ABI", () => {
  it("has exactly the reviewed state-changing functions", () => {
    expect(writes).toEqual(ALLOWED);
  });

  it("has no function that sounds like taking tokens out", () => {
    const names = shopAbi.filter((e) => e.type === "function").map((e) => (e as { name: string }).name);
    for (const n of names) {
      expect(n).not.toMatch(/withdraw|rescue|recover|skim|drain|claim|collect|send|transfer(?!Ownership)/i);
    }
  });

  it("takes no ETH", () => {
    expect(shopAbi.some((e) => "stateMutability" in e && e.stateMutability === "payable")).toBe(false);
    expect(shopAbi.some((e) => e.type === "receive" || e.type === "fallback")).toBe(false);
  });
});
