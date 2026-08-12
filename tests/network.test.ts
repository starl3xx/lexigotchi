import { describe, it, expect } from "vitest";
import {
  BASE,
  BASE_SEPOLIA,
  NETWORKS,
  NETWORK,
  networkById,
  resolveNetwork,
  caip2,
  explorerAddress,
  explorerTx,
} from "@/lib/onchain/network";

// The chain id decides where a signed transaction lands, so every one of these is a wrong-chain bug
// if it drifts. Pinned exactly rather than derived.
describe("network definitions", () => {
  it("pins Base mainnet", () => {
    expect(BASE.id).toBe(8453);
    expect(BASE.idHex).toBe("0x2105");
    expect(BASE.explorer).toBe("https://basescan.org");
    expect(BASE.isTestnet).toBe(false);
  });

  it("pins Base Sepolia", () => {
    expect(BASE_SEPOLIA.id).toBe(84532);
    expect(BASE_SEPOLIA.idHex).toBe("0x14a34");
    expect(BASE_SEPOLIA.explorer).toBe("https://sepolia.basescan.org");
    expect(BASE_SEPOLIA.isTestnet).toBe(true);
  });

  it("keeps idHex and id in agreement", () => {
    for (const n of NETWORKS) expect(Number(n.idHex)).toBe(n.id);
  });

  it("has unique ids and keys", () => {
    expect(new Set(NETWORKS.map((n) => n.id)).size).toBe(NETWORKS.length);
    expect(new Set(NETWORKS.map((n) => n.key)).size).toBe(NETWORKS.length);
  });
});

describe("resolveNetwork", () => {
  it("defaults to Base mainnet when unset or blank", () => {
    expect(resolveNetwork(undefined)).toBe(BASE);
    expect(resolveNetwork("")).toBe(BASE);
    expect(resolveNetwork("   ")).toBe(BASE);
  });

  it("selects by chain id, tolerating whitespace", () => {
    expect(resolveNetwork("8453")).toBe(BASE);
    expect(resolveNetwork("84532")).toBe(BASE_SEPOLIA);
    expect(resolveNetwork(" 84532 ")).toBe(BASE_SEPOLIA);
  });

  // A silent fallback here would point a signed tx at a chain nobody chose.
  it("THROWS on an unsupported chain id rather than falling back", () => {
    expect(() => resolveNetwork("1")).toThrow(/not a supported network/);
    expect(() => resolveNetwork("999999")).toThrow(/not a supported network/);
  });

  it("throws on non-numeric input rather than coercing", () => {
    for (const bad of ["base", "0x2105", "8453x", "-1", "84.5"]) {
      expect(() => resolveNetwork(bad)).toThrow();
    }
  });
});

describe("derived helpers", () => {
  it("builds CAIP-2 ids", () => {
    expect(caip2(BASE)).toBe("eip155:8453");
    expect(caip2(BASE_SEPOLIA)).toBe("eip155:84532");
  });

  it("builds explorer links per network", () => {
    const a = "0x51E29Ba3Ff9ebdb5e6d32f6AB52F2FD3b21Ae1E3";
    expect(explorerAddress(a, BASE)).toBe(`https://basescan.org/address/${a}`);
    expect(explorerAddress(a, BASE_SEPOLIA)).toBe(`https://sepolia.basescan.org/address/${a}`);
    expect(explorerTx("0xabc", BASE_SEPOLIA)).toBe("https://sepolia.basescan.org/tx/0xabc");
  });

  it("looks up by id", () => {
    expect(networkById(8453)).toBe(BASE);
    expect(networkById(84532)).toBe(BASE_SEPOLIA);
    expect(networkById(1)).toBeUndefined();
  });

  it("the active NETWORK is one of the defined ones", () => {
    expect(NETWORKS).toContain(NETWORK);
  });
});
