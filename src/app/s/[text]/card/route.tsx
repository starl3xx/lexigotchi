import { readFileSync } from "fs";
import { join } from "path";
import { ImageResponse } from "next/og";
import { OgTile } from "../../../_og/tile";
import { leanFor } from "@/components/game/tileShapes";
import { FOOT_SHARE, wordFootings, wordLayout } from "@/components/scenes/layout";
import { parseShowcase } from "@/lib/showcase";
import { parseLinkScene } from "@/lib/scenes";
import { isWord } from "@/lib/dictionary";
import { wordTier, type Tier } from "@/lib/economy";
import { tierMarkPaths } from "@/lib/tierMark";
import { cardNo } from "@/lib/cardFacts";
import { CARD_H, CARD_W, svgDoc } from "@/lib/cardArt/engrave";
import { CARD_LOOKS, CARD_PAPER } from "@/lib/cardArt/looks";
import { cardArt, cardFrame } from "@/lib/cardArt/scenes";
import { isSuiteDeployed } from "@/lib/onchain/addresses";
import { cardNumberSoon } from "@/lib/onchain/cardNumbers";

/**
 * A word's share picture: its card (decisions.md #33), as the game draws it. The card's own paper,
 * the scene's art in the frame's window (`?scene=`, lib/scenes; the Stage when a link names none),
 * the word's tile characters standing in it in the finish of the word's rarity (lib/rarityFinish,
 * still: a picture has no light passing), the frame in the rarity's ink, and the ribbon.
 *
 * - **The card lies on a dark table.** Default 1200×630, X's large-card shape (1.91:1).
 *   `?ratio=3x2` gives 1200×800 for the Farcaster embed, whose spec requires 3:2. The card itself
 *   is always 16:9, as in the game.
 * - **`?face=1` is the card's front alone,** 1200×675, edge to edge with no table: the share loop
 *   turns it over (components/cards/loop), beside the back's picture.
 * - **The art and the frame are the game's own pictures** (lib/cardArt), each placed as one image.
 * - **The ribbon's lettering is TeX Gyre Pagella,** an open look-alike of Palatino. The game uses
 *   Iowan Old Style where the device has it and ships no font for it; a server has no fonts of its
 *   own (starl3xx, 2026-11-25: "let's ship an open-licensed Palatino look-alike for the share
 *   card"). Its license is beside it (public/fonts/texgyrepagella-LICENSE.txt). The picture's
 *   figures are lining ones: this renderer sets no old-style figures.
 * - **The card's number is the chain's,** never the link's: nothing in the query can put a number
 *   on a card. A word with no number yet, and a house card, have none on the ribbon. The picture
 *   waits a second and a half for the number at most, then is drawn without it.
 *
 * No name on a link card (decisions.md #23): X prints the site under the card and the post names
 * @lexigotchi; Farcaster's card carries the game's button. `?saved=1` is the picture that travels
 * alone (Save image), so it carries a quiet wordmark in the table's corner.
 */

// TTF and OTF: Satori (next/og) can't read the app's woff2 (same as /embed-image).
const soehneBold = readFileSync(join(process.cwd(), "public/fonts/soehne-fett.ttf"));
const pagellaBold = readFileSync(join(process.cwd(), "public/fonts/texgyrepagella-bold.otf"));

const INK = "#1b1714";
/** A picture as an address Satori's `<img>` takes. */
const image = (markup: string) => `data:image/svg+xml;base64,${Buffer.from(svgDoc(markup)).toString("base64")}`;
/** A card with no word's rarity to wear (a house card) is printed as Common, with no ribbon. */
const PLAIN: Tier = "Common";

export async function GET(req: Request, { params }: { params: Promise<{ text: string }> }) {
  const tiles = parseShowcase((await params).text);
  if (!tiles) return new Response("Not a showcase", { status: 404 });

  const url = new URL(req.url);
  const face = url.searchParams.get("face") === "1";
  const tall = !face && url.searchParams.get("ratio") === "3x2";
  const saved = !face && url.searchParams.get("saved") === "1";
  const scene = parseLinkScene(url.searchParams.get("scene"));
  // The picture, and the card on it.
  const W = CARD_W;
  const H = face ? CARD_H : tall ? 800 : 630;
  const cardW = face ? CARD_W : tall ? 1080 : 960;
  const k = cardW / CARD_W; // pixels per card unit
  const cardH = Math.round(CARD_H * k);

  // The word's rarity, from the word itself: a link can't claim a tier. A house card (HEYOO) isn't
  // a dictionary word, so it has none and stays plain.
  const word = tiles.map((t) => t.char).join("");
  const tier = isWord(word) ? wordTier(word) : undefined;
  const look = CARD_LOOKS[tier ?? PLAIN];
  // Not for long: a crawler is waiting for this picture (cardNumberSoon). A picture drawn without
  // its number is kept for minutes only, below.
  const number = tier ? await cardNumberSoon(word) : null;
  const no = cardNo(number);

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

  const card = (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: cardW,
        height: cardH,
        overflow: "hidden",
        background: CARD_PAPER,
        ...(face ? {} : { borderRadius: Math.round(28 * k), border: `${Math.round(4 * k)}px solid ${INK}`, boxShadow: `${Math.round(7 * k)}px ${Math.round(9 * k)}px 0 rgba(0, 0, 0, 0.42)` }),
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
              <OgTile char={t.char} upper={t.upper} w={L.tileW} tier={tier} index={i} uid={`t${i}`} linkLeft={i > 0} linkRight={i < tiles.length - 1} lean={leanFor(word, i)} />
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

  // A known number is for good, and so is a card with none to wait for: a day in browsers, a week
  // at the edge (CARD_LOOK in the address starts every cache again when the look changes). A word
  // whose number hasn't been read yet (made a moment ago, or the chain read failed) is asked again soon.
  const waiting = !!tier && !no && isSuiteDeployed();
  return new ImageResponse(
    face ? (
      card
    ) : (
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: W,
          height: H,
          fontFamily: "Soehne",
          backgroundColor: "#16293a",
          backgroundImage: "radial-gradient(circle at 50% 42%, #2f5570 0%, #16293a 78%)",
        }}
      >
        {card}
        {saved && (
          <div style={{ position: "absolute", right: tall ? 34 : 28, bottom: tall ? 26 : 12, display: "flex", fontSize: tall ? 26 : 20, fontWeight: 800, letterSpacing: -0.5, color: "#fbf4e3", opacity: 0.85 }}>LEXIGOTCHI</div>
        )}
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: [
        { name: "Soehne", data: soehneBold, weight: 800, style: "normal" },
        { name: "Pagella", data: pagellaBold, weight: 700, style: "normal" },
      ],
      headers: { "cache-control": waiting ? "public, max-age=300, s-maxage=300" : "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400" },
    },
  );
}
