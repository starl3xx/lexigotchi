/**
 * A word as five small flat tiles in its finish, for long lists (the Dictionary draws 80 words).
 * Each tile is one styled letter, not the character rig: at 20 px the rig's face and limbs don't
 * show, and 400 of its drawings made each keystroke in the Dictionary's search two to four times
 * slower on a 4×-slowed phone. The material is baked once per tier into a CSS gradient (the tint
 * of lib/rarityFinish over the tile's own face, and a gloss for the polished ones), so a list
 * costs what a list of letters costs. Still, like every list.
 */
import type { CSSProperties } from "react";
import type { Tier } from "@/lib/economy";
import { FINISH, finishFor } from "@/lib/rarityFinish";

/** "#rrggbb" at `a` opacity. */
function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Each tier's tile background, worked out once: the material's tint, then a gloss. */
const BAKED: Partial<Record<Tier, string>> = Object.fromEntries(
  Object.keys(FINISH).map((t) => {
    const fin = finishFor(t as Tier)!;
    const tint = `linear-gradient(160deg, ${fin.face.map((c) => rgba(c, fin.alpha)).join(", ")})`;
    const gloss =
      fin.material === "satin"
        ? "linear-gradient(135deg, rgba(255,255,255,0) 15%, rgba(255,255,255,0.45) 30%, rgba(255,255,255,0) 48%)"
        : "linear-gradient(135deg, rgba(255,255,255,0) 22%, rgba(255,255,255,0.65) 34%, rgba(255,255,255,0) 44%, rgba(255,255,255,0.35) 52%, rgba(255,255,255,0) 58%)";
    return [t, `${gloss}, ${tint}`];
  }),
);

export function MiniTiles({ word, upper, tier, className = "" }: { word: string; upper: readonly boolean[]; tier?: Tier; className?: string }) {
  const bg = tier ? BAKED[tier] : undefined;
  const style: CSSProperties | undefined = bg ? { backgroundImage: bg } : undefined;
  return (
    <span className={`inline-flex gap-[3px] ${className}`} aria-hidden>
      {[...word].map((ch, i) => (
        <span key={i} className={`mini-tile ${upper[i] ? "is-up" : ""}`} style={style}>
          {upper[i] ? ch.toUpperCase() : ch.toLowerCase()}
        </span>
      ))}
    </span>
  );
}
