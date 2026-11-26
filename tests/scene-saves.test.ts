/**
 * Saved scenes (decisions.md #15): what /api/scenes accepts (lib/sceneSaves.ts), which pick wins
 * when the browser and the server disagree, and the route's rules: public reads, saves only under
 * a profile session and only for the session's own profile account.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MAX_PICKS_PER_SAVE, MAX_WALLETS_PER_READ, newestPick, parsePicks, parseStoredPick, parseWallets, readSavedPicks } from "@/lib/sceneSaves";
import { BANNED } from "@/lib/dictionary";

// Made-up wallets: never anyone's real address.
const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";
const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

describe("parseWallets (a read)", () => {
  it("takes up to eight addresses, lowercased and deduped", () => {
    expect(parseWallets(`${A.toUpperCase().replace("0X", "0x")},${B},${A}`)).toEqual([A, B]);
    expect(parseWallets(Array.from({ length: MAX_WALLETS_PER_READ + 1 }, (_, i) => `0x${String(i).padStart(40, "0")}`).join(","))).toBeNull();
  });

  it("refuses anything that isn't an address", () => {
    for (const bad of [null, "", "0x12", `${A},nope`, "<script>"]) expect(parseWallets(bad)).toBeNull();
  });
});

describe("parsePicks (a save)", () => {
  it("reads a pick, defaulting the wallet to the session's and the word to UPPERCASE", () => {
    expect(parsePicks({ picks: [{ word: "crane", scene: "trophy", at: NOW - 1000 }] }, A, NOW)).toEqual([
      { wallet: A, word: "CRANE", scene: "trophy", at: new Date(NOW - 1000) },
    ]);
    expect(parsePicks({ picks: [{ word: "CRANE", scene: "stage", at: NOW, wallet: B.toUpperCase().replace("0X", "0x") }] }, A, NOW)?.[0].wallet).toBe(B);
  });

  it("keeps a pick's time within the last 30 days and never in the future", () => {
    expect(parsePicks({ picks: [{ word: "CRANE", scene: "stage", at: 0 }] }, A, NOW)?.[0].at.getTime()).toBe(NOW - 30 * DAY);
    expect(parsePicks({ picks: [{ word: "CRANE", scene: "stage", at: NOW + DAY }] }, A, NOW)?.[0].at.getTime()).toBe(NOW + 60_000);
    expect(parsePicks({ picks: [{ word: "CRANE", scene: "stage" }] }, A, NOW)?.[0].at.getTime()).toBe(NOW);
  });

  it("collapses two picks for one wallet and word to the newer (Postgres can't upsert a row twice)", () => {
    const picks = parsePicks(
      {
        picks: [
          { word: "CRANE", scene: "stage", at: NOW - 5000 },
          { word: "crane", scene: "trophy", at: NOW - 1000 },
          { word: "CRANE", scene: "spring", at: NOW - 3000, wallet: B },
          { word: "CRANE", scene: "stock", at: NOW - 9000 },
        ],
      },
      A,
      NOW,
    );
    expect(picks?.map((p) => [p.wallet, p.word, p.scene])).toEqual([
      [A, "CRANE", "trophy"],
      [B, "CRANE", "spring"],
    ]);
  });

  it("refuses free text, banned words, unknown scenes, bad wallets, and empty or oversized saves", () => {
    const one = (p: Record<string, unknown>) => parsePicks({ picks: [{ word: "CRANE", scene: "stage", at: NOW, ...p }] }, A, NOW);
    expect(one({ word: "XQZPW" })).toBeNull();
    expect(one({ word: BANNED[0] })).toBeNull();
    expect(one({ scene: "moonbase" })).toBeNull();
    expect(one({ wallet: "nope" })).toBeNull();
    expect(parsePicks({ picks: [] }, A, NOW)).toBeNull();
    expect(parsePicks(null, A, NOW)).toBeNull();
    expect(parsePicks({ picks: Array.from({ length: MAX_PICKS_PER_SAVE + 1 }, () => ({ word: "CRANE", scene: "stage" })) }, A, NOW)).toBeNull();
  });
});

describe("a retired scene (Picture Day, Summer, Fall, Winter: decisions.md #34)", () => {
  it("is still a pick, made when it was, and it shows the stock card", () => {
    for (const old of ["portrait", "summer", "fall", "winter"]) {
      expect(parseStoredPick(JSON.stringify({ scene: old, at: 5, synced: true }))).toEqual({ scene: "stock", at: 5, synced: true });
      expect(parseStoredPick(JSON.stringify({ scene: old, at: 7, synced: false }))).toEqual({ scene: "stock", at: 7, synced: false });
    }
  });

  it("from the first version (no time) reads as the stock card with nothing to upload", () => {
    // it can't be ordered against any other pick, and with no other pick the word is on the stock card anyway
    expect(parseStoredPick("winter")).toEqual({ scene: "stock", at: 0, synced: true });
  });

  it("never brings back the scene the player left for it (Bugbot on #226)", () => {
    // the Stage picked here, then Picture Day picked on another device and saved: the newer pick
    // wins, and it reads as the stock card. Dropping it showed the Stage again.
    const saved = readSavedPicks([{ wallet: A, word: "CRANE", scene: "portrait", at: 20 }]);
    expect(saved.get(`${A}:CRANE`)).toEqual({ scene: "stock", at: 20 });
    expect(newestPick({ scene: "stage", at: 10, synced: true }, saved.get(`${A}:CRANE`) ?? null)).toBe("stock");
    // and the other way round: a retired pick here, then a newer real one saved elsewhere
    expect(newestPick(parseStoredPick(JSON.stringify({ scene: "fall", at: 10, synced: true })), { scene: "spring", at: 20 })).toBe("spring");
  });

  it("leaves out a saved row whose scene is nothing known, and keeps the rest", () => {
    const saved = readSavedPicks([
      { wallet: A, word: "CRANE", scene: "nonsense", at: 5 },
      { wallet: A, word: "VIVID", scene: "trophy", at: 6 },
    ]);
    expect([...saved]).toEqual([[`${A}:VIVID`, { scene: "trophy", at: 6 }]]);
  });

  it("can't be saved again", () => {
    expect(parsePicks({ picks: [{ word: "CRANE", scene: "winter", at: NOW }] }, A, NOW)).toBeNull();
  });
});

describe("which pick shows", () => {
  it("reads this browser's picks, including the first version's bare scene ids", () => {
    expect(parseStoredPick("trophy")).toEqual({ scene: "trophy", at: 0, synced: false });
    expect(parseStoredPick(JSON.stringify({ scene: "stage", at: 5, synced: true }))).toEqual({ scene: "stage", at: 5, synced: true });
    for (const junk of [null, "", "moonbase", "{", JSON.stringify({ scene: "moonbase" })]) expect(parseStoredPick(junk)).toBeNull();
  });

  it("shows the newer of the browser's pick and the saved one", () => {
    // A pick made here before sign-in beats an older saved one; a newer pick from another device wins.
    expect(newestPick({ scene: "stage", at: 20, synced: false }, { scene: "trophy", at: 10 })).toBe("stage");
    expect(newestPick({ scene: "stage", at: 10, synced: true }, { scene: "trophy", at: 20 })).toBe("trophy");
    expect(newestPick(null, { scene: "trophy", at: 1 })).toBe("trophy");
    expect(newestPick({ scene: "stage", at: 1, synced: false }, null)).toBe("stage");
    expect(newestPick(null, null)).toBeNull();
  });
});

// ── the route ────────────────────────────────────────────────────────────────────────────────────
const saved: { wallet: string; picks: unknown[] }[] = [];
let session: string | null = A;
let account: string | null = A;
let accountWallets = [A];
let full = false;
let missingTable = false;

vi.mock("@/lib/profile/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/profile/session")>()),
  profilesEnabled: () => true,
  sessionAddress: () => session,
}));
vi.mock("@/lib/profile/account", () => ({ sessionAccountOf: async () => account }));
vi.mock("@/lib/db/walletLinks", () => ({ walletsOfAccount: async () => accountWallets }));
vi.mock("@/lib/ratelimit", () => ({ allow: async () => true }));
// What the session's profile has bought in the Shop (lib/shop/owned); "down" is a database error.
let bought: string[] | "down" = [];
const askedFor: string[][] = [];
vi.mock("@/lib/shop/owned", () => ({
  boughtScenesOf: async (wallets: string[]) => {
    askedFor.push(wallets);
    if (bought === "down") throw new Error("db down");
    return new Set(bought);
  },
}));
vi.mock("@/lib/db/wordPicks", () => ({
  scenePicksFor: async (wallets: string[]) => {
    if (missingTable) throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
    return wallets.includes(A) ? [{ wallet: A, word: "CRANE", scene: "trophy", updatedAt: new Date(NOW) }] : [];
  },
  saveScenePicks: async (profile: string, picks: unknown[]) => {
    if (missingTable) throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
    if (full) return "full";
    saved.push({ wallet: profile, picks });
    return "ok";
  },
}));

const put = (body: unknown) =>
  new Request("http://localhost/api/scenes", { method: "PUT", headers: { "content-type": "application/json", "x-lexigotchi-session": "t" }, body: JSON.stringify(body) });

beforeEach(() => {
  saved.length = 0;
  session = A;
  account = A;
  accountWallets = [A];
  full = false;
  missingTable = false;
  bought = [];
  askedFor.length = 0;
});

describe("/api/scenes", () => {
  it("reads any wallets' saved scenes, no session needed", async () => {
    const { GET } = await import("@/app/api/scenes/route");
    const res = await GET(new Request(`http://localhost/api/scenes?wallets=${A},${B}`));
    expect(res.status).toBe(200);
    expect((await res.json()).scenes).toEqual([{ wallet: A, word: "CRANE", scene: "trophy", at: NOW }]);
    expect((await GET(new Request("http://localhost/api/scenes?wallets=nope"))).status).toBe(400);
  });

  it("saves only under a session", async () => {
    const { PUT } = await import("@/app/api/scenes/route");
    session = null;
    account = null;
    expect((await PUT(put({ picks: [{ word: "CRANE", scene: "stage", at: NOW }] }))).status).toBe(401);
    expect(saved).toEqual([]);
  });

  it("saves picks for any wallet of the session's profile, under the PROFILE (decisions.md #22)", async () => {
    const { PUT } = await import("@/app/api/scenes/route");
    accountWallets = [A, B];
    const res = await PUT(put({ picks: [{ word: "CRANE", scene: "stage", at: NOW }, { word: "VIVID", scene: "spring", at: NOW, wallet: B }] }));
    expect(res.status).toBe(200);
    // One save, keyed by the profile (the account A heads), holding both wallets' words.
    expect(saved.map((s) => s.wallet)).toEqual([A]);
    expect(saved[0].picks).toHaveLength(2);
  });

  it("saves a Shop scene only for a profile that has bought it (decisions.md #41)", async () => {
    const { PUT } = await import("@/app/api/scenes/route");
    accountWallets = [A, B];
    const picks = { picks: [{ word: "CRANE", scene: "space", at: NOW }, { word: "VIVID", scene: "spring", at: NOW }] };
    // not bought: the Shop scene's pick is left out and named, and the rest of the save lands
    let res = await PUT(put(picks));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, refused: ["CRANE"] });
    expect(saved).toHaveLength(1);
    expect((saved[0].picks as { word: string }[]).map((p) => p.word)).toEqual(["VIVID"]);
    // it asked about the whole profile's wallets, not only the session's
    expect(askedFor[0].sort()).toEqual([A, B].sort());
    // bought: saved like any pick
    saved.length = 0;
    bought = ["space"];
    res = await PUT(put(picks));
    expect(await res.json()).toEqual({ ok: true });
    expect((saved[0].picks as { word: string }[]).map((p) => p.word)).toEqual(["CRANE", "VIVID"]);
    // buying one Shop scene doesn't grant the other
    saved.length = 0;
    res = await PUT(put({ picks: [{ word: "CRANE", scene: "bookshelf", at: NOW }] }));
    expect(await res.json()).toEqual({ ok: true, refused: ["CRANE"] });
    expect(saved).toEqual([]);
  });

  it("when it can't check the purchase, it saves no Shop scene and still saves the rest", async () => {
    const { PUT } = await import("@/app/api/scenes/route");
    bought = "down";
    const res = await PUT(put({ picks: [{ word: "CRANE", scene: "space", at: NOW }, { word: "VIVID", scene: "stage", at: NOW }] }));
    expect(await res.json()).toEqual({ ok: true, refused: ["CRANE"] });
    expect((saved[0].picks as { word: string }[]).map((p) => p.word)).toEqual(["VIVID"]);
  });

  it("doesn't ask about purchases for a save with no Shop scene in it", async () => {
    const { PUT } = await import("@/app/api/scenes/route");
    await PUT(put({ picks: [{ word: "CRANE", scene: "trophy", at: NOW }] }));
    expect(askedFor).toEqual([]);
  });

  it("refuses a wallet outside the session's profile, saving nothing", async () => {
    const { PUT } = await import("@/app/api/scenes/route");
    const res = await PUT(put({ picks: [{ word: "CRANE", scene: "stage", at: NOW }, { word: "VIVID", scene: "spring", at: NOW, wallet: C }] }));
    expect(res.status).toBe(403);
    expect(saved).toEqual([]);
  });

  it("refuses a bad save, a full profile, and says so plainly before migration 0011", async () => {
    const { GET, PUT } = await import("@/app/api/scenes/route");
    expect((await PUT(put({ picks: [{ word: "XQZPW", scene: "stage" }] }))).status).toBe(400);
    full = true;
    expect((await PUT(put({ picks: [{ word: "CRANE", scene: "stage" }] }))).status).toBe(409);
    full = false;
    missingTable = true;
    expect((await PUT(put({ picks: [{ word: "CRANE", scene: "stage" }] }))).status).toBe(503);
    expect((await GET(new Request(`http://localhost/api/scenes?wallets=${A}`))).status).toBe(503);
  });
});

// ── picks by profile (lib/db/wordPicks, decisions.md #22) ─────────────────────────────────────────
describe("picks belong to the profile", async () => {
  const { picksForWallets, stalePicks } = await vi.importActual<typeof import("@/lib/db/wordPicks")>("@/lib/db/wordPicks");
  const P = A; // the profile: its first wallet
  const at = new Date(NOW);

  it("every wallet of a profile sees the profile's picks; a stranger sees none", () => {
    const accounts = new Map([[A, P], [B, P], [C, C]]);
    const rows = [{ profile: P, word: "CRANE", value: "trophy", updatedAt: at }];
    const seen = picksForWallets([A, B, C], accounts, rows);
    expect(seen.map((r) => r.wallet)).toEqual([A, B]);
    expect(seen.every((r) => r.word === "CRANE" && r.scene === "trophy")).toBe(true);
  });

  it("a pick a wallet saved under its own key before joining stays its profile's; the newest per word wins", () => {
    const accounts = new Map([[A, P], [B, P]]); // B joined P after saving picks as itself
    const rows = [
      { profile: B, word: "VIVID", value: "stage", updatedAt: at }, // saved by B before it joined
      { profile: P, word: "CRANE", value: "trophy", updatedAt: new Date(NOW - 1_000) },
      { profile: B, word: "CRANE", value: "spring", updatedAt: at }, // newer: wins
    ];
    const seen = picksForWallets([A], accounts, rows);
    expect(seen.map((r) => `${r.word}:${r.scene}`).sort()).toEqual(["CRANE:spring", "VIVID:stage"]);
  });

  it("the keeper keeps a joined wallet's old picks (their effective profile is the account)", () => {
    const rows = [{ profile: B, word: "VIVID" }];
    const held = new Map([["VIVID", P]]);
    const accountOf = (k: string) => (k === B ? P : k);
    expect(stalePicks(rows, held, accountOf)).toEqual([]);
    expect(stalePicks(rows, held)).toHaveLength(1); // without the links it would have gone
  });

  it("a pick comes off only when the scan shows its word held by another profile", () => {
    const rows = [
      { profile: P, word: "CRANE" }, // still the profile's (staked, or moved to its other wallet)
      { profile: P, word: "VIVID" }, // sold to C's profile
      { profile: P, word: "GRAPE" }, // missing from the scan: dissolved, or its owner read failed
    ];
    const held = new Map([["CRANE", P], ["VIVID", C]]);
    // A missing answer never deletes: only VIVID, positively held by someone else, goes.
    expect(stalePicks(rows, held).map((r) => r.word)).toEqual(["VIVID"]);
  });
});
