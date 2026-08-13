import { describe, it, expect } from "vitest";
import { sendCallsAttributed, CHAIN_ID_HEX, WrongChainError, type Eip1193Provider } from "@/lib/onchain/sendCalls";
import { BUILDER_DATA_SUFFIX } from "@/lib/onchain/builderCode";
import { NETWORK } from "@/lib/onchain/network";

const FROM = ("0x" + "1".repeat(40)) as `0x${string}`;
const TO = ("0x" + "2".repeat(40)) as `0x${string}`;
const DATA = ("0xa9059cbb" + "00".repeat(8)) as `0x${string}`;

/**
 * A wallet with a chain. `sendCallsAttributed` now refuses to send unless `eth_chainId` agrees with
 * the game's chain, so every mock has to model one — which is the point: the real bug was a wallet
 * parked on Ethereum mainnet whose `eth_sendTransaction` sailed a Sepolia commit off to chain 1.
 */
function mockProvider(opts: {
  chainId?: string;
  switchBehavior?: "switch" | "silent-noop" | "reject" | "unrecognized";
  supports5792?: boolean;
}) {
  let chain = opts.chainId ?? CHAIN_ID_HEX;
  const calls: { method: string; params?: unknown[] }[] = [];
  const provider: Eip1193Provider = {
    request: async (a) => {
      calls.push(a);
      switch (a.method) {
        case "eth_chainId":
          return chain;
        case "wallet_switchEthereumChain":
          if (opts.switchBehavior === "reject") throw { code: 4001, message: "User rejected" };
          if (opts.switchBehavior === "unrecognized" && !calls.some((c) => c.method === "wallet_addEthereumChain"))
            throw { code: 4902, message: "Unrecognized chain" };
          if (opts.switchBehavior !== "silent-noop")
            chain = (a.params as { chainId: string }[])[0].chainId;
          return null; // a silent-noop RESOLVES — that's what makes it treacherous
        case "wallet_addEthereumChain":
          return null;
        case "wallet_sendCalls":
          if (opts.supports5792 === false) throw { code: 4200, message: "Unsupported method" };
          return "0xbatchid";
        case "eth_sendTransaction":
          return "0xtxhash";
        default:
          throw new Error(`unexpected method ${a.method}`);
      }
    },
  };
  return { provider, calls, sends: () => calls.filter((c) => c.method === "wallet_sendCalls" || c.method === "eth_sendTransaction") };
}

// The chokepoint's whole job is to make attribution un-skippable. Assert it injects the builder
// dataSuffix on BOTH the ERC-5792 path and the eth_sendTransaction fallback.
describe("sendCallsAttributed — the write chokepoint", () => {
  it("uses wallet_sendCalls on Base with the builder dataSuffix capability", async () => {
    const { provider, calls } = mockProvider({});
    const res = await sendCallsAttributed(provider, FROM, [{ to: TO, data: DATA }]);
    expect(res).toEqual({ via: "sendCalls", id: "0xbatchid" });

    const send = calls.find((c) => c.method === "wallet_sendCalls")!;
    const p = (send.params as Record<string, unknown>[])[0];
    expect(p.from).toBe(FROM);
    expect(p.chainId).toBe(CHAIN_ID_HEX);
    expect(p.capabilities).toEqual({ dataSuffix: { value: BUILDER_DATA_SUFFIX, optional: true } });
    expect((p.calls as Record<string, unknown>[])[0]).toMatchObject({ to: TO, data: DATA });
  });

  it("falls back to eth_sendTransaction with the suffix appended when 5792 is unsupported", async () => {
    const { provider, calls } = mockProvider({ supports5792: false });
    const res = await sendCallsAttributed(provider, FROM, [{ to: TO, data: DATA }]);
    expect(res).toEqual({ via: "sendTransaction", hashes: ["0xtxhash"] });

    const tx = (calls.find((c) => c.method === "eth_sendTransaction")!.params as Record<string, unknown>[])[0];
    expect(tx.to).toBe(TO);
    expect((tx.data as string).startsWith(DATA)).toBe(true);
    expect((tx.data as string).endsWith(BUILDER_DATA_SUFFIX.slice(2))).toBe(true);
  });

  it("re-throws a non-unsupported provider error (e.g. user rejection)", async () => {
    const { provider } = mockProvider({});
    provider.request = (async (a: { method: string }) => {
      if (a.method === "eth_chainId") return CHAIN_ID_HEX;
      throw { code: 4001, message: "User rejected the request" };
    }) as Eip1193Provider["request"];
    await expect(sendCallsAttributed(provider, FROM, [{ to: TO }])).rejects.toMatchObject({ code: 4001 });
  });
});

/**
 * The chain guard. Modeled on a REAL transaction: reads come from our RPC so the UI looks right on
 * any chain, and the fallback tx carries no chain id — a wallet on Ethereum mainnet sent a Sepolia
 * daily commit to chain 1 (real gas, an address with no code there, nothing minted).
 */
describe("sendCallsAttributed — the chain guard", () => {
  it("does not touch switch methods when the wallet is already on the game's chain", async () => {
    const { provider, calls } = mockProvider({});
    await sendCallsAttributed(provider, FROM, [{ to: TO, data: DATA }]);
    expect(calls.some((c) => c.method === "wallet_switchEthereumChain")).toBe(false);
  });

  it("switches a wrong-chain wallet, verifies, then sends", async () => {
    const { provider, calls, sends } = mockProvider({ chainId: "0x1", switchBehavior: "switch" });
    const res = await sendCallsAttributed(provider, FROM, [{ to: TO, data: DATA }]);
    expect(res.via).toBe("sendCalls");
    // The send happened strictly AFTER the switch — order is the guarantee.
    const order = calls.map((c) => c.method);
    expect(order.indexOf("wallet_switchEthereumChain")).toBeLessThan(order.indexOf("wallet_sendCalls"));
    expect(sends()).toHaveLength(1);
  });

  it("REFUSES to send when the user rejects the switch — the mainnet-tx bug", async () => {
    const { provider, sends } = mockProvider({ chainId: "0x1", switchBehavior: "reject" });
    await expect(sendCallsAttributed(provider, FROM, [{ to: TO, data: DATA }])).rejects.toMatchObject({ code: 4001 });
    expect(sends()).toHaveLength(0); // nothing may leave on the wrong chain — this is the whole fix
  });

  it("REFUSES to send when the switch resolves but silently does nothing", async () => {
    // The treacherous wallet: wallet_switchEthereumChain resolves, chain unchanged. Only the
    // re-check catches it.
    const { provider, sends } = mockProvider({ chainId: "0x1", switchBehavior: "silent-noop" });
    await expect(sendCallsAttributed(provider, FROM, [{ to: TO, data: DATA }])).rejects.toBeInstanceOf(WrongChainError);
    expect(sends()).toHaveLength(0);
  });

  it("teaches the wallet an unrecognized chain (4902), using the PUBLIC rpc, then sends", async () => {
    const { provider, calls, sends } = mockProvider({ chainId: "0x1", switchBehavior: "unrecognized" });
    await sendCallsAttributed(provider, FROM, [{ to: TO, data: DATA }]);

    const add = calls.find((c) => c.method === "wallet_addEthereumChain")!;
    const cfg = (add.params as Record<string, unknown>[])[0];
    expect(cfg.chainId).toBe(CHAIN_ID_HEX);
    // Never the keyed Alchemy URL: the wallet stores this as the chain's RPC forever.
    expect(cfg.rpcUrls).toEqual([NETWORK.publicRpc]);
    expect(String((cfg.rpcUrls as string[])[0])).not.toMatch(/alchemy|apikey|v2\//i);
    expect(sends()).toHaveLength(1);
  });
});
