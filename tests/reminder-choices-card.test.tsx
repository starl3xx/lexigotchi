// @vitest-environment jsdom
/**
 * "What to tell me" in the profile (components/game/ReminderChoices.tsx): one checkbox per kind of
 * reminder, saved to the player's account. Until their own choices load, it shows the defaults,
 * which is what they get; a change needs the wallet's session.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReminderChoices, type ReminderChoicesProfile } from "@/components/game/ReminderChoices";

const A = "0x00000000000000000000000000000000000000aa";
const ALL_ON = { hunger: true, daily: true, jackpot: true, sold: true, bounty: true, payday: false };
let calls: { method: string; body?: unknown; token?: string }[] = [];
let answer: (method: string, body?: { kinds: Record<string, boolean> }) => { status?: number; json: unknown };

beforeEach(() => {
  calls = [];
  answer = (method, body) => ({ json: { ok: true, kinds: method === "PUT" ? { ...ALL_ON, ...body!.kinds } : ALL_ON } });
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, body, token: (init.headers as Record<string, string>)?.["x-lexigotchi-session"] });
    const a = answer(method, body);
    return { status: a.status ?? 200, json: async () => a.json } as Response;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = (p: Partial<ReminderChoicesProfile> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ReminderChoices p={{ address: A, sessionToken: "tok", ensureToken: async () => "tok", ...p }} />
    </QueryClientProvider>,
  );
const box = (name: RegExp) => screen.getByRole("checkbox", { name }) as HTMLInputElement;

describe("What to tell me", () => {
  it("lists every kind with its box, and loads the player’s own choices", async () => {
    answer = () => ({ json: { ok: true, kinds: { ...ALL_ON, daily: false } } });
    show();
    expect(screen.getAllByRole("checkbox")).toHaveLength(6);
    // the one kind that comes every day starts off
    expect(box(/My words were paid/).checked).toBe(false);
    await waitFor(() => expect(box(/free daily letter/).checked).toBe(false));
    expect(box(/about to go hungry/).checked).toBe(true);
    expect(calls[0]).toMatchObject({ method: "GET", token: "tok" });
  });

  it("saves one kind when its box is changed, and shows what the server kept", async () => {
    show();
    await waitFor(() => expect(calls).toHaveLength(1));
    fireEvent.click(box(/Something of mine sold/));
    await waitFor(() => expect(box(/Something of mine sold/).checked).toBe(false));
    expect(calls[1]).toMatchObject({ method: "PUT", body: { kinds: { sold: false } }, token: "tok" });
  });

  it("shows the defaults with no session, and asks for the sign-in on a change", async () => {
    const ensureToken = vi.fn(async () => null);
    show({ sessionToken: null, ensureToken });
    expect(box(/I won the jackpot/).checked).toBe(true);
    expect(calls).toHaveLength(0); // nothing is asked of the server without a session
    fireEvent.click(box(/I won the jackpot/));
    await screen.findByText("Sign in with your wallet to change this.");
    expect(ensureToken).toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(box(/I won the jackpot/).checked).toBe(true); // nothing changed
  });

  it("says so when a choice can’t be kept yet, and leaves the box as it was", async () => {
    show();
    await waitFor(() => expect(calls).toHaveLength(1));
    answer = (method) => (method === "PUT" ? { status: 503, json: { ok: false, error: "not_configured" } } : { json: { ok: true, kinds: ALL_ON } });
    fireEvent.click(box(/free daily letter/));
    await screen.findByText("Choices aren’t switched on yet. Try again soon.");
    expect(box(/free daily letter/).checked).toBe(true);
  });
});
