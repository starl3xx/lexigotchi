/**
 * Which store backs the game (src/lib/onchain/gameMode.ts). The rule since the mainnet cutover
 * work: chain-backed exactly when this network's registry has the whole suite, so production flips
 * to the real game in the same deploy that commits the mainnet addresses, and not before.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let deployed = false;
vi.mock("@/lib/onchain/addresses", () => ({ isSuiteDeployed: () => deployed }));

async function mode(chainId: string, opts: { deployed: boolean; brake?: string }) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", chainId);
  vi.stubEnv("NEXT_PUBLIC_CHAIN_GAME", opts.brake ?? "");
  deployed = opts.deployed;
  return import("@/lib/onchain/gameMode");
}

beforeEach(() => vi.unstubAllEnvs());

describe("gameMode", () => {
  it("mainnet today (no addresses): the practice game, not real money", async () => {
    const m = await mode("8453", { deployed: false });
    expect(m.isChainBacked()).toBe(false);
    expect(m.isRealEconomy()).toBe(false);
  });

  it("mainnet once the addresses are committed: the real game, in the same deploy", async () => {
    const m = await mode("8453", { deployed: true });
    expect(m.isChainBacked()).toBe(true);
    expect(m.isRealEconomy()).toBe(true);
  });

  it("Sepolia with its rehearsal suite: onchain, but play money", async () => {
    const m = await mode("84532", { deployed: true });
    expect(m.isChainBacked()).toBe(true);
    expect(m.isRealEconomy()).toBe(false);
  });

  it("NEXT_PUBLIC_CHAIN_GAME=0 is an emergency brake back to the practice game", async () => {
    const m = await mode("8453", { deployed: true, brake: "0" });
    expect(m.isChainBacked()).toBe(false);
    expect(m.isRealEconomy()).toBe(false);
  });
});
