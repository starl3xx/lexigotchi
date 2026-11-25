/**
 * The Shop's app side (decisions.md #22): when it shows, which items show, what can be bought, how a
 * purchase pays, the keeper's sweep minimum, the console's totals, and the test USDC voucher digest.
 * Items here are throwaway fixtures, never a real catalog.
 */
import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeAbiParameters, getAddress, keccak256, recoverTypedDataAddress, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { availability, cardFor, fmtUsdc, shopCards, shopOn, TEST_USDC_FAUCET, usdcLabel, type RegistryItem } from "@/lib/shop/rules";
import { approveCall, buyCall, buyRoute, buyWithPermitCall, isUnsupported, permitTypedDataJson } from "@/lib/shop/buy";
import { holderProfiles, sweepMinWordOut, MIN_SWEEP_USDC } from "@/lib/keeper/shop";
import { shopTotals } from "@/lib/admin/shopStats";
import { USDC_FAUCET_KIND, usdcFaucetDigest } from "@/lib/onchain/digests";
import { erc20Abi, shopAbi } from "@/lib/onchain/abis";
import { NETWORK } from "@/lib/onchain/network";
import type { KeeperWord } from "@/lib/keeper/shares";

const SHOP = "0x00000000000000000000000000000000000005a0" as const;
const USDC = "0x0000000000000000000000000000000000000c0c" as const;
const ME = "0x000000000000000000000000000000000000abcd" as const;

const item = (over: Partial<RegistryItem> = {}): RegistryItem => ({
  id: 1,
  priceUsdc: 1_000_000n,
  start: 0,
  end: 0,
  maxSupply: 0,
  sold: 0,
  active: true,
  ...over,
});

describe("SHOP_ENABLED", () => {
  const on = { flag: "true", isTestnet: true, shop: SHOP, usdc: USDC };
  it("shows only with the switch on, on a test network, with the Shop and USDC deployed", () => {
    expect(shopOn(on)).toBe(true);
    expect(shopOn({ ...on, flag: undefined })).toBe(false); // off by default
    expect(shopOn({ ...on, flag: "1" })).toBe(false);
    expect(shopOn({ ...on, shop: null })).toBe(false);
    expect(shopOn({ ...on, usdc: null })).toBe(false);
  });
  it("stays off on mainnet whatever the switch says", () => {
    expect(shopOn({ ...on, isTestnet: false })).toBe(false);
  });
});

describe("which items show", () => {
  const meta = { name: "A fixture scene", kind: "scene" as const, art: null };
  it("an item with metadata shows as itself", () => {
    expect(cardFor(item(), meta, false)).toEqual({ kind: "item", item: item(), meta });
  });
  it("an item with NO metadata is hidden on mainnet, and a plain Test item on a test network", () => {
    expect(cardFor(item(), null, false)).toBeNull();
    expect(cardFor(item(), null, true)).toEqual({ kind: "placeholder", item: item(), name: "Test item" });
  });
  it("an inactive item never shows", () => {
    expect(cardFor(item({ active: false }), meta, true)).toBeNull();
  });
  it("an empty registry shows nothing", () => {
    expect(shopCards([], () => null, true)).toEqual([]);
  });
});

describe("what can be bought (mirrors Shop._buy)", () => {
  it("follows the window: the start second is on sale, the end second is not", () => {
    const it2 = item({ start: 100, end: 200 });
    expect(availability(it2, 99)).toBe("not_yet");
    expect(availability(it2, 100)).toBe("on_sale");
    expect(availability(it2, 199)).toBe("on_sale");
    expect(availability(it2, 200)).toBe("ended");
  });
  it("sells out at the supply; 0 is unlimited", () => {
    expect(availability(item({ maxSupply: 2, sold: 2 }), 0)).toBe("sold_out");
    expect(availability(item({ maxSupply: 0, sold: 10_000 }), 0)).toBe("on_sale");
    expect(availability(item({ active: false }), 0)).toBe("inactive");
  });
});

describe("USDC on screen", () => {
  it("formats units as cents, never through a float", () => {
    expect(fmtUsdc(1_000_000n)).toBe("1.00");
    expect(fmtUsdc(25_000_000n)).toBe("25.00");
    expect(fmtUsdc(10_000n)).toBe("0.01");
    expect(fmtUsdc(123_456_789n)).toBe("123.46");
  });
  it("test USDC never reads as dollars", () => {
    expect(usdcLabel(TEST_USDC_FAUCET, true)).toBe("25.00 test USDC");
    expect(usdcLabel(TEST_USDC_FAUCET, true)).not.toContain("$");
    expect(usdcLabel(2_500_000n, false)).toBe("$2.50");
  });
});

describe("how a purchase pays", () => {
  it("a covering allowance buys outright; else a batch where the wallet can, else a permit", () => {
    expect(buyRoute({ allowance: 1_000_000n, price: 1_000_000n, batch: false })).toBe("allowance");
    expect(buyRoute({ allowance: 0n, price: 1_000_000n, batch: true })).toBe("batch");
    expect(buyRoute({ allowance: 999_999n, price: 1_000_000n, batch: false })).toBe("permit");
  });

  it("approves exactly the price, and buys with no minimum of its own (the Shop's floor rules)", () => {
    const a = decodeFunctionData({ abi: erc20Abi, data: approveCall(USDC, SHOP, 1_234_567n).data! });
    expect(a.args).toEqual([getAddress(SHOP), 1_234_567n]);
    const b = decodeFunctionData({ abi: shopAbi, data: buyCall(SHOP, 7, ME).data! });
    expect(b.functionName).toBe("buy");
    expect(b.args).toEqual([7n, getAddress(ME), 0n]);
  });

  it("the permit carries EIP712Domain and Circle's name/version, and recovers to the signer (#187's lesson)", async () => {
    const acct = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const json = permitTypedDataJson({
      usdc: USDC, name: "USD Coin", version: "2", chainId: NETWORK.id,
      owner: acct.address, spender: SHOP, value: 2_000_000n, nonce: 0n, deadline: 999n,
    });
    const typed = JSON.parse(json);
    expect(typed.types.EIP712Domain.map((f: { name: string }) => f.name)).toEqual(["name", "version", "chainId", "verifyingContract"]);
    expect(typed.domain).toEqual({ name: "USD Coin", version: "2", chainId: NETWORK.id, verifyingContract: USDC });
    const { EIP712Domain: _drop, ...types } = typed.types;
    void _drop;
    const message = { ...typed.message, value: BigInt(typed.message.value), nonce: BigInt(typed.message.nonce), deadline: BigInt(typed.message.deadline) };
    const sig = await acct.signTypedData({ domain: typed.domain, types, primaryType: "Permit", message });
    expect(await recoverTypedDataAddress({ domain: typed.domain, types, primaryType: "Permit", message, signature: sig })).toBe(acct.address);

    // …and buyWithPermit carries that signature split into v, r, s.
    const call = decodeFunctionData({ abi: shopAbi, data: buyWithPermitCall(SHOP, 3, acct.address, 999n, sig).data! });
    expect(call.functionName).toBe("buyWithPermit");
    const [id, to, min, deadline, v, r, s] = call.args as readonly [bigint, string, bigint, bigint, number, Hex, Hex];
    expect([id, to, min, deadline]).toEqual([3n, acct.address, 0n, 999n]);
    expect([27, 28]).toContain(v);
    expect((r + s.slice(2) + v.toString(16)).toLowerCase()).toBe(sig.toLowerCase());
  });

  it("tells a wallet that can't from a player who said no", () => {
    expect(isUnsupported({ code: 4001, message: "User rejected eth_signTypedData_v4" })).toBe(false);
    expect(isUnsupported({ code: -32601 })).toBe(true);
    expect(isUnsupported({ message: "Method not supported" })).toBe(true);
  });
});

describe("the keeper's sweep", () => {
  it("passes a live-price minimum on mainnet, 5% under it", () => {
    // $1 = 4,000,000 $WORD: 2 USDC is 8M $WORD at the live price, 7.6M after 5%.
    expect(sweepMinWordOut({ usdcIn: 2_000_000n, wordPerUsd: 4_000_000, live: true, isTestnet: false })).toBe(7_600_000n * 10n ** 18n);
  });
  it("leaves it to the Shop's floor on a test network or on the fallback price", () => {
    expect(sweepMinWordOut({ usdcIn: 2_000_000n, wordPerUsd: 4_000_000, live: true, isTestnet: true })).toBe(0n);
    expect(sweepMinWordOut({ usdcIn: 2_000_000n, wordPerUsd: 4_000_000, live: false, isTestnet: false })).toBe(0n);
    expect(sweepMinWordOut({ usdcIn: 2_000_000n, wordPerUsd: Number.NaN, live: true, isTestnet: false })).toBe(0n);
  });
  it("skips dust", () => {
    expect(MIN_SWEEP_USDC).toBe(10_000n);
  });
  it("maps each held word to its holder's profile (a staked word is its staker's)", () => {
    const words = [
      { word: "crane", owner: "0x00000000000000000000000000000000000000AA" },
      { word: "VIVID", owner: "0x00000000000000000000000000000000000000bb" },
    ] as unknown as KeeperWord[];
    const accountOf = (w: string) => (w === "0x00000000000000000000000000000000000000bb" ? "0xprofile" : w);
    expect([...holderProfiles(words, accountOf)]).toEqual([
      ["CRANE", "0x00000000000000000000000000000000000000aa"],
      ["VIVID", "0xprofile"],
    ]);
  });
});

describe("the console's totals", () => {
  it("adds up revenue, $WORD to the pool (purchases and sweeps), and per-item sales", () => {
    const t = shopTotals(
      [
        { itemId: 1, priceUsdc: 1_000_000n, toStudio: 800_000n, wordToPool: 5n, deferredUsdc: 0n },
        { itemId: 1, priceUsdc: 1_000_000n, toStudio: 800_000n, wordToPool: 0n, deferredUsdc: 200_000n },
        { itemId: 2, priceUsdc: 3_000_000n, toStudio: 2_400_000n, wordToPool: 9n, deferredUsdc: 0n },
      ],
      [{ usdcIn: 200_000n, wordOut: 4n, strayWord: 1n }],
    );
    expect(t.sales).toBe(3);
    expect(t.grossUsdc).toBe(5_000_000n);
    expect(t.revenueUsdc).toBe(4_000_000n);
    expect(t.wordToPool).toBe(5n + 9n + 4n + 1n);
    expect(t.deferredEverUsdc).toBe(200_000n);
    expect(t.sweptUsdc).toBe(200_000n);
    expect(t.perItem.get(1)).toEqual({ sales: 2, grossUsdc: 2_000_000n, revenueUsdc: 1_600_000n });
  });
});

describe("the test USDC voucher", () => {
  it("names the same kind as MockUSDC.FAUCET_KIND", () => {
    expect(USDC_FAUCET_KIND).toBe(keccak256(toBytes("lexigotchi.mockUsdc.faucet")));
  });
  it("hashes the fields in MockUSDC.faucet's order: (usdc, chain, kind, caller, profile, day, deadline)", () => {
    const a = { usdc: USDC, caller: ME, profile: SHOP, today: 20_000, deadline: 1_234n };
    const expected = keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint32" }, { type: "uint256" }],
        [USDC, BigInt(NETWORK.id), USDC_FAUCET_KIND, ME, SHOP, 20_000, 1_234n],
      ),
    );
    expect(usdcFaucetDigest(a)).toBe(expected);
    // The caller is in it: a voucher copied from the mempool is useless to anyone else.
    expect(usdcFaucetDigest({ ...a, caller: SHOP })).not.toBe(expected);
  });
});

describe("getLogs on a narrow RPC", async () => {
  const { getLogsAdaptive } = await import("@/lib/onchain/logs");
  it("halves its span until the RPC accepts it, and reads every block once", async () => {
    const seen: [bigint, bigint][] = [];
    const client = {
      getBlockNumber: async () => 5_000n,
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        if (toBlock - fromBlock + 1n > 200n) throw Object.assign(new Error("RPC Request failed."), { details: "eth_getLogs is limited to a 200 range" });
        seen.push([fromBlock, toBlock]);
        return [{ blockNumber: fromBlock }];
      },
    };
    const logs = await getLogsAdaptive(client as never, { address: SHOP, event: { type: "event", name: "X", inputs: [] } as never, fromBlock: 1_000n });
    expect(seen[0][0]).toBe(1_000n);
    expect(seen.at(-1)![1]).toBe(5_000n);
    for (let i = 1; i < seen.length; i++) expect(seen[i][0]).toBe(seen[i - 1][1] + 1n); // no gap, no overlap
    expect(logs).toHaveLength(seen.length);
  });
  it("passes any other error through", async () => {
    const client = { getBlockNumber: async () => 10n, getLogs: async () => { throw new Error("boom"); } };
    await expect(getLogsAdaptive(client as never, { address: SHOP, event: {} as never, fromBlock: 0n })).rejects.toThrow("boom");
  });
});
