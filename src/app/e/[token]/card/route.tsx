import { readFileSync } from "fs";
import { join } from "path";
import { ImageResponse } from "next/og";
import { CARD_SERIF, CARD_SERIF_FILE, wordCard } from "../../../_og/wordCard";
import { NO_COLLAB } from "@/lib/rarity";
import { collabSoon } from "@/lib/raritySoon";
import { parseShowcase, type ShowcaseTile } from "@/lib/showcase";
import { parseLinkScene } from "@/lib/scenes";
import { CARD_H, CARD_W } from "@/lib/cardArt/engrave";
import { TABLE, tableImage } from "@/lib/cardArt/table";
import { CARD_PAPER } from "@/lib/cardArt/looks";
import { NETWORK } from "@/lib/onchain/network";
import { earningsCardText, heroStage, parseTz, type EarningsCardText } from "@/lib/earningsShare";
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
 *   it. "about $X" is the token's too (what the total was worth at a live price when it was
 *   signed), and never for test $WORD, which says "test $WORD" and no dollars.
 * - **The word wears its gilding** (decisions.md #48: the rings, the pips, the laurels, the foil),
 *   at the stage the token signed for it. A link can't claim one, and a word the token doesn't
 *   name is drawn without.
 * - **Nothing here reads the chain or a database.** X's crawler won't wait, and it keeps what it
 *   gets for good: a read that timed out would leave the picture ungilded for ever. The token
 *   already holds the picture's facts. So the card's ribbon carries no number (the word's own
 *   picture reads it from the chain).
 * - **The tag is lettered as the card's back is** (decisions.md #35): a name in Söhne, a value in
 *   the card's serif (Source Serif 4, as in the game), a row of dashes between. A WORD is a name: it is
 *   never set in the serif.
 * - **One design, three shapes.** 1200×630 for X's large card and `?ratio=16x9` (1200×675) for the
 *   picture that travels alone (Save image): the card and the tag side by side. `?ratio=3x2`
 *   (1200×800, the Farcaster embed's shape): the card over a wide tag. `?saved=1` adds the quiet
 *   corner wordmark a word's saved picture has.
 */

// TTF and OTF: Satori (next/og) can't read the app's woff2. The serif is the card ribbon's lettering.
const soehneBold = readFileSync(join(process.cwd(), "public/fonts/soehne-fett.ttf"));
const serifBold = readFileSync(join(process.cwd(), CARD_SERIF_FILE));

const INK = "#1b1714";
const SOFT = "rgba(27, 23, 20, 0.66)";
const GOLD_DEEP = "#b07d20"; // the sheet's number (tailwind gold.deep: display numbers)
const GOLD_INK = "#6f4e10";
const SHADOW = "7px 9px 0 rgba(0, 0, 0, 0.42)"; // the card's own, so both lie on the same table

const SERIF = CARD_SERIF;
const RULE = "3px dashed rgba(27, 23, 20, 0.3)";

/** About how wide a figure sets in the serif, in ems: its digits are half an em, and a letter (K, M, B) most of one. */
const figureEms = (text: string) => [...text].reduce((w, ch) => w + (/[0-9]/.test(ch) ? 0.5 : /[.,]/.test(ch) ? 0.26 : ch === " " ? 0.25 : 0.92), 0);
/** The big number's size: the longest amount ("999.99B") still fits its tag. */
const amountSize = (amount: string, room: number, max: number) => Math.min(max, Math.floor(room / figureEms(amount)));

/** The tag: a slip of the card's paper with a punched hole, lying a little askew. `wide` lays its two halves side by side. */
function tag(text: EarningsCardText, w: number, wide: boolean) {
  const pad = 30;
  // "about $24.0K": the word in Söhne, the figure in the serif, on one line of text.
  const about = text.usd && (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 9, fontSize: 25, lineHeight: 1.15, color: SOFT }}>
      <div style={{ display: "flex" }}>about</div>
      <div style={{ display: "flex", fontFamily: SERIF, fontWeight: 700, fontSize: 30, color: INK }}>{text.usd.replace(/^about /, "")}</div>
    </div>
  );
  const numbers = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: wide ? "flex-start" : "center" }}>
      <div style={{ display: "flex", fontSize: 27, color: SOFT }}>{text.kicker}</div>
      {/* the figure, in the card's serif and the game's gold: the sheet's own number */}
      <div style={{ display: "flex", fontFamily: SERIF, fontWeight: 700, fontSize: amountSize(text.amount, wide ? w * 0.46 : w - pad * 2, wide ? 108 : 124), lineHeight: 1, marginTop: 4, color: GOLD_DEEP }}>
        {text.amount}
      </div>
      {/* the wide tag is short: the unit and the dollars share a line there */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 22, marginTop: -4 }}>
        <div style={{ display: "flex", fontSize: 30, lineHeight: 1.15, color: SOFT }}>{text.unit}</div>
        {wide && about}
      </div>
      {!wide && about && <div style={{ display: "flex", marginTop: 6 }}>{about}</div>}
    </div>
  );
  // The ledger: what the latest payout brought, and what the pictured word has earned.
  const ledger = text.ledger.length > 0 && (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        ...(wide ? { flex: 1, marginLeft: 34, paddingLeft: 30, borderLeft: RULE } : { alignSelf: "stretch", marginTop: 16, paddingTop: 14, borderTop: RULE }),
      }}
    >
      {text.ledger.map(([name, value]) => (
        <div key={name} style={{ display: "flex", alignItems: "flex-end", gap: 10, fontSize: 25, lineHeight: 1.15 }}>
          <div style={{ display: "flex", color: INK }}>{name}</div>
          <div style={{ display: "flex", flex: 1, height: 0, marginBottom: 7, borderBottom: RULE }} />
          <div style={{ display: "flex", fontFamily: SERIF, fontWeight: 700, fontSize: 29, color: GOLD_INK }}>{value}</div>
        </div>
      ))}
    </div>
  );
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: wide ? "row" : "column",
        alignItems: "center",
        justifyContent: wide ? "flex-start" : "center",
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
          background: TABLE.ground,
          display: "flex",
        }}
      />
      {numbers}
      {ledger}
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
  // The hero word's rarity on its card, as the game treats it (a collab word is Legendary).
  const collab = tiles ? await collabSoon() : NO_COLLAB;
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
          backgroundColor: TABLE.ground,
        }}
      >
        {/* the same engraved table (lib/cardArt/table) */}
        <img src={tableImage(CARD_W, H)} width={CARD_W} height={H} style={{ position: "absolute", left: 0, top: 0 }} />
        {tiles && wordCard({ tiles, scene, cardW, collab, gild: heroStage(snapshot, word) ?? 0 })}
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
        { name: CARD_SERIF, data: serifBold, weight: 700, style: "normal" },
      ],
      // A token is one picture for good: a day in browsers, a week at the edge (the word's picture).
      headers: { "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400" },
    },
  );
}
