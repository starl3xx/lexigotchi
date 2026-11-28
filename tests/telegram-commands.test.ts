import { describe, expect, it, vi } from "vitest";
import { commandOf, type TgMessage } from "@/lib/telegram";
import {
  COMMANDS,
  bountyText,
  cardUrlOf,
  drawState,
  helpText,
  jackpotText,
  lastDrawOf,
  parseWordArg,
  shortAddress,
  spanText,
  statusText,
  wordText,
  type HeldWord,
} from "@/lib/telegramCommands";
import { TIER_COUNTS, wordTier } from "@/lib/economy";
import { THEMES } from "@/lib/themes";
import { tokenIdOf } from "@/lib/onchain/tokenId";

const DAY = 86_400;
/** A message that opens with a command, as Telegram marks it. */
const typed = (text: string, more: Partial<TgMessage> = {}): TgMessage => ({
  message_id: 77,
  from: { id: 5, first_name: "Ann" },
  chat: { id: -5000000001, type: "supergroup" },
  text,
  entities: [{ type: "bot_command", offset: 0, length: text.split(/\s/)[0].length }],
  ...more,
});

describe("reading a command", () => {
  it("takes the command a message opens with, and the rest as its words", () => {
    expect(commandOf(typed("/status"))).toEqual({ name: "status", args: "" });
    expect(commandOf(typed("/word  crane  please"))).toEqual({ name: "word", args: "crane  please" });
    expect(commandOf(typed("/Word CRANE"))).toEqual({ name: "word", args: "CRANE" });
  });

  it("takes one addressed to this bot, and leaves one addressed to another", () => {
    expect(commandOf(typed("/status@lexigotchi_bot"), "lexigotchi_bot")).toEqual({ name: "status", args: "" });
    expect(commandOf(typed("/status@Lexigotchi_Bot now"), "lexigotchi_bot")).toEqual({ name: "status", args: "now" });
    expect(commandOf(typed("/status@other_bot"), "lexigotchi_bot")).toBeNull();
  });

  it("reads a command typed under a picture", () => {
    const m: TgMessage = { chat: { id: 1 }, caption: "/bug the roll hangs", caption_entities: [{ type: "bot_command", offset: 0, length: 4 }] };
    expect(commandOf(m)).toEqual({ name: "bug", args: "the roll hangs" });
  });

  it("is null for anything that doesn't open with a command Telegram marked", () => {
    // ordinary talk, a path that only looks like a command, a command later in the sentence
    expect(commandOf({ chat: { id: 1 }, text: "is the game up?" })).toBeNull();
    expect(commandOf({ chat: { id: 1 }, text: "/status" })).toBeNull();
    expect(commandOf({ chat: { id: 1 }, text: "try /status", entities: [{ type: "bot_command", offset: 4, length: 7 }] })).toBeNull();
    expect(commandOf({ chat: { id: 1 }, text: "hi there", entities: [{ type: "bold", offset: 0, length: 2 }] })).toBeNull();
    expect(commandOf({ chat: { id: 1 } })).toBeNull();
    expect(commandOf(undefined)).toBeNull();
  });
});

describe("the command list", () => {
  it("is in the shape Telegram's setMyCommands takes", () => {
    expect(COMMANDS.length).toBeGreaterThan(3);
    for (const c of COMMANDS) {
      expect(Object.keys(c).sort()).toEqual(["command", "description"]);
      expect(c.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.description.length).toBeLessThanOrEqual(256);
    }
    expect(new Set(COMMANDS.map((c) => c.command)).size).toBe(COMMANDS.length);
  });

  it("is what /help lists", () => {
    const help = helpText();
    for (const c of COMMANDS.filter((x) => x.command !== "help")) expect(help).toContain(`/${c.command}: ${c.description}`);
    expect(help.split("\n")[0]).toBe("Here’s what I can do:");
  });
});

describe("a length of time", () => {
  it("is said in its two largest units", () => {
    expect(spanText(2 * DAY + 4 * 3600 + 59)).toBe("2 days 4 h");
    expect(spanText(DAY)).toBe("1 day");
    expect(spanText(3 * 3600 + 12 * 60)).toBe("3 h 12 min");
    expect(spanText(2 * 3600)).toBe("2 h");
    expect(spanText(12 * 60 + 5)).toBe("12 min");
    expect(spanText(30)).toBe("less than a minute");
    expect(spanText(-5)).toBe("less than a minute");
  });
});

describe("/status", () => {
  const live = { network: "Base Sepolia", testnet: true, chainBacked: true };
  const today = 20_800;
  const at = (secondsIntoDay: number) => today * DAY + secondsIntoDay;

  it("says practice mode where nothing is onchain", () => {
    expect(statusText({ ...live, chainBacked: false, chainTime: null, lastDrawDay: null })).toBe("Lexigotchi is in practice mode here: nothing is onchain yet.");
  });

  it("says the game is up and the day's draw is done", () => {
    expect(statusText({ ...live, chainTime: at(3600), lastDrawDay: today })).toBe(
      "Lexigotchi is running on Base Sepolia (a test network).\nThe chain is answering.\nToday’s jackpot draw is done.",
    );
    expect(statusText({ network: "Base", testnet: false, chainBacked: true, chainTime: at(3600), lastDrawDay: today }).split("\n")[0]).toBe("Lexigotchi is running on Base.");
  });

  it("gives the daily run a few minutes after midnight, then says it is behind", () => {
    expect(statusText({ ...live, chainTime: at(4 * 60), lastDrawDay: today - 1 })).toMatch(/Today’s jackpot draw is due any minute\.$/);
    expect(statusText({ ...live, chainTime: at(3600), lastDrawDay: today - 1 })).toMatch(/The daily run is behind: the last jackpot draw was 1 day ago\.$/);
    expect(statusText({ ...live, chainTime: at(4 * 60), lastDrawDay: today - 3 })).toMatch(/the last jackpot draw was 3 days ago\.$/);
    expect(statusText({ ...live, chainTime: at(3600), lastDrawDay: 0 })).toMatch(/The jackpot hasn’t had its first draw yet\.$/);
  });

  it("never guesses: a chain that didn't answer is said, and an unread draw day is left out", () => {
    expect(statusText({ ...live, chainTime: null, lastDrawDay: today })).toBe(
      "Lexigotchi is running on Base Sepolia (a test network).\nI can’t reach the chain right now, so the game may be slow or stuck.",
    );
    expect(statusText({ ...live, chainTime: at(3600), lastDrawDay: null })).toBe("Lexigotchi is running on Base Sepolia (a test network).\nThe chain is answering.");
  });
});

describe("/jackpot", () => {
  const today = 20_800;
  const now = today * DAY + 20 * 3600 + 48 * 60; // 20:48 UTC
  const drawn = { lastDrawDay: today };

  it("says the pot, when the next word comes, and how the last draw went", () => {
    expect(jackpotText({ pot: 1_204_000, last: { word: "CRANE", winner: null }, ...drawn }, now)).toBe(
      [
        "The jackpot is 1.20M $WORD.",
        "The next secret word is revealed just after midnight UTC, in about 3 h 12 min.",
        "Last draw: CRANE. Nobody held it staked and awake, so the pot rolled over.",
        "Every word that is staked and awake is in the running.",
      ].join("\n"),
    );
    expect(jackpotText({ pot: 512, last: { word: "CRANE", winner: { name: "ann", amount: 96_300 } }, ...drawn }, now)).toContain("Last draw: CRANE. ann held it and won 96.3K $WORD.");
  });

  it("agrees with /status in the minutes after midnight: the next word is today's until the draw has run", () => {
    const justAfter = (today + 1) * DAY + 2 * 60; // 00:02 UTC, yesterday's draw still the last
    const facts = { pot: 5, last: { word: "CRANE", winner: null }, lastDrawDay: today };
    expect(drawState(justAfter, today)).toEqual({ state: "due", behind: 1 });
    expect(jackpotText(facts, justAfter)).toContain("Today’s secret word is due any minute.");
    expect(jackpotText(facts, justAfter)).not.toMatch(/in about/);
    // an hour on with no draw, both say the run is behind
    expect(drawState(justAfter + 3600, today).state).toBe("behind");
    expect(jackpotText(facts, justAfter + 3600)).toContain("Today’s draw is late: the daily run is behind.");
    // and once it has run, the countdown is to tomorrow's
    expect(jackpotText({ ...facts, lastDrawDay: today + 1 }, justAfter)).toContain("in about 23 h 58 min.");
    // an unread draw day guesses nothing: the plain countdown
    expect(jackpotText({ ...facts, lastDrawDay: null }, justAfter)).toContain("in about 23 h 58 min.");
  });

  it("names no word it couldn't match to the draw", () => {
    expect(jackpotText({ pot: 1, last: { word: null, winner: null }, ...drawn }, now)).toContain("Last draw: nobody held the word staked and awake, so the pot rolled over.");
    expect(jackpotText({ pot: 1, last: { word: null, winner: { name: "0x12ab…cdef", amount: 5 } }, ...drawn }, now)).toContain("Last draw: 0x12ab…cdef held the word and won 5 $WORD.");
  });

  it("says there has been no draw, and leaves out what it couldn't read", () => {
    expect(jackpotText({ pot: 0, last: null, lastDrawDay: 0 }, now)).toContain("There hasn’t been a draw yet.");
    const unread = jackpotText({ pot: null, last: undefined, lastDrawDay: null }, now);
    expect(unread).toContain("I can’t read the pot right now.");
    expect(unread).not.toMatch(/Last draw|hasn’t been a draw/);
    // an empty pot is a fact, not a failed read
    expect(jackpotText({ pot: 0, last: undefined, ...drawn }, now)).toContain("The jackpot is 0 $WORD.");
  });
});

describe("the last draw", () => {
  const draw = (block: bigint, tx: string, word: string, winner?: string) => ({ blockNumber: block, logIndex: 3, transactionHash: tx, tokenId: tokenIdOf(word), ...(winner ? { winner, amount: 7n * 10n ** 18n } : {}) });

  it("is the latest one, with the word revealed in its own transaction", () => {
    const draws = [draw(30n, "0xc", "CRANE"), draw(10n, "0xa", "ABOUT", "0xWinner"), draw(20n, "0xb", "OTHER")];
    const reveals = [{ transactionHash: "0xa", word: "ABOUT" }, { transactionHash: "0xc", word: "crane" }];
    expect(lastDrawOf(draws, reveals)).toEqual({ word: "CRANE", winner: null, amount: null });
    expect(lastDrawOf(draws.slice(1, 2), reveals)).toEqual({ word: "ABOUT", winner: "0xWinner", amount: 7n * 10n ** 18n });
  });

  it("names no word when the reveal is missing or isn't that draw's word", () => {
    expect(lastDrawOf([draw(30n, "0xc", "CRANE")], [])?.word).toBeNull();
    expect(lastDrawOf([draw(30n, "0xc", "CRANE")], [{ transactionHash: "0xc", word: "ABOUT" }])?.word).toBeNull();
    expect(lastDrawOf([draw(30n, "0xc", "CRANE")], [{ transactionHash: "0xd", word: "CRANE" }])?.word).toBeNull();
  });

  it("is null when there has never been one", () => {
    expect(lastDrawOf([], [{ transactionHash: "0xa", word: "CRANE" }])).toBeNull();
  });
});

describe("/bounty", () => {
  it("names the week's theme, the pool, and when the week ends", () => {
    // Period 2971 (days 20797 to 20803): theme 2971 % 5 = 1.
    const now = 20_800 * DAY + 12 * 3600;
    expect(bountyText(310_000, now)).toBe(
      [
        `This week’s bounty theme: ${THEMES[1].name}.`,
        "The pool is 310.0K $WORD.",
        "The week ends in 3 days 12 h. Every matching word that is staked and not asleep then shares the pool.",
      ].join("\n"),
    );
  });

  it("leaves the pool out when it couldn't be read", () => {
    expect(bountyText(null, 20_800 * DAY)).not.toMatch(/pool is/);
    expect(bountyText(0, 20_800 * DAY)).toContain("The pool is 0 $WORD.");
  });
});

describe("/word", () => {
  const held: HeldWord = { holder: "ann", staked: true, upper: [true, true, true, false, false], level: 0, daysUnfed: 0, number: 12 };
  const first = `CRANE is one of ${TIER_COUNTS[wordTier("CRANE")].toLocaleString("en-US")} ${wordTier("CRANE")} words.`;

  it("finds the word in what was typed, and repeats nothing that isn't plain letters", () => {
    expect(parseWordArg("")).toEqual({ kind: "none" });
    expect(parseWordArg("  crane now")).toEqual({ kind: "ok", word: "CRANE" });
    expect(parseWordArg("zzzzz")).toEqual({ kind: "unknown", shown: "ZZZZZ" });
    expect(parseWordArg("http://x.example")).toEqual({ kind: "unknown", shown: null });
    expect(parseWordArg("a".repeat(40))).toEqual({ kind: "unknown", shown: null });
  });

  it("says who holds it, how many letters are UPPERCASE, and its card number", () => {
    expect(wordText("CRANE", held)).toBe([first, "ann holds it, staked.", "3 of its 5 letters are UPPERCASE.", "Card #0012."].join("\n"));
    expect(wordText("CRANE", { ...held, staked: false, upper: [false, false, false, false, false], number: null })).toBe(
      [first, "ann holds it, not staked.", "Its letters are all lowercase."].join("\n"),
    );
    expect(wordText("CRANE", { ...held, upper: [true, true, true, true, true], level: 2 })).toContain("All of its letters are UPPERCASE.\nIt has ascended to Gilded 2.");
  });

  it("says when a staked word is peckish or hungry, and never for one that isn't staked", () => {
    const all = [true, true, true, true, true];
    expect(wordText("CRANE", { ...held, upper: all, daysUnfed: 1 })).toContain("It is sleepy: it earns half until it is woken.");
    expect(wordText("CRANE", { ...held, upper: all, daysUnfed: 3 })).toContain("It is asleep: it earns nothing and sits out the jackpot until it is woken.");
    expect(wordText("CRANE", { ...held, staked: false, daysUnfed: 9 })).not.toMatch(/asleep|sleepy/);
  });

  it("tells only an all-UPPERCASE word what hunger does to its earnings: no other word earns", () => {
    // 3 of 5 raised, and a word whose case couldn't be read
    for (const upper of [held.upper, null]) {
      expect(wordText("CRANE", { ...held, upper, daysUnfed: 1 })).toContain("It is sleepy: wake it before it falls asleep.");
      expect(wordText("CRANE", { ...held, upper, daysUnfed: 3 })).toContain("It is asleep: it sits out the jackpot until it is woken.");
      expect(wordText("CRANE", { ...held, upper, daysUnfed: 3 })).not.toMatch(/earns/);
    }
  });

  it("sends the card in the word's real case, at an address that names its stage", () => {
    const upper = [true, true, true, false, false];
    const plain = cardUrlOf("CRANE", { upper, level: 0 })!;
    expect(new URL(plain).pathname).toBe("/s/CRAne/card");
    expect(new URL(plain).searchParams.get("saved")).toBe("1");
    // a picture is kept for a week under its address: a new stage must be a new address
    const gilded = cardUrlOf("CRANE", { upper: [true, true, true, true, true], level: 2 })!;
    expect(new URL(gilded).searchParams.get("g")).toBe("2");
    expect(gilded).not.toBe(cardUrlOf("CRANE", { upper: [true, true, true, true, true], level: 3 }));
    // no picture for a word whose case couldn't be read
    expect(cardUrlOf("CRANE", { upper: null, level: 2 })).toBeUndefined();
  });

  it("leaves out what it couldn't read, and tells nobody apart from not knowing", () => {
    expect(wordText("CRANE", { ...held, upper: null, level: null, daysUnfed: null, number: null })).toBe([first, "ann holds it, staked."].join("\n"));
    expect(wordText("CRANE", null)).toBe([first, "Nobody holds it right now."].join("\n"));
    expect(wordText("CRANE", undefined)).toBe([first, "I can’t read the chain right now, so I don’t know who holds it."].join("\n"));
    expect(wordText("CRANE", undefined, false)).toBe(first);
  });
});

describe("a wallet with no name", () => {
  it("is shown short", () => expect(shortAddress("0x12ab000000000000000000000000000000cdef")).toBe("0x12ab…cdef"));
});

describe("the webhook route answers commands", () => {
  const CHAT = "-5000000001";
  const env = { TELEGRAM_BOT_TOKEN: "123:test", TELEGRAM_CHAT_ID: CHAT, TELEGRAM_WEBHOOK_SECRET: "hook-secret" };
  const post = (message: TgMessage, updateId = 1) =>
    new Request("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "hook-secret" },
      body: JSON.stringify({ update_id: updateId, message }),
    });

  /** Run `fn` with Telegram's API replaced: every call to it is recorded as [method, body]. */
  async function withTelegram(fn: (sent: [string, Record<string, unknown>][]) => Promise<void>) {
    const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    Object.assign(process.env, env);
    const sent: [string, Record<string, unknown>][] = [];
    const realFetch = globalThis.fetch;
    const realWarn = console.warn;
    console.warn = () => {};
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (!u.includes("api.telegram.org")) throw new Error(`unexpected fetch: ${u}`);
      sent.push([u.split("/").pop()!, JSON.parse(String(init?.body))]);
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      await fn(sent);
    } finally {
      globalThis.fetch = realFetch;
      console.warn = realWarn;
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
  /** Long enough for an answer written after the response to have gone, had there been one. */
  const settle = () => new Promise((r) => setTimeout(r, 50));

  it("answers in the group, as a reply to the message that asked, with no link preview", async () => {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    await withTelegram(async (sent) => {
      expect((await POST(post(typed("/help")))).status).toBe(200);
      await vi.waitFor(() => expect(sent.length).toBe(1));
      expect(sent[0]).toEqual([
        "sendMessage",
        { chat_id: Number(CHAT), text: helpText(), link_preview_options: { is_disabled: true }, reply_parameters: { message_id: 77, allow_sending_without_reply: true } },
      ]);
    });
  });

  it("answers in a private chat, where an unknown command gets the list and /start a greeting", async () => {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    await withTelegram(async (sent) => {
      const dm = { chat: { id: 5, type: "private" } };
      await POST(post(typed("/wibble", dm), 2));
      await vi.waitFor(() => expect(sent.length).toBe(1));
      expect(sent[0][1]).toMatchObject({ chat_id: 5, text: `I don’t know that one.\n\n${helpText()}` });
      await POST(post(typed("/start", dm), 3));
      await vi.waitFor(() => expect(sent.length).toBe(2));
      expect(sent[1][1].text).toBe(`HEYOO! I’m the Lexigotchi bot.\n\n${helpText()}`);
    });
  });

  it("answers /word from the dictionary alone in practice mode, and says when a word isn't in it", async () => {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    await withTelegram(async (sent) => {
      await POST(post(typed("/word crane"), 4));
      await vi.waitFor(() => expect(sent.length).toBe(1));
      expect(sent[0][1].text).toBe(`CRANE is one of ${TIER_COUNTS[wordTier("CRANE")].toLocaleString("en-US")} ${wordTier("CRANE")} words.`);
      await POST(post(typed("/word zzzzz"), 5));
      await vi.waitFor(() => expect(sent.length).toBe(2));
      expect(sent[1][1].text).toBe("ZZZZZ isn’t in the game’s dictionary.");
    });
  });

  it("answers a group admin who posts anonymously (Telegram's stand-in bot, with the group as the sender)", async () => {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    await withTelegram(async (sent) => {
      await POST(post(typed("/help", { from: { id: 1087968824, is_bot: true }, sender_chat: { id: Number(CHAT) } }), 6));
      await vi.waitFor(() => expect(sent.length).toBe(1));
      expect(sent[0][1].text).toBe(helpText());
    });
  });

  it("stays silent for ordinary talk, an unknown command in the group, another group, another bot's command, and a bot", async () => {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    await withTelegram(async (sent) => {
      const quiet: TgMessage[] = [
        { message_id: 1, from: { id: 5 }, chat: { id: Number(CHAT), type: "supergroup" }, text: "is the game up? /status" },
        typed("/wibble"),
        typed("/start"),
        typed("/help", { chat: { id: -42, type: "supergroup" } }),
        typed("/help@other_bot"),
        typed("/help", { from: { id: 9, is_bot: true } }),
        // a channel's post, or an anonymous admin of some other chat
        typed("/help", { from: { id: 136817688, is_bot: true }, sender_chat: { id: -1001 } }),
        typed("/help", { chat: { id: 5, type: "private" }, from: { id: 9, is_bot: true }, sender_chat: { id: 5 } }),
        typed("/help", { from: undefined }),
      ];
      for (const [i, m] of quiet.entries()) expect((await POST(post(m, 100 + i))).status).toBe(200);
      await settle();
      expect(sent).toEqual([]);
    });
  });
});

describe("the bot's words follow the house copy rules", () => {
  it("in every answer", () => {
    const now = 20_800 * DAY + 3600;
    const held: HeldWord = { holder: "ann", staked: true, upper: [true, false, true, false, true], level: 3, daysUnfed: 4, number: 7 };
    const all = [
      helpText(),
      ...COMMANDS.map((c) => c.description),
      statusText({ network: "Base Sepolia", testnet: true, chainBacked: false, chainTime: null, lastDrawDay: null }),
      statusText({ network: "Base Sepolia", testnet: true, chainBacked: true, chainTime: null, lastDrawDay: null }),
      statusText({ network: "Base Sepolia", testnet: true, chainBacked: true, chainTime: now, lastDrawDay: 0 }),
      statusText({ network: "Base Sepolia", testnet: true, chainBacked: true, chainTime: now, lastDrawDay: 20_800 }),
      statusText({ network: "Base Sepolia", testnet: true, chainBacked: true, chainTime: now, lastDrawDay: 20_700 }),
      jackpotText({ pot: null, last: null, lastDrawDay: 0 }, now),
      jackpotText({ pot: 5, last: { word: "CRANE", winner: { name: "ann", amount: 5 } }, lastDrawDay: 20_800 }, now),
      jackpotText({ pot: 5, last: { word: null, winner: null }, lastDrawDay: 20_799 }, 20_800 * DAY + 60),
      jackpotText({ pot: 5, last: { word: null, winner: null }, lastDrawDay: 20_700 }, now),
      bountyText(5, now),
      wordText("CRANE", held),
      wordText("CRANE", { ...held, daysUnfed: 1 }),
      wordText("CRANE", { ...held, upper: [true, true, true, true, true], daysUnfed: 1 }),
      wordText("CRANE", { ...held, upper: [true, true, true, true, true] }),
      wordText("CRANE", null),
      wordText("CRANE", undefined),
    ].join("\n");
    expect(all).not.toMatch(/—/);
    expect(all).not.toMatch(/[A-Za-z]'[A-Za-z]/);
    expect(all).not.toMatch(/\bon-chain\b/i);
    // A name is never written with an "@": in Telegram that would mention someone else.
    expect(all).not.toMatch(/@/);
  });
});
