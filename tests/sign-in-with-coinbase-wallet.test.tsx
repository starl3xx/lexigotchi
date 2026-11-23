// @vitest-environment jsdom
/**
 * The "Sign in with Coinbase Wallet" door (Base Account, renamed). Two silent failures are pinned.
 *
 * The button finds its connector by id. If RainbowKit ever renamed the Base Account connector, the
 * button would quietly render nothing, and nobody would notice a door that isn't there. The first
 * test builds the REAL wallet list and asserts the id the button looks for is in it, and that the
 * modal's row carries the new name.
 *
 * A tap must connect that wallet and nothing else: a branded button opening MetaMask, or the
 * RainbowKit modal, is the bug Let's Have A Word! shipped and fixed.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { createConfig, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { coinbaseWalletAccount, walletList } from "@/lib/onchain/wagmi";

const connect = vi.fn();
const getProvider = vi.fn(async () => ({}));
let state: { isPending: boolean; variables?: { connector: unknown } } = { isPending: false };
let connectors: { id: string; getProvider: typeof getProvider }[] = [];
vi.mock("wagmi", async (orig) => ({
  ...(await orig<typeof import("wagmi")>()),
  useConnect: () => ({ connect, connectors, ...state }),
}));

const { SignInWithCoinbaseWallet, BASE_ACCOUNT_CONNECTOR_ID } = await import("@/components/game/SignInWithCoinbaseWallet");

beforeEach(() => {
  connect.mockClear();
  getProvider.mockClear();
  state = { isPending: false };
  connectors = [
    { id: "farcaster", getProvider },
    { id: "io.rabby", getProvider },
    { id: BASE_ACCOUNT_CONNECTOR_ID, getProvider },
  ];
});
afterEach(cleanup);

describe("Sign in with Coinbase Wallet", () => {
  it("looks for the id the real wallet list gives the Coinbase Wallet (Base Account) connector", () => {
    // Built for real with no WalletConnect project id: with one, building the config starts the
    // WalletConnect core, and a test must not reach the network.
    const config = createConfig({
      chains: [baseSepolia],
      transports: { [baseSepolia.id]: http() },
      connectors: connectorsForWallets(walletList(""), { appName: "Lexigotchi", projectId: "unset" }),
    });
    expect(config.connectors.map((c) => c.id)).toContain(BASE_ACCOUNT_CONNECTOR_ID);
    // With a project id, the same wallet is listed (unbuilt, see above).
    expect(walletList("some-project-id").flatMap((g) => g.wallets)).toContain(coinbaseWalletAccount);
  });

  it("names the modal's row the way the popup names itself", () => {
    const row = coinbaseWalletAccount({ appName: "Lexigotchi" } as Parameters<typeof coinbaseWalletAccount>[0]);
    expect(row.name).toBe("Coinbase Wallet");
  });

  it("connects that connector, and only that one", () => {
    render(<SignInWithCoinbaseWallet />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Coinbase Wallet" }));
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith({ connector: connectors[2] });
  });

  it("warms the SDK before any tap, so the popup opens with no await in front of it", () => {
    render(<SignInWithCoinbaseWallet />);
    expect(getProvider).toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("says where to look while the wallet is asked, and can't be tapped twice", () => {
    state = { isPending: true, variables: { connector: connectors[2] } };
    render(<SignInWithCoinbaseWallet />);
    const button = screen.getByRole("button", { name: /Check your Coinbase Wallet/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Sign in with Coinbase Wallet" })).toBeNull();
  });

  it("renders nothing when there is no such connector", () => {
    connectors = connectors.filter((c) => c.id !== BASE_ACCOUNT_CONNECTOR_ID);
    const { container } = render(<SignInWithCoinbaseWallet />);
    expect(container.innerHTML).toBe("");
  });
});
