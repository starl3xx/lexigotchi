// @vitest-environment jsdom
/**
 * The connect beacon every player runs (useWalletSighting, mounted in GameApp). Pinned: it waits
 * for the viewer to resolve so the web/Farcaster label is right, it says nothing without a wallet,
 * it posts once per wallet per UTC day, and it marks the day only when the server stored it (so a
 * server without migration 0009 hears again on the next visit, not never).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";
import { sightingStorageKey, utcDay } from "@/lib/sightings";

const W = "0x00000000000000000000000000000000000000A1";
let address: string | undefined = W;
let environment: "loading" | "web" | "farcaster" = "web";
let answer: { ok: boolean; error?: string } = { ok: true };
const post = vi.fn(async (_path: string, _body: unknown) => answer);

vi.mock("wagmi", () => ({ useAccount: () => ({ address }) }));
vi.mock("@/components/game/useViewer", () => ({ useViewer: () => ({ environment }) }));
vi.mock("@/components/game/campaignClient", () => ({
  maybeAuthedPostJson: (path: string, body: unknown) => post(path, body),
}));

const { useWalletSighting } = await import("@/components/game/useWalletSighting");

beforeEach(() => {
  address = W;
  environment = "web";
  answer = { ok: true };
  post.mockClear();
  localStorage.clear();
});
afterEach(cleanup);

describe("useWalletSighting", () => {
  it("posts the wallet and where the game runs, then marks today", async () => {
    environment = "farcaster";
    renderHook(() => useWalletSighting());
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/api/players/seen", { address: W, via: "farcaster" });
    await waitFor(() => expect(localStorage.getItem(sightingStorageKey(W))).toBe(String(utcDay())));
  });

  it("says nothing while the viewer is loading, or without a wallet", async () => {
    environment = "loading";
    renderHook(() => useWalletSighting());
    address = undefined;
    environment = "web";
    renderHook(() => useWalletSighting());
    await new Promise((r) => setTimeout(r, 20));
    expect(post).not.toHaveBeenCalled();
  });

  it("posts once a day per wallet", async () => {
    localStorage.setItem(sightingStorageKey(W), String(utcDay()));
    renderHook(() => useWalletSighting());
    await new Promise((r) => setTimeout(r, 20));
    expect(post).not.toHaveBeenCalled();
  });

  it("leaves the day unmarked when the server didn't store it", async () => {
    answer = { ok: false, error: "not_configured" };
    renderHook(() => useWalletSighting());
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(localStorage.getItem(sightingStorageKey(W))).toBeNull();
  });
});
