import { describe, expect, it } from "vitest";
import { webhookSecretMatches, welcomeFor, type TgUpdate, type TgUser } from "@/lib/telegram";

const CHAT = "-5000000001";
const join = (members: TgUser[], chatId = -5000000001): TgUpdate => ({
  message: { chat: { id: chatId }, new_chat_members: members },
});

describe("the beta group's welcome", () => {
  it("greets a person who joins by their @username, with the pinned-message pointer", () => {
    const w = welcomeFor(join([{ id: 1, first_name: "DOPAMINE ⌐◨-◨", username: "ann_plays" }]), CHAT);
    expect(w).toEqual({
      caption:
        "HEYOO, @ann_plays! 👋 Welcome to the Lexigotchi beta. The pinned message has everything you need to get set up, then jump in at lexigotchi.fun/play.",
      mentions: [],
    });
  });

  it("greets several people in one message, with the Oxford comma", () => {
    expect(welcomeFor(join([{ id: 1, username: "ann" }, { id: 2, username: "bo" }]), CHAT)?.caption).toMatch(/^HEYOO, @ann and @bo!/);
    const three = welcomeFor(join([{ id: 1, username: "ann" }, { id: 2, first_name: "Bo" }, { id: 3, username: "cy" }]), CHAT)!;
    expect(three.caption).toMatch(/^HEYOO, @ann, Bo, and @cy!/);
    expect(three.mentions).toEqual([{ type: "text_mention", offset: "HEYOO, @ann, ".length, length: 2, user: { id: 2 } }]);
  });

  it("names someone with no username by first name, as a mention of their account; else “there”", () => {
    expect(welcomeFor(join([{ id: 7, first_name: "Ann" }]), CHAT)).toMatchObject({
      caption: expect.stringMatching(/^HEYOO, Ann!/),
      mentions: [{ type: "text_mention", offset: 7, length: 3, user: { id: 7 } }],
    });
    expect(welcomeFor(join([{ id: 1, first_name: "  " }]), CHAT)).toMatchObject({ caption: expect.stringMatching(/^HEYOO, there!/), mentions: [] });
    expect(welcomeFor(join([{ id: 1 }]), CHAT)).toMatchObject({ caption: expect.stringMatching(/^HEYOO, there!/), mentions: [] });
  });

  it("cuts a long name at 40 characters without splitting an emoji, and the mention covers exactly the name", () => {
    const w = welcomeFor(join([{ id: 5, first_name: "🐸".repeat(50) }]), CHAT)!;
    expect(w.caption).toBe(`HEYOO, ${"🐸".repeat(40)}! 👋 Welcome to the Lexigotchi beta. The pinned message has everything you need to get set up, then jump in at lexigotchi.fun/play.`);
    expect(w.caption.slice(w.mentions[0].offset, w.mentions[0].offset + w.mentions[0].length)).toBe("🐸".repeat(40));
  });

  it("never greets a bot (including itself being added), another chat, or an ordinary message", () => {
    expect(welcomeFor(join([{ id: 9, is_bot: true, first_name: "Lexigotchi" }]), CHAT)).toBeNull();
    expect(welcomeFor(join([{ id: 1, first_name: "Ann" }], -42), CHAT)).toBeNull();
    expect(welcomeFor({ message: { chat: { id: -5000000001 } } }, CHAT)).toBeNull();
    expect(welcomeFor({}, CHAT)).toBeNull();
  });

  it("follows the house copy rules", () => {
    const caption = welcomeFor(join([{ id: 1, first_name: "Ann" }]), CHAT)!.caption;
    expect(caption).not.toMatch(/—/);
    expect(caption).not.toMatch(/'/);
  });
});

describe("the webhook secret", () => {
  it("matches only Telegram's exact echo", () => {
    expect(webhookSecretMatches("s3cret-value", "s3cret-value")).toBe(true);
    expect(webhookSecretMatches("s3cret-valuX", "s3cret-value")).toBe(false);
    expect(webhookSecretMatches(null, "s3cret-value")).toBe(false);
    expect(webhookSecretMatches("anything", "")).toBe(false);
  });
});

describe("the webhook route", () => {
  const env = { TELEGRAM_BOT_TOKEN: "123:test", TELEGRAM_CHAT_ID: CHAT, TELEGRAM_WEBHOOK_SECRET: "hook-secret" };
  const post = (body: unknown, secret?: string) =>
    new Request("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) },
      body: JSON.stringify(body),
    });

  async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
    try {
      return await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }

  it("is dark until configured, and refuses a call without Telegram's secret", async () => {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    await withEnv({ TELEGRAM_BOT_TOKEN: undefined, TELEGRAM_CHAT_ID: undefined, TELEGRAM_WEBHOOK_SECRET: undefined }, async () => {
      expect((await POST(post({}))).status).toBe(404);
    });
    await withEnv(env, async () => {
      expect((await POST(post({}, "wrong"))).status).toBe(401);
      expect((await POST(post({}))).status).toBe(401);
    });
  });

  it("sends the HEYOO card with the caption when someone joins, and nothing otherwise", async () => {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push(u.includes("api.telegram.org") ? `telegram ${u.split("/").pop()} ${(init?.body as FormData).get("caption")}` : `card ${u.replace(/^https?:\/\/[^/]+/, "")}`);
      return u.includes("api.telegram.org")
        ? new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } })
        : new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
    }) as typeof fetch;
    try {
      await withEnv(env, async () => {
        const joined = await POST(post({ message: { chat: { id: Number(CHAT) }, new_chat_members: [{ id: 1, first_name: "Ann", username: "ann_plays" }] } }, "hook-secret"));
        expect(joined.status).toBe(200);
        const chatter = await POST(post({ message: { chat: { id: Number(CHAT) } } }, "hook-secret"));
        expect(chatter.status).toBe(200);
      });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls).toEqual([
      // the saved picture: it goes alone, so it carries the game's name in a corner (decisions.md #22)
      "card /s/HEYOO/card?saved=1",
      "telegram sendPhoto HEYOO, @ann_plays! 👋 Welcome to the Lexigotchi beta. The pinned message has everything you need to get set up, then jump in at lexigotchi.fun/play.",
    ]);
  });

  it("sends a mention for someone with no username, and greets them without it if Telegram refuses the mention", async () => {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const sent: (string | null)[] = [];
    const realFetch = globalThis.fetch;
    const realWarn = console.warn;
    console.warn = () => {};
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      if (!String(url).includes("api.telegram.org")) return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
      const entities = (init?.body as FormData).get("caption_entities") as string | null;
      sent.push(entities);
      // Refuse the first try (with the mention), accept the second.
      const ok = sent.length > 1;
      return new Response(JSON.stringify(ok ? { ok } : { ok, description: "Bad Request: can't parse entities" }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      await withEnv(env, async () => {
        const joined = await POST(post({ message: { chat: { id: Number(CHAT) }, new_chat_members: [{ id: 7, first_name: "Ann" }] } }, "hook-secret"));
        expect(joined.status).toBe(200);
      });
    } finally {
      globalThis.fetch = realFetch;
      console.warn = realWarn;
    }
    expect(sent).toEqual([JSON.stringify([{ type: "text_mention", offset: 7, length: 3, user: { id: 7 } }]), null]);
  });

  it("never sends the welcome twice after a failure that isn't a clear refusal (the first may have landed)", async () => {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    let sends = 0;
    const realFetch = globalThis.fetch;
    const realError = console.error;
    console.error = () => {};
    globalThis.fetch = (async (url: string | URL) => {
      if (!String(url).includes("api.telegram.org")) return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
      sends += 1;
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    try {
      await withEnv(env, async () => {
        const joined = await POST(post({ message: { chat: { id: Number(CHAT) }, new_chat_members: [{ id: 7, first_name: "Ann" }] } }, "hook-secret"));
        expect(joined.status).toBe(200);
      });
    } finally {
      globalThis.fetch = realFetch;
      console.error = realError;
    }
    expect(sends).toBe(1);
  });
});
