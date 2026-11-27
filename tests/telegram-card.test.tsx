// @vitest-environment jsdom
/**
 * "Telegram reminders" in the profile (components/game/TelegramCard.tsx): link a Telegram account
 * in two taps, see that it is linked, and unlink. The link to Telegram is opened by its own tap,
 * after the server has made it; the card then asks until the link shows.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TelegramCard, type TelegramCardProfile } from "@/components/game/TelegramCard";
import { ReminderChoices } from "@/components/game/ReminderChoices";

const opened = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock("@/components/game/useShare", () => ({ useOpenUrl: () => async (url: string) => void opened.urls.push(url) }));

const A = "0x00000000000000000000000000000000000000aa";
const LINK = "https://t.me/lexigotchi_bot?start=code-0123456789abcdef";
let calls: { method: string; token?: string }[] = [];
let linked: { name: string } | null = null;
let answer: (method: string) => { json: unknown };

beforeEach(() => {
  calls = [];
  linked = null;
  opened.urls = [];
  answer = (method) => {
    if (method === "POST") return { json: { ok: true, url: LINK, expiresAt: "2026-11-27T10:15:00.000Z" } };
    if (method === "DELETE") {
      linked = null;
      return { json: { ok: true, linked: null } };
    }
    return { json: { ok: true, linked } };
  };
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, token: (init.headers as Record<string, string>)?.["x-lexigotchi-session"] });
    return { status: 200, json: async () => answer(method).json } as Response;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = (p: Partial<TelegramCardProfile> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TelegramCard p={{ address: A, sessionToken: "tok", ensureToken: async () => "tok", ...p }} />
    </QueryClientProvider>,
  );

describe("Telegram reminders", () => {
  it("offers Link Telegram, then the link as its own tap, and opens nothing by itself", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Link Telegram" }));
    const open = await screen.findByRole("button", { name: "Open Telegram" });
    // the server made the link with the profile's session, and nothing has been opened yet
    expect(calls.filter((c) => c.method === "POST")).toEqual([{ method: "POST", token: "tok" }]);
    expect(opened.urls).toEqual([]);
    expect(screen.getByText("Press Start in Telegram, then come back here.")).toBeTruthy();
    fireEvent.click(open);
    expect(opened.urls).toEqual([LINK]);
  });

  it("shows the link once the bot has made it, without a reload", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Link Telegram" }));
    await screen.findByRole("button", { name: "Open Telegram" });
    linked = { name: "ann_plays" }; // the player pressed Start over in Telegram
    await waitFor(() => expect(screen.getByText("ann_plays")).toBeTruthy(), { timeout: 5000 });
    expect(screen.queryByRole("button", { name: "Open Telegram" })).toBeNull();
    expect(screen.getByRole("button", { name: "Unlink" })).toBeTruthy();
  }, 8000);

  it("shows a linked account by name and unlinks it", async () => {
    linked = { name: "ann_plays" };
    show();
    expect(await screen.findByText("ann_plays")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    await screen.findByRole("button", { name: "Link Telegram" });
    expect(calls.some((c) => c.method === "DELETE" && c.token === "tok")).toBe(true);
  });

  it("asks for the wallet's sign-in first, and says so when there is none", async () => {
    const ensureToken = vi.fn(async () => null);
    show({ sessionToken: null, ensureToken });
    fireEvent.click(screen.getByRole("button", { name: "Link Telegram" }));
    expect(await screen.findByText("Sign in with your wallet to link Telegram.")).toBeTruthy();
    expect(ensureToken).toHaveBeenCalledTimes(1);
    // signed out, nothing is asked of the server
    expect(calls).toEqual([]);
  });

  it("says when it isn't switched on yet, or when the server refuses", async () => {
    answer = (method) => (method === "POST" ? { json: { ok: false, error: "not_configured" } } : { json: { ok: true, linked: null } });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Link Telegram" }));
    expect(await screen.findByText("Telegram reminders aren’t switched on yet. Try again soon.")).toBeTruthy();
    answer = (method) => (method === "POST" ? { json: { ok: false, error: "wibble" } } : { json: { ok: true, linked: null } });
    fireEvent.click(screen.getByRole("button", { name: "Link Telegram" }));
    expect(await screen.findByText("Couldn’t do that. Try again.")).toBeTruthy();
  });
});

describe("What to tell me, where Telegram is offered", () => {
  it("names Telegram among the ways the game reaches a player, and only there", () => {
    const p = { address: A, sessionToken: null, ensureToken: async () => null };
    const wrap = (telegram: boolean) =>
      render(
        <QueryClientProvider client={new QueryClient()}>
          <ReminderChoices p={p} telegram={telegram} />
        </QueryClientProvider>,
      );
    wrap(true);
    expect(screen.getByText("Your choice for every way we reach you: email, your browser, Farcaster, and Telegram.")).toBeTruthy();
    cleanup();
    wrap(false);
    expect(screen.getByText("Your choice for every way we reach you: email, your browser, and Farcaster.")).toBeTruthy();
  });
});
