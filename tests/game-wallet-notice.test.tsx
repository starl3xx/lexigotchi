// @vitest-environment jsdom
/**
 * The game wallet notice can be hidden (components/game/GameWalletNotice.tsx; starl3xx, 2026-11-27:
 * "I'd like the option to dismiss this on Today and Bag and anywhere else it might appear"). Hidden on
 * one screen means hidden on the other, on the first frame. It comes back only when it would say
 * something new (another wallet, another kind), never when counts change, and a browser that can't
 * store the choice still hides it for the page.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { WalletHoldings } from "@/lib/profile/gameWalletAdvice";

// Made-up wallets: F = the game wallet, W and V = the player's others.
const F = "0x1111111111111111111111111111111111111111";
const W = "0x2222222222222222222222222222222222222222";
const V = "0x3333333333333333333333333333333333333333";
const empty: WalletHoldings = { letters: 0, words: 0, staked: 0, word: 0 };
const has = (p: Partial<WalletHoldings>): WalletHoldings => ({ ...empty, ...p });

const env = vi.hoisted(() => ({
  address: "" as string,
  wallets: [] as string[],
  holdings: {} as Record<string, unknown>,
  gameWallet: null as string | null,
  toasts: [] as { text: string; tone: string }[],
}));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: env.address }) }));
vi.mock("@/components/game/useViewer", () => ({ useViewer: () => ({ environment: "web" }) }));
vi.mock("@/components/game/useProfile", () => ({ useProfile: () => ({ busy: false, setGameWallet: async () => ({}) }) }));
vi.mock("@/components/game/walletSwitch", () => ({ promptAccountSwitch: async () => {} }));
vi.mock("@/components/game/useWalletHoldings", () => ({
  useWalletHoldings: () => ({ wallets: env.wallets, holdings: env.holdings, gameWallet: env.gameWallet, refetch() {} }),
}));
vi.mock("@/components/game/state", async (orig) => {
  const real = await orig<typeof import("@/components/game/state")>();
  return {
    ...real,
    useGame: () => ({
      state: { chainBacked: true, words: [] },
      openSheet() {},
      toast: (text: string, tone: string) => void env.toasts.push({ text, tone }),
    }),
  };
});

const { GameWalletNotice } = await import("@/components/game/GameWalletNotice");

/** The screenshot's case: connected with the game wallet, another wallet holds letters and $WORD. */
function gather(otherLetters = 5) {
  env.address = F;
  env.gameWallet = F;
  env.wallets = [F, W, V];
  env.holdings = { [F]: has({ letters: 200 }), [W]: has({ letters: otherLetters, word: 11_352_000 }), [V]: empty };
}
const hideButtons = () => screen.queryAllByRole("button", { name: "Hide this notice" });

beforeEach(() => {
  window.localStorage.clear();
  env.toasts.length = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("hiding the game wallet notice", () => {
  it("every kind of notice has the ×", () => {
    gather();
    render(<GameWalletNotice />);
    expect(screen.getByText("Some of your things are in other wallets")).toBeTruthy();
    expect(hideButtons()).toHaveLength(1);
    cleanup();

    // choose: things are spread out and no game wallet is chosen
    env.gameWallet = null;
    render(<GameWalletNotice />);
    expect(screen.getByText("Choose your game wallet")).toBeTruthy();
    expect(hideButtons()).toHaveLength(1);
    cleanup();

    // move_to_game: connected with another wallet that holds letters
    env.gameWallet = F;
    env.address = W;
    render(<GameWalletNotice />);
    expect(screen.getByText("This isn’t your game wallet")).toBeTruthy();
    expect(hideButtons()).toHaveLength(1);
    cleanup();

    // switch_to_game: connected with an empty wallet, the game wallet holds things
    env.address = V;
    render(<GameWalletNotice />);
    expect(screen.getByText("Your things are in your game wallet")).toBeTruthy();
    expect(hideButtons()).toHaveLength(1);
  });

  it("hides on Today and the Bag at once, says where the wallets are, and stays hidden on the next screen", () => {
    gather();
    // Both screens' notices on the page at once: one store, so one × hides both.
    render(
      <>
        <GameWalletNotice />
        <GameWalletNotice />
      </>,
    );
    expect(hideButtons()).toHaveLength(2);
    fireEvent.click(hideButtons()[0]);
    expect(hideButtons()).toHaveLength(0);
    expect(env.toasts).toEqual([{ text: "Hidden. Your wallets stay in your profile.", tone: "info" }]);
    cleanup();

    // Opening the other screen later: hidden from its first render.
    render(<GameWalletNotice />);
    expect(screen.queryByText("Some of your things are in other wallets")).toBeNull();
  });

  it("stays hidden when the counts change, and comes back when another wallet holds things", () => {
    gather(5);
    render(<GameWalletNotice />);
    fireEvent.click(hideButtons()[0]);
    cleanup();

    // A daily letter landed in W: the same wallets, so still hidden.
    gather(6);
    render(<GameWalletNotice />);
    expect(hideButtons()).toHaveLength(0);
    cleanup();

    // Now V holds letters too: that's news.
    env.holdings = { ...env.holdings, [V]: has({ letters: 2 }) };
    render(<GameWalletNotice />);
    expect(screen.getByText("Some of your things are in other wallets")).toBeTruthy();
  });

  it("stays hidden when it has less to say: a named wallet emptied, a wallet unlinked", () => {
    // Hidden while it named W and V.
    gather();
    env.holdings = { ...env.holdings, [V]: has({ letters: 2 }) };
    render(<GameWalletNotice />);
    expect(screen.getByText("Some of your things are in other wallets")).toBeTruthy();
    fireEvent.click(hideButtons()[0]);
    cleanup();

    // The player moved V's letters, as it asked: W alone was named before, so still hidden.
    gather();
    render(<GameWalletNotice />);
    expect(hideButtons()).toHaveLength(0);
    cleanup();

    // choose, hidden with three wallets linked, then one unlinked: still hidden.
    env.gameWallet = null;
    env.holdings = { ...env.holdings, [V]: has({ letters: 2 }) };
    render(<GameWalletNotice />);
    expect(screen.getByText("Choose your game wallet")).toBeTruthy();
    fireEvent.click(hideButtons()[0]);
    cleanup();
    env.wallets = [F, W];
    render(<GameWalletNotice />);
    expect(hideButtons()).toHaveLength(0);
  });

  it("hiding one kind leaves the others", () => {
    gather();
    render(<GameWalletNotice />);
    fireEvent.click(hideButtons()[0]);
    cleanup();

    env.address = W; // the move notice, for the wallet that holds the letters
    render(<GameWalletNotice />);
    expect(screen.getByText("This isn’t your game wallet")).toBeTruthy();
    fireEvent.click(hideButtons()[0]);
    cleanup();

    // Back on the game wallet: the gather notice is still hidden too (both are kept).
    env.address = F;
    render(<GameWalletNotice />);
    expect(hideButtons()).toHaveLength(0);
  });

  // Last: the page's in-memory copy outlives the test.
  it("hides it for the page where storage can't keep it", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    gather();
    render(<GameWalletNotice />);
    fireEvent.click(hideButtons()[0]);
    expect(hideButtons()).toHaveLength(0);
    cleanup();
    render(<GameWalletNotice />);
    expect(hideButtons()).toHaveLength(0);
  });
});
