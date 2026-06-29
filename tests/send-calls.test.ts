import { describe, it, expect } from "vitest";
import { sendCallsAttributed, BASE_CHAIN_ID_HEX, type Eip1193Provider } from "@/lib/onchain/sendCalls";
import { BUILDER_DATA_SUFFIX } from "@/lib/onchain/builderCode";

const FROM = ("0x" + "1".repeat(40)) as `0x${string}`;
const TO = ("0x" + "2".repeat(40)) as `0x${string}`;
const DATA = ("0xa9059cbb" + "00".repeat(8)) as `0x${string}`;

// The chokepoint's whole job is to make attribution un-skippable. Assert it injects the builder
// dataSuffix on BOTH the ERC-5792 path and the eth_sendTransaction fallback.
describe("sendCallsAttributed — the write chokepoint", () => {
  it("uses wallet_sendCalls on Base with the builder dataSuffix capability", async () => {
    const seen: { method: string; params?: unknown[] }[] = [];
    const provider: Eip1193Provider = {
      request: async (a) => {
        seen.push(a);
        return "0xbatchid";
      },
    };

    const res = await sendCallsAttributed(provider, FROM, [{ to: TO, data: DATA }]);
    expect(res).toEqual({ via: "sendCalls", id: "0xbatchid" });

    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("wallet_sendCalls");
    const p = (seen[0].params as Record<string, unknown>[])[0];
    expect(p.from).toBe(FROM);
    expect(p.chainId).toBe(BASE_CHAIN_ID_HEX);
    expect(p.capabilities).toEqual({ dataSuffix: { value: BUILDER_DATA_SUFFIX, optional: true } });
    expect((p.calls as Record<string, unknown>[])[0]).toMatchObject({ to: TO, data: DATA });
  });

  it("falls back to eth_sendTransaction with the suffix appended when 5792 is unsupported", async () => {
    const sent: Record<string, unknown>[] = [];
    const provider: Eip1193Provider = {
      request: async (a) => {
        if (a.method === "wallet_sendCalls") throw { code: 4200, message: "Unsupported method" };
        sent.push((a.params as Record<string, unknown>[])[0]);
        return "0xtxhash";
      },
    };

    const res = await sendCallsAttributed(provider, FROM, [{ to: TO, data: DATA }]);
    expect(res).toEqual({ via: "sendTransaction", hashes: ["0xtxhash"] });

    const tx = sent[0];
    expect(tx.to).toBe(TO);
    expect((tx.data as string).startsWith(DATA)).toBe(true);
    expect((tx.data as string).endsWith(BUILDER_DATA_SUFFIX.slice(2))).toBe(true);
  });

  it("re-throws a non-unsupported provider error (e.g. user rejection)", async () => {
    const provider: Eip1193Provider = {
      request: async () => {
        throw { code: 4001, message: "User rejected the request" };
      },
    };
    await expect(sendCallsAttributed(provider, FROM, [{ to: TO }])).rejects.toMatchObject({ code: 4001 });
  });
});
