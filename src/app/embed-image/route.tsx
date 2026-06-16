import { readFileSync } from "fs";
import { join } from "path";
import { ImageResponse } from "next/og";
import { OgTile } from "../_og/tile";

/** Branded 3:2 share card used by the mini-app embed (`fc:miniapp` imageUrl) and OG previews. */
export const dynamic = "force-static";

// Söhne TTFs — Satori (next/og) can't read the app's woff2, so we ship ttf copies (same set LHAW uses).
const soehneBold = readFileSync(join(process.cwd(), "public/fonts/soehne-fett.ttf"));
const soehneBook = readFileSync(join(process.cwd(), "public/fonts/soehne-buch.ttf"));

export function GET() {
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
        <div style={{ display: "flex", gap: 6 }}>
          {[..."LEXI"].map((c, i) => (
            <OgTile key={i} char={c} upper w={168} />
          ))}
        </div>
        <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: -1, marginTop: -18 }}>LEXIGOTCHI</div>
        <div style={{ fontSize: 34, marginTop: 12, opacity: 0.75 }}>
          Raise your letters. Spell your words. Own the dictionary.
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 800,
      fonts: [
        { name: "Soehne", data: soehneBold, weight: 800, style: "normal" },
        { name: "Soehne", data: soehneBook, weight: 400, style: "normal" },
      ],
    },
  );
}
