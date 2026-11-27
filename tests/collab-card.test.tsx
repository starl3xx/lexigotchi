/**
 * @vitest-environment jsdom
 *
 * A collab word's card, where it is drawn (decisions.md, "Collab sets", item 3): its tiles wear
 * its set's two colors in place of its rarity's material, its card's front is the collab stock in
 * those colors with the set's stamp in one fixed place, and its card pictures' addresses name its
 * look. The case still owns the border and ascension its rings: neither reads the look.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { collabCardLook, lookOf, type CollabLook } from "@/lib/collabLook";
import { CARD_LOOKS } from "@/lib/cardArt/looks";
import { cardArt, cardFrame } from "@/lib/cardArt/scenes";
import { FINISH, collabFinish } from "@/lib/rarityFinish";
import { CARD_CACHE_LONG, CARD_CACHE_SHORT, CARD_LOOK, cardPictureCache, parseLinkMark, showcaseCardPath, showcaseCardUrl, showcaseFacePath, showcaseStagePath } from "@/lib/showcase";

const A = "#1f6f8b";
const B = "#f2a65a";
const STAMP = "data:image/png;base64,AAAA";
const LOOK: CollabLook = lookOf(7, { partner: "Test partner", url: null, colorA: A, colorB: B, stamp: "/api/sets/7/stamp?v=123" });

// jsdom has no matchMedia; this viewer doesn't ask for reduced motion
window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

// The game's lookup is the sets answer; here a stand-in gives one collab word its look.
const hook = vi.hoisted(() => ({ collab: new Map<string, unknown>() }));
vi.mock("@/components/game/useSets", () => ({ useSets: () => ({ collab: hook.collab }) }));
vi.mock("@/lib/onchain/gameMode", () => ({ isChainBacked: () => true }));

beforeEach(() => {
  hook.collab = new Map([["CRANE", LOOK]]);
});
afterEach(cleanup);

describe("the tiles", () => {
  it("wear the set's two colors in place of the rarity's material, with no gold on them", async () => {
    const { WordTiles } = await import("@/components/game/LetterTile");
    const upper = [true, true, false, false, true];
    const collab = renderToStaticMarkup(<WordTiles word="CRANE" upper={upper} size={48} tier="Legendary" look={LOOK} still />);
    const gold = renderToStaticMarkup(<WordTiles word="CRANE" upper={upper} size={48} tier="Legendary" look={null} still />);
    const fin = collabFinish({ a: A, b: B });
    for (const c of fin.face) expect(collab).toContain(`stop-color="${c}"`);
    for (const c of FINISH.Legendary!.face) expect(collab).not.toContain(`stop-color="${c}"`);
    expect(gold).toContain(`stop-color="${FINISH.Legendary!.face[0]}"`);
    // the case still owns the border, and the letter its ink: the same on both
    const strokes = (html: string) => [...html.matchAll(/stroke="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1].toLowerCase());
    for (const ink of ["#111827", "#2a1e1a"]) expect(collab).toContain(`fill="${ink}"`);
    expect(new Set(strokes(collab).filter((s) => new Set(strokes(gold)).has(s))).size).toBeGreaterThan(0);
  });
  it("is matte: no hot spot and no edge glint, in the game and on the server, as its small tiles have no gloss", async () => {
    const { polished, FINISH: F, collabFinish: cf } = await import("@/lib/rarityFinish");
    expect(polished(cf({ a: A, b: B }))).toBe(false);
    expect(polished(F.Uncommon!)).toBe(false); // satin, as before
    for (const t of ["Rare", "Legendary", "Mythic"] as const) expect(polished(F[t]!)).toBe(true);
    // every "is it polished?" in the two tile renderers asks the one function: a new material can't be missed in one of them
    for (const f of ["src/components/game/TileFinish.tsx", "src/app/_og/tile.tsx"]) {
      const src = readFileSync(join(__dirname, "..", f), "utf8");
      expect(src, f).not.toMatch(/!== "satin"/);
      expect(src, f).toContain("polished(fin)");
    }
    // and a collab tile at rest draws no hot spot (the radial gradient a polished tile has)
    const { WordTiles } = await import("@/components/game/LetterTile");
    const upper = [true, true, false, false, true];
    const collab = renderToStaticMarkup(<WordTiles word="CRANE" upper={upper} size={48} tier="Legendary" look={LOOK} />);
    const gold = renderToStaticMarkup(<WordTiles word="CRANE" upper={upper} size={48} tier="Legendary" look={null} />);
    expect(gold).toContain("radialGradient");
    expect(collab).not.toContain("radialGradient");
  });
  it("ascension still draws on a collab word: its rings and pips are there at a stage", async () => {
    const { WordTiles } = await import("@/components/game/LetterTile");
    const all = [true, true, true, true, true];
    const plain = renderToStaticMarkup(<WordTiles word="CRANE" upper={all} size={48} tier="Legendary" look={LOOK} still />);
    const gilded = renderToStaticMarkup(<WordTiles word="CRANE" upper={all} size={48} tier="Legendary" gild={3} look={LOOK} still />);
    expect(gilded.length).toBeGreaterThan(plain.length); // the rings, laurels, and pips are added
    expect(gilded).toContain(`stop-color="${A}"`); // on the same collab stock
  });
  it("a word draws its own look in the game, with nothing passed: by the word", async () => {
    const { WordTiles } = await import("@/components/game/LetterTile");
    const { MiniTiles } = await import("@/components/game/MiniTiles");
    const { CollabLooksProvider } = await import("@/components/game/collabLooks");
    const upper = [false, false, false, false, false];
    const { container } = render(
      <CollabLooksProvider>
        <div id="collab"><WordTiles word="CRANE" upper={upper} size={48} tier="Legendary" still /></div>
        <div id="other"><WordTiles word="MOTEL" upper={upper} size={48} tier="Legendary" still /></div>
        <div id="mini"><MiniTiles word="CRANE" upper={upper} tier="Legendary" /></div>
        <div id="mini-other"><MiniTiles word="MOTEL" upper={upper} tier="Legendary" /></div>
      </CollabLooksProvider>,
    );
    const html = (id: string) => container.querySelector(`#${id}`)!.innerHTML.toLowerCase();
    expect(html("collab")).toContain(A);
    expect(html("other")).not.toContain(A);
    expect(html("other")).toContain(FINISH.Legendary!.face[0]);
    // the small tiles: the two colors as their background, in place of gold
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ");
    expect(html("mini")).toContain(`rgba(${rgb(A)}`);
    expect(html("mini-other")).not.toContain(`rgba(${rgb(A)}`);
  });
  it("without the game's lookup (a page outside the game, a test) a word is drawn in its rarity", async () => {
    const { WordTiles } = await import("@/components/game/LetterTile");
    const html = renderToStaticMarkup(<WordTiles word="CRANE" upper={[false, false, false, false, false]} size={48} tier="Legendary" still />);
    expect(html).not.toContain(A);
  });
});

describe("who draws a word's tiles", () => {
  it("the word's row looks its look up itself, and only for a word drawn WITH its rarity", async () => {
    const { TileWord } = await import("@/components/game/TileCharacter");
    const { CollabLooksProvider } = await import("@/components/game/collabLooks");
    const upper = [false, false, false, false, false];
    const { container } = render(
      <CollabLooksProvider>
        <div id="word"><TileWord word="CRANE" upper={upper} size={48} tier="Legendary" still /></div>
        <div id="example"><TileWord word="CRANE" upper={upper} size={48} still /></div>
      </CollabLooksProvider>,
    );
    expect(container.querySelector("#word")!.innerHTML.toLowerCase()).toContain(A);
    // an example word (the onboarding's CRANE) has no rarity and is never dressed as a set's
    expect(container.querySelector("#example")!.innerHTML.toLowerCase()).not.toContain(A);
  });
  it("every tile drawn one by one with a rarity is given the word's look (the list of who may)", () => {
    // `TileWord`, `WordTiles`, `MiniTiles`, `SceneFrame`, and the server's `wordCard` look a word's
    // look up or are handed it. A file that draws `TileCharacter` or `OgTile` itself WITH a tier
    // must pass what `tileTierOf` gave it: otherwise a collab word is gold there (the advisor
    // found five such places before this test existed).
    const { readdirSync, statSync } = require("fs") as typeof import("fs");
    const root = join(__dirname, "..");
    const files = (dir: string): string[] =>
      readdirSync(join(root, dir)).flatMap((name: string) => {
        const rel = `${dir}/${name}`;
        return statSync(join(root, rel)).isDirectory() ? files(rel) : /\.tsx$/.test(name) ? [rel] : [];
      });
    const wrong: string[] = [];
    let seen = 0;
    for (const f of files("src")) {
      if (f === "src/components/game/TileCharacter.tsx") continue; // the row passes its own letters' tier on
      const src = readFileSync(join(root, f), "utf8");
      // Each tag up to its own end: a prop like `linkLeft={i > 0}` holds a `>`, so the tag is read to its `/>`.
      for (const m of src.matchAll(/<(TileCharacter|OgTile)\b/g)) {
        const tag = src.slice(m.index, src.indexOf("/>", m.index) + 2);
        const tier = /\btier=\{([^}]*)\}/.exec(tag);
        if (!tier) continue; // no rarity: a loose letter, an example
        seen++;
        if (!/^(tileTier|tileTierOf\(.*\)|spec\.tier)$/.test(tier[1].trim())) wrong.push(`${f}: <${m[1]} tier={${tier[1]}}>`);
      }
    }
    expect(wrong).toEqual([]);
    expect(seen).toBeGreaterThanOrEqual(6); // SceneFrame, CardBack, LookupSheet, the video's letters, the server's card and back
  });
});

describe("the card's own colors", () => {
  it("every color picked by a word's rarity asks for its collab look first (the list of where)", () => {
    // The tiles are held by the scan above; these are the card's other inks, each from a table
    // keyed by tier: the frame's and the case's ink, the back's line, the band of light. A collab
    // word is Legendary, so any of these read by tier alone comes out gold (a review found the
    // video's stamp, the case's label, and the sheen that way).
    const { readdirSync, statSync } = require("fs") as typeof import("fs");
    const root = join(__dirname, "..");
    const files = (dir: string): string[] =>
      readdirSync(join(root, dir)).flatMap((name: string) => {
        const rel = `${dir}/${name}`;
        return statSync(join(root, rel)).isDirectory() ? files(rel) : /\.tsx?$/.test(name) ? [rel] : [];
      });
    const wrong: string[] = [];
    let seen = 0;
    for (const f of [...files("src/components"), ...files("src/app")]) {
      const src = readFileSync(join(root, f), "utf8");
      src.split("\n").forEach((line, i) => {
        if (!/\b(CARD_LOOKS|MATERIAL_LINE|CARD_SHEEN)\[[^\]"']*tier/.test(line)) return; // keyed by a word's tier
        seen++;
        // the same line decides by the look first: `mine ? … :`, `look ? … :`, `collab?.… ??`, `… ?? CARD_LOOKS[…]`
        if (!/\b(mine|look|collab|collabLook)\b[^;]*(\?|\?\?)|\?\?\s*(CARD_LOOKS|MATERIAL_LINE)\[/.test(line)) wrong.push(`${f}:${i + 1} ${line.trim().slice(0, 90)}`);
      });
    }
    expect(wrong).toEqual([]);
    expect(seen).toBeGreaterThanOrEqual(6); // SceneFrame, wordCard, CardCase, SceneCard, CardBack (twice), ShareVideo
  });
});

describe("the card's front", () => {
  it("the stock card's wash takes the two colors, and the frame the look's ink; a rarity's card is what it was", () => {
    const L = collabCardLook(LOOK);
    const art = cardArt("stock", "Legendary", L);
    expect(art).toContain(`stop-color="${A}"`);
    expect(art).toContain(`stop-color="${B}"`);
    expect(cardFrame("Legendary", L)).toContain(`stroke="${L.ink}"`);
    expect(cardFrame("Legendary", L)).not.toContain(CARD_LOOKS.Legendary.ink);
    // a rarity's own art and frame: one tint, three stops, exactly the strengths they always had
    const plain = cardArt("stock", "Legendary");
    const t = CARD_LOOKS.Legendary;
    const at = (v: number) => Math.round(v * t.wash * 100 * 10) / 10 / 100;
    expect(plain).toContain(
      `<radialGradient id="tint" cx="0.5" cy="0.56" r="0.72"><stop offset="0" stop-color="${t.tint}" stop-opacity="${at(0.28)}"/><stop offset="0.55" stop-color="${t.tint}" stop-opacity="${at(0.11)}"/><stop offset="1" stop-color="${t.tint}" stop-opacity="${at(0.03)}"/></radialGradient>`,
    );
    expect(plain).not.toContain(B);
    // a place has inks of its own: only the stock card takes the two colors
    expect(cardArt("stage", "Legendary", L)).toBe(cardArt("stage", "Legendary"));
  });
  it("in the game: the look's ink on the frame and ribbon, the stamp in its one place, the rarity still named", async () => {
    const { SceneFrame } = await import("@/components/scenes/SceneFrame");
    const upper = [true, true, false, false, true];
    const { container } = render(<SceneFrame scene="stock" word="CRANE" upper={upper} tier="Legendary" number={12} collab={{ ...LOOK, stamp: STAMP }} animated={false} />);
    const card = container.querySelector(".cf") as HTMLElement;
    expect(card.style.getPropertyValue("--cf-ink")).toBe(collabCardLook(LOOK).ink);
    const stamp = container.querySelector("img.cf-stamp") as HTMLImageElement;
    expect(stamp.getAttribute("src")).toBe(STAMP);
    expect(stamp.getAttribute("alt")).toBe(""); // decoration: the partner is named on the back, in words
    expect(container.textContent).toContain("Legendary");
    expect(container.innerHTML.toLowerCase()).toContain(A); // the tiles on it wear the look too
  });
  it("a word of no collab set has no stamp and its rarity's ink; a collab with no stamp has none either", async () => {
    const { SceneFrame } = await import("@/components/scenes/SceneFrame");
    const upper = [true, true, false, false, true];
    const plain = render(<SceneFrame scene="stock" word="CRANE" upper={upper} tier="Legendary" collab={null} animated={false} />);
    expect(plain.container.querySelector(".cf-stamp")).toBeNull();
    expect((plain.container.querySelector(".cf") as HTMLElement).style.getPropertyValue("--cf-ink")).toBe(CARD_LOOKS.Legendary.ink);
    cleanup();
    const bare = render(<SceneFrame scene="stock" word="CRANE" upper={upper} tier="Legendary" collab={{ ...LOOK, stamp: null }} animated={false} />);
    expect(bare.container.querySelector(".cf-stamp")).toBeNull();
  });
  it("the stamp's one place is clear of the corner piece, the word, and the ribbon; a thumbnail has none", () => {
    const css = readFileSync(join(__dirname, "..", "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = /\.cf-stamp \{([^}]*)\}/.exec(css)![1];
    const pct = (name: string) => Number(new RegExp(`${name}: ([0-9.]+)%`).exec(rule)![1]);
    const [left, top, width] = [pct("left") * 12, pct("top") * 6.75, pct("width") * 12]; // in card units (1200 × 675)
    expect(left).toBeGreaterThan(46); // past the corner piece (13 to 46)
    expect(left + width).toBeLessThan(200); // before the word's row
    expect(top).toBeGreaterThan(46);
    expect(top + width).toBeLessThan(224); // above the letters' tops
    expect(css).toMatch(/\.cf-small \.cf-stamp \{ display: none; \}/);
    // and the server draws it in the same place (app/_og/wordCard.tsx): 62 in, 60 down, 92 across
    const og = readFileSync(join(__dirname, "..", "src/app/_og/wordCard.tsx"), "utf8");
    expect(og).toContain("left: Math.round(62 * k), top: Math.round(60 * k)");
    expect([Math.round(left), Math.round(top), Math.round(width)]).toEqual([62, 60, 92]);
  });
});

describe("the stamp's plate", () => {
  it("stands the stamp on the card's own paper, ruled in the frame's ink, in the game and on the server alike", () => {
    // A stamp is any picture: without a plate a dark one was lost on Outer Space and a pale one on
    // the stock card (seen in both engines). On paper, a mark made for a light ground always reads.
    const css = readFileSync(join(__dirname, "..", "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = /\.cf-stamp \{([^}]*)\}/.exec(css)![1];
    expect(rule).toContain("background: #fcf7ea"); // CARD_PAPER
    expect(rule).toMatch(/border: [^;]* solid var\(--cf-ink\)/);
    expect(rule).toContain("object-fit: contain");
    const og = readFileSync(join(__dirname, "..", "src/app/_og/wordCard.tsx"), "utf8");
    expect(og).toContain("background: CARD_PAPER");
    expect(og).toMatch(/border: `\$\{[^`]*\}px solid \$\{look\.ink\}`/);
  });
});

describe("the card's back", () => {
  const read = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");
  it("says the partner and “1 of 5”", async () => {
    const { collabLine, BACK_PARTNER_MAX } = await import("@/lib/cardFacts");
    expect(collabLine("Test partner")).toBe("Test partner · 1 of 5");
    expect(collabLine("Test partner", true)).toBe("Test partner · 1 of 5");
    // On the back it is ONE line in a narrow column: a name of 60 characters is cut in the text
    // itself, so the game's back and the server's picture agree and neither runs into the ledger.
    const long = "P".repeat(60);
    expect(collabLine(long, true)).toBe(`${"P".repeat(BACK_PARTNER_MAX - 1)}… · 1 of 5`);
    expect(collabLine(long, true).length).toBeLessThanOrEqual(BACK_PARTNER_MAX + 9);
    expect(collabLine(long)).toBe(`${long} · 1 of 5`); // the row under an opened card wraps: the whole name
  });
  it("the cream type the colorway is deepened for is the back's own", async () => {
    const { BACK_TEXT } = await import("@/lib/collabLook");
    expect(read("src/app/globals.css")).toContain(`--cb-text: ${BACK_TEXT};`);
    expect(read("src/app/s/[text]/back/route.tsx")).toMatch(new RegExp(`const TEXT = "${BACK_TEXT}"`));
  });
  it("in the game: the colorway in place of the rarity's material, with none of a material's extras and no live shader", () => {
    const src = read("src/components/cards/CardBack.tsx");
    expect(src).toContain('className={`cb ${collab ? "m-collab" : `m-${m}`}`} style={collab?.style}');
    expect(src).toContain("const drawLive = live && !mini && !reduced && !lowPower && !collab && canDrawLive();");
    for (const extra of ['m === "rare" && <div className="cb-brush" />', 'm === "legendary" && <div className="cb-glitter" />', 'm === "mythic" && <Facets />', 'm === "mythic" && <div className="cb-fire" />']) {
      expect(src, extra).toContain(`!collab && ${extra}`);
    }
    expect(src).toContain("{f.collab && <span className=\"cb-collab\">{collabLine(f.collab, true)}</span>}");
    expect(src).toContain('{f.collab && <Row label="Collab">{collabLine(f.collab)}</Row>}'); // a phone-sized back leaves the line out; the rows under the card carry it
    // the colors come from the one function that deepens them until the cream type reads
    expect(src).toContain("const b = collabBack(look);");
  });
  it("on the server: the colorway is painted INTO the picture (the video's shader paints a rarity's under a clear ground)", () => {
    const src = read("src/app/s/[text]/back/route.tsx");
    expect(src).toContain("const colorway = mine ? collabBack(mine) : null;");
    expect(src).toContain("backgroundImage: `linear-gradient(165deg, ${colorway.base2}, ${colorway.base} 70%)`");
    expect(src).toMatch(/tier === "Legendary" &&\s*!colorway &&/); // no gold scrollwork on a partner's colorway
    // the partner line: cut to fit, and in the back's full cream in BOTH renderers (the server's was dimmer: Bugbot on #306)
    expect(src).toContain("{mine && <div style={{ display: \"flex\", fontSize: 1.9 * U, lineHeight: 1.2, color: TEXT }}>{collabLine(mine.partner, true)}</div>}");
    expect(read("src/app/globals.css")).toMatch(/\.cb-collab \{[^}]*color: var\(--cb-text\)/);
    // the game's back and the server's use the same two grounds
    expect(read("src/components/cards/CardBack.tsx")).toContain("`linear-gradient(165deg, ${b.base2}, ${b.base} 70%)`");
  });
});

describe("the server's card picture", () => {
  const tiles = [..."CRAne"].map((char) => ({ char: char.toUpperCase(), upper: char === char.toUpperCase() }));
  it("draws a collab word in its look, with its stamp as bytes it was handed", async () => {
    const { wordCard } = await import("@/app/_og/wordCard");
    const html = renderToStaticMarkup(wordCard({ tiles, scene: "stock", cardW: 1200, collab: new Map([["CRANE", LOOK]]), stamp: STAMP, no: "0012" }));
    expect(html).toContain(`src="${STAMP}"`);
    expect(html).toContain(collabCardLook(LOOK).ink); // the ribbon's lettering
    expect(html.toLowerCase()).toContain(`stop-color="${A}"`); // its tiles
    expect(html).not.toContain(`stop-color="${FINISH.Legendary!.face[0]}"`);
    expect(html).toContain("Legendary");
  });
  it("draws any other word as before, and never a stamp for it", async () => {
    const { wordCard } = await import("@/app/_og/wordCard");
    const html = renderToStaticMarkup(wordCard({ tiles, scene: "stock", cardW: 1200, collab: new Map(), stamp: STAMP }));
    expect(html).not.toContain(STAMP);
    expect(html).not.toContain(A);
  });
});

describe("a card picture's address names the word's look", () => {
  it("as `c`, on the link picture, the face, and the video's stage; a word with none has none", () => {
    expect(showcaseCardPath("CRAne", "x", undefined, false, 2, LOOK.mark)).toBe(`/s/CRAne/card?v=${CARD_LOOK}&g=2&c=7-123`);
    expect(showcaseFacePath("CRAne", undefined, null, LOOK.mark)).toBe(`/s/CRAne/card?face=1&v=${CARD_LOOK}&c=7-123`);
    expect(showcaseStagePath("CRAne", undefined, 1, LOOK.mark)).toBe(`/s/CRAne/card?face=1&letters=0&v=${CARD_LOOK}&g=1&c=7-123`);
    expect(showcaseCardUrl("CRAne", "x", undefined, true, null, LOOK.mark)).toContain("&c=7-123");
    expect(showcaseFacePath("CRAne", undefined, 2)).toBe(`/s/CRAne/card?face=1&v=${CARD_LOOK}&g=2`); // unchanged for every other word
    expect(showcaseFacePath("CRAne", undefined, 2, null)).not.toContain("c=");
  });
  it("is read back strictly, and only ever compared", () => {
    expect(parseLinkMark("7-123")).toBe("7-123");
    for (const bad of ["", "7", "7-", "-123", "7-123x", "<script>", "7-123&x=1", null, undefined]) expect(parseLinkMark(bad as string)).toBeNull();
  });
  it("a picture is kept long only when its address names the look the word has", () => {
    const known = { waiting: false, level: 0, hint: null };
    expect(cardPictureCache({ ...known, mark: "7-123", look: "7-123" })).toBe(CARD_CACHE_LONG);
    expect(cardPictureCache({ ...known })).toBe(CARD_CACHE_LONG); // a word of no collab set, as before
    // an old link to a word whose set has since been revealed: asked again soon, never kept a week
    expect(cardPictureCache({ ...known, mark: null, look: "7-123" })).toBe(CARD_CACHE_SHORT);
    expect(cardPictureCache({ ...known, mark: "7-100", look: "7-123" })).toBe(CARD_CACHE_SHORT); // a stamp replaced before the reveal
    expect(cardPictureCache({ ...known, mark: "7-123", look: null })).toBe(CARD_CACHE_SHORT); // an address that claims a look the word doesn't have
  });
  it("the earnings picture is kept long only when it was drawn whole: the sets read, and the hero word's stamp drawn", () => {
    // It used to be a week whatever happened; X and Farcaster keep what they first read (Bugbot on #302).
    const route = readFileSync(join(__dirname, "..", "src/app/e/[token]/card/route.tsx"), "utf8");
    expect(route).toContain("const whole = setsRead && !(mine?.stamp && !stamp);");
    expect(route).toContain('headers: { "cache-control": whole ? CARD_CACHE_LONG : CARD_CACHE_SHORT }');
    expect(CARD_CACHE_LONG).toBe("public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400"); // what the route sent before, unchanged when whole
    // a picture with no word on it reads no sets, and is whole
    expect(route).toContain("tiles ? await collabSoonRead() : { looks: NO_LOOKS, known: true }");
  });
  it("a draft's word gets the same address and the same caching as any word: nothing to read from a header", () => {
    // The look map holds nothing of a draft (lib/collabLook.ts), so the route sees `look: null`
    // and the game builds an address with no `c`: exactly a plain word's.
    expect(cardPictureCache({ waiting: false, level: 0, hint: null, mark: null, look: null })).toBe(CARD_CACHE_LONG);
    const route = readFileSync(join(__dirname, "..", "src/app/s/[text]/card/route.tsx"), "utf8");
    expect(route).toContain("look: mine?.mark ?? null");
    expect(route).toContain("const mine = collab.get(word.toUpperCase());");
  });
});
