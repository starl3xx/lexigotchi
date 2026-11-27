/**
 * The beta group's Mythic-word alert (lib/telegramAlerts, /api/cron/telegram-alerts): its words,
 * which claims earn one, and the route's guards. Like the daily recap it posts to real people
 * unasked: production only, once per claim, and never for a claim that is no longer fresh.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MYTHICS, wordsByTier } from "@/lib/economy";

vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532"); // the Sepolia registry has a deployed suite

const MYTHIC = MYTHICS[0];
const COMMON = wordsByTier("Common")[0];

// A chain made of numbers: a block every 2 seconds, and the Claimed logs in `claims`.
const AT = 70_000_000n; // after the suite's deploy block
const T0 = 1_000_000;
const timeOf = (n: bigint) => T0 + Number(n - AT) * 2;
const chain = { latest: AT + 1_000n, claims: [] as { blockNumber: bigint; logIndex: number; transactionHash: string; args: { word: string; owner: string; upperMask: number } }[], down: false };
vi.mock("@/lib/onchain/reads", async (orig) => ({
  ...(await orig<typeof import("@/lib/onchain/reads")>()),
  readChainTime: async () => {
    if (chain.down) throw new Error("rpc down");
    return timeOf(chain.latest);
  },
  getPublicClient: () => ({
    getBlock: async (q?: { blockNumber: bigint }) => {
      if (chain.down) throw new Error("rpc down");
      const number = q?.blockNumber ?? chain.latest;
      return { number, timestamp: BigInt(timeOf(number)) };
    },
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => chain.claims.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock),
  }),
}));

// Names come from the profile lookup; here every wallet is "ann".
vi.mock("@/lib/telegramCommands", async (orig) => ({ ...(await orig<typeof import("@/lib/telegramCommands")>()), nameOf: async () => "ann" }));

const marks = vi.hoisted(() => ({ taken: new Set<string>(), unavailable: false, log: [] as string[] }));
vi.mock("@/lib/db/reminderMarks", () => ({
  hasMark: async (account: string, kind: string, mark: string) => (marks.unavailable ? null : marks.taken.has(`${account} ${kind} ${mark}`)),
  claimMark: async (account: string, kind: string, mark: string) => {
    const key = `${account} ${kind} ${mark}`;
    if (marks.unavailable) return "unavailable";
    if (marks.taken.has(key)) return "taken";
    marks.taken.add(key);
    marks.log.push(`claim ${mark}`);
    return "claimed";
  },
  releaseMark: async (account: string, kind: string, mark: string) => {
    marks.taken.delete(`${account} ${kind} ${mark}`);
    marks.log.push(`release ${mark}`);
  },
}));

/** A claim `minutesAgo` before the chain's latest block. */
const claim = (word: string, minutesAgo: number, tx: string, upperMask = 0) => ({
  blockNumber: chain.latest - BigInt(minutesAgo * 30),
  logIndex: 2,
  transactionHash: tx,
  args: { word, owner: "0xAbC0000000000000000000000000000000000001", upperMask },
});

describe("the alert's words", () => {
  it("name who made the word and how rare it is, under the update posts' own heading", async () => {
    const { alertPost } = await import("@/lib/telegramAlerts");
    const post = alertPost({ word: MYTHIC, upper: [false, false, false, false, false] }, "ann");
    expect(post.text).toBe(["💎 Mythic word", "----------------", `ann just made ${MYTHIC}, one of the game’s 46 Mythic words.`].join("\n"));
    expect(post.text.slice(post.bold[0].offset, post.bold[0].offset + post.bold[0].length)).toBe("Mythic word");
    expect(post.bold).toHaveLength(1);
  });

  it("send the card in the case the word was made in, as the picture that travels alone", async () => {
    const { alertPost } = await import("@/lib/telegramAlerts");
    const url = new URL(alertPost({ word: MYTHIC, upper: [true, false, true, false, false] }, "ann").photoUrl);
    const [a, b, c, d, e] = [...MYTHIC];
    expect(url.pathname).toBe(`/s/${a}${b.toLowerCase()}${c}${d.toLowerCase()}${e.toLowerCase()}/card`);
    expect(url.searchParams.get("saved")).toBe("1");
  });

  it("follow the house copy rules, and never write an “@”", async () => {
    const { alertPost } = await import("@/lib/telegramAlerts");
    const text = alertPost({ word: MYTHIC, upper: [] }, "0x12ab…cdef").text;
    expect(text).not.toMatch(/—/);
    expect(text).not.toMatch(/[A-Za-z]'[A-Za-z]/);
    expect(text).not.toMatch(/@/);
  });
});

describe("which claims earn an alert", () => {
  beforeEach(() => {
    chain.down = false;
    chain.latest = AT + 1_000n;
  });

  it("only a Mythic word", async () => {
    const { isAlertWord, ALERT_TIERS } = await import("@/lib/telegramAlerts");
    expect(ALERT_TIERS).toEqual(["Mythic"]);
    for (const w of MYTHICS) expect(isAlertWord(w)).toBe(true);
    for (const tier of ["Common", "Uncommon", "Rare", "Legendary"] as const) expect(isAlertWord(wordsByTier(tier)[0])).toBe(false);
  });

  it("only a fresh one: half an hour old at most, oldest first, with the case it was made in", async () => {
    const { readAlertClaims, ALERT_WINDOW_S } = await import("@/lib/telegramAlerts");
    expect(ALERT_WINDOW_S).toBe(30 * 60);
    chain.claims = [
      claim(MYTHICS[1], 5, "0xnew", 0b00101), // letters 1 and 3 UPPERCASE
      claim(MYTHICS[2], 31, "0xold"), // made before the window: never announced late
      claim(COMMON, 3, "0xcommon"),
      claim(MYTHICS[0].toLowerCase(), 29, "0xfirst"),
    ];
    const fresh = await readAlertClaims();
    expect(fresh.map((c) => c.word)).toEqual([MYTHICS[0], MYTHICS[1]]);
    expect(fresh[1]).toMatchObject({ owner: "0xabc0000000000000000000000000000000000001", upper: [true, false, true, false, false], transactionHash: "0xnew", logIndex: 2 });
  });

  it("marks each claim by its own event, so a word made again is announced again", async () => {
    const { alertMark } = await import("@/lib/telegramAlerts");
    expect(alertMark({ transactionHash: "0xabc", logIndex: 7 })).toBe("0xabc:7");
  });
});

describe("the alert's route", () => {
  const env = { TELEGRAM_BOT_TOKEN: "123:test", TELEGRAM_CHAT_ID: "-5000000001", TELEGRAM_WEBHOOK_SECRET: "hook-secret", CRON_SECRET: "s3cret" };
  const call = (auth: string | null = "Bearer s3cret") => new Request("http://localhost/api/cron/telegram-alerts", { headers: auth ? { authorization: auth } : {} });

  /**
   * Run the route with the card server and Telegram replaced. `telegram` answers a Telegram call
   * (by method), `card` is whether the card can be drawn.
   */
  async function run(opts: { telegram?: (method: string) => { ok: boolean; description?: string } | Error; card?: boolean; auth?: string | null } = {}) {
    const sent: { method: string; text: string; entities: unknown; photo: boolean }[] = [];
    /** What had been claimed each time a card was asked for. */
    const cards: string[][] = [];
    const real = { fetch: globalThis.fetch, error: console.error, warn: console.warn };
    console.error = () => {};
    console.warn = () => {};
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (!u.includes("api.telegram.org")) {
        if (!u.includes("/card")) throw new Error(`unexpected fetch: ${u}`);
        cards.push([...marks.log]);
        return opts.card === false ? new Response("no", { status: 500 }) : new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
      }
      const method = u.split("/").pop()!;
      const form = init?.body instanceof FormData ? init.body : null;
      const json = form ? null : JSON.parse(String(init?.body));
      sent.push({
        method,
        text: form ? String(form.get("caption")) : json.text,
        entities: form ? JSON.parse(String(form.get("caption_entities"))) : json.entities,
        photo: Boolean(form?.get("photo")),
      });
      const answer = opts.telegram?.(method) ?? { ok: true };
      if (answer instanceof Error) throw answer;
      return new Response(JSON.stringify(answer));
    }) as typeof fetch;
    try {
      const { GET } = await import("@/app/api/cron/telegram-alerts/route");
      const res = await GET(call(opts.auth));
      return { status: res.status, body: (await res.json()) as Record<string, unknown>, sent, cards };
    } finally {
      globalThis.fetch = real.fetch;
      console.error = real.error;
      console.warn = real.warn;
    }
  }

  beforeEach(() => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TELEGRAM_ALERTS", "");
    chain.down = false;
    chain.latest = AT + 1_000n;
    chain.claims = [claim(MYTHIC, 4, "0xa1")];
    marks.taken.clear();
    marks.unavailable = false;
    marks.log = [];
  });

  it("posts a fresh Mythic claim with its card, the heading in bold, and never again", async () => {
    const first = await run();
    expect(first).toMatchObject({ status: 200, body: { ok: true, posted: [MYTHIC] } });
    expect(first.sent).toEqual([
      { method: "sendPhoto", text: `💎 Mythic word\n----------------\nann just made ${MYTHIC}, one of the game’s 46 Mythic words.`, entities: [{ type: "bold", offset: 3, length: 11 }], photo: true },
    ]);
    expect(marks.log).toEqual(["claim 0xa1:2"]);
    // five minutes on, the claim is still fresh, and already told: not even its card is asked for
    expect(await run()).toMatchObject({ status: 200, body: { posted: [] }, sent: [], cards: [] });
  });

  it("claims the mark last: a run that dies while the card is drawn has claimed nothing", async () => {
    const r = await run();
    // when the card was asked for, nothing had been claimed yet
    expect(r.cards).toEqual([[]]);
    expect(marks.log).toEqual(["claim 0xa1:2"]);
  });

  it("posts nothing for other words, or with nothing fresh", async () => {
    chain.claims = [claim(COMMON, 4, "0xc1"), claim(MYTHIC, 45, "0xold")];
    expect(await run()).toMatchObject({ status: 200, body: { ok: true, posted: [] }, sent: [] });
    expect(marks.log).toEqual([]);
  });

  it("posts at most three a run, oldest first; the rest go at the next run", async () => {
    chain.claims = [5, 4, 3, 2, 1].map((minutes, i) => claim(MYTHICS[i], minutes, `0x${i}`));
    expect((await run()).body.posted).toEqual(MYTHICS.slice(0, 3));
    expect((await run()).body.posted).toEqual(MYTHICS.slice(3, 5));
    expect((await run()).body.posted).toEqual([]);
  });

  it("sends the words alone when the card can't be drawn, or Telegram refuses the picture", async () => {
    const noCard = await run({ card: false });
    expect(noCard.sent.map((s) => [s.method, s.photo])).toEqual([["sendMessage", false]]);
    expect(noCard.sent[0].entities).toEqual([{ type: "bold", offset: 3, length: 11 }]);
    marks.taken.clear();
    const refused = await run({ telegram: (m) => (m === "sendPhoto" ? { ok: false, description: "Bad Request: IMAGE_PROCESS_FAILED" } : { ok: true }) });
    expect(refused.sent.map((s) => s.method)).toEqual(["sendPhoto", "sendMessage"]);
    expect(refused.body).toMatchObject({ ok: true, posted: [MYTHIC] });
  });

  it("gives the mark back when Telegram clearly refuses, and keeps it when the post may have gone", async () => {
    const kicked = await run({ telegram: () => ({ ok: false, description: "Forbidden: bot was kicked from the supergroup chat" }) });
    expect(kicked).toMatchObject({ status: 500, body: { ok: false, posted: [] } });
    expect(marks.log).toEqual(["claim 0xa1:2", "release 0xa1:2"]);
    marks.log = [];
    // a timeout on the picture: it may be in the group, so no words after it, and no second try
    const slow = await run({ telegram: () => new Error("The operation was aborted due to timeout") });
    expect(slow.sent.map((s) => s.method)).toEqual(["sendPhoto"]);
    expect(slow.status).toBe(500);
    expect(marks.log).toEqual(["claim 0xa1:2"]);
    expect((await run()).sent).toEqual([]);
  });

  it("posts nothing without a mark to keep, outside production, when muted, or in the wrong hands", async () => {
    marks.unavailable = true;
    expect(await run()).toMatchObject({ status: 200, body: { posted: [] }, sent: [] });
    marks.unavailable = false;
    vi.stubEnv("NODE_ENV", "test");
    expect(await run()).toMatchObject({ body: { skipped: "not_production" }, sent: [] });
    vi.stubEnv("NODE_ENV", "production");
    // a Vercel preview build runs with NODE_ENV "production" too, and may hold the same secrets
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(await run()).toMatchObject({ body: { skipped: "not_production" }, sent: [] });
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TELEGRAM_ALERTS", "off");
    expect(await run()).toMatchObject({ body: { skipped: "off" }, sent: [] });
    vi.stubEnv("TELEGRAM_ALERTS", "");
    expect((await run({ auth: "Bearer wrong" })).status).toBe(401);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect(await run()).toMatchObject({ body: { skipped: "telegram_not_configured" }, sent: [] });
    expect(marks.log).toEqual([]);
  });

  it("says so when the chain can't be read, and claims nothing", async () => {
    chain.down = true;
    expect(await run()).toMatchObject({ status: 503, body: { ok: false, error: "unread" }, sent: [] });
    expect(marks.log).toEqual([]);
  });
});
