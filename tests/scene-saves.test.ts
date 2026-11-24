/**
 * Saved scenes (decisions.md #15): what /api/scenes accepts (lib/sceneSaves.ts), which pick wins
 * when the browser and the server disagree, and the route's rules: public reads, saves only under
 * a profile session and only for the session's own profile account.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MAX_PICKS_PER_SAVE, MAX_WALLETS_PER_READ, newestPick, parsePicks, parseStoredPick, parseWallets } from "@/lib/sceneSaves";
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
    expect(parsePicks({ picks: [{ word: "crane", scene: "winter", at: NOW - 1000 }] }, A, NOW)).toEqual([
      { wallet: A, word: "CRANE", scene: "winter", at: new Date(NOW - 1000) },
    ]);
    expect(parsePicks({ picks: [{ word: "CRANE", scene: "fall", at: NOW, wallet: B.toUpperCase().replace("0X", "0x") }] }, A, NOW)?.[0].wallet).toBe(B);
  });

  it("keeps a pick's time within the last 30 days and never in the future", () => {
    expect(parsePicks({ picks: [{ word: "CRANE", scene: "fall", at: 0 }] }, A, NOW)?.[0].at.getTime()).toBe(NOW - 30 * DAY);
    expect(parsePicks({ picks: [{ word: "CRANE", scene: "fall", at: NOW + DAY }] }, A, NOW)?.[0].at.getTime()).toBe(NOW + 60_000);
    expect(parsePicks({ picks: [{ word: "CRANE", scene: "fall" }] }, A, NOW)?.[0].at.getTime()).toBe(NOW);
  });

  it("refuses free text, banned words, unknown scenes, bad wallets, and empty or oversized saves", () => {
    const one = (p: Record<string, unknown>) => parsePicks({ picks: [{ word: "CRANE", scene: "fall", at: NOW, ...p }] }, A, NOW);
    expect(one({ word: "XQZPW" })).toBeNull();
    expect(one({ word: BANNED[0] })).toBeNull();
    expect(one({ scene: "space" })).toBeNull();
    expect(one({ wallet: "nope" })).toBeNull();
    expect(parsePicks({ picks: [] }, A, NOW)).toBeNull();
    expect(parsePicks(null, A, NOW)).toBeNull();
    expect(parsePicks({ picks: Array.from({ length: MAX_PICKS_PER_SAVE + 1 }, () => ({ word: "CRANE", scene: "fall" })) }, A, NOW)).toBeNull();
  });
});

describe("which pick shows", () => {
  it("reads this browser's picks, including the first version's bare scene ids", () => {
    expect(parseStoredPick("winter")).toEqual({ scene: "winter", at: 0, synced: false });
    expect(parseStoredPick(JSON.stringify({ scene: "fall", at: 5, synced: true }))).toEqual({ scene: "fall", at: 5, synced: true });
    for (const junk of [null, "", "space", "{", JSON.stringify({ scene: "space" })]) expect(parseStoredPick(junk)).toBeNull();
  });

  it("shows the newer of the browser's pick and the saved one", () => {
    // A pick made here before sign-in beats an older saved one; a newer pick from another device wins.
    expect(newestPick({ scene: "fall", at: 20, synced: false }, { scene: "winter", at: 10 })).toBe("fall");
    expect(newestPick({ scene: "fall", at: 10, synced: true }, { scene: "winter", at: 20 })).toBe("winter");
    expect(newestPick(null, { scene: "winter", at: 1 })).toBe("winter");
    expect(newestPick({ scene: "fall", at: 1, synced: false }, null)).toBe("fall");
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
vi.mock("@/lib/db/wordScenes", () => ({
  scenesOf: async (wallets: string[]) => {
    if (missingTable) throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
    return wallets.includes(A) ? [{ wallet: A, word: "CRANE", scene: "winter", updatedAt: new Date(NOW) }] : [];
  },
  saveScenes: async (wallet: string, picks: unknown[]) => {
    if (missingTable) throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
    if (full) return "full";
    saved.push({ wallet, picks });
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
});

describe("/api/scenes", () => {
  it("reads any wallets' saved scenes, no session needed", async () => {
    const { GET } = await import("@/app/api/scenes/route");
    const res = await GET(new Request(`http://localhost/api/scenes?wallets=${A},${B}`));
    expect(res.status).toBe(200);
    expect((await res.json()).scenes).toEqual([{ wallet: A, word: "CRANE", scene: "winter", at: NOW }]);
    expect((await GET(new Request("http://localhost/api/scenes?wallets=nope"))).status).toBe(400);
  });

  it("saves only under a session", async () => {
    const { PUT } = await import("@/app/api/scenes/route");
    session = null;
    account = null;
    expect((await PUT(put({ picks: [{ word: "CRANE", scene: "fall", at: NOW }] }))).status).toBe(401);
    expect(saved).toEqual([]);
  });

  it("saves for the session's wallet, and for the other wallets of its profile account", async () => {
    const { PUT } = await import("@/app/api/scenes/route");
    accountWallets = [A, B];
    const res = await PUT(put({ picks: [{ word: "CRANE", scene: "fall", at: NOW }, { word: "VIVID", scene: "spring", at: NOW, wallet: B }] }));
    expect(res.status).toBe(200);
    expect(saved.map((s) => s.wallet).sort()).toEqual([A, B]);
  });

  it("refuses a wallet outside the session's profile, saving nothing", async () => {
    const { PUT } = await import("@/app/api/scenes/route");
    const res = await PUT(put({ picks: [{ word: "CRANE", scene: "fall", at: NOW }, { word: "VIVID", scene: "spring", at: NOW, wallet: C }] }));
    expect(res.status).toBe(403);
    expect(saved).toEqual([]);
  });

  it("refuses a bad save, a full wallet, and says so plainly before migration 0009", async () => {
    const { GET, PUT } = await import("@/app/api/scenes/route");
    expect((await PUT(put({ picks: [{ word: "XQZPW", scene: "fall" }] }))).status).toBe(400);
    full = true;
    expect((await PUT(put({ picks: [{ word: "CRANE", scene: "fall" }] }))).status).toBe(409);
    full = false;
    missingTable = true;
    expect((await PUT(put({ picks: [{ word: "CRANE", scene: "fall" }] }))).status).toBe(503);
    expect((await GET(new Request(`http://localhost/api/scenes?wallets=${A}`))).status).toBe(503);
  });
});
