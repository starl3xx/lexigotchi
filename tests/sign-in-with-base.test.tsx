// @vitest-environment jsdom
/**
 * Base's "Sign in with Base" door. Two silent failures are pinned here.
 *
 * The button finds its connector by id. If RainbowKit ever renamed the Base Account connector, the
 * button would quietly render nothing, and nobody would notice a door that isn't there. The first
 * test builds the REAL wallet list and asserts the id the button looks for is in it.
 *
 * A tap must connect the Base Account and nothing else: the branded button opening MetaMask, or
 * the RainbowKit modal, is the bug Let's Have A Word! shipped and fixed.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { createConfig, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { baseAccount } from "@rainbow-me/rainbowkit/wallets";
import { walletList } from "@/lib/onchain/wagmi";

// The sealed Base component, stood in for by a plain button with the same onClick contract.
vi.mock("next/dynamic", () => ({
  default: () =>
    function FakeBaseButton({ onClick }: { onClick: () => void }) {
      return <button onClick={onClick}>Sign in with Base</button>;
    },
}));

const connect = vi.fn();
const getProvider = vi.fn(async () => ({}));
let state: { isPending: boolean; variables?: { connector: unknown } } = { isPending: false };
let connectors: { id: string; getProvider: typeof getProvider }[] = [];
vi.mock("wagmi", async (orig) => ({
  ...(await orig<typeof import("wagmi")>()),
  useConnect: () => ({ connect, connectors, ...state }),
}));

const { SignInWithBase, BASE_ACCOUNT_CONNECTOR_ID } = await import("@/components/game/SignInWithBase");

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

describe("Sign in with Base", () => {
  it("looks for the id the real wallet list gives the Base Account connector", () => {
    // Built for real with no WalletConnect project id: with one, building the config starts the
    // WalletConnect core, and a test must not reach the network.
    const config = createConfig({
      chains: [baseSepolia],
      transports: { [baseSepolia.id]: http() },
      connectors: connectorsForWallets(walletList(""), { appName: "Lexigotchi", projectId: "unset" }),
    });
    expect(config.connectors.map((c) => c.id)).toContain(BASE_ACCOUNT_CONNECTOR_ID);
    // With a project id, the same RainbowKit `baseAccount` wallet is listed (unbuilt, see above).
    expect(walletList("some-project-id").flatMap((g) => g.wallets)).toContain(baseAccount);
  });

  it("connects the Base Account connector, and only that one", () => {
    render(<SignInWithBase />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Base" }));
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith({ connector: connectors[2] });
  });

  it("warms the Base SDK before any tap, so the popup opens with no await in front of it", () => {
    render(<SignInWithBase />);
    expect(getProvider).toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("holds the button's footprint while the Base Account is asked", () => {
    state = { isPending: true, variables: { connector: connectors[2] } };
    render(<SignInWithBase />);
    expect(screen.getByText("Check your Base Account…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in with Base" })).toBeNull();
  });

  it("renders nothing when there is no Base Account connector", () => {
    connectors = connectors.filter((c) => c.id !== BASE_ACCOUNT_CONNECTOR_ID);
    const { container } = render(<SignInWithBase />);
    expect(container.innerHTML).toBe("");
  });
});
