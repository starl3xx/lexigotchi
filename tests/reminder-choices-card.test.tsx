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

// Whether the game has a set to speak of (useSets): the "A new set of words" choice shows only then.
const anySets = vi.hoisted(() => ({ on: true }));
vi.mock("@/components/game/useSets", () => ({
  useSets: () => ({ known: true, sets: anySets.on ? [{ kind: "locked" }] : [], held: null, setNameOf: () => undefined, released: undefined, gate: false }),
  useMinuteClock: () => 0,
}));

const A = "0x00000000000000000000000000000000000000aa";
const ALL_ON = { hunger: true, daily: true, jackpot: true, sold: true, bounty: true, payday: false, deal: false, sets: true };
let calls: { method: string; body?: unknown; token?: string }[] = [];
let answer: (method: string, body?: { kinds: Record<string, boolean> }) => { status?: number; json: unknown };

beforeEach(() => {
  anySets.on = true;
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

const show = (p: Partial<ReminderChoicesProfile> = {}, hasEmail = false) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ReminderChoices p={{ address: A, sessionToken: "tok", ensureToken: async () => "tok", ...p }} hasEmail={hasEmail} />
    </QueryClientProvider>,
  );
const box = (name: RegExp) => screen.getByRole("checkbox", { name }) as HTMLInputElement;

describe("What to tell me", () => {
  it("offers “A new set of words” only once the game has a set", async () => {
    anySets.on = false;
    show();
    await waitFor(() => expect(box(/free daily letter/).checked).toBe(true));
    expect(screen.getAllByRole("checkbox")).toHaveLength(7);
    expect(screen.queryByRole("checkbox", { name: /A new set of words/ })).toBeNull();
    cleanup();
    anySets.on = true;
    show();
    await waitFor(() => expect(box(/A new set of words/).checked).toBe(true));
  });

  it("lists every kind with its box, and loads the player’s own choices", async () => {
    answer = () => ({ json: { ok: true, kinds: { ...ALL_ON, daily: false } } });
    show();
    // "A new set of words" is offered only once the game has a set to speak of
    expect(screen.getAllByRole("checkbox")).toHaveLength(anySets.on ? 8 : 7);
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

  it("offers how often email comes only to a player with an email, and saves the choice", async () => {
    answer = (method, body) => ({ json: { ok: true, kinds: ALL_ON, emailCadence: method === "PUT" ? (body as unknown as { emailCadence: string }).emailCadence : "each" } });
    const { unmount } = show();
    expect(screen.queryByRole("radio")).toBeNull();
    unmount();
    show({}, true);
    await waitFor(() => expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThan(0));
    // a labelled group (a fieldset's floated legend once pushed the first choice out of the card)
    expect(screen.getByRole("radiogroup", { name: "How often by email" }).querySelectorAll("input[type=radio]")).toHaveLength(2);
    const weekly = screen.getByRole("radio", { name: /One email a week/ }) as HTMLInputElement;
    expect((screen.getByRole("radio", { name: /Each one as it happens/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(weekly);
    await waitFor(() => expect(weekly.checked).toBe(true));
    expect(calls.at(-1)).toMatchObject({ method: "PUT", body: { emailCadence: "weekly" } });
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
