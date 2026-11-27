/**
 * Posting to the beta group as the bot from the operator console (/api/admin/telegram): the gate,
 * what is sent, and what is refused before Telegram is asked. It speaks to every tester in the
 * game's name, so the gate comes first in every test that sends.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pollError } from "@/lib/telegram";
// The workflows' own check: plain JavaScript, so it can't share code with the app. The two must agree.
import { pollProblem } from "../.github/scripts/tester-note.mjs";

const gate = vi.hoisted(() => ({ ok: true }));
vi.mock("@/lib/admin/serverAuth", () => ({
  checkAdmin: async () => (gate.ok ? { ok: true, via: "wallet", who: "0xop" } : { ok: false, status: 401, error: "sign_in" }),
  refusalBody: (d: { error: string }) => ({ ok: false, error: d.error, hint: "Sign in with an operator wallet." }),
}));

const GROUP = "-1005000000001";
const env = { TELEGRAM_BOT_TOKEN: "123:test", TELEGRAM_CHAT_ID: GROUP, TELEGRAM_WEBHOOK_SECRET: "hook-secret" };
const post = (body: unknown) => new Request("http://localhost/api/admin/telegram", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function withTelegram<T>(fn: (calls: { method: string; body: Record<string, unknown> }[]) => Promise<T>, refuse?: string): Promise<T> {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const real = { fetch: globalThis.fetch, log: console.log };
  console.log = () => {};
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    if (u.hostname !== "api.telegram.org") throw new Error(`unexpected fetch: ${u}`);
    const method = u.pathname.split("/").pop()!;
    calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : Object.fromEntries(u.searchParams) });
    if (method === "getChatMemberCount") return new Response(JSON.stringify({ ok: true, result: 14 }));
    return new Response(JSON.stringify(refuse ? { ok: false, description: refuse } : { ok: true, result: { message_id: 1 } }));
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real.fetch;
    console.log = real.log;
  }
}

beforeEach(() => {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  gate.ok = true;
});

describe("a poll's limits", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => `Answer ${i + 1}`);
  const cases: [string, string, string[]][] = [
    ["a plain poll", "Did it work?", ["Yes", "No"]],
    ["twelve answers", "Which?", twelve],
    ["a question at the limit", "Q".repeat(300), ["Yes", "No"]],
    ["an answer at the limit", "Which?", ["Yes", "a".repeat(100)]],
    ["no question", "", ["Yes", "No"]],
    ["a question over the limit", "Q".repeat(301), ["Yes", "No"]],
    ["one answer", "Which?", ["Yes"]],
    ["no answers", "Which?", []],
    ["thirteen answers", "Which?", [...twelve, "One more"]],
    ["an answer over the limit", "Which?", ["Yes", "a".repeat(101)]],
    ["an empty answer", "Which?", ["Yes", ""]],
    ["the same answer twice", "Which?", ["Yes", "yes"]],
  ];

  it.each(cases)("%s: the console and the workflows agree", (_name, question, options) => {
    expect(pollError({ question, options }) === null).toBe(pollProblem(question, options) === null);
  });

  it("takes the first four and refuses the rest, with a reason", () => {
    for (const [, question, options] of cases.slice(0, 4)) expect(pollError({ question, options })).toBeNull();
    for (const [, question, options] of cases.slice(4)) expect(pollError({ question, options })).toMatch(/\.$/);
  });
});

describe("posting to the group as the bot", () => {
  it("is gated: nothing is read or sent without an operator's credential", async () => {
    const { GET, POST } = await import("@/app/api/admin/telegram/route");
    gate.ok = false;
    await withTelegram(async (calls) => {
      for (const res of [await GET(new Request("http://localhost/api/admin/telegram")), await POST(post({ kind: "message", text: "hi" })), await POST(post({ kind: "poll", question: "Q?", options: ["a", "b"] }))]) {
        expect(res.status).toBe(401);
        expect(res.headers.get("cache-control")).toBe("no-store");
      }
      expect(calls).toEqual([]);
    });
  });

  it("says whether the bot is set up here, and how many it would reach", async () => {
    const { GET } = await import("@/app/api/admin/telegram/route");
    await withTelegram(async () => {
      expect(await (await GET(new Request("http://localhost/api/admin/telegram"))).json()).toEqual({ ok: true, configured: true, members: 14 });
    });
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    await withTelegram(async (calls) => {
      expect(await (await GET(new Request("http://localhost/api/admin/telegram"))).json()).toEqual({ ok: true, configured: false, members: null });
      expect(calls).toEqual([]);
    });
  });

  it("sends a message as typed: no parse mode, no link preview", async () => {
    const { POST } = await import("@/app/api/admin/telegram/route");
    await withTelegram(async (calls) => {
      const res = await POST(post({ kind: "message", text: "  The testnet resets <b>tonight</b>.\r\nSee lexigotchi.fun/docs  " }));
      expect(await res.json()).toEqual({ ok: true });
      expect(calls).toEqual([{ method: "sendMessage", body: { chat_id: GROUP, text: "The testnet resets <b>tonight</b>.\nSee lexigotchi.fun/docs", link_preview_options: { is_disabled: true } } }]);
    });
  });

  it("sends a poll, anonymous and single-answer unless asked otherwise", async () => {
    const { POST } = await import("@/app/api/admin/telegram/route");
    await withTelegram(async (calls) => {
      await POST(post({ kind: "poll", question: " Which do you play on most? ", options: ["A phone", " A computer "] }));
      await POST(post({ kind: "poll", question: "Which?", options: ["a", "b"], named: true, multiple: true }));
      expect(calls).toEqual([
        { method: "sendPoll", body: { chat_id: GROUP, question: "Which do you play on most?", options: [{ text: "A phone" }, { text: "A computer" }], is_anonymous: true, allows_multiple_answers: false } },
        { method: "sendPoll", body: { chat_id: GROUP, question: "Which?", options: [{ text: "a" }, { text: "b" }], is_anonymous: false, allows_multiple_answers: true } },
      ]);
    });
  });

  it("refuses what Telegram would refuse before asking it, with the reason", async () => {
    const { POST } = await import("@/app/api/admin/telegram/route");
    await withTelegram(async (calls) => {
      const refused: [unknown, string][] = [
        [{ kind: "message", text: "   " }, "There is nothing to send."],
        [{ kind: "message", text: "x".repeat(4097) }, "The message is 4097 characters (Telegram takes 4096)."],
        [{ kind: "message" }, "There is nothing to send."],
        [{ kind: "poll", question: "Which?", options: ["Yes"] }, "It needs at least 2 answers."],
        [{ kind: "poll", question: "", options: ["Yes", "No"] }, "It has no question."],
        [{ kind: "poll", question: "Which?", options: "Yes" }, "It needs at least 2 answers."],
        [{ kind: "poll", question: "Which?", options: ["Yes", 7] }, "One of its answers is empty."],
        [{ kind: "shout", text: "hi" }, "Send a message or a poll."],
        [null, "Send a message or a poll."],
      ];
      for (const [body, error] of refused) {
        const res = await POST(post(body));
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ ok: false, error });
      }
      expect(calls).toEqual([]);
    });
  });

  it("answers with Telegram's own words when a send fails, and tries once", async () => {
    const { POST } = await import("@/app/api/admin/telegram/route");
    await withTelegram(async (calls) => {
      const res = await POST(post({ kind: "message", text: "hi" }));
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ ok: false, error: "sendMessage: Forbidden: bot was kicked from the supergroup chat" });
      expect(calls).toHaveLength(1);
    }, "Forbidden: bot was kicked from the supergroup chat");
  });

  it("sends nothing where the bot isn't set up", async () => {
    const { POST } = await import("@/app/api/admin/telegram/route");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    await withTelegram(async (calls) => {
      expect((await POST(post({ kind: "message", text: "hi" }))).status).toBe(503);
      expect(calls).toEqual([]);
    });
  });
});
