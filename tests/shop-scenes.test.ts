/**
 * The Shop's scenes (lib/shop/scenes, decisions.md #41): what grants a paid scene, and which are on
 * sale. Money rides on the first rule, so every way to NOT be granted one is held here.
 */
import { describe, it, expect } from "vitest";
import { boughtScenes, sceneOfItem, scenesOnSale } from "@/lib/shop/scenes";
import type { ItemMeta, RegistryItem } from "@/lib/shop/rules";

const meta = (kind: string, art: string | null, name = "x"): ItemMeta => ({ name, kind: kind as ItemMeta["kind"], art });
const item = (id: number, more: Partial<RegistryItem> = {}): RegistryItem => ({ id, priceUsdc: 3_000_000n, start: 0, end: 0, maxSupply: 0, sold: 0, active: true, ...more });
const NOW = 1_800_000_000;

describe("what a Shop item is", () => {
  it("is a Shop scene only when its row says scene and names one", () => {
    expect(sceneOfItem(meta("scene", "space"))).toBe("space");
    expect(sceneOfItem(meta("scene", "bookshelf"))).toBe("bookshelf");
  });

  it("is no scene with no row (the test network's placeholder item), another kind, or no art", () => {
    expect(sceneOfItem(null)).toBeNull();
    expect(sceneOfItem(undefined)).toBeNull();
    expect(sceneOfItem(meta("costume", "space"))).toBeNull();
    expect(sceneOfItem(meta("scene", null))).toBeNull();
    expect(sceneOfItem(meta("scene", ""))).toBeNull();
  });

  it("can't sell a free or 3-word scene, a retired one, or a name that isn't a scene", () => {
    for (const art of ["stock", "stage", "trophy", "spring", "winter", "portrait", "Space", "space ", "moonbase"]) expect(sceneOfItem(meta("scene", art)), art).toBeNull();
  });
});

describe("what a profile has bought", () => {
  const rows = new Map<number, ItemMeta>([
    [1, meta("scene", "space")],
    [2, meta("scene", "bookshelf")],
    [3, meta("costume", "hat")],
  ]);
  const metaOf = (id: number) => rows.get(id) ?? null;

  it("is the Shop scenes of the items in its wardrobe", () => {
    expect([...boughtScenes(new Map([[1, 1]]), metaOf)]).toEqual(["space"]);
    expect([...boughtScenes(new Map([[1, 2], [2, 1]]), metaOf)].sort()).toEqual(["bookshelf", "space"]);
  });

  it("is nothing for an empty wardrobe, an item with no row, a costume, or a count of zero", () => {
    expect(boughtScenes(new Map(), metaOf).size).toBe(0);
    expect(boughtScenes(new Map([[9, 1]]), metaOf).size).toBe(0); // the placeholder "Test item"
    expect(boughtScenes(new Map([[3, 1]]), metaOf).size).toBe(0);
    expect(boughtScenes(new Map([[1, 0]]), metaOf).size).toBe(0);
  });
});

describe("the Shop scenes on sale", () => {
  const rows = new Map<number, ItemMeta>([
    [1, meta("scene", "space")],
    [2, meta("scene", "space")],
    [3, meta("scene", "bookshelf")],
  ]);
  const metaOf = (id: number) => rows.get(id) ?? null;

  it("are the scenes of items that can be bought right now, the cheapest item for each", () => {
    const onSale = scenesOnSale([item(1, { priceUsdc: 5_000_000n }), item(2, { priceUsdc: 3_000_000n }), item(3)], metaOf, NOW);
    expect([...onSale.keys()].sort()).toEqual(["bookshelf", "space"]);
    expect(onSale.get("space")?.id).toBe(2);
  });

  it("leave out an item that is off, not started, ended, sold out, or not a scene", () => {
    const off = [item(1, { active: false }), item(3, { start: NOW + 60 })];
    expect(scenesOnSale(off, metaOf, NOW).size).toBe(0);
    const gone = [item(1, { end: NOW - 1 }), item(3, { maxSupply: 10, sold: 10 })];
    expect(scenesOnSale(gone, metaOf, NOW).size).toBe(0);
    expect(scenesOnSale([item(7)], metaOf, NOW).size).toBe(0);
  });
});
