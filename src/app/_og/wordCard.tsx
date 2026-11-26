import type { ReactElement } from "react";
import { OgTile } from "./tile";
import { leanFor } from "@/components/game/tileShapes";
import { FOOT_SHARE, wordFootings, wordLayout } from "@/components/scenes/layout";
import type { ShowcaseTile } from "@/lib/showcase";
import type { SceneId } from "@/lib/scenes";
import { isWord } from "@/lib/dictionary";
import { wordTier, type Tier } from "@/lib/economy";
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
 * ascension stage, which its letters wear; the caller reads that from the chain too. `bare` is the card's
 * face alone, with no outline or shadow (the share loop turns it over). The ribbon's lettering is
 * the "Pagella" font: a picture that draws a card loads it (public/fonts/texgyrepagella-bold.otf).
 */

const INK = "#1b1714";
/** A picture as an address Satori's `<img>` takes. */
const image = (markup: string) => `data:image/svg+xml;base64,${Buffer.from(svgDoc(markup)).toString("base64")}`;
/** A card with no word's rarity to wear (a house card) is printed as Common, with no ribbon. */
const PLAIN: Tier = "Common";

/** The word's rarity, from the word itself: a link can't claim a tier. A house card (HEYOO) isn't a dictionary word, so it has none. */
export function cardTier(tiles: readonly ShowcaseTile[]): Tier | undefined {
  const word = tiles.map((t) => t.char).join("");
  return isWord(word) ? wordTier(word) : undefined;
}

export function wordCard({ tiles, scene, cardW, no = null, gild = 0, bare = false }: { tiles: readonly ShowcaseTile[]; scene: SceneId; cardW: number; no?: string | null; gild?: number; bare?: boolean }): ReactElement {
  const k = cardW / CARD_W; // pixels per card unit
  const cardH = Math.round(CARD_H * k);
  const word = tiles.map((t) => t.char).join("");
  const tier = cardTier(tiles);
  const look = CARD_LOOKS[tier ?? PLAIN];

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
      <img src={image(cardArt(scene, tier ?? PLAIN))} width={cardW} height={cardH} style={{ position: "absolute", left: 0, top: 0 }} />
      <div style={{ position: "absolute", left: L.rowLeft, top: L.rowTop, display: "flex", alignItems: "flex-end" }}>
        {tiles.map((t, i) => {
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
              <OgTile char={t.char} upper={t.upper} w={L.tileW} tier={tier} gild={gild} index={i} uid={`t${i}`} linkLeft={i > 0} linkRight={i < tiles.length - 1} lean={leanFor(word, i)} />
            </div>
          );
        })}
      </div>
      <img src={image(cardFrame(tier ?? PLAIN))} width={cardW} height={cardH} style={{ position: "absolute", left: 0, top: 0 }} />
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
                fontFamily: "Pagella",
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
