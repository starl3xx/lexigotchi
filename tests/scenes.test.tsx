// @vitest-environment jsdom
/**
 * Scenes and the front of a word's card (decisions.md #34): the scene list and its unlock, the card
 * art's rules, where the word stands, and what the card's front shows.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_SCENE,
  FREE_SCENES,
  LINK_DEFAULT_SCENE,
  SCENES,
  SCENE_IDS,
  SCENE_UNLOCK_WORDS,
  SHOP_SCENES,
  UNLOCK_SCENES,
  canUseScene,
  isSceneId,
  isShopScene,
  parseLinkScene,
  parseScene,
  sceneMeta,
  sceneShows,
  storedScene,
  scenesUnlocked,
  shownScene,
  type SceneId,
} from "@/lib/scenes";
import { TIERS as TIER_LIST, type Tier } from "@/lib/economy";
import { CARD_H, CARD_W, beadRing, beadsOnCurve, svgDataUri, svgDoc } from "@/lib/cardArt/engrave";
import { CARD_LOOKS, FEET_Y, WINDOW } from "@/lib/cardArt/looks";
import { DARK_SCENES, GROUND, PEWTER, RARITY_FACES, cardArt, cardFrame, footingFor, groundOf } from "@/lib/cardArt/scenes";
import { tierMarkPaths } from "@/lib/tierMark";
import { FOOT_SHARE, wordFootings, wordLayout } from "@/components/scenes/layout";
import { SceneFrame, SceneThumb, sceneArtImage, toneOf } from "@/components/scenes/SceneFrame";

const TIERS: Tier[] = TIER_LIST.map((t) => t.name);
// jsdom has no matchMedia; this viewer doesn't ask for reduced motion
window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

afterEach(cleanup);

describe("the scene list", () => {
  it("is the stock face and its dark side, the Stage, the Trophy Case, Spring, and the Shop's two, each named once", () => {
    expect([...SCENE_IDS]).toEqual(["stock", "darkstock", "stage", "trophy", "spring", "bookshelf", "space"]);
    expect([...FREE_SCENES, ...UNLOCK_SCENES, ...SHOP_SCENES].sort()).toEqual([...SCENE_IDS].sort()); // each scene is one kind
    expect(SCENES.map((s) => s.id)).toEqual([...SCENE_IDS]);
    expect(new Set(SCENES.map((s) => s.name)).size).toBe(SCENES.length);
    expect(sceneMeta("trophy").name).toBe("Trophy Case");
  });

  it("starts every word on the stock card (starl3xx: \"word with no scene (brand new) are on the stock card\")", () => {
    expect(DEFAULT_SCENE).toBe("stock");
    expect(parseScene(undefined)).toBe("stock");
    expect(parseScene("nonsense")).toBe("stock");
    expect(parseScene("spring")).toBe("spring");
  });

  it("has retired Picture Day, Summer, Fall, and Winter: a saved pick of one reads as the stock card", () => {
    for (const old of ["portrait", "summer", "fall", "winter"]) {
      expect(isSceneId(old)).toBe(false);
      expect(parseScene(old)).toBe("stock");
      expect(storedScene(old)).toBe("stock"); // still a pick: the stock card, at its own time
    }
    expect(storedScene("spring")).toBe("spring");
    for (const bad of ["nonsense", "", null, undefined, 3]) expect(storedScene(bad)).toBeNull();
  });

  it("reads a share link with no scene as the Stage, as it always has, and a retired one as the stock card", () => {
    expect(LINK_DEFAULT_SCENE).toBe("stage");
    expect(parseLinkScene(undefined)).toBe("stage");
    expect(parseLinkScene(null)).toBe("stage");
    expect(parseLinkScene("")).toBe("stage");
    expect(parseLinkScene("stock")).toBe("stock");
    expect(parseLinkScene("trophy")).toBe("trophy");
    expect(parseLinkScene("winter")).toBe("stock");
    expect(parseLinkScene(["spring", "stage"])).toBe("spring"); // ?scene=spring&scene=stage
  });

  it("player copy has no em dash", () => {
    for (const s of SCENES) expect(`${s.name} ${s.blurb}`).not.toMatch(/—/);
  });
});

describe("the unlock", () => {
  it("opens the Trophy Case and Spring at three words (starl3xx: an unlock for reaching, say, 3 words spelled)", () => {
    expect(SCENE_UNLOCK_WORDS).toBe(3);
    expect(scenesUnlocked(2)).toBe(false);
    expect(scenesUnlocked(3)).toBe(true);
    expect(canUseScene("trophy", 2)).toBe(false);
    expect(canUseScene("spring", 3)).toBe(true);
  });

  it("always lets a player use the stock face, the dark stock face, and the Stage", () => {
    expect([...FREE_SCENES]).toEqual(["stock", "darkstock", "stage"]);
    for (const free of FREE_SCENES) expect(canUseScene(free, 0)).toBe(true);
  });

  it("opens a Shop scene only to a profile that has bought it, however many words it has held", () => {
    for (const scene of SHOP_SCENES) {
      expect(isShopScene(scene)).toBe(true);
      expect(canUseScene(scene, 0)).toBe(false);
      expect(canUseScene(scene, 99)).toBe(false);
      expect(canUseScene(scene, 0, new Set([scene]))).toBe(true);
    }
    // buying one doesn't open the other, and a purchase doesn't open the 3-word scenes
    expect(canUseScene("space", 99, new Set<SceneId>(["bookshelf"]))).toBe(false);
    expect(canUseScene("trophy", 0, new Set<SceneId>(["space"]))).toBe(false);
    expect(shownScene("space", 5)).toBe("stock");
    expect(shownScene("space", 0, new Set<SceneId>(["space"]))).toBe("space");
    for (const scene of [...FREE_SCENES, ...UNLOCK_SCENES]) expect(isShopScene(scene)).toBe(false);
  });

  it("keeps showing a saved Shop scene while the purchase isn't known: unknown is not \"no\"", () => {
    const none = new Set<SceneId>();
    // a positive "not bought": the stock card shows instead
    expect(sceneShows("space", { unlocked: true, bought: none, shopKnown: true })).toBe(false);
    // bought
    expect(sceneShows("space", { unlocked: false, bought: new Set<SceneId>(["space"]), shopKnown: true })).toBe(true);
    // loading, a failed read, or the Shop switched off: a buyer's card keeps its scene
    expect(sceneShows("space", { unlocked: false, bought: none, shopKnown: false })).toBe(true);
    // the other kinds don't depend on the Shop at all
    expect(sceneShows("stock", { unlocked: false, bought: none, shopKnown: false })).toBe(true);
    expect(sceneShows("trophy", { unlocked: false, bought: none, shopKnown: false })).toBe(false);
    expect(sceneShows("trophy", { unlocked: true, bought: none, shopKnown: true })).toBe(true);
  });

  it("draws a saved choice only while it is unlocked, and keeps it for when it is again", () => {
    expect(shownScene("spring", 1)).toBe("stock");
    expect(shownScene("spring", 3)).toBe("spring");
    expect(shownScene("stage", 0)).toBe("stage");
    expect(shownScene(null, 9)).toBe("stock");
  });
});

describe("the card's art (lib/cardArt)", () => {
  const every = SCENE_IDS.flatMap((scene) => TIERS.map((tier) => ({ scene, tier })));
  const docs = [
    ...every.map(({ scene, tier }) => ({ name: `${scene} art, ${tier}`, markup: cardArt(scene, tier) })),
    ...TIERS.map((tier) => ({ name: `the frame, ${tier}`, markup: cardFrame(tier) })),
  ];

  it("is plain shapes the server's renderer draws as they stand: no text, filters, scripts, styles, or anything fetched", () => {
    for (const d of docs) {
      expect(d.markup, d.name).not.toMatch(/<(text|filter|script|style|foreignObject|image|animate)\b/i);
      expect(d.markup, d.name).not.toMatch(/\b(class|style)=/);
      expect(d.markup, d.name).not.toMatch(/https?:\/\//);
    }
  });

  it("carries no number that isn't one (a NaN in a path drops the path without a word)", () => {
    for (const d of docs) expect(d.markup, d.name).not.toMatch(/NaN|Infinity|undefined|null/);
  });

  it("names each of its gradients, patterns, and clips once, and uses only names it made", () => {
    for (const d of docs) {
      const ids = [...d.markup.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size, d.name).toBe(ids.length);
      const used = [...d.markup.matchAll(/url\(#([^)]+)\)/g), ...d.markup.matchAll(/\bhref="#([^"]+)"/g)].map((m) => m[1]);
      for (const u of used) expect(ids, `${d.name} uses #${u}`).toContain(u);
    }
  });

  it("draws a row of beads as circles, never as zero-length dashes with round caps (a renderer may drop those without a word)", () => {
    for (const d of docs) expect(d.markup, d.name).not.toMatch(/stroke-dasharray="0[ ,"]/);
    // the stock card's medallion, the Stage's valance, and the Trophy Case's rosettes still have their beads
    expect(cardArt("stock", "Rare")).toContain(`fill="${CARD_LOOKS.Rare.ink}" opacity="0.85"`);
    expect((cardArt("stage", "Common").match(/fill="#c9a65c"\/>/g) ?? []).length).toBeGreaterThanOrEqual(5); // one row a swag
  });

  it("spaces beads evenly along a curve, one at each end", () => {
    const d = beadsOnCurve(0, 0, 50, 0, 100, 0, 10, 2, "#000"); // a straight "curve", 100 long
    const xs = [...d.matchAll(/M(-?[\d.]+) /g)].map((m) => Number(m[1]) + 2);
    expect(xs).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    const ring = beadRing(0, 0, 100, 10, 2, "#000");
    expect((ring.match(/M/g) ?? []).length).toBe(63); // 2π·100 / 10, to the nearest bead
  });

  it("is a still picture: nothing in it moves (starl3xx: only the card itself may)", () => {
    for (const d of docs) expect(d.markup, d.name).not.toMatch(/<animate|<set\b|@keyframes/i);
  });

  it("is the same picture every time (seeded, not random), on the server and in a browser", () => {
    for (const { scene, tier } of every) expect(cardArt(scene, tier)).toBe(cardArt(scene, tier));
  });

  it("stays a few hundred shapes at most: a picture, where a scene used to be a thousand elements in the page", () => {
    for (const d of docs) expect((d.markup.match(/<[a-z]/g) ?? []).length, d.name).toBeLessThan(400);
  });

  it("keeps a scene inside the frame's window, so the frame's paper shows around it", () => {
    for (const scene of SCENE_IDS) {
      const art = cardArt(scene, "Common");
      expect(art).toContain(`<clipPath id="w"><rect x="${WINDOW.x}" y="${WINDOW.y}" width="${WINDOW.w}" height="${WINDOW.h}"`);
      expect(art).toContain('clip-path="url(#w)"');
    }
  });

  it("prints only the two stock faces in the word's rarity: a place has inks of its own", () => {
    expect(cardArt("stock", "Rare")).not.toBe(cardArt("stock", "Mythic"));
    expect(cardArt("stock", "Rare")).toContain(CARD_LOOKS.Rare.ink);
    expect(cardArt("darkstock", "Rare")).not.toBe(cardArt("darkstock", "Mythic"));
    expect(cardArt("darkstock", "Rare")).toContain(CARD_LOOKS.Rare.tint);
    for (const scene of ["stage", "trophy", "spring", "bookshelf", "space"] as const) expect(cardArt(scene, "Rare")).toBe(cardArt(scene, "Mythic"));
    // the list that says so is true of every face: a face changes with the rarity exactly when it is listed
    expect([...RARITY_FACES].sort()).toEqual(["darkstock", "stock"]);
    for (const scene of SCENE_IDS) expect(cardArt(scene, "Rare") !== cardArt(scene, "Mythic"), scene).toBe(RARITY_FACES.has(scene));
  });

  it("keeps a face's picture per rarity where the rarity is printed, whichever rarity is drawn first (Bugbot on #303)", () => {
    // The game builds each picture once and then only names it. Keyed by face alone, the first
    // rarity drawn would colour every card on that face.
    for (const scene of SCENE_IDS) {
      const first = sceneArtImage(scene, "Mythic");
      const next = sceneArtImage(scene, "Common");
      expect(first !== next, scene).toBe(RARITY_FACES.has(scene));
      expect(sceneArtImage(scene, "Mythic"), scene).toBe(first); // and each is still built once
    }
    // the picture kept for a Common dark stock card is Common's own drawing, not the Mythic one made before it
    const common = sceneArtImage("darkstock", "Common");
    expect(common).toBe(`url("${svgDataUri(svgDoc(cardArt("darkstock", "Common")))}")`);
    expect(common).not.toBe(`url("${svgDataUri(svgDoc(cardArt("darkstock", "Mythic")))}")`);
  });

  it("washes the stock card with the rarity more lightly for a color that reads stronger (the green was too much)", () => {
    expect(CARD_LOOKS.Uncommon.wash).toBeLessThan(CARD_LOOKS.Rare.wash);
    expect(CARD_LOOKS.Rare.wash).toBeLessThan(CARD_LOOKS.Common.wash);
    for (const tier of TIERS) expect(CARD_LOOKS[tier].wash).toBeGreaterThan(0);
  });

  it("prints the frame in the rarity's ink, with the game's own rarity mark in its four corners", () => {
    for (const tier of TIERS) {
      const f = cardFrame(tier);
      expect(f).toContain(CARD_LOOKS[tier].ink);
      const base = tierMarkPaths(tier)[0].d;
      expect(f.split(base).length - 1, tier).toBe(4);
    }
  });

  it("makes one document a browser's image and CSS can load", () => {
    const doc = svgDoc(cardFrame("Common"));
    expect(doc.startsWith(`<svg xmlns="http://www.w3.org/2000/svg"`)).toBe(true);
    expect(doc).toContain(`viewBox="0 0 ${CARD_W} ${CARD_H}"`);
    const uri = svgDataUri(doc);
    expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
    expect(uri).not.toMatch(/["'<>#\s]/); // safe inside url("…")
    expect(decodeURIComponent(uri.slice("data:image/svg+xml,".length))).toBe(doc);
  });
});

describe("the dark stock face (decisions.md #57)", () => {
  // every path's own drawing (`d="…"`), longest first: the floor's tiles and lines are the longest
  const paths = (markup: string) => [...markup.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).sort((a, b) => b.length - a.length);

  it("is the stock face's own engraving: the same floor, the same sunburst, on another plate", () => {
    for (const tier of TIERS) {
      const light = paths(cardArt("stock", tier));
      const dark = paths(cardArt("darkstock", tier));
      // the tiles, the floor's lines, and the sunburst: each drawn once, and the same in both
      expect(dark.slice(0, 3), tier).toEqual(light.slice(0, 3));
      expect(light[0].length, tier).toBeGreaterThan(2000);
    }
  });

  it("prints every rarity on the same pewter plate: grey first, the rarity as an overtone only", () => {
    for (const tier of TIERS) {
      const art = cardArt("darkstock", tier);
      expect(art, tier).toContain(`fill="${PEWTER.field}"`);
      expect(art, tier).toContain(`fill="${PEWTER.floor}"`);
      // the rarity's ink is the light stock's print; here it would be dark on dark, so it is never used
      expect(art, tier).not.toContain(CARD_LOOKS[tier].ink);
    }
  });

  it("is pewter, never near black (starl3xx of the first plate: \"way too dark\")", () => {
    const light = (c: string) => [1, 3, 5].reduce((sum, i) => sum + parseInt(c.slice(i, i + 2), 16), 0) / 3 / 255;
    // the first plate was #262422, about 0.14; the owner chose the lightest of three steps up from it
    expect(light(PEWTER.field)).toBeGreaterThan(0.35);
    expect(light(PEWTER.field)).toBeLessThan(0.55); // and it is still the dark one beside the light stock
    expect(light(PEWTER.floor)).toBeLessThan(light(PEWTER.field)); // the floor is a shade deeper
  });

  it("stands the word in light: on the wall behind it and on the floor under it", () => {
    // A letter's arms, legs, and shoes are dark ink: without this light they are lost on the plate.
    expect(PEWTER.wall).toBeGreaterThan(0);
    expect(PEWTER.pool).toBeGreaterThan(0);
    const art = cardArt("darkstock", "Common");
    for (const id of ["wall", "pool"]) {
      expect(art).toContain(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse"`);
      expect(art).toContain(`fill="url(#${id})"`);
    }
    // the pool is on the feet line, and wide enough for a five-letter row (800 units)
    expect(art).toMatch(new RegExp(`id="pool" gradientUnits="userSpaceOnUse" cx="${CARD_W / 2}" cy="${FEET_Y + 4}" r="640"`));
  });

  it("is a dark face, as Outer Space is: the card's own light is fainter over it", () => {
    expect([...DARK_SCENES].sort()).toEqual(["darkstock", "space"]);
    const dark = render(<SceneFrame scene="darkstock" word="CRANE" upper={[true, true, true, false, false]} tier="Rare" animated={false} />).container;
    const pale = render(<SceneFrame scene="stock" word="CRANE" upper={[true, true, true, false, false]} tier="Rare" animated={false} />).container;
    expect(dark.querySelector(".cf")!.className).toContain("cf-dark");
    expect(pale.querySelector(".cf")!.className).not.toContain("cf-dark");
  });

  it("fades a hungry word's face less on a dark face: at the full amount a dark plate would stop being dark", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const strength = (selector: string) => {
      const m = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.]/g, "\\.")} \\{[^}]*opacity: ([\\d.]+); \\}`));
      expect(m, selector).not.toBeNull();
      return Number(m![1]);
    };
    const peckish = strength(".scene-peckish");
    const hungry = strength(".scene-hungry");
    const darkPeckish = strength(".cf-dark .scene-peckish");
    const darkHungry = strength(".cf-dark .scene-hungry");
    expect(darkHungry).toBeGreaterThan(hungry); // more ink is left on a dark plate
    expect(darkPeckish).toBeGreaterThan(peckish);
    expect(darkHungry).toBeLessThan(darkPeckish); // hungrier is still fainter
    expect(darkPeckish).toBeLessThan(1); // and a peckish word still shows it
  });

  it("has an id that share links and saved picks carry, so it never changes", () => {
    expect(isSceneId("darkstock")).toBe(true);
    expect(parseLinkScene("darkstock")).toBe("darkstock");
    expect(storedScene("darkstock")).toBe("darkstock");
    expect(sceneMeta("stock").name).toBe("Stock (light)");
    expect(sceneMeta("darkstock").name).toBe("Stock (dark)");
    expect(canUseScene("darkstock", 0)).toBe(true);
  });
});

describe("where the word stands", () => {
  it("puts the feet two thirds of the way down the card, the row centered", () => {
    expect(FEET_Y).toBe(450);
    for (const n of [3, 5, 7]) {
      const L = wordLayout(n);
      expect(L.feetY).toBe(FEET_Y);
      expect(Math.abs(L.rowTop + L.tileH * FOOT_SHARE - FEET_Y)).toBeLessThanOrEqual(1); // to the nearest unit
      expect(Math.abs(L.rowLeft + L.rowW / 2 - CARD_W / 2)).toBeLessThanOrEqual(1);
      expect(L.rowLeft).toBeGreaterThan(WINDOW.x);
      expect(L.rowBottom).toBeLessThan(WINDOW.y + WINDOW.h);
    }
  });

  it("scales with the card, so the game and the share picture agree", () => {
    const a = wordLayout(5);
    const b = wordLayout(5, 0.8);
    expect(b.tileW / a.tileW).toBeCloseTo(0.8, 1);
    expect(b.feetY).toBe(Math.round(FEET_Y * 0.8));
    expect(b.rowLeft / a.rowLeft).toBeCloseTo(0.8, 1);
  });

  it("stands upright on level ground: the stock card, the Stage, the Trophy Case, the Bookshelf", () => {
    for (const scene of ["stock", "stage", "trophy", "bookshelf"] as const) {
      expect(GROUND[scene]).toBeUndefined();
      for (const f of wordFootings(scene, 5)) expect(f).toEqual({ drop: 0, deg: 0 });
    }
  });

  it("stands on Spring's hill: lower and turned outward toward the word's ends, level in the middle, the same on both sides", () => {
    const f = wordFootings("spring", 5);
    expect(f[2].drop).toBeCloseTo(0, 5);
    expect(f[2].deg).toBeCloseTo(0, 5);
    expect(f[0].drop).toBeGreaterThan(f[1].drop);
    expect(f[1].drop).toBeGreaterThan(0);
    expect(f[0].deg).toBeLessThan(0); // the left end leans left, down the hill
    expect(f[4].deg).toBeCloseTo(-f[0].deg, 5);
    expect(f[4].drop).toBeCloseTo(f[0].drop, 5);
  });

  it("stands on Outer Space's little planet: a tighter curve than the hill, the same on both sides", () => {
    const planet = wordFootings("space", 5);
    const hill = wordFootings("spring", 5);
    expect(planet[2]).toEqual({ drop: 0, deg: 0 });
    expect(planet[0].drop).toBeGreaterThan(hill[0].drop);
    expect(Math.abs(planet[0].deg)).toBeGreaterThan(Math.abs(hill[0].deg));
    expect(planet[4].deg).toBeCloseTo(-planet[0].deg, 5);
  });

  it("keeps any curve gentle enough for held hands: a slope under 12 degrees along a full-width word", () => {
    for (const scene of SCENE_IDS) for (const f of wordFootings(scene, 8)) expect(Math.abs(f.deg)).toBeLessThan(12);
  });

  it("takes a new curved scene as one height curve: a dip lowers the middle and turns the ends inward", () => {
    const dip = groundOf((s) => 40 * (1 - (s / 480) ** 2)); // a bridge's sag, 40 units at its middle
    expect(dip(0)).toEqual({ drop: 40, deg: 0 });
    expect(dip(-300).drop).toBeLessThan(40);
    expect(dip(-300).deg).toBeGreaterThan(0);
    expect(dip(300).deg).toBeLessThan(0);
    expect(footingFor("stage", 250)).toEqual({ drop: 0, deg: 0 });
  });

  it("gives the share picture its drops in its own pixels and the same turns", () => {
    const a = wordFootings("spring", 5);
    const b = wordFootings("spring", 5, 0.8);
    expect(b[0].drop).toBeCloseTo(a[0].drop * 0.8, 5);
    expect(b[0].deg).toBeCloseTo(a[0].deg, 5);
  });
});

describe("the front of a word's card (SceneFrame)", () => {
  const card = (props: Partial<Parameters<typeof SceneFrame>[0]> = {}) => render(<SceneFrame scene="stock" word="CRANE" upper={[true, true, true, false, false]} tier="Rare" animated={false} {...props} />).container;

  it("draws the art and the frame as two pictures, not as shapes in the page", () => {
    const c = card();
    const art = c.querySelector<HTMLElement>(".cf-art")!;
    const frame = c.querySelector<HTMLElement>(".cf-frame")!;
    expect(art.style.backgroundImage).toMatch(/^url\("data:image\/svg\+xml,/);
    expect(frame.style.backgroundImage).toMatch(/^url\("data:image\/svg\+xml,/);
    expect(art.childElementCount + frame.childElementCount).toBe(0);
  });

  it("letters the ribbon: one of one, the card's number, the rarity, in that order (starl3xx, 2026-11-25)", () => {
    const text = card({ number: 20 }).querySelector(".cf-ribbon")!.textContent!;
    expect(text).toBe("One of oneNo. 0020Rare");
  });

  it("leaves the number out while it isn't known, and never shows a dash or a guess", () => {
    for (const number of [undefined, null, 0]) {
      const text = card({ number }).querySelector(".cf-ribbon")!.textContent!;
      expect(text).toBe("One of oneRare");
    }
  });

  it("never letters the word itself on the card: a word is only ever its tiles, in Söhne", () => {
    expect(card({ number: 20 }).querySelector(".cf-ribbon")!.textContent).not.toMatch(/crane/i);
  });

  it("has no ribbon on a thumbnail, nor on a card with no word's rarity to state", () => {
    expect(card({ small: true }).querySelector(".cf-ribbon")).toBeNull();
    expect(card({ tier: undefined, word: "" }).querySelector(".cf-ribbon")).toBeNull();
  });

  it("stands each letter on the feet line, and on Spring's hill turns it to the slope", () => {
    const level = card({ scene: "stage" });
    for (const t of Array.from(level.querySelectorAll<HTMLElement>(".cf-word [data-tc]"))) expect(t.parentElement!.style.transform).toBe("");
    const hill = card({ scene: "spring" });
    const stands = Array.from(hill.querySelectorAll<HTMLElement>(".cf-word [data-tc]")).map((t) => t.parentElement!.style);
    expect(stands).toHaveLength(5);
    expect(stands[0].transform).toMatch(/^translateY\([\d.]+cqw\) rotate\(-[\d.]+deg\)$/);
    expect(stands[2].transform).toBe("");
    expect(stands[4].transform).toMatch(/^translateY\([\d.]+cqw\) rotate\([\d.]+deg\)$/);
    expect(stands[0].transformOrigin).toBe("50% 88.82%"); // about its own feet
  });

  it("prints the face with less ink as the word gets hungry: the art only, never the frame, and nothing laid over the card", () => {
    expect(toneOf("hungry")).toBe("hungry");
    expect(toneOf("eating")).toBe("fed");
    const c = card({ tone: "hungry", state: "hungry" });
    // the tone is on the GROUP of art layers, never on a picture itself
    expect(c.querySelector(".cf-arts")!.className).toContain("scene-hungry");
    expect(c.querySelector(".cf-art")!.className).not.toContain("scene-hungry");
    expect(c.querySelector(".cf-art")!.parentElement!.className).toContain("cf-arts");
    expect(c.querySelector(".cf-frame")!.className).not.toContain("scene-");
    // the fog that used to roll over the scene and the word is gone (decisions.md #61)
    expect(c.querySelector(".cf-fog, .scene-fog, [class*='fog']")).toBeNull();
    expect(card({ tone: "peckish", state: "peckish" }).querySelector(".cf-arts")!.className).toContain("scene-peckish");
    expect(card().querySelector(".cf-arts")!.className).not.toMatch(/scene-(peckish|hungry)/);
  });

  it("fades a hungry card's two pictures as one during a face change: see-through pictures would add up, then pop", () => {
    // Bugbot on #328: the old face stays under the new one until it is in. With the tone on each
    // picture, two hungry faces showed more ink than one, and the card went paler when the old one left.
    const frame = (scene: "stock" | "stage") => <SceneFrame scene={scene} word="CRANE" upper={[true, true, true, false, false]} tier="Rare" animated={false} tone="hungry" state="hungry" change="fade" />;
    const { container, rerender } = render(frame("stock"));
    rerender(frame("stage"));
    const group = container.querySelector(".cf-arts")!;
    expect(group.className).toContain("scene-hungry");
    const pictures = [...group.querySelectorAll(".cf-art")];
    expect(pictures).toHaveLength(2); // the old face under the new one
    for (const p of pictures) expect(p.className).not.toMatch(/scene-(tone|peckish|hungry)/);
    expect(container.querySelectorAll(".cf > .cf-art")).toHaveLength(0);
  });

  it("prints a card with no rarity as Common, and a thumbnail in the rarity it is shown for", () => {
    const plain = render(<SceneFrame scene="stock" word="" upper={[]} />).container;
    expect(decodeURIComponent(plain.querySelector<HTMLElement>(".cf-frame")!.style.backgroundImage)).toContain(CARD_LOOKS.Common.ink);
    const thumb = render(<SceneThumb scene="stock" tier="Mythic" />).container;
    expect(decodeURIComponent(thumb.querySelector<HTMLElement>(".cf-frame")!.style.backgroundImage)).toContain(CARD_LOOKS.Mythic.ink);
    expect(thumb.querySelector(".cf-ribbon")).toBeNull();
  });

  it("renders on the server too (the share page), with the same row", () => {
    const html = renderToStaticMarkup(<SceneFrame scene="spring" word="CRANE" upper={[true, true, true, false, false]} tier="Common" number={3} animated={false} />);
    expect(html).toContain("cf-ribbon");
    expect(html).toContain("No. 0003");
    expect(html.match(/data-tc/g)).toHaveLength(5);
  });
});
