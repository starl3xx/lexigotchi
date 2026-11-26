import { readFileSync } from "fs";
import { join } from "path";
import { ImageResponse } from "next/og";
import { OgTile } from "../../../_og/tile";
import { parseLinkStage, parseShowcase } from "@/lib/showcase";
import { cardLevelOf } from "@/lib/onchain/cardLevel";
import { wordTier, type Tier } from "@/lib/economy";
import { tierMarkPaths } from "@/lib/tierMark";
import { PIP_Y, pipPath } from "@/components/game/tileShapes";
import { ascensionLabel, cardDigits, caseLabel, tierCount, wordPoints } from "@/lib/cardFacts";
import { svgDoc } from "@/lib/cardArt/engrave";
import { SEAL, sealInk } from "@/lib/cardArt/seal";
import { isSuiteDeployed } from "@/lib/onchain/addresses";
import { readWordStory } from "@/lib/onchain/wordStory";
import { cardNumberOf } from "@/lib/onchain/cardNumbers";
import { playerFaces } from "@/lib/profile/faces";

/**
 * The back of a word's card for the share loop (components/cards/loop): its words and tiles over a
 * transparent ground, 1200×675, the card's own shape (16:9). Laid out as the game's back is at its
 * full size (components/cards/CardBack; decisions.md #35, #37): the rarity over the card's number
 * (the headline), "One of one", the tiles on their rack, the facts as a ledger, the game's seal
 * pressed in behind them, and the frame's two lines. The card's serif here is TeX Gyre Pagella
 * (the server has no fonts of its own; the share picture's route says more). The loop's shader
 * paints the back's material under it (cards/live/materialGlsl), the same material the game's live
 * back draws, so the video and the game match.
 *
 * The video travels to strangers, so the back speaks of the word, never of "you": its rarity, its
 * case (from the link, like the share card's front), its points, and from the chain when the game
 * is live, its card number (its place in the order words were first made), its ascension, and who
 * first found it. Nothing comes from the query string. The facts can change (an ascension, a first finder's name), so it caches for minutes,
 * not the share card's week.
 */

// Söhne TTFs: Satori (next/og) can't read the app's woff2. Labels are bold here: Satori has no
// semibold Söhne (the game's labels are semibold).
const soehneBold = readFileSync(join(process.cwd(), "public/fonts/soehne-fett.ttf"));
const soehneBook = readFileSync(join(process.cwd(), "public/fonts/soehne-buch.ttf"));
const pagellaBold = readFileSync(join(process.cwd(), "public/fonts/texgyrepagella-bold.otf"));

const W = 1200;
const H = 675;
const fmt = (n: number) => n.toLocaleString("en-US");

/** Each material’s frame line and rack (globals.css `.cb.m-*`, the same colors). */
const LOOK: Record<Tier, { line: string; rackTop: string; rackFront: string }> = {
  Common: { line: "#9a8164", rackTop: "#54402d", rackFront: "#2a1e15" },
  Uncommon: { line: "#5cc4a9", rackTop: "#22705e", rackFront: "#0c3028" },
  Rare: { line: "#7fb0ef", rackTop: "#2a5799", rackFront: "#0b1d3d" },
  Legendary: { line: "#e9b949", rackTop: "#8a6418", rackFront: "#3a2806" },
  Mythic: { line: "#b48cf0", rackTop: "#552c94", rackFront: "#1d0d36" },
};

const TEXT = "#f7efdc";
const SUB = "rgba(247, 239, 220, 0.74)";
const SHADOW = "0 2px 3px rgba(0, 0, 0, 0.45)";
const SERIF = "Pagella";
/** Two colours mixed, `share` of the first: the game's `color-mix` for lettering in the line's colour. */
function mix(a: string, b: string, share: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `rgb(${[0, 1, 2].map((i) => Math.round(ch(a, i) * share + ch(b, i) * (1 - share))).join(", ")})`;
}
/** The seal, pressed in the material's line colour, as an address Satori's `<img>` takes. */
const seal = (ink: string) => `data:image/svg+xml;base64,${Buffer.from(svgDoc(sealInk(ink), SEAL, SEAL)).toString("base64")}`;

type ChainFacts = { number: number | null; finder: string | null };

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
  if (!isSuiteDeployed()) return { number: null, finder: null };
  const [number, story] = await Promise.all([cardNumberOf(word), readWordStory(word).catch(() => null)]);
  const first = story?.claims[0]?.owner ?? null;
  let finder: string | null = null;
  if (first) {
    const faces = await playerFaces([first]).catch(() => null);
    const name = faces?.profiles[first]?.username;
    finder = name ? `@${name}` : `${first.slice(0, 6)}…${first.slice(-4)}`;
  }
  return { number, finder };
}

export async function GET(req: Request, { params }: { params: Promise<{ text: string }> }) {
  const tiles = parseShowcase((await params).text);
  if (!tiles) return new Response("Not a showcase", { status: 404 });
  const word = tiles.map((t) => t.char).join("");
  const tier = wordTier(word);
  const look = LOOK[tier];
  // The stage has its own read (lib/onchain/cardLevel), which the stage this address names can ask
  // to be read again: a video made the moment after an ascension must not draw the stage before it.
  const [{ number, finder }, level] = await Promise.all([chainFactsOf(word), cardLevelOf(word, parseLinkStage(new URL(req.url).searchParams.get("g")))]);

  const stats: [string, string][] = [
    ["Case", caseLabel(tiles.map((t) => t.upper))],
    ...(level !== null ? ([["Ascension", ascensionLabel(level)]] as [string, string][]) : []),
    ["Points", String(wordPoints(word))],
    ...(finder ? ([["Found by", finder]] as [string, string][]) : []),
  ];

  const digits = cardDigits(number);
  // The game's back at its full size (globals.css, `.cb`), in the same measures: a share of the
  // card's width each (cqw there, U here), without the caps the game puts on type for a screen.
  const U = W / 100;
  const tint = mix(look.line, TEXT, 0.74);
  return new ImageResponse(
    (
      <div style={{ position: "relative", display: "flex", width: W, height: H, fontFamily: "Soehne", color: TEXT, textShadow: SHADOW }}>
        {/* the frame: a line in the material's colour, and a dotted line just outside it */}
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", left: 0, top: 0 }}>
          <rect x="13" y="13" width={W - 26} height={H - 26} rx="29" fill="none" stroke={look.line} strokeWidth="3.4" strokeDasharray="3.4 5" />
          <rect x="21.5" y="21.5" width={W - 43} height={H - 43} rx="24" fill="none" stroke={look.line} strokeWidth="3.6" />
        </svg>
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
                One of {fmt(tierCount(tier))} {tier} words
              </div>
            </div>
            {/* the tiles on their rack: the word itself, in Söhne, and nowhere else on the back */}
            <div style={{ position: "relative", display: "flex", width: 430, height: 118, marginTop: 0.6 * U, alignItems: "flex-end", justifyContent: "center" }}>
              <svg width="430" height="48" viewBox="0 0 100 20" preserveAspectRatio="none" style={{ position: "absolute", left: 0, bottom: 0 }}>
                <polygon points="5,4 95,4 100,13 0,13" fill={look.rackTop} />
                <polygon points="5,4 95,4 95.6,5 4.4,5" fill="rgba(0,0,0,0.35)" />
                <rect x="1.5" y="10.6" width="97" height="1.4" fill="rgba(0,0,0,0.42)" />
                <path d="M0 13 L100 13 L100 18 Q100 20 98 20 L2 20 Q0 20 0 18 Z" fill={look.rackFront} />
                <rect x="0" y="13" width="100" height="0.9" fill="rgba(255,255,255,0.3)" />
              </svg>
              <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
                {tiles.map((t, i) => (
                  <div key={i} style={{ display: "flex" }}>
                    <OgTile char={t.char} upper={t.upper} w={74} limbs={false} tier={tier} gild={level ?? 0} index={i} uid={`b${i}`} />
                  </div>
                ))}
              </div>
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
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: [
        { name: "Soehne", data: soehneBold, weight: 800, style: "normal" },
        { name: "Soehne", data: soehneBook, weight: 400, style: "normal" },
        { name: SERIF, data: pagellaBold, weight: 700, style: "normal" },
      ],
      // Ascension and the first finder's name can change: minutes, not the share card's week.
      headers: { "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600" },
    },
  );
}
