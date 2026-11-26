import { readFileSync } from "fs";
import { join } from "path";
import { ImageResponse } from "next/og";
import { cardTier, wordCard } from "../../../_og/wordCard";
import { parseShowcase } from "@/lib/showcase";
import { parseLinkScene } from "@/lib/scenes";
import { cardNo } from "@/lib/cardFacts";
import { CARD_H, CARD_W } from "@/lib/cardArt/engrave";
import { isSuiteDeployed } from "@/lib/onchain/addresses";
import { cardNumberSoon } from "@/lib/onchain/cardNumbers";

/**
 * A word's share picture: its card (decisions.md #34), as the game draws it. The card's own paper,
 * the scene's art in the frame's window (`?scene=`, lib/scenes; the Stage when a link names none),
 * the word's tile characters standing in it in the finish of the word's rarity (lib/rarityFinish,
 * still: a picture has no light passing), the frame in the rarity's ink, and the ribbon.
 *
 * - **The card lies on a dark table.** Default 1200×630, X's large-card shape (1.91:1).
 *   `?ratio=3x2` gives 1200×800 for the Farcaster embed, whose spec requires 3:2. The card itself
 *   is always 16:9, as in the game.
 * - **`?face=1` is the card's front alone,** 1200×675, edge to edge with no table: the share loop
 *   turns it over (components/cards/loop), beside the back's picture.
 * - **The card is drawn by `_og/wordCard`,** which the earnings share's picture draws too.
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

  // The word's rarity, from the word itself: a link can't claim a tier. A house card (HEYOO) isn't
  // a dictionary word, so it has none and stays plain.
  const word = tiles.map((t) => t.char).join("");
  const tier = cardTier(tiles);
  // Not for long: a crawler is waiting for this picture (cardNumberSoon). A picture drawn without
  // its number is kept for minutes only, below.
  const number = tier ? await cardNumberSoon(word) : null;
  const no = cardNo(number);

  const card = wordCard({ tiles, scene, cardW, no, bare: face });

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
