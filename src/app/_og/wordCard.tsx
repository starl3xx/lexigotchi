import { lockupDoc } from "@/lib/cardArt/logo";
import type { ReactElement } from "react";
import { OgTile } from "./tile";
import { leanFor } from "@/components/game/tileShapes";
import { FOOT_SHARE, wordFootings, wordLayout } from "@/components/scenes/layout";
import type { ShowcaseTile } from "@/lib/showcase";
import type { SceneId } from "@/lib/scenes";
import { isWord } from "@/lib/dictionary";
import type { Tier } from "@/lib/economy";
import { tierWith, type CollabWords } from "@/lib/rarity";
import { collabCardLook, tintOf, type CollabLooks } from "@/lib/collabLook";
import { tierMarkPaths } from "@/lib/tierMark";
import { CARD_H, CARD_W, svgDoc } from "@/lib/cardArt/engrave";
import { CARD_CORNER, CARD_LOOKS, CARD_PAPER } from "@/lib/cardArt/looks";
import { cardArt, cardFrame } from "@/lib/cardArt/scenes";

/**
 * A word's card as a picture draws it (decisions.md #34): the card's own paper, the scene's art in
 * the frame's window, the word's tile characters standing in it, the frame in the rarity's ink, and
 * the ribbon. One drawing for every picture that shows a card: the word's own share picture
 * (`/s/<word>/card`, which says the rest about it) and the earnings share (`/e/<token>/card`),
 * where the player's top word lies on the table beside what their words have earned.
 *
 * `cardW` is the card's width in pixels (it is always 16:9). `no` is its number as the ribbon
 * prints it, or null; the caller reads it from the chain or leaves it out. `gild` is the word's
 * ascension stage, which its letters wear; the caller reads that from the chain too. `letters: false`
 * leaves the letters out: the card as a stage, for the share video, whose letters are drawn by the
 * player's browser so that they can breathe and blink (cards/loop/liveFront). `bare` is the card's
 * face alone, with no outline or shadow (the share loop turns it over). The ribbon's lettering is
 * the card's serif, CARD_SERIF: a picture that draws a card loads it (public/fonts/sourceserif4-bold.ttf).
 */

const INK = "#1b1714";
/** A picture as an address Satori's `<img>` takes. */
const image = (markup: string) => `data:image/svg+xml;base64,${Buffer.from(svgDoc(markup)).toString("base64")}`;
/** A card with no word's rarity to wear (a house card) is printed as Common, with no ribbon. */
const PLAIN: Tier = "Common";

/**
 * The card's serif on the server's pictures: Source Serif 4, as in the game (globals.css,
 * --font-card; decisions.md #52). A server has no fonts of its own, so each picture's route loads
 * the bold file and names it this.
 */
export const CARD_SERIF = "Source Serif 4";

/**
 * The game's lockup in the corner of a SAVED picture (decisions.md #56, part 2): the picture leaves
 * the game alone, so it says whose it is. On the dark table, so the name is in paper. A link card
 * carries no name (X and Farcaster show the site under it).
 */
const cornerDoc = lockupDoc({ tone: "dark" });
const cornerSrc = `data:image/svg+xml;base64,${Buffer.from(cornerDoc.svg).toString("base64")}`;
export function cornerMark(tall: boolean) {
  const h = tall ? 40 : 36;
  const w = Math.round((h * cornerDoc.width) / cornerDoc.height);
  // the drawing has air under the name's baseline (a quarter of its height), so it sits lower than the type did
  return <img src={cornerSrc} width={w} height={h} style={{ position: "absolute", right: tall ? 30 : 24, bottom: tall ? 12 : 5, opacity: 0.94 }} />;
}
/** The file every picture loads for it: a plain TTF, because the renderer can't read the game's woff2. */
export const CARD_SERIF_FILE = "public/fonts/sourceserif4-bold.ttf";

/**
 * The word's rarity, from the word itself: a link can't claim a tier. A house card (HEYOO) isn't a
 * dictionary word, so it has none. `collab` is the collab words in force (lib/raritySoon.ts): a
 * collab word is Legendary on its pictures as it is in the game.
 */
export function cardTier(tiles: readonly ShowcaseTile[], collab: CollabWords): Tier | undefined {
  const word = tiles.map((t) => t.char).join("");
  return isWord(word) ? tierWith(word, collab) : undefined;
}

export function wordCard({
  tiles,
  scene,
  cardW,
  collab,
  stamp = null,
  no = null,
  gild = 0,
  bare = false,
  letters = true,
}: {
  tiles: readonly ShowcaseTile[];
  scene: SceneId;
  cardW: number;
  /** The collab looks in force (lib/raritySoon.ts `collabSoon`): the word's rarity and its card look come from here. */
  collab: CollabLooks;
  /** The word's set's stamp as a `data:` address (lib/sets/stampData.ts), when it is a collab word with one. */
  stamp?: string | null;
  no?: string | null;
  gild?: number;
  bare?: boolean;
  letters?: boolean;
}): ReactElement {
  const k = cardW / CARD_W; // pixels per card unit
  const cardH = Math.round(CARD_H * k);
  const word = tiles.map((t) => t.char).join("");
  const tier = cardTier(tiles, collab);
  // A collab word's card is the collab stock in its set's two colors (lib/collabLook.ts), as in
  // the game: the look takes the place of the rarity's on the frame, the stock card's wash, the
  // ribbon, and the tiles. Its rarity still names the ribbon.
  const mine = collab.get(word.toUpperCase());
  const collabLook = mine ? collabCardLook(mine) : undefined;
  const look = collabLook ?? CARD_LOOKS[tier ?? PLAIN];
  const tileTier = mine ? tintOf(mine) : tier;

  // The same layout the game uses (scenes/layout.ts), at this card's scale.
  const L = wordLayout(tiles.length, k);
  const footings = wordFootings(scene, tiles.length, k);
  const font = Math.round(cardW * 0.023);
  const line = Math.max(2, Math.round(cardW * 0.0026));
  const caps = { display: "flex", textTransform: "uppercase" as const, letterSpacing: font * 0.09, fontSize: font * 0.9 };
  // a small diamond between the ribbon's words, drawn (a turned box sat low in this renderer)
  const diamond = (
    <svg width={font * 0.46} height={font * 0.46} viewBox="0 0 10 10">
      <polygon points="5,0 10,5 5,10 0,5" fill={look.accent} />
    </svg>
  );
  const tail = (side: "l" | "r") => (
    <svg
      width={font * 1.5}
      height={font * 2.2}
      viewBox="0 0 30 40"
      preserveAspectRatio="none"
      style={{ position: "absolute", top: font * 0.36, ...(side === "l" ? { left: -font * 0.9 } : { right: -font * 0.9 }) }}
    >
      <polygon points={side === "l" ? "1,1 30,1 30,39 1,39 11,20" : "0,1 29,1 19,20 29,39 0,39"} fill={look.ground} stroke={look.ink} strokeWidth={2.4} strokeLinejoin="round" />
    </svg>
  );

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: cardW,
        height: cardH,
        overflow: "hidden",
        background: CARD_PAPER,
        ...(bare ? {} : { borderRadius: Math.round(CARD_CORNER * cardW), border: `${Math.round(4 * k)}px solid ${INK}`, boxShadow: `${Math.round(7 * k)}px ${Math.round(9 * k)}px 0 rgba(0, 0, 0, 0.42)` }),
      }}
    >
      <img src={image(cardArt(scene, tier ?? PLAIN, collabLook))} width={cardW} height={cardH} style={{ position: "absolute", left: 0, top: 0 }} />
      <div style={{ position: "absolute", left: L.rowLeft, top: L.rowTop, display: "flex", alignItems: "flex-end" }}>
        {(letters ? tiles : []).map((t, i) => {
          const f = footings[i];
          return (
            <div
              key={i}
              style={{
                display: "flex",
                marginLeft: i ? -L.overlap : 0,
                // on a scene whose ground is curved, the letter stands on the curve, turned to it about its feet
                ...(f.drop || f.deg ? { transform: `translateY(${f.drop.toFixed(1)}px) rotate(${f.deg.toFixed(2)}deg)`, transformOrigin: `50% ${(FOOT_SHARE * 100).toFixed(2)}%` } : {}),
              }}
            >
              <OgTile char={t.char} upper={t.upper} w={L.tileW} tier={tileTier} gild={gild} index={i} uid={`t${i}`} linkLeft={i > 0} linkRight={i < tiles.length - 1} lean={leanFor(word, i)} />
            </div>
          );
        })}
      </div>
      <img src={image(cardFrame(tier ?? PLAIN, collabLook))} width={cardW} height={cardH} style={{ position: "absolute", left: 0, top: 0 }} />
      {/* The set's stamp, where the game draws it (globals.css, .cf-stamp): a 92-unit box, 62 in and 60 down. */}
      {mine && stamp && <img src={stamp} width={Math.round(92 * k)} height={Math.round(92 * k)} style={{ position: "absolute", left: Math.round(62 * k), top: Math.round(60 * k), objectFit: "contain" }} />}
      {/* The ribbon: "one of one", the number when the chain has given one, the rarity. Never the word. */}
      {tier && (
        <div style={{ position: "absolute", left: 0, bottom: Math.round(cardW * 0.0105), width: cardW, display: "flex", justifyContent: "center" }}>
          <div style={{ position: "relative", display: "flex" }}>
            {tail("l")}
            {tail("r")}
            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: font * 0.55,
                padding: `${font * 0.46}px ${font * 1.1}px`,
                border: `${line}px solid ${look.ink}`,
                borderRadius: 2,
                backgroundColor: CARD_PAPER,
                // fine ruled lines in the rarity's ink, as on the game's ribbon
                backgroundImage: `linear-gradient(to bottom, ${look.ink}1f 0px, ${look.ink}1f 1px, transparent 1px, transparent 4px)`,
                backgroundSize: "100% 4px",
                fontFamily: CARD_SERIF,
                fontWeight: 700,
                fontSize: font,
                lineHeight: 1,
                color: look.ink,
              }}
            >
              <div style={caps}>One of one</div>
              {diamond}
              {no ? <div style={caps}>{no}</div> : null}
              {no ? diamond : null}
              <div style={{ display: "flex", alignItems: "center", gap: font * 0.4 }}>
                {/* the tier's mark, the game's own (lib/tierMark): plain paths, every attribute given (Satori's rules) */}
                <svg width={font * 1.15} height={font * 1.15} viewBox="0 0 20 20">
                  {tierMarkPaths(tier).map((p, i) => (
                    <path key={i} d={p.d} fill={p.fill} opacity={p.opacity} stroke={p.stroke} strokeWidth={p.strokeWidth} strokeLinejoin="round" />
                  ))}
                </svg>
                <div style={caps}>{tier}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
