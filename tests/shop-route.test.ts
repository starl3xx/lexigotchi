/**
 * GET /api/shop: the registry and what each item is. The one rule held here: when the database
 * can't say what the items are, the answer says so (`metaKnown: false`), because the game decides
 * what a player owns from that metadata (Bugbot on #235: an answer with every `meta` null read as
 * "nothing is a scene", and a buyer's scene came off their card).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let rows: Map<number, { name: string; kind: string; art: string | null }> | "down" = new Map();
let deployed = true;

vi.mock("@/lib/shop/config", () => ({ shopEnabled: () => true }));
vi.mock("@/lib/onchain/addresses", () => ({ shopAddress: () => "0x00000000000000000000000000000000000000aa", usdcAddress: () => "0x00000000000000000000000000000000000000bb" }));
vi.mock("@/lib/shop/registry", () => ({
  readShop: async () =>
    deployed ? { paused: false, revenueBps: 8000, items: [{ id: 1, priceUsdc: 3_000_000n, start: 0, end: 0, maxSupply: 0, sold: 0, active: true }] } : null,
}));
vi.mock("@/lib/db/shop", () => ({
  itemMetadata: async () => {
    if (rows === "down") throw new Error("db down");
    return rows;
  },
}));

beforeEach(() => {
  rows = new Map();
  deployed = true;
});

describe("/api/shop", () => {
  it("says what each item is, and that it knows", async () => {
    const { GET } = await import("@/app/api/shop/route");
    rows = new Map([[1, { name: "Outer Space", kind: "scene", art: "space" }]]);
    const d = await (await GET()).json();
    expect(d.ok).toBe(true);
    expect(d.metaKnown).toBe(true);
    expect(d.items).toEqual([{ id: 1, priceUsdc: "3000000", start: 0, end: 0, maxSupply: 0, sold: 0, active: true, meta: { name: "Outer Space", kind: "scene", art: "space" } }]);
  });

  it("knows an item with no row is a plain item", async () => {
    const { GET } = await import("@/app/api/shop/route");
    const d = await (await GET()).json();
    expect(d.metaKnown).toBe(true);
    expect(d.items[0].meta).toBeNull();
  });

  it("says it doesn't know when the database couldn't be read, and still lists the registry", async () => {
    const { GET } = await import("@/app/api/shop/route");
    rows = "down";
    const res = await GET();
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.metaKnown).toBe(false);
    expect(d.items[0].meta).toBeNull();
  });

  it("is 503 with no Shop to read", async () => {
    const { GET } = await import("@/app/api/shop/route");
    deployed = false;
    expect((await GET()).status).toBe(503);
  });
});
