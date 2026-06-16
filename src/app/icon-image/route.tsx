import { readFileSync } from "fs";
import { join } from "path";
import { ImageResponse } from "next/og";

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
        }}
      >
        <div
          style={{
            width: 720,
            height: 720,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 460,
            fontWeight: 800,
            fontFamily: "Soehne",
            color: "#f4ead2",
            background: "#d8463f",
            border: "32px solid #1b1714",
            borderRadius: 96,
            boxShadow: "40px 40px 0 #1b1714",
          }}
        >
          L
        </div>
      </div>
    ),
    {
      width: 1024,
      height: 1024,
      fonts: [{ name: "Soehne", data: soehneBold, weight: 800, style: "normal" }],
    },
  );
}
