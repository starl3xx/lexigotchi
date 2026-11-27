import { readFileSync } from "fs";
import { join } from "path";
import { ImageResponse } from "next/og";
import { CARD_SERIF, CARD_SERIF_FILE, cardTier, cornerMark, wordCard } from "../../../_og/wordCard";
import { cardPictureCache, parseLinkMark, parseLinkStage, parseShowcase } from "@/lib/showcase";
import { parseLinkScene } from "@/lib/scenes";
import { cardNo } from "@/lib/cardFacts";
import { CARD_H, CARD_W } from "@/lib/cardArt/engrave";
import { TABLE, tableImage } from "@/lib/cardArt/table";
import { isSuiteDeployed } from "@/lib/onchain/addresses";
import { collabSoonRead } from "@/lib/raritySoon";
import { stampDataOf } from "@/lib/sets/stampData";
import { cardNumberOf, cardNumberSoon } from "@/lib/onchain/cardNumbers";
import { cardLevelOf, cardLevelSoon } from "@/lib/onchain/cardLevel";

/**
 * A word's share picture: its card (decisions.md #34), as the game draws it. The card's own paper,
 * the scene's art in the frame's window (`?scene=`, lib/scenes; the Stage when a link names none),
 * the word's tile characters standing in it in the finish of the word's rarity (lib/rarityFinish,
 * still: a picture has no light passing), the frame in the rarity's ink, and the ribbon.
 *
 * - **The card lies on a dark table.** Default 1200×630, X's large-card shape (1.91:1).
 *   `?ratio=3x2` gives 1200×800 for the Farcaster embed, whose spec requires 3:2. The card itself
 *   is always 16:9, as in the game.
 * - **`?face=1&letters=0` is that front without its letters:** the stage the share video's living
 *   letters stand on (cards/loop/liveFront draws them in the player's browser).
 * - **`?face=1` is the card's front alone,** 1200×675, edge to edge with no table: the share loop
 *   turns it over (components/cards/loop), beside the back's picture.
 * - **The card is drawn by `_og/wordCard`,** which the earnings share's picture draws too.
 * - **The art and the frame are the game's own pictures** (lib/cardArt), each placed as one image.
 * - **The ribbon's lettering is Source Serif 4,** the card's serif in the game too (decisions.md
 *   #52: one face for every player and every picture). A server has no fonts of its own, so the
 *   bold file is loaded here. Its license is beside it (public/fonts/sourceserif4-LICENSE.txt).
 *   The picture's figures are lining ones: this renderer sets no old-style figures.
 * - **The card's number is the chain's,** never the link's: nothing in the query can put a number
 *   on a card. A word with no number yet, and a house card, have none on the ribbon. The picture
 *   waits a second and a half for the number at most, then is drawn without it.
 *
 * - **The letters' gilding is the chain's too** (decisions.md #48): the word's ascension stage is
 *   read as its number is, and its letters wear it as they do in the game. The address may name a
 *   stage (`g`), but only so that a word's picture gets a new address when its stage changes:
 *   nothing in the query is drawn. A picture whose address doesn't name the stage it shows is kept
 *   for minutes, not a week (lib/showcase, cardPictureCache).
 *
 * No name on a link card (decisions.md #23): X prints the site under the card and the post names
 * @lexigotchi; Farcaster's card carries the game's button. `?saved=1` is the picture that travels
 * alone (Save image), so it carries a quiet wordmark in the table's corner.
 */

// TTF and OTF: Satori (next/og) can't read the app's woff2 (same as /embed-image).
const soehneBold = readFileSync(join(process.cwd(), "public/fonts/soehne-fett.ttf"));
const serifBold = readFileSync(join(process.cwd(), CARD_SERIF_FILE));

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
  const { looks: collab, known: setsRead } = await collabSoonRead();
  const tier = cardTier(tiles, collab);
  // A collab word's own look, and its set's stamp as bytes (never fetched from this site's own route).
  const mine = collab.get(word.toUpperCase());
  const stamp = mine ? await stampDataOf(mine) : null;
  // Not for long: a crawler is waiting for this picture (cardNumberSoon). A picture drawn without
  // its number is kept for minutes only, below.
  // The stage the same way. A house card has none; before the game is deployed there is none to read.
  // The stage the address names is passed along only as a reason to read again (cardLevel says why).
  const hint = parseLinkStage(url.searchParams.get("g"));
  // A crawler is waiting for a link picture, so its reads have a short wait and it is drawn with
  // what is known. The video's front (`face`) is asked for by the player's own browser, beside the
  // back's picture (app/s/[text]/back), which waits for its reads: the front waits for the same
  // ones, so the two faces of one video can never disagree about the word's number or its
  // gilding (Bugbot on #247: a slow read gave an ungilded front and a gilded back).
  const [number, level] = await Promise.all([
    tier ? (face ? cardNumberOf(word).catch(() => null) : cardNumberSoon(word)) : null,
    tier && isSuiteDeployed() ? (face ? cardLevelOf(word, hint) : cardLevelSoon(word, hint)) : 0,
  ]);
  const no = cardNo(number);

  // The front without its letters (`letters=0`, only with `face=1`): the share video draws them itself.
  const card = wordCard({ tiles, scene, cardW, collab, stamp, no, gild: level ?? 0, bare: face, letters: !(face && url.searchParams.get("letters") === "0") });

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
          backgroundColor: TABLE.ground,
        }}
      >
        {/* the table, engraved (lib/cardArt/table): a still picture under the card, placed as a scene is */}
        <img src={tableImage(W, H)} width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }} />
        {card}
        {saved && cornerMark(tall)}
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: [
        { name: "Soehne", data: soehneBold, weight: 800, style: "normal" },
        { name: CARD_SERIF, data: serifBold, weight: 700, style: "normal" },
      ],
      // Kept long only when the address names the look the word has (`c`), the sets were read (a
      // failed read draws a collab word in its rarity's look), and the stamp it has was drawn.
      headers: { "cache-control": cardPictureCache({ waiting: waiting || !setsRead || (!!mine?.stamp && !stamp), level, hint, mark: parseLinkMark(url.searchParams.get("c")), look: mine?.mark ?? null }) },
    },
  );
}
