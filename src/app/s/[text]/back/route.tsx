import { readFileSync } from "fs";
import { join } from "path";
import { ImageResponse } from "next/og";
import { OgTile } from "../../../_og/tile";
import { parseShowcase } from "@/lib/showcase";
import { wordTier, type Tier } from "@/lib/economy";
import { ascensionLabel, cardNumber, caseLabel, tierCount, wordPoints } from "@/lib/cardFacts";
import { isSuiteDeployed, addressOf } from "@/lib/onchain/addresses";
import { getPublicClient } from "@/lib/onchain/reads";
import { wordsAbi } from "@/lib/onchain/abis";
import { tokenIdOf } from "@/lib/onchain/tokenId";
import { readWordStory } from "@/lib/onchain/wordStory";
import { readMadeOrder } from "@/lib/keeper/scan";
import { playerFaces } from "@/lib/profile/faces";

/**
 * The back of a word's card for the share loop (components/cards/loop): its words and tiles on
 * their steady plates over a transparent ground, 1200×630, the share card's size. The loop's shader
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

const W = 1200;
const H = 630;
const fmt = (n: number) => n.toLocaleString("en-US");

/** Each material's frame line, gem, and rack (globals.css `.cb.m-*`, the same colors). */
const LOOK: Record<Tier, { line: string; gem: string; rackTop: string; rackFront: string }> = {
  Common: { line: "#9a8164", gem: "#cbbb9c", rackTop: "#54402d", rackFront: "#2a1e15" },
  Uncommon: { line: "#5cc4a9", gem: "#5cc4a9", rackTop: "#22705e", rackFront: "#0c3028" },
  Rare: { line: "#7fb0ef", gem: "#6e9fe0", rackTop: "#2a5799", rackFront: "#0b1d3d" },
  Legendary: { line: "#e9b949", gem: "#f0b53a", rackTop: "#8a6418", rackFront: "#3a2806" },
  Mythic: { line: "#b48cf0", gem: "#a77ce8", rackTop: "#552c94", rackFront: "#1d0d36" },
};

const TEXT = "#f7efdc";
const SUB = "rgba(247, 239, 220, 0.74)";
const PLATE = { background: "rgba(14, 10, 8, 0.52)", border: "1px solid rgba(255, 255, 255, 0.14)" };

type ChainFacts = { number: number | null; level: number | null; finder: string | null };

// Every word's card number, shared by all words. A number never changes once given, so a known one
// is kept; a word not numbered yet (claimed a moment ago) reads them again, at most once a minute.
const ORDER_TTL_MS = 60_000;
let order: { at: number; map: Record<string, number> } | null = null;
let orderRead: Promise<Record<string, number>> | null = null;
async function numberOf(word: string): Promise<number | null> {
  const known = order?.map[word];
  if (known) return known;
  if (order && Date.now() - order.at < ORDER_TTL_MS) return null;
  orderRead ??= readMadeOrder()
    .then((map) => {
      order = { at: Date.now(), map };
      return map;
    })
    .finally(() => {
      orderRead = null;
    });
  const map = await orderRead.catch(() => null);
  return map?.[word] ?? null;
}
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
  if (!isSuiteDeployed()) return { number: null, level: null, finder: null };
  const [number, level, story] = await Promise.all([
    numberOf(word),
    getPublicClient()
      .readContract({ address: addressOf("words"), abi: wordsAbi, functionName: "prestigeLevel", args: [tokenIdOf(word)] })
      .then((l) => Number(l))
      .catch(() => null),
    readWordStory(word).catch(() => null),
  ]);
  const first = story?.claims[0]?.owner ?? null;
  let finder: string | null = null;
  if (first) {
    const faces = await playerFaces([first]).catch(() => null);
    const name = faces?.profiles[first]?.username;
    finder = name ? `@${name}` : `${first.slice(0, 6)}…${first.slice(-4)}`;
  }
  return { number, level, finder };
}

export async function GET(_req: Request, { params }: { params: Promise<{ text: string }> }) {
  const tiles = parseShowcase((await params).text);
  if (!tiles) return new Response("Not a showcase", { status: 404 });
  const word = tiles.map((t) => t.char).join("");
  const tier = wordTier(word);
  const look = LOOK[tier];
  const { number, level, finder } = await chainFactsOf(word);

  const stats: [string, string][] = [
    ["Case", caseLabel(tiles.map((t) => t.upper))],
    ...(level !== null ? ([["Ascension", ascensionLabel(level)]] as [string, string][]) : []),
    ["Points", String(wordPoints(word))],
    ...(finder ? ([["Found by", finder]] as [string, string][]) : []),
  ];

  return new ImageResponse(
    (
      <div style={{ position: "relative", display: "flex", width: W, height: H, fontFamily: "Soehne", color: TEXT }}>
        {/* the frame */}
        <div style={{ position: "absolute", left: 20, top: 20, width: W - 40, height: H - 40, display: "flex", border: `3px solid ${look.line}`, borderRadius: 24 }} />
        <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, display: "flex", flexDirection: "column", padding: "52px 60px", gap: 26 }}>
          {/* the rarity, and the word's number */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 22px 8px 14px", borderRadius: 999, ...PLATE, fontSize: 34, fontWeight: 800 }}>
              <svg width="36" height="36" viewBox="0 0 20 20">
                <path d="M10 1 L18 6 L18 14 L10 19 L2 14 L2 6 Z" fill={look.gem} stroke="#231a14" strokeWidth="1.2" />
                <path d="M10 1 L18 6 L10 9 L2 6 Z" fill="#ffffff" opacity="0.55" />
                <path d="M10 9 L18 6 L18 14 L10 19 Z" fill="#000000" opacity="0.14" />
              </svg>
              {tier}
            </div>
            {/* its card number, only when known (the practice game has no chain to number it) */}
            {number ? <div style={{ display: "flex", padding: "10px 22px", borderRadius: 999, ...PLATE, fontSize: 26, fontWeight: 800, letterSpacing: 0.5, color: SUB }}>{cardNumber(number)}</div> : null}
          </div>

          <div style={{ display: "flex", flex: 1, gap: 40, alignItems: "center" }}>
            {/* the tiles on their rack, and "1 of 1" */}
            <div style={{ display: "flex", flexDirection: "column", width: 520, gap: 18 }}>
              <div style={{ position: "relative", display: "flex", width: 520, height: 150, alignItems: "flex-end", justifyContent: "center" }}>
                <svg width="520" height="56" viewBox="0 0 100 20" preserveAspectRatio="none" style={{ position: "absolute", left: 0, bottom: 0 }}>
                  <polygon points="5,4 95,4 100,13 0,13" fill={look.rackTop} />
                  <polygon points="5,4 95,4 95.6,5 4.4,5" fill="rgba(0,0,0,0.35)" />
                  <rect x="1.5" y="10.6" width="97" height="1.4" fill="rgba(0,0,0,0.42)" />
                  <path d="M0 13 L100 13 L100 18 Q100 20 98 20 L2 20 Q0 20 0 18 Z" fill={look.rackFront} />
                  <rect x="0" y="13" width="100" height="0.9" fill="rgba(255,255,255,0.3)" />
                </svg>
                <div style={{ display: "flex", gap: 6, marginBottom: 22 }}>
                  {tiles.map((t, i) => (
                    <div key={i} style={{ display: "flex" }}>
                      <OgTile char={t.char} upper={t.upper} w={88} limbs={false} tier={tier} index={i} uid={`b${i}`} />
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignSelf: "flex-start", gap: 4, padding: "14px 20px", borderRadius: 14, ...PLATE }}>
                <div style={{ display: "flex", fontSize: 40, fontWeight: 800, lineHeight: 1 }}>1 of 1</div>
                <div style={{ display: "flex", fontSize: 24, color: SUB }}>
                  One of {fmt(tierCount(tier))} {tier} words
                </div>
              </div>
            </div>
            {/* the word's facts */}
            <div style={{ display: "flex", flex: 1, flexDirection: "column", padding: "20px 26px", borderRadius: 14, ...PLATE, gap: 18 }}>
              {/* one fact a row: a label, then its value (the same size, as on the game's back) */}
              {stats.map(([label, value]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 20, fontSize: 26 }}>
                  <div style={{ display: "flex", fontWeight: 800, color: SUB }}>{label}</div>
                  <div style={{ display: "flex" }}>{value}</div>
                </div>
              ))}
            </div>
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
      ],
      // Ascension and the first finder's name can change: minutes, not the share card's week.
      headers: { "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600" },
    },
  );
}
