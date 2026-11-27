import { readFileSync } from "fs";
import { join } from "path";
import { ImageResponse } from "next/og";
import { OgTile } from "../../../_og/tile";
import { CARD_SERIF, CARD_SERIF_FILE } from "../../../_og/wordCard";
import { parseLinkStage, parseShowcase } from "@/lib/showcase";
import { cardLevelOf } from "@/lib/onchain/cardLevel";
import type { Tier } from "@/lib/economy";
import { tierCountsWith, tierFn, tierWith } from "@/lib/rarity";
import { collabSoon } from "@/lib/raritySoon";
import { collabBack, tintOf } from "@/lib/collabLook";
import { collabLine } from "@/lib/cardFacts";
import { tierMarkPaths } from "@/lib/tierMark";
import { PIP_Y, pipPath } from "@/components/game/tileShapes";
import { cardDigits, shortTokenId, tierCount, type WordStory } from "@/lib/cardFacts";
import { backFoot, backLedger } from "@/lib/backPicture";
import { NUMBERED_HEADER } from "@/components/cards/stamp";
import { rackPaths } from "@/lib/cardArt/rack";
import { readBackFacts } from "@/lib/backPictureFacts";
import { SCROLL_PATH_CARD } from "@/components/cards/material";
import { svgDoc } from "@/lib/cardArt/engrave";
import { SEAL, sealInk } from "@/lib/cardArt/seal";
import { CARD_CORNER } from "@/lib/cardArt/looks";
import { isSuiteDeployed } from "@/lib/onchain/addresses";
import { readWordStory } from "@/lib/onchain/wordStory";
import { cardNumberOf } from "@/lib/onchain/cardNumbers";
import { playerFaces } from "@/lib/profile/faces";

/**
 * The back of a word's card for the share loop (components/cards/loop): its words and tiles over a
 * transparent ground, 1200×675, the card's own shape (16:9). Laid out as the game's back is at its
 * full size (components/cards/CardBack; decisions.md #35, #37): the rarity over the card's number
 * (the headline), "One of one", the tiles on their rack, the facts as a ledger, the game's seal
 * pressed in behind them, and the frame's two lines. The card's serif here is Source Serif 4, as
 * in the game (the server has no fonts of its own; the share picture's route says more). The loop's shader
 * paints the back's material under it (cards/live/materialGlsl), the same material the game's live
 * back draws, so the video and the game match.
 *
 * The video travels to strangers, so the back speaks of the word, never of "you" (lib/backPicture
 * says which of the game's lines it keeps, rewords, and leaves out; decisions.md #48, part 5): its
 * rarity, its case (from the link, like the share card's front), its points, and from the chain
 * when the game is live, its card number, its ascension and pips, the day it reached its holder,
 * about what it earns a day and costs to make, who first found it, whether the jackpot drew it, and
 * its token. Nothing comes from the query string. The facts can change, so it caches for minutes,
 * not the share card's week.
 *
 * Every read has a short wait, and a fact that doesn't arrive in time is left out: the picture is
 * drawn with what is known, never held up and never guessed.
 */

// Söhne TTFs: Satori (next/og) can't read the app's woff2. Labels are bold here: Satori has no
// semibold Söhne (the game's labels are semibold).
const soehneBold = readFileSync(join(process.cwd(), "public/fonts/soehne-fett.ttf"));
const soehneBook = readFileSync(join(process.cwd(), "public/fonts/soehne-buch.ttf"));
const serifBold = readFileSync(join(process.cwd(), CARD_SERIF_FILE));

const W = 1200;
const H = 675;
const fmt = (n: number) => n.toLocaleString("en-US");

/** Each material’s frame line and the rack's dark front (globals.css `.cb.m-*`, the same colors). */
const LOOK: Record<Tier, { line: string; rackFront: string }> = {
  Common: { line: "#9a8164", rackFront: "#2a1e15" },
  Uncommon: { line: "#5cc4a9", rackFront: "#0c3028" },
  Rare: { line: "#7fb0ef", rackFront: "#0b1d3d" },
  Legendary: { line: "#e9b949", rackFront: "#3a2806" },
  Mythic: { line: "#b48cf0", rackFront: "#1d0d36" },
};
/** The rack on this picture, in its pixels (lib/cardArt/rack: the game's own shapes). */
const RACK_W = 430;
const RACK_H = 48;
const RACK = rackPaths(RACK_W, RACK_H);

const TEXT = "#f7efdc";
const SUB = "rgba(247, 239, 220, 0.74)";
const SHADOW = "0 2px 3px rgba(0, 0, 0, 0.45)";
const SERIF = CARD_SERIF;
/** Two colours mixed, `share` of the first: the game's `color-mix` for lettering in the line's colour. */
function mix(a: string, b: string, share: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `rgb(${[0, 1, 2].map((i) => Math.round(ch(a, i) * share + ch(b, i) * (1 - share))).join(", ")})`;
}
/** The seal, pressed in the material's line colour, as an address Satori's `<img>` takes. */
const seal = (ink: string) => `data:image/svg+xml;base64,${Buffer.from(svgDoc(sealInk(ink), SEAL, SEAL)).toString("base64")}`;

type ChainFacts = { number: number | null; finder: string | null; story: WordStory | null };


// Kept per word, not per link: a word's 32 casings are one word's facts. A few minutes on a warm
// instance, and one read for callers that arrive together.
const FACTS_TTL_MS = 5 * 60_000;
const factsCache = new Map<string, { at: number; facts: ChainFacts }>();
const factsInflight = new Map<string, Promise<ChainFacts>>();
function chainFactsOf(word: string): Promise<ChainFacts> {
  const hit = factsCache.get(word);
  if (hit && Date.now() - hit.at < FACTS_TTL_MS) return Promise.resolve(hit.facts);
  let read = factsInflight.get(word);
  if (!read) {
    read = chainFacts(word)
      .then((facts) => {
        factsCache.set(word, { at: Date.now(), facts });
        return facts;
      })
      .finally(() => factsInflight.delete(word));
    factsInflight.set(word, read);
  }
  return read;
}

/** Card number, ascension, and first finder, from the chain, when the game is live; nothing otherwise. */
async function chainFacts(word: string): Promise<ChainFacts> {
  if (!isSuiteDeployed()) return { number: null, finder: null, story: null };
  const [number, story] = await Promise.all([cardNumberOf(word), readWordStory(word).catch(() => null)]);
  const first = story?.claims[0]?.owner ?? null;
  let finder: string | null = null;
  if (first) {
    const faces = await playerFaces([first]).catch(() => null);
    const name = faces?.profiles[first]?.username;
    finder = name ? `@${name}` : `${first.slice(0, 6)}…${first.slice(-4)}`;
  }
  return { number, finder, story };
}

export async function GET(req: Request, { params }: { params: Promise<{ text: string }> }) {
  const tiles = parseShowcase((await params).text);
  if (!tiles) return new Response("Not a showcase", { status: 404 });
  const word = tiles.map((t) => t.char).join("");
  // The tier the game treats it as: a collab word is Legendary on its back as on its front.
  const collab = await collabSoon();
  const tier = tierWith(word, collab);
  // A collab word's back is its set's colorway in place of its rarity's material (the game's
  // CardBack does the same): the two colors, deepened until the cream type reads on them.
  const mine = collab.get(word.toUpperCase());
  const colorway = mine ? collabBack(mine) : null;
  const look = colorway ? { line: colorway.line, rackFront: colorway.rack } : LOOK[tier];
  // The rack's tiles are the word's own: a collab word's wear its set's two colors, as on its front.
  const tileTier = mine ? tintOf(mine) : tier;
  // The stage has its own read (lib/onchain/cardLevel), which the stage this address names can ask
  // to be read again: a video made the moment after an ascension must not draw the stage before it.
  const [{ number, finder, story }, level] = await Promise.all([chainFactsOf(word), cardLevelOf(word, parseLinkStage(new URL(req.url).searchParams.get("g")))]);
  const live = isSuiteDeployed();
  const more = live ? await readBackFacts(word, level, story, tierFn(collab)) : { since: null, perDay: null, cost: null, drawn: null };
  // A word released in a reserved set carries its set's name, as the game's back does. Only a
  // RELEASED set's: nothing of a set that isn't public can reach a picture. Unknown is left out.
  // Loaded here, at the moment of use: the sets module brings the database and the chain reads with
  // it, and this route's other answers (a 404 for anything that isn't a word) need none of that.
  const set =
    (await import("@/lib/sets/server").then((m) => m.loadSets()).catch(() => null))?.sets.find((s) => s.status === "released" && s.words.some((w) => w.word === word))?.name ?? null;
  const facts = { word, upper: tiles.map((t) => t.upper), level, finder, ...more, token: live ? shortTokenId(word) : null, set };
  const stats = backLedger(facts);
  const foot = backFoot(facts);

  const digits = cardDigits(number);
  // The game's back at its full size (globals.css, `.cb`), in the same measures: a share of the
  // card's width each (cqw there, U here), without the caps the game puts on type for a screen.
  const U = W / 100;
  const tint = mix(look.line, TEXT, 0.74);
  return new ImageResponse(
    (
      <div style={{ position: "relative", display: "flex", width: W, height: H, fontFamily: "Soehne", color: TEXT, textShadow: SHADOW }}>
        {/* A rarity's back is drawn over a clear ground: the video's shader paints the material
            under it. A collab word's ground is its colorway, painted HERE, so the picture alone is
            the whole back and the shader's material never shows under it. */}
        {colorway && (
          <div
            style={{ position: "absolute", left: 0, top: 0, width: W, height: H, display: "flex", borderRadius: CARD_CORNER * W, backgroundImage: `linear-gradient(165deg, ${colorway.base2}, ${colorway.base} 70%)` }}
          />
        )}
        {/* the frame: a line in the material's colour, and a dotted line just outside it */}
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", left: 0, top: 0 }}>
          {/* each line runs parallel to the card's own corner: the corner (CARD_CORNER of the width) less the line's inset */}
          <rect x="13" y="13" width={W - 26} height={H - 26} rx={CARD_CORNER * W - 13} fill="none" stroke={look.line} strokeWidth="3.4" strokeDasharray="3.4 5" />
          <rect x="21.5" y="21.5" width={W - 43} height={H - 43} rx={CARD_CORNER * W - 21.5} fill="none" stroke={look.line} strokeWidth="3.6" />
        </svg>
        {/* Legendary's engraved scrollwork, in each corner (the game's back draws it: CardBack, Scroll) */}
        {tier === "Legendary" &&
          !colorway &&
          ([
            ["tl", {}],
            ["tr", { transform: "scaleX(-1)" }],
            ["bl", { transform: "scaleY(-1)" }],
            ["br", { transform: "scale(-1, -1)" }],
          ] as const).map(([k, flip]) => (
            <svg key={k} width={6 * U} height={6 * U} viewBox="0 0 40 40" style={{ position: "absolute", ...(k[1] === "l" ? { left: 2.6 * U } : { right: 2.6 * U }), ...(k[0] === "t" ? { top: 2.6 * U } : { bottom: 2.6 * U }), ...flip }}>
              <path d={SCROLL_PATH_CARD} fill="none" stroke="rgba(255, 244, 200, 0.55)" strokeWidth="2.4" strokeLinecap="round" transform="translate(1 1)" />
              <path d={SCROLL_PATH_CARD} fill="none" stroke="#e9b949" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ))}
        {/* the game's seal, pressed into the material behind the facts */}
        <img src={seal(look.line)} width={42 * U} height={42 * U} style={{ position: "absolute", right: 4 * U, top: (H - 42 * U) / 2, opacity: 0.14 }} />
        <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, display: "flex", alignItems: "center", padding: `${6.5 * U}px ${5.5 * U}px ${5.5 * U}px`, gap: 4 * U }}>
          {/* the left column: the rarity, the number (the headline), "One of one", how many share the rarity, the tiles */}
          <div style={{ display: "flex", flexDirection: "column", width: 0.475 * (W - 15 * U), gap: 1.1 * U }}>
            {/* the tier's mark, the game's own (lib/tierMark): plain paths, every attribute given (Satori's rules) */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: SERIF, fontWeight: 700, fontSize: 2.3 * U, lineHeight: 1.15, color: tint }}>
              <svg width={2.65 * U} height={2.65 * U} viewBox="0 0 20 20">
                {tierMarkPaths(tier).map((p, i) => (
                  <path key={i} d={p.d} fill={p.fill} opacity={p.opacity} stroke={p.stroke} strokeWidth={p.strokeWidth} strokeLinejoin="round" />
                ))}
              </svg>
              {tier}
            </div>
            {/* only when known (the practice game has no chain to number it). "No." is lifted onto the
                digits' baseline by hand: this renderer lines up boxes, not baselines. */}
            {digits ? (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 0.16 * 10.5 * U, fontFamily: SERIF, fontWeight: 700, fontSize: 10.5 * U, lineHeight: 0.9 }}>
                <div style={{ display: "flex", fontSize: 0.34 * 10.5 * U, lineHeight: 1, color: tint, marginBottom: 0.115 * 10.5 * U }}>No.</div>
                {digits}
              </div>
            ) : null}
            <div style={{ display: "flex", width: "100%", height: 0.3 * U, backgroundImage: `linear-gradient(90deg, ${look.line}, rgba(0, 0, 0, 0))` }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", fontFamily: SERIF, fontWeight: 700, fontSize: 2.7 * U, lineHeight: 1.05 }}>One of one</div>
              <div style={{ display: "flex", fontSize: 1.9 * U, lineHeight: 1.2, color: SUB }}>
                One of {fmt(tierCount(tier, tierCountsWith(collab)))} {tier} words
              </div>
              {/* a collab word: its partner, and its place among the set's five. In the back's full cream, as
                  the game's back letters it (globals.css, .cb-collab), not the muted tone of the line above. */}
              {mine && <div style={{ display: "flex", fontSize: 1.9 * U, lineHeight: 1.2, color: TEXT }}>{collabLine(mine.partner, true)}</div>}
            </div>
            {/* the tiles on their rack: the word itself, in Söhne, and nowhere else on the back */}
            <div style={{ position: "relative", display: "flex", width: 430, height: 118, marginTop: 0.6 * U, alignItems: "flex-end", justifyContent: "center" }}>
              {/* the rack, engraved: the game's own shapes (lib/cardArt/rack), in this picture's pixels.
                  Its top, behind the tiles; its front is drawn after them, below. */}
              <svg width={RACK_W} height={RACK_H} viewBox={`0 0 ${RACK_W} ${RACK_H}`} style={{ position: "absolute", left: 0, bottom: 0 }}>
                <path d={RACK.top} fill={look.line} fillOpacity={0.1} stroke={look.line} strokeOpacity={0.8} strokeWidth={1.8} strokeLinejoin="round" />
                <path d={RACK.topRules} fill="none" stroke={look.line} strokeOpacity={0.5} strokeWidth={1.3} strokeLinecap="round" />
              </svg>
              <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
                {tiles.map((t, i) => (
                  <div key={i} style={{ display: "flex" }}>
                    <OgTile char={t.char} upper={t.upper} w={74} limbs={false} tier={tileTier} gild={level ?? 0} index={i} uid={`b${i}`} />
                  </div>
                ))}
              </div>
              {/* the rack's front, before the tiles: dark, under closer ruling, with the bright edge they stand behind */}
              <svg width={RACK_W} height={RACK_H} viewBox={`0 0 ${RACK_W} ${RACK_H}`} style={{ position: "absolute", left: 0, bottom: 0 }}>
                <path d={RACK.front} fill={look.rackFront} stroke={look.line} strokeOpacity={0.8} strokeWidth={1.8} strokeLinejoin="round" />
                <path d={RACK.frontRules} fill="none" stroke={look.line} strokeOpacity={0.34} strokeWidth={1.3} strokeLinecap="round" />
                <path d={RACK.edge} fill="none" stroke={look.line} strokeWidth={2.6} strokeLinecap="round" />
              </svg>
            </div>
          </div>
          {/* the ledger: a name, a row of dots, a value */}
          <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: 1.5 * U }}>
            {stats.map(([label, value]) => (
              <div key={label} style={{ display: "flex", alignItems: "flex-end", gap: 12, fontSize: 2.05 * U, lineHeight: 1.15 }}>
                <div style={{ display: "flex", fontWeight: 800, color: SUB }}>{label}</div>
                <div style={{ display: "flex", flex: 1, height: 0, marginBottom: 8, borderBottom: "3px dashed rgba(247, 239, 220, 0.4)" }} />
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: SERIF, fontWeight: 700 }}>
                  {value}
                  {/* the stage's pips, as on the tile (tileShapes, pipPath), in the back's own ink: solid where earned, an outline where not */}
                  {label === "Ascension" && level ? (
                    <svg width={5.9 * U} height={1.45 * U} viewBox={`69 ${PIP_Y - 9} 102 18`}>
                      {[0, 1, 2, 3, 4].map((i) => (
                        <path key={i} d={pipPath(i)} fill={i < level ? look.line : "none"} stroke={look.line} strokeOpacity={i < level ? 1 : 0.55} strokeWidth={1.6} strokeLinejoin="round" />
                      ))}
                    </svg>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* the line along the bottom, inside the frame: the jackpot, then the token */}
        {foot.length > 0 && (
          <div style={{ position: "absolute", left: 5.5 * U, right: 5.5 * U, bottom: 2.9 * U, display: "flex", justifyContent: "center", fontSize: 1.75 * U, lineHeight: 1.15, color: SUB }}>{foot.join("  ·  ")}</div>
        )}
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: [
        { name: "Soehne", data: soehneBold, weight: 800, style: "normal" },
        { name: "Soehne", data: soehneBook, weight: 400, style: "normal" },
        { name: SERIF, data: serifBold, weight: 700, style: "normal" },
      ],
      // Ascension and the first finder's name can change: minutes, not the share card's week.
      // and whether this picture has the card's number on it: the share video places the holder's stamp by it (cards/stamp)
      headers: { "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600", [NUMBERED_HEADER]: digits ? "1" : "0" },
    },
  );
}
