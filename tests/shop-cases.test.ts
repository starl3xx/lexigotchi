/**
 * The plastic case (lib/shop/cases, decisions.md #42): one case holds one word. Money rides on the
 * count, so it is held here, and so is the route that is the one place that counts
 * (`/api/cases`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CASE_STYLE, caseOffer, caseOnSale, casesBought, casesLeft, casesShown, casesState, isCaseItem, mayCase } from "@/lib/shop/cases";
import type { ItemMeta, RegistryItem } from "@/lib/shop/rules";

const meta = (kind: string, art: string | null = null): ItemMeta => ({ name: "x", kind: kind as ItemMeta["kind"], art });
const item = (id: number, more: Partial<RegistryItem> = {}): RegistryItem => ({ id, priceUsdc: 3_000_000n, start: 0, end: 0, maxSupply: 0, sold: 0, active: true, ...more });
const NOW = 1_800_000_000;

describe("what a case is", () => {
  it("is an item whose row says so, and nothing else", () => {
    expect(isCaseItem(meta("case"))).toBe(true);
    expect(isCaseItem(meta("scene", "space"))).toBe(false);
    expect(isCaseItem(meta("costume"))).toBe(false);
    expect(isCaseItem(null)).toBe(false); // the test network's placeholder item has no row
    expect(isCaseItem(undefined)).toBe(false);
  });

  it("counts every case bought, across the items that sell one", () => {
    const rows = new Map<number, ItemMeta>([[1, meta("case")], [2, meta("case")], [3, meta("scene", "space")]]);
    const metaOf = (id: number) => rows.get(id) ?? null;
    expect(casesBought(new Map([[1, 2]]), metaOf)).toBe(2);
    expect(casesBought(new Map([[1, 2], [2, 1], [3, 4]]), metaOf)).toBe(3);
    expect(casesBought(new Map([[3, 1], [9, 5]]), metaOf)).toBe(0); // a scene, and an item with no row
    expect(casesBought(new Map([[1, 0]]), metaOf)).toBe(0);
    expect(casesBought(new Map(), metaOf)).toBe(0);
  });
});

describe("one case holds one word", () => {
  it("leaves as many free as were bought, less the words in one, never under zero", () => {
    expect(casesLeft(2, 0)).toBe(2);
    expect(casesLeft(2, 1)).toBe(1);
    expect(casesLeft(2, 2)).toBe(0);
    expect(casesLeft(1, 3)).toBe(0); // a wallet that bought some has left the profile
  });

  it("puts a word in a case only while one is free", () => {
    expect(mayCase("JAZZY", new Set(), 0)).toBe(false);
    expect(mayCase("JAZZY", new Set(), 1)).toBe(true);
    expect(mayCase("JAZZY", new Set(["PLUMB"]), 1)).toBe(false);
    expect(mayCase("JAZZY", new Set(["PLUMB"]), 2)).toBe(true);
  });

  it("changes nothing for a word already in one, whatever the count", () => {
    expect(mayCase("PLUMB", new Set(["PLUMB"]), 1)).toBe(true);
    expect(mayCase("PLUMB", new Set(["PLUMB"]), 0)).toBe(true);
  });
});

describe("the case on sale", () => {
  const rows = new Map<number, ItemMeta>([[1, meta("case")], [2, meta("case")], [3, meta("scene", "space")]]);
  const metaOf = (id: number) => rows.get(id) ?? null;

  it("is the cheapest case that can be bought right now", () => {
    expect(caseOnSale([item(1, { priceUsdc: 5_000_000n }), item(2), item(3, { priceUsdc: 1n })], metaOf, NOW)?.id).toBe(2);
  });

  it("is none when every case is off, not started, ended, or sold out", () => {
    expect(caseOnSale([item(1, { active: false }), item(2, { start: NOW + 60 })], metaOf, NOW)).toBeNull();
    expect(caseOnSale([item(1, { end: NOW - 1 }), item(2, { maxSupply: 4, sold: 4 })], metaOf, NOW)).toBeNull();
    expect(caseOnSale([item(3), item(7)], metaOf, NOW)).toBeNull();
  });
});

describe("which words show a case", () => {
  const held = new Map([["CRANE", 300], ["VIVID", 100], ["MOTEL", 200]]);

  it("is every listed word while the count isn't known: unknown is not \"no\"", () => {
    expect([...casesShown(held, null).keys()].sort()).toEqual(["CRANE", "MOTEL", "VIVID"]);
  });

  it("is every listed word when the profile has that many cases or more", () => {
    expect(casesShown(held, 3).size).toBe(3);
    expect(casesShown(held, 9).size).toBe(3);
  });

  it("is at most as many as were bought, the oldest first: a case doesn't outlive its purchase", () => {
    expect([...casesShown(held, 2).keys()]).toEqual(["VIVID", "MOTEL"]);
    expect([...casesShown(held, 1).keys()]).toEqual(["VIVID"]);
    expect(casesShown(held, 0).size).toBe(0);
    // two cased at the same moment: A to Z, so the answer is the same every time
    expect([...casesShown(new Map([["ZESTY", 5], ["APPLE", 5]]), 1).keys()]).toEqual(["APPLE"]);
  });
});

describe("what the game knows about a player's cases, from three reads", () => {
  const shopItem = (id: number, m: ItemMeta | null, more: Partial<RegistryItem> = {}) => ({ ...item(id, more), meta: m });
  const shop = (more: { paused?: boolean; metaKnown?: boolean } = {}) => ({ paused: false, metaKnown: true, items: [shopItem(1, meta("case")), shopItem(2, meta("scene", "space"))], ...more });
  const list = new Map([["VIVID", 100]]);
  const two = new Map([[1, 2]]);
  const know = (a: Partial<Parameters<typeof casesState>[0]>) => casesState({ list, shop: shop(), wardrobe: two, nowSec: NOW, ...a });

  it("counts, with all three in", () => {
    const s = know({});
    expect([s.bought, s.left, s.onSale?.id]).toEqual([2, 1, 1]);
    expect([...s.shown.keys()]).toEqual(["VIVID"]);
    expect(s.held).toBe(list);
  });

  it("never reads a missing list as \"no words in cases\": no count of free cases, nothing shown", () => {
    for (const missing of [undefined, null]) {
      const s = know({ list: missing });
      expect(s.held).toBeNull();
      expect(s.left).toBeNull();
      expect(s.shown.size).toBe(0);
      expect(s.bought).toBe(2); // what was bought is still known
    }
  });

  it("never reads a missing wardrobe as \"no cases\": the listed words keep their cases", () => {
    for (const missing of [undefined, null]) {
      const s = know({ wardrobe: missing });
      expect([s.bought, s.left]).toEqual([null, null]);
      expect([...s.shown.keys()]).toEqual(["VIVID"]);
    }
  });

  it("knows of no case when the Shop is missing or couldn't say what its items are", () => {
    for (const s of [know({ shop: undefined }), know({ shop: null }), know({ shop: shop({ metaKnown: false }) })]) {
      expect([s.bought, s.left, s.onSale]).toEqual([null, null, null]);
      expect([...s.shown.keys()]).toEqual(["VIVID"]);
    }
  });

  it("sells nothing while the Shop is paused, and still counts what was bought", () => {
    const s = know({ shop: shop({ paused: true }) });
    expect([s.bought, s.onSale]).toEqual([2, null]);
  });

  it("stops showing the newest cases when the purchase has gone, and counts none free", () => {
    const s = know({ list: new Map([["VIVID", 100], ["CRANE", 300]]), wardrobe: new Map([[1, 1]]) });
    expect([...s.shown.keys()]).toEqual(["VIVID"]);
    expect(s.left).toBe(0);
  });
});

describe("what the Case button offers", () => {
  const base = { held: new Map<string, number>(), shown: new Map<string, number>(), bought: 0 as number | null, left: 0 as number | null, onSale: null as unknown };
  const vivid = new Map([["VIVID", 100]]);

  it("is nothing while the list of cased words isn't known, whatever was bought", () => {
    expect(caseOffer("CRANE", { ...base, held: null, bought: 2, left: null, onSale: {} })).toEqual({ kind: "none" });
  });

  it("is nothing while the count isn't known, for a word not in a case", () => {
    expect(caseOffer("CRANE", { ...base, held: vivid, shown: vivid, bought: null, left: null, onSale: {} })).toEqual({ kind: "none" });
  });

  it("lets a word that shows a case be taken out, even while the count isn't known", () => {
    expect(caseOffer("VIVID", { ...base, held: vivid, shown: vivid, bought: null, left: null })).toEqual({ kind: "cased" });
    expect(caseOffer("VIVID", { ...base, held: vivid, shown: vivid, bought: 1, left: 0 })).toEqual({ kind: "cased" });
  });

  it("offers a free case", () => {
    expect(caseOffer("CRANE", { ...base, held: vivid, shown: vivid, bought: 3, left: 2 })).toEqual({ kind: "put", free: 2 });
  });

  it("lists the words to take out when every case holds one, and says when another can be bought", () => {
    expect(caseOffer("CRANE", { ...base, held: vivid, shown: vivid, bought: 1, left: 0 })).toEqual({ kind: "full", holding: ["VIVID"], more: false });
    expect(caseOffer("CRANE", { ...base, held: vivid, shown: vivid, bought: 1, left: 0, onSale: {} })).toEqual({ kind: "full", holding: ["VIVID"], more: true });
  });

  it("for a word whose case stopped showing (the purchase has gone), lists the words that still show one", () => {
    const held = new Map([["VIVID", 100], ["CRANE", 300]]);
    expect(caseOffer("CRANE", { ...base, held, shown: vivid, bought: 1, left: 0 })).toEqual({ kind: "full", holding: ["VIVID"], more: false });
  });

  it("offers the Shop's case to a player with none, only while one is on sale", () => {
    expect(caseOffer("CRANE", { ...base, onSale: {} })).toEqual({ kind: "buy" });
    expect(caseOffer("CRANE", { ...base })).toEqual({ kind: "none" });
  });
});

// ── the route ────────────────────────────────────────────────────────────────────────────────────
const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
let session: string | null = A;
let account: string | null = A;
let accountWallets = [A];
let bought: number | "down" = 0;
let missingTable = false;
const askedFor: string[][] = [];
/** The store: profile → its cased words. */
const store = new Map<string, Map<string, Date>>();
const setCalls: { profile: string; word: string; on: boolean; bought: number }[] = [];

vi.mock("@/lib/profile/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/profile/session")>()),
  profilesEnabled: () => true,
  sessionAddress: () => session,
}));
vi.mock("@/lib/profile/account", () => ({ sessionAccountOf: async () => account }));
vi.mock("@/lib/db/walletLinks", () => ({ walletsOfAccount: async () => accountWallets }));
vi.mock("@/lib/ratelimit", () => ({ allow: async () => true }));
vi.mock("@/lib/shop/owned", () => ({
  casesBoughtBy: async (wallets: string[]) => {
    askedFor.push(wallets);
    if (bought === "down") throw new Error("db down");
    return bought;
  },
}));
// The database is stood in for by a map; the rule it applies is the real one (lib/shop/cases).
vi.mock("@/lib/db/wordCases", async () => {
  const { mayCase: may } = await import("@/lib/shop/cases");
  return {
    casesFor: async (wallets: string[]) => {
      if (missingTable) throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
      return wallets.flatMap((w) => [...(store.get(w) ?? [])].map(([word, since]) => ({ wallet: w, word, since })));
    },
    setCase: async (profile: string, word: string, on: boolean, n: number) => {
      if (missingTable) throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
      setCalls.push({ profile, word, on, bought: n });
      const mine = store.get(profile) ?? new Map<string, Date>();
      store.set(profile, mine);
      if (!on) return mine.delete(word), "ok";
      if (mine.has(word)) return "ok";
      if (!may(word, new Set(mine.keys()), n)) return "none_left";
      mine.set(word, new Date(NOW * 1000));
      return "ok";
    },
  };
});

const put = (body: unknown) =>
  new Request("http://localhost/api/cases", { method: "PUT", headers: { "content-type": "application/json", "x-lexigotchi-session": "t" }, body: JSON.stringify(body) });

beforeEach(() => {
  session = A;
  account = A;
  accountWallets = [A];
  bought = 0;
  missingTable = false;
  askedFor.length = 0;
  setCalls.length = 0;
  store.clear();
});

describe("/api/cases", () => {
  it("reads any wallets' cased words, no session needed", async () => {
    const { GET } = await import("@/app/api/cases/route");
    store.set(A, new Map([["CRANE", new Date(NOW * 1000)]]));
    const res = await GET(new Request(`http://localhost/api/cases?wallets=${A},${B}`));
    expect(res.status).toBe(200);
    expect((await res.json()).cases).toEqual([{ wallet: A, word: "CRANE", since: NOW * 1000 }]);
    expect((await GET(new Request("http://localhost/api/cases?wallets=nope"))).status).toBe(400);
  });

  it("changes nothing without a session", async () => {
    const { PUT } = await import("@/app/api/cases/route");
    session = null;
    account = null;
    expect((await PUT(put({ word: "CRANE", on: true }))).status).toBe(401);
    expect(setCalls).toEqual([]);
  });

  it("puts a word in a case only for a profile with a case free", async () => {
    const { PUT } = await import("@/app/api/cases/route");
    // none bought
    let res = await PUT(put({ word: "CRANE", on: true }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "none_left" });
    // one bought: one word goes in, a second doesn't
    bought = 1;
    expect((await PUT(put({ word: "CRANE", on: true }))).status).toBe(200);
    expect((await PUT(put({ word: "VIVID", on: true }))).status).toBe(409);
    expect([...store.get(A)!.keys()]).toEqual(["CRANE"]);
    // asking again for the word already in one is fine, and changes nothing
    expect((await PUT(put({ word: "CRANE", on: true }))).status).toBe(200);
    expect([...store.get(A)!.keys()]).toEqual(["CRANE"]);
  });

  it("frees the case when the word is taken out, without asking what was bought", async () => {
    const { PUT } = await import("@/app/api/cases/route");
    bought = 1;
    await PUT(put({ word: "CRANE", on: true }));
    askedFor.length = 0;
    expect((await PUT(put({ word: "CRANE", on: false }))).status).toBe(200);
    expect(askedFor).toEqual([]);
    expect((await PUT(put({ word: "VIVID", on: true }))).status).toBe(200);
    expect([...store.get(A)!.keys()]).toEqual(["VIVID"]);
  });

  it("counts the whole profile's cases, and saves under the profile", async () => {
    const { PUT } = await import("@/app/api/cases/route");
    session = B; // a second wallet of the profile A heads
    accountWallets = [A, B];
    bought = 1;
    expect((await PUT(put({ word: "crane", on: true }))).status).toBe(200);
    expect(askedFor[0].slice().sort()).toEqual([A, B].sort());
    expect(setCalls[0]).toEqual({ profile: A, word: "CRANE", on: true, bought: 1 });
  });

  it("gives no case on a guess: a wardrobe that can't be read refuses", async () => {
    const { PUT } = await import("@/app/api/cases/route");
    bought = "down";
    const res = await PUT(put({ word: "CRANE", on: true }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "try_again" });
    expect(setCalls).toEqual([]);
  });

  it("refuses free text, a missing choice, and anything that isn't a dictionary word", async () => {
    const { PUT } = await import("@/app/api/cases/route");
    bought = 5;
    for (const body of [{ word: "NOTAWORDX", on: true }, { word: "CRANE" }, { word: "CRANE", on: "yes" }, { on: true }, null, { word: 7, on: true }]) {
      expect((await PUT(put(body))).status, JSON.stringify(body)).toBe(400);
    }
    expect(setCalls).toEqual([]);
  });

  it("answers not_configured before the table exists", async () => {
    const { GET, PUT } = await import("@/app/api/cases/route");
    missingTable = true;
    bought = 1;
    expect((await GET(new Request(`http://localhost/api/cases?wallets=${A}`))).status).toBe(503);
    expect((await PUT(put({ word: "CRANE", on: true }))).status).toBe(503);
  });

  it("stores the one style of case there is", () => {
    expect(CASE_STYLE).toBe("slab");
  });
});
