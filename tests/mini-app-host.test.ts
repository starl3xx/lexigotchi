// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConfig, createConnector, http } from "wagmi";
import { reconnect } from "wagmi/actions";
import { baseSepolia } from "wagmi/chains";
import { HOST_WAIT_MS, hostAnswered, hostable, watchHost } from "@/lib/miniAppHost";
import { farcasterWhereHosted } from "@/lib/onchain/wagmi";

/**
 * Whether /play is inside a Farcaster host. The bug: in a React Native wallet browser (Rainbow)
 * the SDK asks a host that isn't there, its context never settles, and the page stayed blank.
 */
const PLAYER = { user: { fid: 6500 }, client: { clientFid: 9152, added: false } };
const never = () => new Promise<never>(() => {});
const after = (ms: number, value: unknown) => () => new Promise((r) => setTimeout(() => r(value), ms));

describe("watchHost", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is the web at once in a top window with no React Native web view", () => {
    const set = vi.fn();
    const context = vi.fn(never);
    watchHost({ hostable: false, context, set });
    expect(set.mock.calls).toEqual([["web"]]);
    expect(context).not.toHaveBeenCalled(); // never asks: nothing could answer
  });

  it("plays as the web when nobody answers (Rainbow's browser)", async () => {
    const set = vi.fn();
    watchHost({ hostable: true, context: never, set });
    await vi.advanceTimersByTimeAsync(HOST_WAIT_MS - 1);
    expect(set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(set.mock.calls).toEqual([["web"]]);
  });

  it("says nothing after it is stopped, but still records that a host answered", async () => {
    expect(hostAnswered()).toBe(false); // no test above this one has had a player answer
    const set = vi.fn();
    const stop = watchHost({ hostable: true, context: after(HOST_WAIT_MS * 2, PLAYER), set });
    stop();
    await vi.advanceTimersByTimeAsync(HOST_WAIT_MS * 5);
    expect(set).not.toHaveBeenCalled();
    expect(hostAnswered()).toBe(true); // the wallet connector reads this for the whole page
  });

  it("is a host when one answers in time, and stays one", async () => {
    const set = vi.fn();
    watchHost({ hostable: true, context: after(50, PLAYER), set });
    await vi.advanceTimersByTimeAsync(HOST_WAIT_MS * 5);
    expect(set.mock.calls).toEqual([["host"]]);
  });

  it("still becomes a host when the answer comes late", async () => {
    // A real host taken for the web never gets ready() and keeps its splash screen up for good.
    const set = vi.fn();
    watchHost({ hostable: true, context: after(HOST_WAIT_MS * 3, PLAYER), set });
    await vi.advanceTimersByTimeAsync(HOST_WAIT_MS * 5);
    expect(set.mock.calls).toEqual([["web"], ["host"]]);
  });

  it("takes any context object as a host's answer, but not an empty reply or a failure", async () => {
    for (const context of [after(10, undefined), after(10, null), () => Promise.reject(new Error("x"))]) {
      const set = vi.fn();
      watchHost({ hostable: true, context, set });
      await vi.advanceTimersByTimeAsync(HOST_WAIT_MS * 2);
      expect(set.mock.calls).toEqual([["web"]]);
    }
    // Neynar called ready() for any answer; a host whose context lacks a user must still get it.
    const set = vi.fn();
    watchHost({ hostable: true, context: after(10, {}), set });
    await vi.advanceTimersByTimeAsync(HOST_WAIT_MS * 2);
    expect(set.mock.calls).toEqual([["host"]]);
  });
});

/**
 * The Farcaster wallet connector, which wagmi's reconnect asks first on every load. Outside a host
 * its question never came back, so a returning player in Rainbow's browser was never reconnected.
 */
describe("farcasterWhereHosted", () => {
  const silentHost = () =>
    createConnector(() => ({
      id: "farcaster",
      name: "Farcaster",
      type: "farcasterMiniApp",
      getProvider: async () => ({ request: () => new Promise(() => {}) }),
      isAuthorized: () => new Promise<boolean>(() => {}), // nobody answers
      connect: async () => ({ accounts: [], chainId: baseSepolia.id }),
      disconnect: async () => {},
      getAccounts: async () => [],
      getChainId: async () => baseSepolia.id,
      onAccountsChanged() {},
      onChainChanged() {},
      onDisconnect() {},
    }));
  const configWith = (inHost: boolean) =>
    createConfig({
      chains: [baseSepolia],
      connectors: [farcasterWhereHosted(silentHost(), () => inHost)],
      transports: { [baseSepolia.id]: http() },
    });

  it("has no provider outside a host, so reconnect finishes", async () => {
    const config = configWith(false);
    expect(config.connectors[0].id).toBe("farcaster");
    expect(await config.connectors[0].getProvider()).toBeUndefined();
    await expect(reconnect(config)).resolves.toEqual([]);
  });

  it("hands over the wallet inside a host", async () => {
    expect(await configWith(true).connectors[0].getProvider()).toBeDefined();
  });
});

describe("hostable", () => {
  it("is true only in an iframe or a React Native web view", () => {
    const top = {} as Window;
    (top as { parent: Window }).parent = top;
    expect(hostable(top)).toBe(false);
    expect(hostable(Object.assign(top, { ReactNativeWebView: { postMessage() {} } }))).toBe(true);
    const framed = { parent: {} } as Window;
    expect(hostable(framed)).toBe(true);
  });
});
