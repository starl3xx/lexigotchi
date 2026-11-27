import { readFileSync } from "fs";
import { join } from "path";
import { ImageResponse } from "next/og";
import { lockupDoc } from "@/lib/cardArt/logo";

/** Branded 3:2 share card used by the mini-app embed (`fc:miniapp` imageUrl) and OG previews. */
export const dynamic = "force-static";

// Söhne TTFs — Satori (next/og) can't read the app's woff2, so we ship ttf copies (same set LHAW uses).
const soehneBold = readFileSync(join(process.cwd(), "public/fonts/soehne-fett.ttf"));
const soehneBook = readFileSync(join(process.cwd(), "public/fonts/soehne-buch.ttf"));

// The game's lockup is the picture (decisions.md #56, part 2). It stood under four letters that spelled LEXI, with the
// name in plain type: with the lockup there, the L tile showed twice, so the lockup stands alone.
const MARK = lockupDoc();
const MARK_H = 230;
const MARK_W = Math.round((MARK_H * MARK.width) / MARK.height);
const MARK_SRC = `data:image/svg+xml;base64,${Buffer.from(MARK.svg).toString("base64")}`;

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
        <img src={MARK_SRC} width={MARK_W} height={MARK_H} />
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
