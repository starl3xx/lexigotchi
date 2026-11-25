import { readFileSync } from "fs";
import { join } from "path";
import { ImageResponse } from "next/og";
import { OgTile } from "../../../_og/tile";
import { SCENE_W, SceneBack, SceneFront } from "@/components/scenes/SceneArt";
import { sceneLayout } from "@/components/scenes/layout";
import { parseShowcase } from "@/lib/showcase";
import { parseScene } from "@/lib/scenes";
import { SITE_URL } from "@/lib/site";

const HOST = new URL(SITE_URL).host;

/**
 * A Showcase share's card: the player's word, drawn as the game's tile characters standing in the
 * scene the player chose (`?scene=`, lib/scenes; the Stage when there is none).
 *
 * Default 1200×630, X's large-card shape (1.91:1). `?ratio=3x2` gives 1200×800 for the Farcaster
 * embed, whose spec requires 3:2. The word and scene come from the URL, so a card is the same
 * picture forever and caches hard.
 */

// Söhne TTFs: Satori (next/og) can't read the app's woff2 (same as /embed-image).
const soehneBold = readFileSync(join(process.cwd(), "public/fonts/soehne-fett.ttf"));
const soehneBook = readFileSync(join(process.cwd(), "public/fonts/soehne-buch.ttf"));

export async function GET(req: Request, { params }: { params: Promise<{ text: string }> }) {
  const tiles = parseShowcase((await params).text);
  if (!tiles) return new Response("Not a showcase", { status: 404 });

  const url = new URL(req.url);
  const tall = url.searchParams.get("ratio") === "3x2";
  const scene = parseScene(url.searchParams.get("scene"));
  const H = tall ? 800 : 630;
  // The same layout the app uses (scenes/layout.ts), at 1 px per scene unit.
  const { tileW, feetY, rowLeft, overlap } = sceneLayout(tiles.length, SCENE_W, H);
  const tileH = Math.round((tileW * 340) / 240);

  return new ImageResponse(
    (
      <div style={{ position: "relative", display: "flex", width: SCENE_W, height: H, fontFamily: "Soehne", color: "#1b1714" }}>
        <SceneBack id={scene} h={H} uid="b" width={SCENE_W} height={H} style={{ position: "absolute", left: 0, top: 0 }} />
        <div style={{ position: "absolute", left: rowLeft, top: feetY - Math.round((tileH * 302) / 340), display: "flex", alignItems: "flex-end" }}>
          {tiles.map((t, i) => (
            <div key={i} style={{ display: "flex", marginLeft: i ? -overlap : 0 }}>
              <OgTile char={t.char} upper={t.upper} w={tileW} />
            </div>
          ))}
        </div>
        <SceneFront id={scene} h={H} uid="f" width={SCENE_W} height={H} style={{ position: "absolute", left: 0, top: 0 }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: tall ? 30 : 22, display: "flex", justifyContent: "center" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "8px 26px",
              borderRadius: 999,
              border: "4px solid #1b1714",
              background: "#fbf4e3",
              boxShadow: "4px 4px 0 #1b1714",
            }}
          >
            <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: -1 }}>LEXIGOTCHI</div>
            <div style={{ fontSize: 24, opacity: 0.6 }}>{HOST}</div>
          </div>
        </div>
      </div>
    ),
    {
      width: SCENE_W,
      height: H,
      fonts: [
        { name: "Soehne", data: soehneBold, weight: 800, style: "normal" },
        { name: "Soehne", data: soehneBook, weight: 400, style: "normal" },
      ],
      // Deterministic per URL, but leave room to redesign it: a day in browsers, a week at the edge.
      headers: { "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400" },
    },
  );
}
