/**
 * The beta group's daily recap (lib/telegramRecap, /api/cron/telegram-recap): its words, the read
 * of the day's new words, and the route's guards. It posts to real people unasked, so the guards
 * are the point: production only, once a day, and never before the day's draw.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532"); // the Sepolia registry has a deployed suite

// A chain made of numbers: block n is at `timeOf(n)`, and `claims` are the Claimed logs.
const chain = { latest: 0n, timeOf: (_n: bigint) => 0, claims: [] as { blockNumber: bigint; logIndex: number; args: { word: string } }[], reads: [] as string[] };
vi.mock("@/lib/onchain/reads", async (orig) => ({
  ...(await orig<typeof import("@/lib/onchain/reads")>()),
  getPublicClient: () => ({
    getBlock: async (q?: { blockNumber: bigint }) => {
      const number = q?.blockNumber ?? chain.latest;
      chain.reads.push(`block ${number}`);
      return { number, timestamp: BigInt(chain.timeOf(number)) };
    },
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      chain.reads.push(`logs ${fromBlock}..${toBlock}`);
      return chain.claims.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
    },
  }),
}));

const recap = vi.hoisted(() => ({ next: null as unknown }));
vi.mock("@/lib/telegramRecap", async (orig) => ({
  ...(await orig<typeof import("@/lib/telegramRecap")>()),
  readRecap: async () => recap.next,
}));

const marks = vi.hoisted(() => ({ claim: "claimed" as "claimed" | "taken" | "unavailable", log: [] as string[] }));
vi.mock("@/lib/db/reminderMarks", () => ({
  claimMark: async (account: string, kind: string, mark: string) => {
    marks.log.push(`claim ${account} ${kind} ${mark}`);
    return marks.claim;
  },
  releaseMark: async (account: string, kind: string, mark: string) => void marks.log.push(`release ${account} ${kind} ${mark}`),
}));

const DAY = 86_400;

describe("the recap's words", () => {
  const rolled = { word: "CRANE", winner: null };

  it("says how the draw went and what the pot is now, under the update posts' own heading", async () => {
    const { recapPost } = await vi.importActual<typeof import("@/lib/telegramRecap")>("@/lib/telegramRecap");
    const post = recapPost({ draw: rolled, pot: 143_490_000, made: ["OXBOW", "STORE", "DOUGH"], newTheme: null });
    expect(post.text).toBe(
      [
        "📅 Daily recap",
        "---------------",
        "The secret word was CRANE. Nobody held it staked and fed, so the jackpot rolled over: it is now 143.49M $WORD.",
        "",
        "New words yesterday: OXBOW, STORE, and DOUGH.",
      ].join("\n"),
    );
    // the bold stretch is exactly the label
    expect(post.bold).toEqual([{ offset: 3, length: 11 }]);
    expect(post.text.slice(post.bold[0].offset, post.bold[0].offset + post.bold[0].length)).toBe("Daily recap");
  });

  it("names a winner and what the next jackpot starts at", async () => {
    const { recapPost } = await vi.importActual<typeof import("@/lib/telegramRecap")>("@/lib/telegramRecap");
    const won = recapPost({ draw: { word: "CRANE", winner: { name: "ann", amount: 12_300_000 } }, pot: 1200, made: [], newTheme: null });
    expect(won.text.split("\n")[2]).toBe("ann held CRANE and won the jackpot: 12.30M $WORD. The next one starts at 1.2K $WORD.");
    expect(won.text.split("\n")).toHaveLength(3);
  });

  it("leaves out what it couldn't read, and names no word it couldn't match to the draw", async () => {
    const { recapPost } = await vi.importActual<typeof import("@/lib/telegramRecap")>("@/lib/telegramRecap");
    const line = (f: Parameters<typeof recapPost>[0]) => recapPost(f).text.split("\n").slice(2).join("\n");
    expect(line({ draw: rolled, pot: null, made: null, newTheme: null })).toBe("The secret word was CRANE. Nobody held it staked and fed, so the jackpot rolled over.");
    expect(line({ draw: { word: null, winner: null }, pot: 5, made: null, newTheme: null })).toBe("Nobody held the secret word staked and fed, so the jackpot rolled over: it is now 5 $WORD.");
    expect(line({ draw: { word: null, winner: { name: "0x12ab…cdef", amount: 9 } }, pot: null, made: null, newTheme: null })).toBe("0x12ab…cdef held the secret word and won the jackpot: 9 $WORD.");
    // an empty pot is a fact
    expect(line({ draw: rolled, pot: 0, made: null, newTheme: null })).toContain("it is now 0 $WORD.");
  });

  it("names one, two, or several new words, and counts the rest past eight", async () => {
    const { recapPost } = await vi.importActual<typeof import("@/lib/telegramRecap")>("@/lib/telegramRecap");
    const made = (words: string[]) => recapPost({ draw: rolled, pot: 1, made: words, newTheme: null }).text.split("\n\n")[1];
    expect(made([])).toBeUndefined();
    expect(made(["OXBOW"])).toBe("New word yesterday: OXBOW.");
    expect(made(["OXBOW", "STORE"])).toBe("New words yesterday: OXBOW and STORE.");
    const nine = ["A1", "B2", "C3", "D4", "E5", "F6", "G7", "H8", "I9"];
    expect(made(nine.slice(0, 8))).toBe("New words yesterday: A1, B2, C3, D4, E5, F6, G7, and H8.");
    expect(made(nine)).toBe("New words yesterday: A1, B2, C3, D4, E5, F6, G7, H8, and 1 more.");
  });

  it("names the new bounty theme on a week's first day only", async () => {
    const { recapPost, newThemeOn } = await vi.importActual<typeof import("@/lib/telegramRecap")>("@/lib/telegramRecap");
    const { THEMES } = await import("@/lib/themes");
    // Day 20797 opens period 2971, whose theme is 2971 % 5 = 1.
    expect(newThemeOn(20_797)).toBe(THEMES[1].name);
    for (const d of [20_796, 20_798, 20_800]) expect(newThemeOn(d)).toBeNull();
    const post = recapPost({ draw: rolled, pot: 1, made: [], newTheme: THEMES[1].name });
    expect(post.text.split("\n\n")[1]).toBe(`A new bounty week starts today. The theme: ${THEMES[1].name}.`);
  });

  it("follows the house copy rules, and never writes an “@”", async () => {
    const { recapPost } = await vi.importActual<typeof import("@/lib/telegramRecap")>("@/lib/telegramRecap");
    const { THEMES } = await import("@/lib/themes");
    const all = [
      recapPost({ draw: rolled, pot: 1, made: ["A", "B", "C"], newTheme: THEMES[0].name }),
      recapPost({ draw: { word: null, winner: { name: "ann", amount: 5 } }, pot: 1, made: ["A"], newTheme: null }),
      recapPost({ draw: { word: null, winner: null }, pot: null, made: null, newTheme: null }),
    ]
      .map((p) => p.text)
      .join("\n");
    expect(all).not.toMatch(/—/);
    expect(all).not.toMatch(/[A-Za-z]'[A-Za-z]/);
    expect(all).not.toMatch(/@/);
  });
});

describe("the day's new words", () => {
  const from = 1_000_000;
  const to = from + DAY;
  const claim = (blockNumber: bigint, word: string, logIndex = 0) => ({ blockNumber, logIndex, args: { word } });

  beforeEach(() => {
    chain.reads = [];
  });

  it("are the words claimed inside the day, oldest first, each once", async () => {
    const { readWordsMade } = await vi.importActual<typeof import("@/lib/telegramRecap")>("@/lib/telegramRecap");
    // A block every 2 seconds; block 70,000,000 is at `from`.
    const at = 70_000_000n; // after the suite's deploy block: the read never starts before it
    chain.timeOf = (n) => from + Number(n - at) * 2;
    chain.latest = at + BigInt((DAY + 600) / 2); // ten minutes into the next day
    chain.claims = [
      claim(at - 5n, "EARLY"), // the day before
      claim(at + 30_000n, "STORE", 4),
      claim(at + 30_000n, "OXBOW", 1), // same block, earlier in it
      claim(at, "FIRST"), // exactly at the day's start: in
      claim(at + 40_000n, "oxbow"), // made again after a dissolve: named once
      claim(at + BigInt(DAY / 2), "LATER"), // exactly at the day's end: out
    ];
    expect(await readWordsMade(from, to)).toEqual(["FIRST", "OXBOW", "STORE"]);
  });

  it("moves the start back when blocks have come faster than the last few thousand suggest", async () => {
    const { readWordsMade } = await vi.importActual<typeof import("@/lib/telegramRecap")>("@/lib/telegramRecap");
    // The chain sped up: blocks came every 2 seconds until an hour ago, and every half second since.
    // Measured over the last 5,000 blocks alone, the day's start looks far nearer than it is.
    const fastSince = 70_000_000n;
    const latest = fastSince + 7_200n; // an hour of half-second blocks
    const fastStart = to + 600 - 3600;
    chain.latest = latest;
    chain.timeOf = (n) => (n >= fastSince ? fastStart + Number(n - fastSince) * 0.5 : fastStart - Number(fastSince - n) * 2);
    // a word made in the day's first minute, far before the first guess at a start block
    const morning = fastSince - BigInt((fastStart - (from + 60)) / 2);
    chain.claims = [claim(morning, "DAWNS"), claim(fastSince - 10n, "NIGHT")];
    expect(await readWordsMade(from, to)).toEqual(["DAWNS", "NIGHT"]);
    // it checked the start block's time and read the logs once, from a block before the day began
    const logs = chain.reads.filter((r) => r.startsWith("logs"));
    expect(logs).toHaveLength(1);
    expect(chain.timeOf(BigInt(logs[0].slice(5).split("..")[0]))).toBeLessThan(from);
  });

  it("is unread, not empty, when a day's claims sit in too many blocks to time", async () => {
    const { readWordsMade } = await vi.importActual<typeof import("@/lib/telegramRecap")>("@/lib/telegramRecap");
    const at = 70_000_000n; // after the suite's deploy block: the read never starts before it
    chain.timeOf = (n) => from + Number(n - at) * 2;
    chain.latest = at + BigInt(DAY / 2);
    chain.claims = Array.from({ length: 151 }, (_, i) => claim(at + BigInt(i * 10), `W${i}`));
    await expect(readWordsMade(from, to)).rejects.toThrow("151 blocks to time");
  });
});

describe("the recap's route", () => {
  const env = { TELEGRAM_BOT_TOKEN: "123:test", TELEGRAM_CHAT_ID: "-5000000001", TELEGRAM_WEBHOOK_SECRET: "hook-secret", CRON_SECRET: "s3cret" };
  const call = (auth: string | null = "Bearer s3cret") => new Request("http://localhost/api/cron/telegram-recap", { headers: auth ? { authorization: auth } : {} });
  const ready = { ok: true, day: 20_784, facts: { draw: { word: "CRANE", winner: null }, pot: 5, made: ["OXBOW"], newTheme: null } };

  /** Run the route with Telegram replaced: `answer` is what Telegram says, or an error to throw. */
  async function run(opts: { answer?: { ok: boolean; description?: string } | Error; auth?: string | null } = {}) {
    const sent: Record<string, unknown>[] = [];
    const realFetch = globalThis.fetch;
    const realError = console.error;
    const realLog = console.log;
    console.error = () => {};
    console.log = () => {};
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      if (!String(url).includes("api.telegram.org")) throw new Error(`unexpected fetch: ${url}`);
      sent.push({ method: String(url).split("/").pop(), ...JSON.parse(String(init?.body)) });
      if (opts.answer instanceof Error) throw opts.answer;
      return new Response(JSON.stringify(opts.answer ?? { ok: true, result: { message_id: 1 } }));
    }) as typeof fetch;
    try {
      const { GET } = await import("@/app/api/cron/telegram-recap/route");
      const res = await GET(call(opts.auth));
      return { status: res.status, body: (await res.json()) as Record<string, unknown>, sent };
    } finally {
      globalThis.fetch = realFetch;
      console.error = realError;
      console.log = realLog;
    }
  }

  beforeEach(() => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TELEGRAM_RECAP", "");
    recap.next = ready;
    marks.claim = "claimed";
    marks.log = [];
  });

  it("posts today's recap once the day's mark is claimed, with the heading in bold and no parse mode", async () => {
    const r = await run();
    expect(r).toMatchObject({ status: 200, body: { ok: true, posted: 20_784 } });
    expect(marks.log).toEqual(["claim telegram:group recap 20784"]);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({ method: "sendMessage", chat_id: "-5000000001", entities: [{ type: "bold", offset: 3, length: 11 }], link_preview_options: { is_disabled: true } });
    expect(r.sent[0].text).toContain("The secret word was CRANE.");
    expect(r.sent[0]).not.toHaveProperty("parse_mode");
  });

  it("refuses a caller without the cron secret, and fails closed in production when none is set", async () => {
    expect((await run({ auth: "Bearer wrong" })).status).toBe(401);
    expect((await run({ auth: null })).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect(await run()).toMatchObject({ status: 401, body: { error: "not_configured" }, sent: [] });
  });

  it("never posts outside production, when muted, or without the bot's settings", async () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(await run()).toMatchObject({ body: { skipped: "not_production" }, sent: [] });
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TELEGRAM_RECAP", "off");
    expect(await run()).toMatchObject({ body: { skipped: "off" }, sent: [] });
    vi.stubEnv("TELEGRAM_RECAP", "");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    expect(await run()).toMatchObject({ body: { skipped: "telegram_not_configured" }, sent: [] });
    expect(marks.log).toEqual([]);
  });

  it("waits for the day's draw, claiming nothing, so the later run can post", async () => {
    for (const why of ["draw_not_done", "draw_unread"]) {
      recap.next = { ok: false, why };
      expect(await run()).toMatchObject({ status: 200, body: { ok: true, skipped: why }, sent: [] });
    }
    expect(marks.log).toEqual([]);
  });

  it("posts once a day: a taken mark, or no mark to take, posts nothing", async () => {
    marks.claim = "taken";
    expect(await run()).toMatchObject({ body: { skipped: "already_posted" }, sent: [] });
    marks.claim = "unavailable";
    expect(await run()).toMatchObject({ body: { skipped: "no_mark" }, sent: [] });
  });

  it("gives the mark back when Telegram clearly refuses, and keeps it when the post may have gone", async () => {
    const refused = await run({ answer: { ok: false, description: "Forbidden: bot was kicked from the supergroup chat" } });
    expect(refused).toMatchObject({ status: 500, body: { ok: false, error: "send_failed" } });
    expect(marks.log).toEqual(["claim telegram:group recap 20784", "release telegram:group recap 20784"]);
    marks.log = [];
    // a timeout, or Telegram's own server error: the message may be in the group
    expect((await run({ answer: new Error("The operation was aborted due to timeout") })).status).toBe(500);
    expect((await run({ answer: { ok: false, description: "Internal Server Error" } })).status).toBe(500);
    expect(marks.log).toEqual(["claim telegram:group recap 20784", "claim telegram:group recap 20784"]);
  });
});
