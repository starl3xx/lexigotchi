/**
 * `/bug` (lib/telegramReports): what is kept of a report, who may file one, what the bot answers,
 * and the operator console's side (/api/admin/reports): the gate, marking a report fixed, and
 * telling its reporter once. Reports are testers' own words from a private group, so the tests
 * also hold what must never happen to them: logged, or sent to a public issue with a name.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TgMessage } from "@/lib/telegram";
import type { TesterReport } from "@/lib/db/schema";

// The report store, in memory.
const store = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], missing: false, broken: false }));
vi.mock("@/lib/db/testerReports", () => {
  const fail = () => {
    if (store.missing) throw Object.assign(new Error("Failed query"), { cause: { code: "42P01" } });
    if (store.broken) throw new Error("connection refused");
  };
  return {
    addReport: async (r: Record<string, unknown>) => {
      fail();
      const id = store.rows.length + 1;
      store.rows.push({ ...r, id, status: "open", createdAt: new Date("2026-11-27T10:00:00Z"), updatedAt: new Date("2026-11-27T10:00:00Z") });
      return id;
    },
    listReports: async () => {
      fail();
      return [...store.rows].reverse();
    },
    getReport: async (id: number) => {
      fail();
      return store.rows.find((r) => r.id === id) ?? null;
    },
    setReportStatus: async (id: number, status: string) => {
      fail();
      const row = store.rows.find((r) => r.id === id);
      if (!row) return null;
      const changed = row.status !== status;
      row.status = status;
      return { report: row, changed };
    },
  };
});

const limits = vi.hoisted(() => ({ refuse: new Set<string>() }));
vi.mock("@/lib/ratelimit", () => ({ allow: async (kind: string) => !limits.refuse.has(kind) }));

const gate = vi.hoisted(() => ({ ok: true }));
vi.mock("@/lib/admin/serverAuth", () => ({
  checkAdmin: async () => (gate.ok ? { ok: true, via: "wallet", who: "0xop" } : { ok: false, status: 401, error: "sign_in" }),
  refusalBody: (d: { error: string }) => ({ ok: false, error: d.error, hint: "Sign in with an operator wallet." }),
}));

const GROUP = -1005000000001;
const env = { TELEGRAM_BOT_TOKEN: "123:test", TELEGRAM_CHAT_ID: String(GROUP), TELEGRAM_WEBHOOK_SECRET: "hook-secret" };

/** A `/bug` message as Telegram marks it. */
const bug = (text: string, more: Partial<TgMessage> = {}): TgMessage => ({
  message_id: 77,
  from: { id: 5, first_name: "Ann", username: "ann_plays" },
  chat: { id: GROUP, type: "supergroup" },
  text,
  entities: [{ type: "bot_command", offset: 0, length: 4 }],
  ...more,
});

/** Telegram's API replaced: every call is recorded, and `member` answers getChatMember. */
async function withTelegram<T>(fn: (calls: { method: string; body: Record<string, unknown> }[]) => Promise<T>, opts: { member?: string | "down"; refuseSend?: string } = {}): Promise<T> {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    if (u.hostname !== "api.telegram.org") throw new Error(`unexpected fetch: ${u}`);
    const method = u.pathname.split("/").pop()!;
    calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : Object.fromEntries(u.searchParams) });
    if (method === "getChatMember") {
      if (opts.member === "down") throw new Error("timeout");
      return new Response(JSON.stringify(opts.member ? { ok: true, result: { status: opts.member } } : { ok: false, description: "Bad Request: user not found" }), { status: opts.member ? 200 : 400 });
    }
    if (method === "getFile") return new Response(JSON.stringify({ ok: true, result: { file_path: "photos/file_1.jpg" } }));
    if (u.pathname.includes("/file/bot")) return new Response(new Uint8Array([255, 216, 255]));
    if (opts.refuseSend) return new Response(JSON.stringify({ ok: false, description: opts.refuseSend }));
    return new Response(JSON.stringify({ ok: true, result: { message_id: 900 } }));
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = realFetch;
  }
}

beforeEach(() => {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  store.rows = [];
  store.missing = false;
  store.broken = false;
  limits.refuse.clear();
  gate.ok = true;
});

describe("what is kept of a report", () => {
  it("the words after the command, who typed them, and where", async () => {
    const { reportOf } = await import("@/lib/telegramReports");
    expect(reportOf(bug("/bug the Roll button stays grey"), "the Roll button stays grey")).toEqual({
      chatId: GROUP,
      messageId: 77,
      reporterId: 5,
      reporterName: "ann_plays", // never with an "@"
      text: "the Roll button stays grey",
      photoFileId: null,
    });
  });

  it("the largest size of a screenshot it was typed under", async () => {
    const { reportOf } = await import("@/lib/telegramReports");
    const under = bug("", { text: undefined, caption: "/bug see this", photo: [{ file_id: "small" }, { file_id: "medium" }, { file_id: "large" }] });
    expect(reportOf(under, "see this")?.photoFileId).toBe("large");
  });

  it("nothing for a /bug with no words", async () => {
    const { reportOf } = await import("@/lib/telegramReports");
    expect(reportOf(bug("/bug"), "")).toBeNull();
    expect(reportOf(bug("/bug   "), "  \n ")).toBeNull();
  });

  it("at most 2,000 characters, line breaks kept, control characters out", async () => {
    const { reportOf, REPORT_MAX } = await import("@/lib/telegramReports");
    expect(REPORT_MAX).toBe(2000);
    const long = reportOf(bug("/bug x"), "🐸".repeat(2500))!.text;
    expect(Array.from(long)).toHaveLength(2001);
    expect(long.endsWith("🐸…")).toBe(true);
    expect(reportOf(bug("/bug x"), "one\ntwo\u0007\u0000 three")!.text).toBe("one\ntwo three");
  });

  it("a first name for someone with no username, and no name for an anonymous admin", async () => {
    const { reportOf } = await import("@/lib/telegramReports");
    expect(reportOf(bug("/bug x", { from: { id: 6, first_name: "Bo" } }), "x")!.reporterName).toBe("Bo");
    expect(reportOf(bug("/bug x", { from: { id: 6 } }), "x")!.reporterName).toBe("a tester");
    const anon = reportOf(bug("/bug x", { from: { id: 1087968824, is_bot: true, first_name: "Group", username: "GroupAnonymousBot" }, sender_chat: { id: GROUP } }), "x")!;
    expect(anon.reporterName).toBe("an admin");
  });
});

describe("filing a report", () => {
  it("saves it and gives its number", async () => {
    const { fileReport } = await import("@/lib/telegramReports");
    await withTelegram(async (calls) => {
      expect(await fileReport(bug("/bug the Roll button stays grey"), "the Roll button stays grey")).toBe("Logged as report #1. Thank you! Only the team sees it.");
      expect(store.rows[0]).toMatchObject({ id: 1, text: "the Roll button stays grey", reporterName: "ann_plays", status: "open" });
      // in the group nobody's membership needs asking
      expect(calls).toEqual([]);
    });
  });

  it("asks for words when there are none", async () => {
    const { fileReport } = await import("@/lib/telegramReports");
    expect(await fileReport(bug("/bug"), "")).toBe("Tell me what went wrong, like this:\n/bug the Roll button stays grey after a miss");
    expect(store.rows).toEqual([]);
  });

  it("in a private chat, takes one only from someone in the beta group now", async () => {
    const { fileReport } = await import("@/lib/telegramReports");
    const dm = bug("/bug it broke", { chat: { id: 5, type: "private" } });
    await withTelegram(async (calls) => {
      expect(await fileReport(dm, "it broke")).toMatch(/^Logged as report #1\./);
      expect(calls).toEqual([{ method: "getChatMember", body: { chat_id: String(GROUP), user_id: "5" } }]);
    }, { member: "member" });
    for (const status of ["creator", "administrator"]) await withTelegram(async () => expect(await fileReport(dm, "it broke")).toMatch(/^Logged/), { member: status });
    store.rows = [];
    for (const status of ["left", "kicked"]) {
      await withTelegram(async () => expect(await fileReport(dm, "it broke")).toBe("Reports are for the beta testers. Ask in the group if you should be one."), { member: status });
    }
    // Telegram has never heard of them
    await withTelegram(async () => expect(await fileReport(dm, "it broke")).toMatch(/^Reports are for the beta testers/));
    // Telegram didn't say: no guess either way
    await withTelegram(async () => expect(await fileReport(dm, "it broke")).toBe("I couldn’t save that just now. Please tell the team in the chat."), { member: "down" });
    expect(store.rows).toEqual([]);
  });

  it("slows down someone filing many at once", async () => {
    const { fileReport } = await import("@/lib/telegramReports");
    limits.refuse.add("telegram-report");
    expect(await fileReport(bug("/bug again"), "again")).toBe("That’s a lot of reports at once. Give me a few minutes, then send the next one.");
    expect(store.rows).toEqual([]);
  });

  it("says so when it can't be saved, and never logs the report's words", async () => {
    const { fileReport } = await import("@/lib/telegramReports");
    const logged: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
    try {
      for (const kind of ["missing", "broken"] as const) {
        store[kind] = true;
        expect(await fileReport(bug("/bug my seed phrase is hunter2"), "my seed phrase is hunter2")).toBe("I couldn’t save that just now. Please tell the team in the chat.");
        store[kind] = false;
      }
    } finally {
      console.error = realError;
    }
    expect(logged).toHaveLength(2);
    expect(logged.join("\n")).not.toMatch(/hunter2|seed phrase/);
  });
});

describe("the webhook files a /bug", () => {
  const post = (message: TgMessage, updateId: number) =>
    new Request("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "hook-secret" },
      body: JSON.stringify({ update_id: updateId, message }),
    });

  it("and answers with the report's number, as a reply", async () => {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    await withTelegram(async (calls) => {
      expect((await POST(post(bug("/bug the Roll button stays grey"), 1))).status).toBe(200);
      await vi.waitFor(() => expect(calls.length).toBe(1));
      expect(calls[0]).toMatchObject({ method: "sendMessage", body: { chat_id: GROUP, text: "Logged as report #1. Thank you! Only the team sees it.", reply_parameters: { message_id: 77 } } });
      expect(store.rows[0]).toMatchObject({ text: "the Roll button stays grey", chatId: GROUP, messageId: 77 });
    });
  });

  it("typed under a screenshot", async () => {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    await withTelegram(async (calls) => {
      const under: TgMessage = { message_id: 78, from: { id: 5, username: "ann_plays" }, chat: { id: GROUP, type: "supergroup" }, caption: "/bug the card is blank", caption_entities: [{ type: "bot_command", offset: 0, length: 4 }], photo: [{ file_id: "s" }, { file_id: "big" }] };
      await POST(post(under, 2));
      await vi.waitFor(() => expect(calls.length).toBe(1));
      expect(store.rows[0]).toMatchObject({ text: "the card is blank", photoFileId: "big" });
    });
  });
});

describe("telling a reporter it is fixed", () => {
  it("quotes the start of their report, and adds the operator's note", async () => {
    const { fixedText } = await import("@/lib/telegramReports");
    expect(fixedText({ id: 12, text: "the Roll button stays grey" })).toBe("Fixed: report #12 (“the Roll button stays grey”) is fixed in the latest update. Thank you for reporting it!");
    // a long report, over two lines: its first 60 characters on one line, then "…"
    const text = `it broke when I\n${"tapped ".repeat(20)}`;
    const long = fixedText({ id: 3, text }, "  Try it again and tell us.  ");
    const quote = `${text.replace(/\s+/g, " ").slice(0, 60)}…`;
    expect(long).toBe(`Fixed: report #3 (“${quote}”) is fixed in the latest update. Thank you for reporting it!\n\nTry it again and tell us.`);
    expect(quote).toHaveLength(61);
    expect(quote).not.toMatch(/\n/);
  });

  it("follows the house copy rules in everything the bot says", async () => {
    const { fixedText, REPORT_REPLY } = await import("@/lib/telegramReports");
    const all = [REPORT_REPLY.saved(1), REPORT_REPLY.empty, REPORT_REPLY.outsider, REPORT_REPLY.busy, REPORT_REPLY.failed, fixedText({ id: 1, text: "x" }, "y")].join("\n");
    expect(all).not.toMatch(/—/);
    expect(all).not.toMatch(/[A-Za-z]'[A-Za-z]/);
    expect(all).not.toMatch(/@/);
  });
});

describe("what the console's tab may import", () => {
  // The tab is a client component. A VALUE imported from a database module, by it or by a file it
  // takes values from, puts the Postgres driver in the browser bundle and fails the build: #265's
  // first build did. Types are erased, so `import type` is fine.
  it("no value from a database module, directly or through the row helpers", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["src/components/admin/tabs/ReportsTab.tsx", "src/lib/admin/reportRows.ts"]) {
      const valueImports = [...readFileSync(file, "utf8").matchAll(/^import (?!type\b)[^;]*? from "([^"]+)";/gm)].map((m) => m[1]);
      expect(valueImports.filter((from) => /\/db\//.test(from) || /telegramReports|lib\/telegram"?$/.test(from))).toEqual([]);
    }
  });
});

describe("a report in the console", () => {
  const report = (more: Partial<TesterReport> = {}): TesterReport => ({
    id: 4,
    chatId: GROUP,
    messageId: 77,
    reporterId: 5,
    reporterName: "ann_plays",
    text: "the Roll button stays grey\nafter a miss",
    photoFileId: null,
    status: "open",
    createdAt: new Date("2026-11-27T10:00:00Z"),
    updatedAt: new Date("2026-11-27T10:00:00Z"),
    ...more,
  });

  it("links to its message in a supergroup, and to nothing where Telegram has no link", async () => {
    const { messageLink, reportRow } = await import("@/lib/admin/reportRows");
    expect(messageLink(GROUP, 77)).toBe("https://t.me/c/5000000001/77");
    expect(messageLink(-5000000001, 77)).toBeNull(); // a basic group
    expect(messageLink(5, 77)).toBeNull(); // a private chat
    expect(messageLink(GROUP, null)).toBeNull();
    expect(reportRow(report())).toMatchObject({ id: 4, reporter: "ann_plays", status: "open", hasPhoto: false, private: false, link: "https://t.me/c/5000000001/77", at: "2026-11-27T10:00:00.000Z" });
    expect(reportRow(report({ chatId: 5, photoFileId: "f", status: "wibble" }))).toMatchObject({ private: true, hasPhoto: true, link: null, status: "open" });
  });

  it("opens as a public issue with its words and number, and never the reporter's name", async () => {
    const { issueUrl, reportRow } = await import("@/lib/admin/reportRows");
    const url = new URL(issueUrl(reportRow(report())));
    expect(`${url.origin}${url.pathname}`).toBe("https://github.com/starl3xx/lexigotchi/issues/new");
    expect(url.searchParams.get("title")).toBe("the Roll button stays grey after a miss");
    expect(url.searchParams.get("body")).toBe("the Roll button stays grey\nafter a miss\n\nBeta report #4");
    expect(url.toString()).not.toMatch(/ann_plays/);
  });
});

describe("the console's reports route", () => {
  const get = () => new Request("http://localhost/api/admin/reports");
  const post = (body: unknown) => new Request("http://localhost/api/admin/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const seed = () =>
    store.rows.push({ id: 1, chatId: GROUP, messageId: 77, reporterId: 5, reporterName: "ann_plays", text: "the Roll button stays grey", photoFileId: "f1", status: "open", createdAt: new Date("2026-11-27T10:00:00Z"), updatedAt: new Date("2026-11-27T10:00:00Z") });

  it("is gated: nothing is read, moved, or sent without an operator's credential", async () => {
    const { GET, POST } = await import("@/app/api/admin/reports/route");
    const photo = await import("@/app/api/admin/reports/photo/route");
    seed();
    gate.ok = false;
    await withTelegram(async (calls) => {
      for (const res of [await GET(get()), await POST(post({ id: 1, status: "fixed" })), await photo.GET(new Request("http://localhost/api/admin/reports/photo?id=1"))]) {
        expect(res.status).toBe(401);
        expect(res.headers.get("cache-control")).toBe("no-store");
      }
      expect(calls).toEqual([]);
    });
    expect(store.rows[0].status).toBe("open");
  });

  it("lists the reports, newest first, never cached; and says when the table isn't there yet", async () => {
    const { GET } = await import("@/app/api/admin/reports/route");
    seed();
    store.rows.push({ ...store.rows[0], id: 2, text: "second", photoFileId: null });
    const res = await GET(get());
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, ready: true });
    expect(body.reports.map((r: { id: number }) => r.id)).toEqual([2, 1]);
    expect(body.reports[1]).toMatchObject({ reporter: "ann_plays", hasPhoto: true, link: "https://t.me/c/5000000001/77" });
    store.missing = true;
    expect(await (await GET(get())).json()).toEqual({ ok: true, ready: false, reports: [] });
    store.missing = false;
    store.broken = true;
    expect((await GET(get())).status).toBe(503);
  });

  it("marking one fixed tells its reporter, as a reply to the report, exactly once", async () => {
    const { POST } = await import("@/app/api/admin/reports/route");
    seed();
    await withTelegram(async (calls) => {
      const first = await (await POST(post({ id: 1, status: "fixed", note: "Try it again." }))).json();
      expect(first).toMatchObject({ ok: true, told: true, report: { id: 1, status: "fixed" } });
      expect(calls).toEqual([
        {
          method: "sendMessage",
          body: {
            chat_id: GROUP,
            text: "Fixed: report #1 (“the Roll button stays grey”) is fixed in the latest update. Thank you for reporting it!\n\nTry it again.",
            link_preview_options: { is_disabled: true },
            reply_parameters: { message_id: 77, allow_sending_without_reply: true },
          },
        },
      ]);
      // a second tap, or a second operator: already fixed, nobody is told again
      expect(await (await POST(post({ id: 1, status: "fixed" }))).json()).toMatchObject({ ok: true, told: null });
      expect(calls).toHaveLength(1);
    });
  });

  it("closing or reopening one tells nobody", async () => {
    const { POST } = await import("@/app/api/admin/reports/route");
    seed();
    await withTelegram(async (calls) => {
      expect(await (await POST(post({ id: 1, status: "closed" }))).json()).toMatchObject({ ok: true, told: null, report: { status: "closed" } });
      expect(await (await POST(post({ id: 1, status: "open" }))).json()).toMatchObject({ ok: true, told: null, report: { status: "open" } });
      expect(calls).toEqual([]);
    });
  });

  it("stays fixed when the bot can't tell the reporter, and says why", async () => {
    const { POST } = await import("@/app/api/admin/reports/route");
    seed();
    await withTelegram(async () => {
      const res = await (await POST(post({ id: 1, status: "fixed" }))).json();
      expect(res).toMatchObject({ ok: true, told: false, tellError: "sendMessage: Forbidden: bot was blocked by the user", report: { status: "fixed" } });
    }, { refuseSend: "Forbidden: bot was blocked by the user" });
    // with no bot on this deployment
    store.rows[0].status = "open";
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect(await (await POST(post({ id: 1, status: "fixed" }))).json()).toMatchObject({ ok: true, told: false, report: { status: "fixed" } });
  });

  it("refuses a request that names no report or no real status", async () => {
    const { POST } = await import("@/app/api/admin/reports/route");
    seed();
    for (const body of [{}, { id: "1", status: "fixed" }, { id: 1.5, status: "fixed" }, { id: 0, status: "fixed" }, { id: 1, status: "deleted" }, null]) {
      expect((await POST(post(body))).status).toBe(400);
    }
    expect((await POST(post({ id: 99, status: "fixed" }))).status).toBe(404);
    expect(store.rows[0].status).toBe("open");
  });

  it("serves a report's screenshot through the bot, never cached, and 404s a report without one", async () => {
    const { GET } = await import("@/app/api/admin/reports/photo/route");
    seed();
    await withTelegram(async (calls) => {
      const res = await GET(new Request("http://localhost/api/admin/reports/photo?id=1"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/jpeg");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([255, 216, 255]));
      expect(calls.map((c) => c.method)).toEqual(["getFile", "file_1.jpg"]);
    });
    store.rows[0].photoFileId = null;
    expect((await GET(new Request("http://localhost/api/admin/reports/photo?id=1"))).status).toBe(404);
    expect((await GET(new Request("http://localhost/api/admin/reports/photo?id=abc"))).status).toBe(400);
  });
});
