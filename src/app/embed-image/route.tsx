import { ImageResponse } from "next/og";

/** Branded 3:2 share card used by the mini-app embed (`fc:miniapp` imageUrl) and OG previews. */
export const dynamic = "force-static";

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
          fontFamily: "Georgia, serif",
        }}
      >
        <div style={{ display: "flex", gap: 18, marginBottom: 32 }}>
          {["L", "E", "X", "I"].map((c, i) => (
            <div
              key={i}
              style={{
                width: 120,
                height: 120,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 84,
                fontWeight: 800,
                color: "#f4ead2",
                background: i === 2 ? "#e0a93b" : "#d8463f",
                border: "6px solid #1b1714",
                borderRadius: 20,
                boxShadow: "8px 8px 0 #1b1714",
              }}
            >
              {c}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: -1 }}>LEXIGOTCHI</div>
        <div style={{ fontSize: 34, marginTop: 12, opacity: 0.75 }}>
          Raise your letters. Spell your words. Own the dictionary.
        </div>
      </div>
    ),
    { width: 1200, height: 800 },
  );
}
