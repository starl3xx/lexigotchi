import { readFileSync } from "fs";
import { join } from "path";
import { ImageResponse } from "next/og";
import { OgTile } from "../../../_og/tile";
import { leanFor } from "@/components/game/tileShapes";
import { SCENE_W, SceneBack, SceneFront } from "@/components/scenes/SceneArt";
import { sceneLayout } from "@/components/scenes/layout";
import { parseShowcase } from "@/lib/showcase";
import { parseScene } from "@/lib/scenes";
import { wordTier } from "@/lib/economy";

/**
 * A Showcase share's card: the player's word, drawn as the game's tile characters standing in the
 * scene the player chose (`?scene=`, lib/scenes; the Stage when there is none), each tile in the
 * finish of the word's rarity (lib/rarityFinish, still: a picture has no light passing).
 *
 * Default 1200×630, X's large-card shape (1.91:1). `?ratio=3x2` gives 1200×800 for the Farcaster
 * embed, whose spec requires 3:2. The word and scene come from the URL, so a card is the same
 * picture forever and caches hard.
 *
 * No name on a link card (decisions.md #23; starl3xx, 2026-11-25: the pill under the word "looks
 * cheap/misplaced and makes the card look imbalanced"): X prints the site under the card and the
 * post names @lexigotchi; Farcaster's card carries the game's button. `?saved=1` is the picture
 * that travels alone (Save image, later the share video), so it carries a quiet wordmark in the
 * bottom right corner, away from the word.
 */

// Söhne TTF: Satori (next/og) can't read the app's woff2 (same as /embed-image).
const soehneBold = readFileSync(join(process.cwd(), "public/fonts/soehne-fett.ttf"));

export async function GET(req: Request, { params }: { params: Promise<{ text: string }> }) {
  const tiles = parseShowcase((await params).text);
  if (!tiles) return new Response("Not a showcase", { status: 404 });

  const url = new URL(req.url);
  const tall = url.searchParams.get("ratio") === "3x2";
  const saved = url.searchParams.get("saved") === "1";
  const scene = parseScene(url.searchParams.get("scene"));
  const H = tall ? 800 : 630;
  // The same layout the app uses (scenes/layout.ts), at 1 px per scene unit.
  const { tileW, feetY, rowLeft, overlap } = sceneLayout(tiles.length, SCENE_W, H);
  const tileH = Math.round((tileW * 340) / 240);
  // The word's rarity, from the word itself: a link can't claim a tier. A house card (HEYOO) isn't
  // a dictionary word, so it has none and stays plain.
  const word = tiles.map((t) => t.char).join("");
  const tier = wordTier(word);

  return new ImageResponse(
    (
      <div style={{ position: "relative", display: "flex", width: SCENE_W, height: H, fontFamily: "Soehne", color: "#1b1714" }}>
        <SceneBack id={scene} h={H} uid="b" width={SCENE_W} height={H} style={{ position: "absolute", left: 0, top: 0 }} />
        <div style={{ position: "absolute", left: rowLeft, top: feetY - Math.round((tileH * 302) / 340), display: "flex", alignItems: "flex-end" }}>
          {tiles.map((t, i) => (
            <div key={i} style={{ display: "flex", marginLeft: i ? -overlap : 0 }}>
              <OgTile char={t.char} upper={t.upper} w={tileW} tier={tier} index={i} uid={`t${i}`} linkLeft={i > 0} linkRight={i < tiles.length - 1} lean={leanFor(word, i)} />
            </div>
          ))}
        </div>
        <SceneFront id={scene} h={H} uid="f" width={SCENE_W} height={H} style={{ position: "absolute", left: 0, top: 0 }} />
        {saved && (
          <div
            style={{
              position: "absolute",
              right: tall ? 34 : 28,
              bottom: tall ? 28 : 22,
              display: "flex",
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: -0.5,
              color: "#fbf4e3",
              opacity: 0.9,
              // a soft dark halo, so it reads on snow as well as on the stage's wood
              textShadow: "0 1px 2px rgba(27, 23, 20, 0.85), 0 0 10px rgba(27, 23, 20, 0.55)",
            }}
          >
            LEXIGOTCHI
          </div>
        )}
      </div>
    ),
    {
      width: SCENE_W,
      height: H,
      fonts: [{ name: "Soehne", data: soehneBold, weight: 800, style: "normal" }],
      // Deterministic per URL, but leave room to redesign it: a day in browsers, a week at the edge.
      headers: { "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400" },
    },
  );
}
