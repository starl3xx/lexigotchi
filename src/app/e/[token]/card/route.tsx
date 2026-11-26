import { readFileSync } from "fs";
import { join } from "path";
import { ImageResponse } from "next/og";
import { wordCard } from "../../../_og/wordCard";
import { parseShowcase, type ShowcaseTile } from "@/lib/showcase";
import { parseLinkScene } from "@/lib/scenes";
import { CARD_H, CARD_W } from "@/lib/cardArt/engrave";
import { CARD_PAPER } from "@/lib/cardArt/looks";
import { NETWORK } from "@/lib/onchain/network";
import { earningsCardText, parseTz, type EarningsCardText } from "@/lib/earningsShare";
import { readEarningsShare } from "@/lib/earningsShareToken";

/**
 * An earnings share's picture (lib/earningsShare.ts): two things on the game's dark table. The
 * player's top word, as its own CARD (the same drawing as its share picture, `_og/wordCard`), and
 * beside it a paper tag that says what their words have earned. The word comes first, where the eye
 * starts, and the tag's sentence starts with the words too ("My words have earned"); the amount is
 * the game's gold, the color of the sheet's own number.
 *
 * - **Every amount comes from the SIGNED token in the path.** A token that doesn't verify, or was
 *   made on another network, is a 404. The word (`w`), its scene, and the clock offset for the date
 *   (`tz`) are the link's, and cosmetic; a word gets an amount beside it only when the token names
 *   it. No dollars, ever, and "test $WORD" on a test network.
 * - **Nothing here reads the chain or a database.** X's crawler won't wait, and the token already
 *   holds the picture's facts. So the card's ribbon carries no number (the word's own picture reads
 *   it from the chain).
 * - **One design, three shapes.** 1200×630 for X's large card and `?ratio=16x9` (1200×675) for the
 *   picture that travels alone (Save image): the card and the tag side by side. `?ratio=3x2`
 *   (1200×800, the Farcaster embed's shape): the card over a wide tag. `?saved=1` adds the quiet
 *   corner wordmark a word's saved picture has.
 */

// TTF and OTF: Satori (next/og) can't read the app's woff2. Pagella is the card ribbon's lettering.
const soehneBold = readFileSync(join(process.cwd(), "public/fonts/soehne-fett.ttf"));
const pagellaBold = readFileSync(join(process.cwd(), "public/fonts/texgyrepagella-bold.otf"));

const INK = "#1b1714";
const SOFT = "rgba(27, 23, 20, 0.66)";
const GOLD_DEEP = "#b07d20"; // the sheet's number (tailwind gold.deep: display numbers)
const GOLD_INK = "#6f4e10";
const TABLE = "#16293a";
const SHADOW = "7px 9px 0 rgba(0, 0, 0, 0.42)"; // the card's own, so both lie on the same table

/** The big number's size: the longest amount ("999.99B") still fits its tag. */
const amountSize = (amount: string, room: number) => Math.min(112, Math.floor(room / (amount.length * 0.56)));

/** The tag: a slip of the card's paper with a punched hole, lying a little askew. `wide` lays its two halves side by side. */
function tag(text: EarningsCardText, w: number, wide: boolean) {
  const pad = 30;
  const numbers = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: wide ? "flex-start" : "center" }}>
      <div style={{ display: "flex", fontSize: 27, color: SOFT }}>{text.kicker}</div>
      <div style={{ display: "flex", fontSize: amountSize(text.amount, wide ? w * 0.5 : w - pad * 2), letterSpacing: -3, lineHeight: 1.08, color: GOLD_DEEP }}>{text.amount}</div>
      <div style={{ display: "flex", fontSize: 30, color: SOFT, marginTop: -2 }}>{text.unit}</div>
    </div>
  );
  const notes = (text.latest || text.plate) && (
    <div style={{ display: "flex", flexDirection: "column", alignItems: wide ? "flex-start" : "center", ...(wide ? { paddingLeft: 30, borderLeft: `3px dashed rgba(27, 23, 20, 0.3)` } : { marginTop: 14 }) }}>
      {text.latest && <div style={{ display: "flex", fontSize: 29, color: GOLD_INK }}>{text.latest}</div>}
      {text.plate && (
        <div
          style={{
            display: "flex",
            fontSize: 24,
            color: INK,
            marginTop: text.latest ? 12 : 0,
            ...(wide || !text.latest ? {} : { paddingTop: 12, borderTop: `3px dashed rgba(27, 23, 20, 0.3)` }),
          }}
        >
          {text.plate}
        </div>
      )}
    </div>
  );
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: wide ? "row" : "column",
        alignItems: "center",
        justifyContent: wide ? "space-between" : "center",
        width: w,
        padding: wide ? `${pad}px ${pad + 14}px ${pad}px ${pad + 44}px` : `${pad + 24}px ${pad}px ${pad - 2}px`,
        background: CARD_PAPER,
        border: `4px solid ${INK}`,
        borderRadius: 22,
        boxShadow: SHADOW,
        transform: `rotate(${wide ? -1 : 2}deg)`,
        fontWeight: 800,
      }}
    >
      {/* the punched hole: the table shows through it */}
      <div
        style={{
          position: "absolute",
          ...(wide ? { left: 22, top: "50%", marginTop: -12 } : { left: w / 2 - 12 - 4, top: 16 }),
          width: 24,
          height: 24,
          borderRadius: 12,
          border: `4px solid ${INK}`,
          background: TABLE,
          display: "flex",
        }}
      />
      {numbers}
      {notes}
    </div>
  );
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const snapshot = readEarningsShare((await params).token);
  if (!snapshot) return new Response("Not an earnings share", { status: 404 });

  const url = new URL(req.url);
  const ratio = url.searchParams.get("ratio");
  const tall = ratio === "3x2";
  const H = tall ? 800 : ratio === "16x9" ? CARD_H : 630;
  const saved = url.searchParams.get("saved") === "1";
  const scene = parseLinkScene(url.searchParams.get("scene"));
  // The word on the table: the link's (any dictionary word, in its case), else the top earner the
  // token names (a word that has earned is all UPPERCASE), else none: the tag lies alone.
  const asked = parseShowcase(url.searchParams.get("w") ?? "");
  const tiles: ShowcaseTile[] | null = asked?.length === 5 ? asked : snapshot.words[0] ? [...snapshot.words[0][0]].map((char) => ({ char, upper: true })) : null;
  const word = tiles ? tiles.map((t) => t.char).join("") : null;
  const text = earningsCardText(snapshot, { testnet: NETWORK.isTestnet, tz: parseTz(url.searchParams.get("tz")), hero: word });

  // Side by side on the wide shapes; the card over a wide tag on the tall one.
  const cardW = tall ? 800 : 680;
  const tagW = !tiles ? 620 : tall ? cardW : CARD_W - 2 * 38 - cardW - 30;

  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: tall ? "column" : "row",
          alignItems: "center",
          justifyContent: "center",
          gap: tall ? 34 : 30,
          width: CARD_W,
          height: H,
          fontFamily: "Soehne",
          color: INK,
          // the table a word's own share picture lies on
          backgroundColor: TABLE,
          backgroundImage: "radial-gradient(circle at 50% 42%, #2f5570 0%, #16293a 78%)",
        }}
      >
        {tiles && wordCard({ tiles, scene, cardW })}
        {tag(text, tagW, tall && !!tiles)}
        {saved && (
          <div style={{ position: "absolute", right: tall ? 34 : 28, bottom: tall ? 26 : 12, display: "flex", fontSize: tall ? 26 : 20, fontWeight: 800, letterSpacing: -0.5, color: "#fbf4e3", opacity: 0.85 }}>
            LEXIGOTCHI
          </div>
        )}
      </div>
    ),
    {
      width: CARD_W,
      height: H,
      fonts: [
        { name: "Soehne", data: soehneBold, weight: 800, style: "normal" },
        { name: "Pagella", data: pagellaBold, weight: 700, style: "normal" },
      ],
      // A token is one picture for good: a day in browsers, a week at the edge (the word's picture).
      headers: { "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400" },
    },
  );
}
