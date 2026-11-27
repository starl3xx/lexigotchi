/**
 * Linking a Telegram account to a profile (lib/telegramLink, /api/profile/telegram), and the
 * reminders that then come as a Telegram message (lib/notify/telegram). What matters most: a link
 * is made only by the profile's own single-use code, and a reminder is sent once, only to a linked
 * player, and never again to someone who blocked the bot.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TgMessage } from "@/lib/telegram";

// The link store, in memory.
const db = vi.hoisted(() => ({
  codes: new Map<string, { account: string; used: boolean; expired?: boolean }>(),
  links: new Map<string, { telegramId: number; name: string }>(),
  missing: false,
  broken: false,
  ready: true,
}));
vi.mock("@/lib/db/telegramLinks", () => {
  const fail = () => {
    if (db.missing) throw Object.assign(new Error("Failed query"), { cause: { code: "42P01" } });
    if (db.broken) throw new Error("connection refused");
  };
  return {
    TELEGRAM_CODE_TTL_MS: 15 * 60_000,
    createTelegramCode: async (account: string) => {
      fail();
      const code = `code_${db.codes.size + 1}-abcdefghijklmnop`;
      db.codes.set(code, { account: account.toLowerCase(), used: false });
      return { code, expiresAt: new Date("2026-11-27T10:15:00Z") };
    },
    consumeTelegramCode: async (code: string) => {
      fail();
      const c = db.codes.get(code);
      if (!c || c.used || c.expired) return null;
      c.used = true;
      return c.account;
    },
    linkTelegram: async (account: string, telegramId: number, name: string) => {
      fail();
      for (const [a, l] of db.links) if (a === account.toLowerCase() || l.telegramId === telegramId) db.links.delete(a);
      db.links.set(account.toLowerCase(), { telegramId, name });
    },
    unlinkTelegram: async (account: string) => {
      fail();
      return db.links.delete(account.toLowerCase());
    },
    unlinkTelegramId: async (telegramId: number) => {
      fail();
      for (const [a, l] of db.links) if (l.telegramId === telegramId) return db.links.delete(a);
      return false;
    },
    telegramLinkOf: async (account: string) => {
      if (db.missing) return null;
      fail();
      const l = db.links.get(account.toLowerCase());
      return l ? { account: account.toLowerCase(), telegramId: l.telegramId, name: l.name, linkedAt: new Date() } : null;
    },
    telegramChats: async (accounts: readonly string[]) => {
      if (db.missing) return new Map();
      fail();
      return new Map(accounts.flatMap((a) => (db.links.has(a.toLowerCase()) ? [[a.toLowerCase(), db.links.get(a.toLowerCase())!.telegramId] as const] : [])));
    },
    telegramLinksReady: async () => db.ready,
    allTelegramLinks: async () => [...db.links].map(([account, l]) => ({ account, ...l, linkedAt: new Date() })),
  };
});

const session = vi.hoisted(() => ({ account: null as string | null, profiles: true }));
vi.mock("@/lib/profile/account", () => ({ sessionAccountOf: async () => session.account }));
vi.mock("@/lib/profile/session", async (orig) => ({ ...(await orig<typeof import("@/lib/profile/session")>()), profilesEnabled: () => session.profiles }));

const limits = vi.hoisted(() => ({ refuse: new Set<string>() }));
vi.mock("@/lib/ratelimit", () => ({ allow: async (kind: string) => !limits.refuse.has(kind) }));

const ACCOUNT = "0xabc0000000000000000000000000000000000001";
const env = { TELEGRAM_BOT_TOKEN: "123:test", TELEGRAM_CHAT_ID: "-1005000000001", TELEGRAM_WEBHOOK_SECRET: "hook-secret" };

/** A command typed in a private chat with the bot, as Telegram marks it. */
const dm = (text: string, more: Partial<TgMessage> = {}): TgMessage => ({
  message_id: 7,
  from: { id: 555, first_name: "Ann", username: "ann_plays" },
  chat: { id: 555, type: "private" },
  text,
  entities: [{ type: "bot_command", offset: 0, length: text.split(/\s/)[0].length }],
  ...more,
});

beforeEach(() => {
  // every test starts from this file's settings: one test's "production" must not reach the next
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  db.codes.clear();
  db.links.clear();
  db.missing = false;
  db.broken = false;
  db.ready = true;
  session.account = ACCOUNT;
  session.profiles = true;
  limits.refuse.clear();
});

describe("the bot links whoever presses Start on a profile's own link", () => {
  it("links that Telegram account to the code's profile, once", async () => {
    const { linkFromStart } = await import("@/lib/telegramLink");
    db.codes.set("AbCdEf0123456789_-xyz", { account: ACCOUNT, used: false });
    expect(await linkFromStart(dm("/start AbCdEf0123456789_-xyz"), "AbCdEf0123456789_-xyz")).toBe(
      "Linked to your Lexigotchi profile (0xabc0…0001). Your reminders will come here from now on.\n\nChoose which ones in your profile, in the game. Send /unlink to stop them.",
    );
    expect(db.links.get(ACCOUNT)).toEqual({ telegramId: 555, name: "ann_plays" });
    // the same link pressed again, by anyone: used up
    const again = await linkFromStart(dm("/start AbCdEf0123456789_-xyz", { from: { id: 666, first_name: "Eve" }, chat: { id: 666, type: "private" } }), "AbCdEf0123456789_-xyz");
    expect(again).toBe("That link has expired, or was used already. Open your profile in the game and tap Link Telegram again.");
    expect(db.links.get(ACCOUNT)?.telegramId).toBe(555);
  });

  it("takes the place of an older link on either side", async () => {
    const { linkFromStart } = await import("@/lib/telegramLink");
    const other = "0xdef0000000000000000000000000000000000002";
    db.links.set(other, { telegramId: 555, name: "ann_plays" }); // this Telegram account named another profile
    db.links.set(ACCOUNT, { telegramId: 111, name: "old_phone" }); // this profile had another Telegram account
    db.codes.set("code-0123456789abcdef", { account: ACCOUNT, used: false });
    await linkFromStart(dm("/start code-0123456789abcdef"), "code-0123456789abcdef");
    expect([...db.links]).toEqual([[ACCOUNT, { telegramId: 555, name: "ann_plays" }]]);
  });

  it("refuses an expired, unknown, or misshapen code, and never looks up a misshapen one", async () => {
    const { linkFromStart } = await import("@/lib/telegramLink");
    const stale = "That link has expired, or was used already. Open your profile in the game and tap Link Telegram again.";
    db.codes.set("expired-0123456789abc", { account: ACCOUNT, used: false, expired: true });
    expect(await linkFromStart(dm("/start expired-0123456789abc"), "expired-0123456789abc")).toBe(stale);
    expect(await linkFromStart(dm("/start nobody-made-this-code1"), "nobody-made-this-code1")).toBe(stale);
    db.broken = true; // a lookup now would throw: a misshapen code must be refused before it
    for (const bad of ["short", "has spaces in it right here", "semi;colon;0123456789abc", "x".repeat(65)]) expect(await linkFromStart(dm(`/start ${bad}`), bad)).toBe(stale);
    expect(db.links.size).toBe(0);
  });

  it("is the greeting's business when there is no code, and a private chat's only", async () => {
    const { linkFromStart } = await import("@/lib/telegramLink");
    expect(await linkFromStart(dm("/start"), "")).toBeNull();
    db.codes.set("code-0123456789abcdef", { account: ACCOUNT, used: false });
    const inGroup = dm("/start code-0123456789abcdef", { chat: { id: -1005000000001, type: "supergroup" } });
    expect(await linkFromStart(inGroup, "code-0123456789abcdef")).toBe("Send me that in a private chat.");
    // the code wasn't spent on the refusal
    expect(db.codes.get("code-0123456789abcdef")?.used).toBe(false);
  });

  it("says so when it can't link, and names the Telegram account by first name when there is no username", async () => {
    const { linkFromStart } = await import("@/lib/telegramLink");
    db.codes.set("code-0123456789abcdef", { account: ACCOUNT, used: false });
    await linkFromStart(dm("/start code-0123456789abcdef", { from: { id: 9, first_name: "Bo" } }), "code-0123456789abcdef");
    expect(db.links.get(ACCOUNT)).toEqual({ telegramId: 9, name: "Bo" });
    db.broken = true;
    const realError = console.error;
    console.error = () => {};
    try {
      expect(await linkFromStart(dm("/start code-zzzz0123456789ab"), "code-zzzz0123456789ab")).toBe("I couldn’t link you just now. Please try again in a minute.");
    } finally {
      console.error = realError;
    }
  });

  it("unlinks on /unlink, in a private chat", async () => {
    const { unlinkFrom } = await import("@/lib/telegramLink");
    db.links.set(ACCOUNT, { telegramId: 555, name: "ann_plays" });
    expect(await unlinkFrom(dm("/unlink", { chat: { id: -1005000000001, type: "supergroup" } }))).toBe("Send me that in a private chat.");
    expect(db.links.size).toBe(1);
    expect(await unlinkFrom(dm("/unlink"))).toBe("Unlinked. I won’t send reminders here any more.");
    expect(db.links.size).toBe(0);
    expect(await unlinkFrom(dm("/unlink"))).toBe("This Telegram account isn’t linked to a profile. Open your profile in the game and tap Link Telegram.");
  });

  it("follows the house copy rules", async () => {
    const { LINK_REPLY } = await import("@/lib/telegramLink");
    const all = [LINK_REPLY.linked(ACCOUNT), LINK_REPLY.stale, LINK_REPLY.failed, LINK_REPLY.unlinked, LINK_REPLY.notLinked, LINK_REPLY.privateOnly].join("\n");
    expect(all).not.toMatch(/—/);
    expect(all).not.toMatch(/[A-Za-z]'[A-Za-z]/);
    expect(all).not.toMatch(/@/);
  });
});

describe("the webhook", () => {
  const post = (message: TgMessage, updateId: number) =>
    new Request("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "hook-secret" },
      body: JSON.stringify({ update_id: updateId, message }),
    });

  it("links on /start with a code, greets on a plain /start, and unlinks on /unlink", async () => {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const sent: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      if (!String(url).includes("api.telegram.org")) throw new Error(`unexpected fetch: ${url}`);
      sent.push(JSON.parse(String(init?.body)).text);
      return new Response(JSON.stringify({ ok: true }));
    }) as typeof fetch;
    try {
      db.codes.set("code-0123456789abcdef", { account: ACCOUNT, used: false });
      await POST(post(dm("/start code-0123456789abcdef"), 1));
      await vi.waitFor(() => expect(sent.length).toBe(1));
      expect(sent[0]).toMatch(/^Linked to your Lexigotchi profile \(0xabc0…0001\)\./);
      await POST(post(dm("/start"), 2));
      await vi.waitFor(() => expect(sent.length).toBe(2));
      expect(sent[1]).toMatch(/^HEYOO! I’m the Lexigotchi bot\./);
      await POST(post(dm("/unlink"), 3));
      await vi.waitFor(() => expect(sent.length).toBe(3));
      expect(sent[2]).toBe("Unlinked. I won’t send reminders here any more.");
      expect(db.links.size).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("the profile's Telegram route", () => {
  const call = (method: string) => new Request("http://localhost/api/profile/telegram", { method });

  it("is dark without profiles or the bot, and needs the profile's session", async () => {
    const route = await import("@/app/api/profile/telegram/route");
    session.profiles = false;
    for (const res of [await route.GET(call("GET")), await route.POST(call("POST")), await route.DELETE(call("DELETE"))]) expect(res.status).toBe(404);
    session.profiles = true;
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect((await route.POST(call("POST"))).status).toBe(404);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:test");
    session.account = null;
    for (const res of [await route.GET(call("GET")), await route.POST(call("POST")), await route.DELETE(call("DELETE"))]) expect(res.status).toBe(401);
    expect(db.codes.size).toBe(0);
  });

  it("makes a start link that carries a single-use code Telegram will accept", async () => {
    const { POST } = await import("@/app/api/profile/telegram/route");
    const res = await POST(call("POST"));
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, expiresAt: "2026-11-27T10:15:00.000Z" });
    const url = new URL(body.url);
    expect(`${url.origin}${url.pathname}`).toBe("https://t.me/lexigotchi_bot");
    const code = url.searchParams.get("start")!;
    // Telegram allows A-Z, a-z, 0-9, "_" and "-" in a start link, up to 64 characters.
    expect(code).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(db.codes.get(code)).toEqual({ account: ACCOUNT, used: false });
  });

  it("says whether the profile is linked, without ever giving a code, and unlinks", async () => {
    const { GET, DELETE } = await import("@/app/api/profile/telegram/route");
    expect(await (await GET(call("GET"))).json()).toEqual({ ok: true, linked: null });
    db.links.set(ACCOUNT, { telegramId: 555, name: "ann_plays" });
    db.codes.set("code-0123456789abcdef", { account: ACCOUNT, used: false });
    const got = await (await GET(call("GET"))).json();
    expect(got).toEqual({ ok: true, linked: { name: "ann_plays" } });
    expect(JSON.stringify(got)).not.toMatch(/555|code-/);
    expect(await (await DELETE(call("DELETE"))).json()).toEqual({ ok: true, linked: null });
    expect(db.links.size).toBe(0);
  });

  it("answers not_configured before the migration, and slows a flood", async () => {
    const { GET, POST } = await import("@/app/api/profile/telegram/route");
    db.missing = true;
    expect(await (await GET(call("GET"))).json()).toEqual({ ok: true, linked: null });
    const res = await POST(call("POST"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "not_configured" });
    db.missing = false;
    limits.refuse.add("profile");
    expect((await POST(call("POST"))).status).toBe(429);
  });

  it("is offered by the profile's config only where the bot is set up and its tables exist", async () => {
    const { GET } = await import("@/app/api/profile/config/route");
    const telegram = async () => ((await (await GET()).json()) as { telegram?: boolean }).telegram;
    expect(await telegram()).toBe(true);
    db.ready = false;
    expect(await telegram()).toBe(false);
    db.ready = true;
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    expect(await telegram()).toBe(false);
    vi.stubEnv("TELEGRAM_CHAT_ID", "-1005000000001");
    session.profiles = false;
    expect(await telegram()).toBe(false);
  });
});

describe("a reminder as a Telegram message", () => {
  const note = { title: "Your free letter is ready", body: "Come see who showed up." };

  it("is its title, its body, and where to go", async () => {
    const { telegramText } = await import("@/lib/notify/telegram");
    expect(telegramText(note)).toMatch(/^Your free letter is ready\nCome see who showed up\.\n\nhttps?:\/\/[^\s]+\/play$/);
    expect(telegramText({ ...note, targetUrl: "https://lexigotchi.fun/play?tab=bag" })).toBe("Your free letter is ready\nCome see who showed up.\n\nhttps://lexigotchi.fun/play?tab=bag");
  });

  it("is armed only on the production deployment, with the bot's token, and not when muted", async () => {
    const { telegramRemindersOn } = await import("@/lib/notify/telegram");
    const on = (env: Record<string, string | undefined>) => telegramRemindersOn(env as NodeJS.ProcessEnv);
    expect(on({ NODE_ENV: "production", TELEGRAM_BOT_TOKEN: "t" })).toBe(true);
    expect(on({ NODE_ENV: "production", VERCEL_ENV: "production", TELEGRAM_BOT_TOKEN: "t" })).toBe(true);
    expect(on({ NODE_ENV: "production", VERCEL_ENV: "preview", TELEGRAM_BOT_TOKEN: "t" })).toBe(false);
    expect(on({ NODE_ENV: "development", TELEGRAM_BOT_TOKEN: "t" })).toBe(false);
    expect(on({ NODE_ENV: "test", TELEGRAM_BOT_TOKEN: "t" })).toBe(false);
    expect(on({ NODE_ENV: "production" })).toBe(false);
    expect(on({ NODE_ENV: "production", TELEGRAM_BOT_TOKEN: "t", TELEGRAM_REMINDERS: "off" })).toBe(false);
  });

  /** Deps that record what happened, in order. `send` answers per chat. */
  function deps(opts: { chats?: Record<string, number>; claim?: Record<string, "claimed" | "taken" | "unavailable">; send?: (chat: number) => void } = {}) {
    const log: string[] = [];
    const reached: string[] = [];
    return {
      log,
      reached,
      d: {
        chats: async (accounts: readonly string[]) => new Map(accounts.flatMap((a) => (opts.chats?.[a] !== undefined ? [[a, opts.chats[a]] as const] : []))),
        claim: async (account: string, mark: string) => {
          const res = opts.claim?.[account] ?? "claimed";
          log.push(`claim ${account} ${mark}: ${res}`);
          return res;
        },
        release: async (account: string, mark: string) => void log.push(`release ${account} ${mark}`),
        send: async (chat: number, text: string) => {
          log.push(`send ${chat} ${text.split("\n")[0]}`);
          opts.send?.(chat);
        },
        forget: async (chat: number) => void log.push(`forget ${chat}`),
        onReached: (account: string) => void reached.push(account),
      },
    };
  }
  const notes = (accounts: string[]) => accounts.map((account) => ({ account, note, mark: "daily-20784" }));

  it("goes only to a linked player, with the mark claimed before the send", async () => {
    const { telegramNotes } = await import("@/lib/notify/telegram");
    const t = deps({ chats: { "0xa": 11 } });
    expect(await telegramNotes(notes(["0xa", "0xb"]), t.d)).toEqual({ sent: 1, skipped: 0, failed: 0, dropped: 0, gone: 0 });
    expect(t.log).toEqual(["claim 0xa daily-20784: claimed", "send 11 Your free letter is ready"]);
    expect(t.reached).toEqual(["0xa"]);
  });

  it("is sent once: a taken mark, or no mark to keep, sends nothing", async () => {
    const { telegramNotes } = await import("@/lib/notify/telegram");
    const t = deps({ chats: { "0xa": 11, "0xb": 22 }, claim: { "0xa": "taken", "0xb": "unavailable" } });
    expect(await telegramNotes(notes(["0xa", "0xb"]), t.d)).toEqual({ sent: 0, skipped: 2, failed: 0, dropped: 0, gone: 0 });
    expect(t.log.filter((l) => l.startsWith("send"))).toEqual([]);
    expect(t.reached).toEqual([]);
  });

  it("unlinks someone who blocked the bot, and gives the mark back on any clear refusal", async () => {
    const { telegramNotes } = await import("@/lib/notify/telegram");
    const t = deps({
      chats: { "0xa": 11, "0xb": 22, "0xc": 33 },
      send: (chat) => {
        if (chat === 11) throw new Error("sendMessage: Forbidden: bot was blocked by the user");
        if (chat === 22) throw new Error("sendMessage: Bad Request: message is too long");
      },
    });
    expect(await telegramNotes(notes(["0xa", "0xb", "0xc"]), t.d)).toEqual({ sent: 1, skipped: 0, failed: 2, dropped: 0, gone: 1 });
    expect(t.log).toEqual([
      "claim 0xa daily-20784: claimed",
      "send 11 Your free letter is ready",
      "forget 11",
      "release 0xa daily-20784",
      "claim 0xb daily-20784: claimed",
      "send 22 Your free letter is ready",
      "release 0xb daily-20784",
      "claim 0xc daily-20784: claimed",
      "send 33 Your free letter is ready",
    ]);
    // one player's failure is their own
    expect(t.reached).toEqual(["0xc"]);
  });

  it("keeps the mark after a timeout: the message may have arrived, so it isn't sent again", async () => {
    const { telegramNotes } = await import("@/lib/notify/telegram");
    const t = deps({ chats: { "0xa": 11 }, send: () => { throw new Error("The operation was aborted due to timeout"); } });
    expect(await telegramNotes(notes(["0xa"]), t.d)).toEqual({ sent: 0, skipped: 0, failed: 1, dropped: 0, gone: 0 });
    expect(t.log.filter((l) => l.startsWith("release") || l.startsWith("forget"))).toEqual([]);
  });

  it("gives the mark back and stops when Telegram says “not now”: a rate limit delivered nothing", async () => {
    const { telegramNotes } = await import("@/lib/notify/telegram");
    const t = deps({ chats: { "0xa": 11, "0xb": 22 }, send: () => { throw new Error("sendMessage: Too Many Requests: retry after 31"); } });
    expect(await telegramNotes(notes(["0xa", "0xb"]), t.d)).toEqual({ sent: 0, skipped: 0, failed: 1, dropped: 1, gone: 0 });
    // 0xa's mark is free again for the next pass; 0xb was never claimed
    expect(t.log).toEqual(["claim 0xa daily-20784: claimed", "send 11 Your free letter is ready", "release 0xa daily-20784"]);
  });

  it("stops the pass when Telegram doesn't answer: an outage costs one wait, not one per player", async () => {
    const { telegramNotes } = await import("@/lib/notify/telegram");
    // 0xa is sent; Telegram then stops answering at 0xb; 0xc and 0xd are never tried, nor claimed
    const t = deps({ chats: { "0xa": 11, "0xb": 22, "0xc": 33, "0xd": 44 }, send: (chat) => { if (chat !== 11) throw new Error("sendMessage: 502"); } });
    expect(await telegramNotes(notes(["0xa", "0xb", "0xnot-linked", "0xc", "0xd"]), t.d)).toEqual({ sent: 1, skipped: 0, failed: 1, dropped: 2, gone: 0 });
    expect(t.log).toEqual(["claim 0xa daily-20784: claimed", "send 11 Your free letter is ready", "claim 0xb daily-20784: claimed", "send 22 Your free letter is ready"]);
    expect(t.reached).toEqual(["0xa"]);
  });

  it("does nothing where the channel is dark, without reading who is linked", async () => {
    const { tellByTelegram } = await import("@/lib/notify/telegram");
    db.broken = true; // any read of the links would throw
    expect(await tellByTelegram("daily", notes([ACCOUNT]))).toBeNull();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TELEGRAM_REMINDERS", "off");
    expect(await tellByTelegram("daily", notes([ACCOUNT]))).toBeNull();
    vi.stubEnv("TELEGRAM_REMINDERS", "");
    expect(await tellByTelegram("daily", [])).toBeNull();
  });
});

describe("the console's switches", () => {
  it("list Telegram reminders with what they still need, and never a setting's value", async () => {
    const { featureSwitches, telegramRemindersSwitch } = await import("@/lib/admin/switches");
    // here: not production
    expect(telegramRemindersSwitch()).toMatchObject({ key: "telegramReminders", on: false, missing: ["the production deployment"] });
    vi.stubEnv("NODE_ENV", "production");
    expect(telegramRemindersSwitch()).toMatchObject({ on: true, missing: [] });
    vi.stubEnv("TELEGRAM_REMINDERS", "off");
    expect(telegramRemindersSwitch()).toMatchObject({ on: false, missing: ["TELEGRAM_REMINDERS not set to off"] });
    vi.stubEnv("TELEGRAM_REMINDERS", "");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(telegramRemindersSwitch().on).toBe(false);
    vi.stubEnv("VERCEL_ENV", "");
    const all = featureSwitches();
    expect(all.map((s) => s.key)).toContain("telegramReminders");
    expect(JSON.stringify(all)).not.toContain("123:test");
  });
});

describe("the console's Players tab", () => {
  it("says whether a wallet's account linked Telegram, and counts it among the reminders", async () => {
    const { buildPlayerRows, funnelOf } = await import("@/lib/admin/playerRows");
    const base = {
      operators: new Set<string>(),
      contracts: new Set<string>(),
      sightings: [
        { address: "0xa", firstSeenAt: 1, lastSeenAt: 2, daysSeen: 1, firstVia: "web", lastVia: "web", fid: null },
        { address: "0xb", firstSeenAt: 1, lastSeenAt: 2, daysSeen: 1, firstVia: "web", lastVia: "web", fid: null },
        { address: "0xc", firstSeenAt: 1, lastSeenAt: 2, daysSeen: 1, firstVia: "web", lastVia: "web", fid: null },
      ],
      chain: new Map(),
      holdings: { letters: {}, words: [] },
      profiles: [],
      pushBrowsers: new Map<string, number>(),
      listings: new Map<string, number>(),
      // 0xb is linked into 0xa's account
      accountOf: (a: string) => (a === "0xb" ? "0xa" : a),
      faces: {},
    };
    const rows = buildPlayerRows({ ...base, telegram: new Set(["0xa"]) });
    expect(Object.fromEntries(rows.map((r) => [r.address, r.telegram]))).toEqual({ "0xa": true, "0xb": true, "0xc": false });
    expect(funnelOf(rows)).toMatchObject({ telegram: 2, reminders: 2 });
    // with nobody linked (or before the migration)
    expect(buildPlayerRows(base).every((r) => r.telegram === false)).toBe(true);
  });
});
