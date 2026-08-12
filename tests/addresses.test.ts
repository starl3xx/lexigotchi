import { describe, it, expect } from "vitest";
import {
  addressOf,
  maybeAddressOf,
  wordTokenAddress,
  signerAddress,
  isSuiteDeployed,
  MissingDeploymentError,
} from "@/lib/onchain/addresses";
import { NETWORK } from "@/lib/onchain/network";

// Under test NEXT_PUBLIC_CHAIN_ID is unset, so the active network is Base MAINNET, whose registry
// is still all-null. That makes this the mainnet-safety test: nothing may resolve to an address.
describe("address resolution on the default (mainnet) build", () => {
  it("is resolving against mainnet", () => {
    expect(NETWORK.id).toBe(8453);
  });

  it("throws rather than returning a falsy address for an undeployed contract", () => {
    expect(() => addressOf("letters")).toThrow(MissingDeploymentError);
    expect(() => addressOf("feeRouter")).toThrow(/not deployed on Base/);
  });

  it("maybeAddressOf returns null for UI gating instead of throwing", () => {
    expect(maybeAddressOf("letters")).toBeNull();
  });

  it("reports the suite as not deployed", () => {
    expect(isSuiteDeployed()).toBe(false);
    expect(signerAddress()).toBeNull();
  });

  // The $WORD token is the one address that IS known on mainnet — it predates the suite.
  it("still resolves the mainnet $WORD token", () => {
    expect(wordTokenAddress().toLowerCase()).toBe("0x304e649e69979298bd1aee63e175adf07885fb4b");
  });
});

// The Sepolia registry is committed config, so its contents can be asserted directly without
// needing a second module instance under a different env.
describe("the committed Sepolia registry", () => {
  it("carries all ten contracts, the mock token, and the signer role", async () => {
    const sepolia = (await import("../config/deployments.base-sepolia.json")).default;
    expect(sepolia.chainId).toBe(84532);
    const contracts = Object.values(sepolia.contracts);
    expect(contracts).toHaveLength(10);
    for (const addr of contracts) expect(addr).toMatch(/^0x[a-fA-F0-9]{40}$/);
    // MockERC20, not the mainnet token — approving the mainnet address here would hit empty code.
    expect(sepolia.wordToken.toLowerCase()).toBe("0x4abe1bc87fc508af1a9d2ac31e5ac1af2a1122ea");
    expect(sepolia.wordToken.toLowerCase()).not.toBe("0x304e649e69979298bd1aee63e175adf07885fb4b");
    expect(sepolia.roles.signer).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });
});
