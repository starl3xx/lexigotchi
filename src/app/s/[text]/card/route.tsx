import { readFileSync } from "fs";
import { join } from "path";
import { ImageResponse } from "next/og";
import { OgTile } from "../../../_og/tile";
import { parseShowcase } from "@/lib/showcase";
import { SITE_URL } from "@/lib/site";

const HOST = new URL(SITE_URL).host;

/**
 * A Showcase share's card: the player's letters, drawn as the game's tile characters.
 *
 * Default 1200×630, X's large-card shape (1.91:1). `?ratio=3x2` gives 1200×800 for the Farcaster
 * embed, whose spec requires 3:2. The letters come from the path, so a card is the same picture
 * forever and caches hard.
 */

// Söhne TTFs: Satori (next/og) can't read the app's woff2 (same as /embed-image).
const soehneBold = readFileSync(join(process.cwd(), "public/fonts/soehne-fett.ttf"));
const soehneBook = readFileSync(join(process.cwd(), "public/fonts/soehne-buch.ttf"));

const W = 1200;
/** Side margin, and the overlap between neighbors (the characters hold hands, as in TileWord). */
const MARGIN = 70;

export async function GET(req: Request, { params }: { params: Promise<{ text: string }> }) {
  const tiles = parseShowcase((await params).text);
  if (!tiles) return new Response("Not a showcase", { status: 404 });

  const tall = new URL(req.url).searchParams.get("ratio") === "3x2";
  const H = tall ? 800 : 630;
  // The tile row's height budget: what's left above the wordmark strip.
  const rowH = H - (tall ? 290 : 230);
  const n = tiles.length;
  const byHeight = Math.floor((rowH * 240) / 340);
  // n tiles overlap by 14% of a width each (n - 1 overlaps), inside the margins.
  const byWidth = Math.floor((W - 2 * MARGIN) / (n - (n - 1) * 0.14));
  const w = Math.min(byHeight, byWidth);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#f4ead2",
          color: "#1b1714",
          fontFamily: "Soehne",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          {tiles.map((t, i) => (
            <div key={i} style={{ display: "flex", marginLeft: i ? -Math.round(w * 0.14) : 0 }}>
              <OgTile char={t.char} upper={t.upper} w={w} />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: tall ? 22 : 12 }}>
          <div style={{ fontSize: tall ? 64 : 54, fontWeight: 800, letterSpacing: -1 }}>LEXIGOTCHI</div>
          <div style={{ fontSize: tall ? 32 : 28, opacity: 0.6 }}>{HOST}</div>
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
      // Deterministic per path, but leave room to redesign it: a day in browsers, a week at the edge.
      headers: { "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400" },
    },
  );
}
