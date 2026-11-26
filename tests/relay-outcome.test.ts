/**
 * What a relayed ascension reveal did, read from the reveal's own logs
 * (src/lib/onchain/relayOutcome.ts). The server tells the game what the CHAIN did, never the
 * outcome it signed, so this reader is the one thing between a mined reveal and "Gilded 2!".
 *
 * The logs below are real: two reveals on Base Sepolia (Prestige 0x20D4…0940), copied from their
 * receipts on 2026-11-26. The route tests mock the relayer, so this is where its reading is held to
 * what the contract really emits.
 */
import { describe, it, expect } from "vitest";
import { prestigeRevealOutcome, type RelayLog } from "@/lib/onchain/relayOutcome";

const PRESTIGE = "0x20D4D992Ac077cA5d70a61f16575FA7f57190940";
const WORDS = "0xc1b4e6625e1b1588aeea70913526c4418f390f91";
const TOKEN = 12931324077590062671156152216586026929552115369715937512727007640336868681257n;
const TOKEN_TOPIC = "0x1c96debc0d219b95729d2f18b31465c0470ddc5eaf357fad6e0fe1c8ab01a629";

/** tx 0xbe11b018…79bd22, block 63,722,443: commit 79 hit, and the word reached stage 5. */
const HIT: RelayLog[] = [
  // Words' own events from bumpPrestige come first in the receipt: the reader must pass over them
  { address: WORDS, topics: ["0xb89114fa98ff450c83c778971647aab062d01a91a071126c0306f3383230f903", TOKEN_TOPIC], data: "0x0000000000000000000000000000000000000000000000000000000000000005" },
  { address: WORDS, topics: ["0xf8e1a15aba9398e019f0b49df1a4fde98ee17ae345cb5f6b5e2c27f5033e8ce7"], data: TOKEN_TOPIC },
  {
    address: "0x20d4d992ac077ca5d70a61f16575fa7f57190940",
    topics: ["0xe9dbd2346d4570ac7f984825dc399b022a59a77ceb8481985af6284cac58c704", "0x000000000000000000000000000000000000000000000000000000000000004f", TOKEN_TOPIC],
    data: "0x0000000000000000000000000000000000000000000000000000000000000005",
  },
];

/** tx 0x7b7f556a…73fc051, block 63,722,225: commit 77 missed; the word stayed at stage 3 with pity 1. */
const MISS: RelayLog[] = [
  {
    address: "0x20d4d992ac077ca5d70a61f16575fa7f57190940",
    topics: ["0x2a29521a6750f5310e18e0f5aed68bb2e0cef8a16ce291e32b8938f7ec8ec40b", "0x000000000000000000000000000000000000000000000000000000000000004d", TOKEN_TOPIC],
    data: "0x0000000000000000000000000000000000000000000000000000000000000001",
  },
];

describe("prestigeRevealOutcome, on real Base Sepolia reveals", () => {
  it("a hit: PrestigeSucceeded names the commit, the word, and the stage it reached", () => {
    expect(prestigeRevealOutcome(HIT, PRESTIGE)).toEqual({ success: true, commitId: 79n, tokenId: TOKEN, level: 5 });
  });

  it("a miss: PrestigeFailed names the commit, the word, and its pity (and no level: the relayer reads that)", () => {
    expect(prestigeRevealOutcome(MISS, PRESTIGE)).toEqual({ success: false, commitId: 77n, tokenId: TOKEN, pity: 1 });
  });

  it("matches the contract's address whatever its letter case (receipts lowercase it, the registry doesn't)", () => {
    expect(prestigeRevealOutcome(MISS, PRESTIGE.toLowerCase())).toMatchObject({ success: false, pity: 1 });
    expect(prestigeRevealOutcome(MISS, PRESTIGE.toUpperCase().replace("0X", "0x"))).toMatchObject({ success: false, pity: 1 });
  });

  it("reads nothing from another contract's logs, or from none: no outcome is ever made up", () => {
    expect(prestigeRevealOutcome(HIT.slice(0, 2), PRESTIGE)).toBeNull();
    expect(prestigeRevealOutcome([], PRESTIGE)).toBeNull();
    // the same events from an address that isn't Prestige are not Prestige's word
    expect(prestigeRevealOutcome(MISS, WORDS)).toBeNull();
  });
});
