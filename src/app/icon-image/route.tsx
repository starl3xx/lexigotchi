import { readFileSync } from "fs";
import { join } from "path";
import { ImageResponse } from "next/og";
import { OgTile } from "../_og/tile";

/** Square app icon / splash image for the mini-app manifest. */
export const dynamic = "force-static";

// Söhne bold TTF — Satori can't read the app's woff2 (same ttf set LHAW ships).
const soehneBold = readFileSync(join(process.cwd(), "public/fonts/soehne-fett.ttf"));

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f4ead2",
          fontFamily: "Soehne",
        }}
      >
        {/* a single glow-up tile — face + eyes, no limbs (reads bold at icon scale) */}
        <OgTile char="L" upper w={900} limbs={false} />
      </div>
    ),
    {
      width: 1024,
      height: 1024,
      fonts: [{ name: "Soehne", data: soehneBold, weight: 800, style: "normal" }],
    },
  );
}
