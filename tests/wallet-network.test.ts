import { describe, expect, it } from "vitest";
import { BASE, BASE_SEPOLIA } from "@/lib/onchain/network";
import { WrongChainError } from "@/lib/onchain/sendCalls";
import { networkToSwitchTo, switchRefusal, walletNetworkName } from "@/lib/onchain/walletNetwork";

/**
 * Which network the connected wallet should switch to (WalletNetworkNotice). The bug: Rainbow's
 * browser stayed on Base when it refused Base Sepolia, and the game said nothing. At launch the
 * same notice must catch a wallet on Ethereum or Arbitrum when the game is on Base.
 */
const ADDR = "0x1111111111111111111111111111111111111111";
const ARBITRUM = 42161;
const ETHEREUM = 1;
const at = (walletChainId: number | undefined, view: string, game = BASE_SEPOLIA) =>
  networkToSwitchTo({ chainBacked: true, address: ADDR, walletChainId, view, game })?.name ?? null;

describe("networkToSwitchTo", () => {
  it("testnet build: a wallet on Base, Arbitrum, or Ethereum switches to Base Sepolia", () => {
    expect(at(BASE.id, "home")).toBe("Base Sepolia"); // Rainbow's case
    expect(at(ARBITRUM, "bag")).toBe("Base Sepolia");
    expect(at(ETHEREUM, "mint")).toBe("Base Sepolia");
    expect(at(BASE_SEPOLIA.id, "home")).toBeNull();
  });

  it("launch build: a wallet on Ethereum, Arbitrum, or Base Sepolia switches to Base", () => {
    expect(at(ETHEREUM, "home", BASE)).toBe("Base");
    expect(at(ARBITRUM, "claim", BASE)).toBe("Base");
    expect(at(BASE_SEPOLIA.id, "home", BASE)).toBe("Base");
    expect(at(BASE.id, "home", BASE)).toBeNull();
  });

  it("the $WORD page wants Base, and doesn't nag a testnet player on Base Sepolia", () => {
    expect(at(BASE.id, "word")).toBeNull(); // where its swap sends
    expect(at(BASE_SEPOLIA.id, "word")).toBeNull(); // the testnet game's network: just reading
    expect(at(ARBITRUM, "word")).toBe("Base"); // never "Base Sepolia" on the page that trades on Base
    expect(at(ARBITRUM, "word", BASE)).toBe("Base");
  });

  it("the Market (the swap view) trades the game's own tokens, so it wants the game's network", () => {
    expect(at(BASE.id, "swap")).toBe("Base Sepolia");
    expect(at(ARBITRUM, "swap")).toBe("Base Sepolia");
    expect(at(BASE_SEPOLIA.id, "swap")).toBeNull();
    expect(at(ARBITRUM, "swap", BASE)).toBe("Base");
  });

  it("says nothing with no wallet, an unknown network, or the practice game", () => {
    expect(networkToSwitchTo({ chainBacked: true, address: undefined, walletChainId: BASE.id, view: "home" })).toBeNull();
    expect(networkToSwitchTo({ chainBacked: true, address: ADDR, walletChainId: undefined, view: "home" })).toBeNull();
    expect(networkToSwitchTo({ chainBacked: false, address: ADDR, walletChainId: ARBITRUM, view: "home" })).toBeNull();
  });
});

describe("walletNetworkName", () => {
  it("names the networks players come from, else says another network", () => {
    expect(walletNetworkName(BASE.id)).toBe("Base");
    expect(walletNetworkName(BASE_SEPOLIA.id)).toBe("Base Sepolia");
    expect(walletNetworkName(ETHEREUM)).toBe("Ethereum");
    expect(walletNetworkName(ARBITRUM)).toBe("Arbitrum");
    expect(walletNetworkName(999_999)).toBe("another network");
  });
});

describe("switchRefusal", () => {
  it("is declined only when the player said no (4001, however deep)", () => {
    expect(switchRefusal({ code: 4001 })).toBe("declined");
    expect(switchRefusal({ message: "x", cause: { cause: { code: 4001 } } })).toBe("declined");
    expect(switchRefusal({ data: { originalError: { code: 4001 } } })).toBe("declined"); // MetaMask Mobile wraps it
  });

  it("is unavailable when the wallet refused or stayed put", () => {
    expect(switchRefusal(Object.assign(new Error("Chain Id not supported"), { code: -32603 }))).toBe("unavailable"); // Rainbow
    expect(switchRefusal(new WrongChainError())).toBe("unavailable"); // resolved the switch, stayed put
    expect(switchRefusal(undefined)).toBe("unavailable");
  });
});
