/**
 * The relayer itself (src/lib/onchain/relayer.ts), with only the chain faked: the route tests mock
 * this module whole, so what it does with a key, a send, and a receipt is held here. The receipts'
 * logs are real Base Sepolia reveals (the same two as tests/relay-outcome.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generatePrivateKey } from "viem/accounts";

vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532");

const PRESTIGE = "0x20d4d992ac077ca5d70a61f16575fa7f57190940";
const TOKEN = 12931324077590062671156152216586026929552115369715937512727007640336868681257n;
const TOKEN_TOPIC = "0x1c96debc0d219b95729d2f18b31465c0470ddc5eaf357fad6e0fe1c8ab01a629";
const HIT_LOGS = [
  { address: "0xc1b4e6625e1b1588aeea70913526c4418f390f91", topics: ["0xb89114fa98ff450c83c778971647aab062d01a91a071126c0306f3383230f903", TOKEN_TOPIC], data: "0x0000000000000000000000000000000000000000000000000000000000000005" },
  { address: PRESTIGE, topics: ["0xe9dbd2346d4570ac7f984825dc399b022a59a77ceb8481985af6284cac58c704", "0x000000000000000000000000000000000000000000000000000000000000004f", TOKEN_TOPIC], data: "0x0000000000000000000000000000000000000000000000000000000000000005" },
];
const MISS_LOGS = [
  { address: PRESTIGE, topics: ["0x2a29521a6750f5310e18e0f5aed68bb2e0cef8a16ce291e32b8938f7ec8ec40b", "0x000000000000000000000000000000000000000000000000000000000000004d", TOKEN_TOPIC], data: "0x0000000000000000000000000000000000000000000000000000000000000001" },
];
const BLOCK = 63_722_225n;
const SIG = `0x${"11".repeat(65)}` as const;

type Req = { address: string; functionName: string; args: readonly unknown[]; dataSuffix?: string; blockNumber?: bigint };
const writes: Req[] = [];
const reads: Req[] = [];
let n = 0;
let writeError: Error | null = null;
let receipt: (hash: string) => unknown = () => ({ status: "success", blockNumber: BLOCK, logs: [] });
let levelRead: () => unknown = () => 3;
const client = {
  writeContract: async (req: Req) => {
    if (writeError) throw writeError;
    writes.push(req);
    return `0x${String(++n).padStart(64, "0")}`;
  },
  waitForTransactionReceipt: async ({ hash }: { hash: string }) => receipt(hash),
  readContract: async (req: Req) => {
    reads.push(req);
    return levelRead();
  },
};
vi.mock("viem", async (orig) => ({
  ...(await orig<typeof import("viem")>()),
  createWalletClient: () => ({ extend: () => client }),
}));

const { relayPrestigeReveal, relayRollReveal, relayerConfigured } = await import("@/lib/onchain/relayer");
const { BUILDER_DATA_SUFFIX } = await import("@/lib/onchain/builderCode");
const { addressOf } = await import("@/lib/onchain/addresses");

/** Each test uses its own commit id: the relayer remembers a commit's send for a minute. */
let commit = 1000n;
const next = () => ++commit;

beforeEach(() => {
  vi.stubEnv("RELAYER_PRIVATE_KEY", generatePrivateKey());
  writes.length = 0;
  reads.length = 0;
  writeError = null;
  receipt = () => ({ status: "success", blockNumber: BLOCK, logs: [] });
  levelRead = () => 3;
});

describe("a relayed ascension reveal", () => {
  it("sends Prestige.reveal with the builder code, and reads a hit from its event: the new stage, a clean pity", async () => {
    receipt = () => ({ status: "success", blockNumber: BLOCK, logs: HIT_LOGS });
    const id = next();
    const r = await relayPrestigeReveal(id, true, SIG);
    expect(r).toMatchObject({ kind: "mined", success: true, level: 5, pity: 0 });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ functionName: "reveal", args: [id, true, SIG], dataSuffix: BUILDER_DATA_SUFFIX });
    expect(writes[0].address.toLowerCase()).toBe(addressOf("prestige").toLowerCase());
    // a hit's event names the level: nothing more is read
    expect(reads).toHaveLength(0);
  });

  it("a miss: the pity from its event, and the level read AT the reveal's block (the event doesn't carry it)", async () => {
    receipt = () => ({ status: "success", blockNumber: BLOCK, logs: MISS_LOGS });
    const r = await relayPrestigeReveal(next(), false, SIG);
    expect(r).toMatchObject({ kind: "mined", success: false, level: 3, pity: 1 });
    expect(reads).toHaveLength(1);
    // pinned to the block: this very word stood at stage 3 then and stands at 5 now
    expect(reads[0]).toMatchObject({ functionName: "prestigeLevel", args: [TOKEN], blockNumber: BLOCK });
    expect(reads[0].address.toLowerCase()).toBe(addressOf("words").toLowerCase());
  });

  it("the chain's word, not the signed one: a signed success that mined as “failed” is no hit", async () => {
    receipt = () => ({ status: "success", blockNumber: BLOCK, logs: MISS_LOGS });
    const r = await relayPrestigeReveal(next(), true, SIG);
    expect(r).toMatchObject({ kind: "mined", success: false, pity: 1 });
  });

  it("a level that can't be read is null, never guessed", async () => {
    receipt = () => ({ status: "success", blockNumber: BLOCK, logs: MISS_LOGS });
    levelRead = () => {
      throw new Error("missing trie node");
    };
    expect(await relayPrestigeReveal(next(), false, SIG)).toMatchObject({ kind: "mined", success: false, level: null, pity: 1 });
  });

  it("mined with no outcome event says only what is known: broadcast, not seen to do anything", async () => {
    expect(await relayPrestigeReveal(next(), true, SIG)).toMatchObject({ kind: "pending" });
  });

  it("a reverted reveal (another one won the race) and one not mined in the wait are both “broadcast”", async () => {
    receipt = () => ({ status: "reverted", blockNumber: BLOCK, logs: [] });
    expect((await relayPrestigeReveal(next(), true, SIG)).kind).toBe("reverted");
    receipt = () => {
      throw new Error("timed out");
    };
    expect((await relayPrestigeReveal(next(), true, SIG)).kind).toBe("pending");
  });

  it("a refused send is “unavailable”, with a reason that never quotes the error (it can carry the RPC key)", async () => {
    writeError = new Error("insufficient funds for gas * price + value: https://rpc.example/v2/SECRET");
    expect(await relayPrestigeReveal(next(), true, SIG)).toEqual({ kind: "unavailable", reason: "relayer_unfunded" });
    writeError = new Error("execution reverted: https://rpc.example/v2/SECRET");
    expect(await relayPrestigeReveal(next(), true, SIG)).toEqual({ kind: "unavailable", reason: "send_failed" });
  });

  it("with no relayer key nothing is sent", async () => {
    vi.stubEnv("RELAYER_PRIVATE_KEY", "");
    expect(relayerConfigured()).toBe(false);
    expect(await relayPrestigeReveal(next(), true, SIG)).toEqual({ kind: "unavailable", reason: "no_relayer" });
    expect(writes).toHaveLength(0);
  });
});

/**
 * Two real roll reveals on Base Sepolia (Rolls 0x5BA5…8440), both sent by the relayer
 * (0x51E2…1E3), copied from their receipts on 2026-11-26.
 */
const ROLLS = "0x5ba540b19f3572a852f640beb30c1b0e93728440";
/** tx 0xc2f6f30d…d5ca60: commit 135 missed, and its letter's pity became 2. */
const ROLL_MISS_LOGS = [
  {
    address: ROLLS,
    topics: ["0x0ef831ff1075bd3977c013d508a4a8b0083212c6715dfea107b919f8c9e832fd", "0x0000000000000000000000000000000000000000000000000000000000000087", "0x0000000000000000000000000fc0f78fc939606db65f5bbf2f3715262c0b2f6e"],
    data: "0x000000000000000000000000000000000000000000000000000000000000000b0000000000000000000000000000000000000000000000000000000000000002",
  },
];
/** tx 0x6031dd8f…cfaa88: commit 137 hit. Four other contracts' logs come before Rolls' own. */
const ROLL_HIT_LOGS = [
  { address: "0xb6e3b233ff7ceb709f20a36fa947a53e47e600cc", topics: ["0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62", "0x000000000000000000000000c1b4e6625e1b1588aeea70913526c4418f390f91", "0x000000000000000000000000c1b4e6625e1b1588aeea70913526c4418f390f91", "0x0000000000000000000000000000000000000000000000000000000000000000"], data: "0x00000000000000000000000000000000000000000000000000000000000000170000000000000000000000000000000000000000000000000000000000000001" },
  { address: "0xb6e3b233ff7ceb709f20a36fa947a53e47e600cc", topics: ["0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62", "0x000000000000000000000000c1b4e6625e1b1588aeea70913526c4418f390f91", "0x0000000000000000000000000000000000000000000000000000000000000000", "0x000000000000000000000000c1b4e6625e1b1588aeea70913526c4418f390f91"], data: "0x00000000000000000000000000000000000000000000000000000000000000310000000000000000000000000000000000000000000000000000000000000001" },
  { address: "0xc1b4e6625e1b1588aeea70913526c4418f390f91", topics: ["0xe1bb1745426d461ddc0424f57bab3bcb4a468247fc2013b8f1d1c2fc944929ce", "0xe57df55a9a044dadb27a82cab24f4ebc0cb94e0cf6d1aabe46a5b1f14d5ce7f4"], data: "0x00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000017" },
  { address: "0xc1b4e6625e1b1588aeea70913526c4418f390f91", topics: ["0xf8e1a15aba9398e019f0b49df1a4fde98ee17ae345cb5f6b5e2c27f5033e8ce7"], data: "0xe57df55a9a044dadb27a82cab24f4ebc0cb94e0cf6d1aabe46a5b1f14d5ce7f4" },
  { address: ROLLS, topics: ["0x9c7a20ef9da5947c3f7f1e0d51163b5d987af21f254496bb3d1385e6db51d38a", "0x0000000000000000000000000000000000000000000000000000000000000089", "0x000000000000000000000000b8980ff66aaad42c1e46ea9dd2dc1c75a7a54039"], data: "0x0000000000000000000000000000000000000000000000000000000000000017" },
];

describe("a relayed roll reveal (live for every roll: it must read as it did before ascension joined it)", () => {
  it("sends Rolls.reveal with the builder code", async () => {
    receipt = () => ({ status: "success", blockNumber: BLOCK, logs: ROLL_MISS_LOGS });
    const id = next();
    await relayRollReveal(id, false, SIG);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ functionName: "reveal", args: [id, false, SIG], dataSuffix: BUILDER_DATA_SUFFIX });
    expect(writes[0].address.toLowerCase()).toBe(addressOf("rolls").toLowerCase());
  });

  it("a miss: mined, with the pity its RollFailed event carries", async () => {
    receipt = () => ({ status: "success", blockNumber: BLOCK, logs: ROLL_MISS_LOGS });
    expect(await relayRollReveal(next(), false, SIG)).toMatchObject({ kind: "mined", success: false, pity: 2 });
  });

  it("a hit: mined, read from RollSucceeded past the other contracts' logs, with a clean pity", async () => {
    receipt = () => ({ status: "success", blockNumber: BLOCK, logs: ROLL_HIT_LOGS });
    expect(await relayRollReveal(next(), true, SIG)).toMatchObject({ kind: "mined", success: true, pity: 0 });
  });

  it("the chain's word, not the signed one, and nothing of the word ladder is read for a roll", async () => {
    receipt = () => ({ status: "success", blockNumber: BLOCK, logs: ROLL_MISS_LOGS });
    expect(await relayRollReveal(next(), true, SIG)).toMatchObject({ kind: "mined", success: false, pity: 2 });
    expect(reads).toHaveLength(0);
  });

  it("reverted, not mined in the wait, and a refused send are what they were", async () => {
    receipt = () => ({ status: "reverted", blockNumber: BLOCK, logs: [] });
    expect((await relayRollReveal(next(), true, SIG)).kind).toBe("reverted");
    receipt = () => {
      throw new Error("timed out");
    };
    expect((await relayRollReveal(next(), true, SIG)).kind).toBe("pending");
    writeError = new Error("insufficient funds for gas");
    expect(await relayRollReveal(next(), true, SIG)).toEqual({ kind: "unavailable", reason: "relayer_unfunded" });
  });
});

describe("rolls and ascensions count their commits separately", () => {
  it("roll 7 and ascension 7 are two sends with two answers; a repeat of either reuses its own", async () => {
    // Under one key for both, the ascension would be answered with the roll's result for a minute.
    receipt = (hash) => ({ status: "success", blockNumber: BLOCK, logs: hash.endsWith("1") ? [] : MISS_LOGS });
    n = 0;
    const id = next();
    const roll = await relayRollReveal(id, true, SIG); // tx …1: no roll event → "pending"
    const ascension = await relayPrestigeReveal(id, false, SIG); // tx …2: the real miss
    expect(roll.kind).toBe("pending");
    expect(ascension).toMatchObject({ kind: "mined", success: false, pity: 1 });
    expect(writes).toHaveLength(2);
    expect(writes[0].address.toLowerCase()).toBe(addressOf("rolls").toLowerCase());
    expect(writes[1].address.toLowerCase()).toBe(addressOf("prestige").toLowerCase());
    // a repeat request for the same commit is answered by the first send, not a second one
    expect(await relayPrestigeReveal(id, false, SIG)).toBe(ascension);
    expect(await relayRollReveal(id, true, SIG)).toBe(roll);
    expect(writes).toHaveLength(2);
  });

  it("every relayed write carries the builder code", async () => {
    await relayRollReveal(next(), true, SIG);
    await relayPrestigeReveal(next(), true, SIG);
    expect(writes).toHaveLength(2);
    for (const w of writes) expect(w.dataSuffix).toBe(BUILDER_DATA_SUFFIX);
  });
});
