/**
 * The scene drawings (lib/scenes.ts names them). One drawing serves three places: the Today
 * stage, the Showcase, and the share card (`/s/<word>/card`, drawn by Satori on the server).
 *
 * Pure SVG shapes and gradients, no hooks, no `<text>`, no CSS that Satori can't read, so the same
 * markup renders in the browser and in an ImageResponse (kit.tsx has the rules that keeps). Motion
 * is CSS (globals.css, the `scn-` classes, all behind prefers-reduced-motion: no-preference) and
 * is drawn only when `animated`: the share card and the picker's thumbnails are still pictures.
 *
 * Geometry: the scene is always 1200 units wide and `h` tall (800 for 3:2, 630 for X's card). The
 * characters' feet stand on one line, SCENE_FLOOR units above the bottom edge, in every scene and
 * every size, so a caller only has to put the feet there (scenes/layout.ts). Everything else is
 * laid out from `h`: the top of a scene can be cut short on a wide card without moving the floor.
 *
 * Each scene has a back layer (behind the characters) and may have a front layer (in front of
 * them: curtains, falling snow, the glass of the trophy case).
 */
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { SceneId } from "@/lib/scenes";
import { SCENE_W, makeCtx, type Layer } from "./kit";
import { stageBack, stageFront } from "./art/stage";
import { trophyBack, trophyFront } from "./art/trophy";
import { portraitBack, portraitFront } from "./art/portrait";
import { fallBack, fallFront, springBack, springFront } from "./art/seasons";
import { summerBack } from "./art/summer";
import { winterBack, winterFront } from "./art/winter";

export { SCENE_W, SCENE_FLOOR } from "./kit";

const ART: Record<SceneId, { back: Layer; front?: Layer }> = {
  stage: { back: stageBack, front: stageFront },
  trophy: { back: trophyBack, front: trophyFront },
  portrait: { back: portraitBack, front: portraitFront },
  spring: { back: springBack, front: springFront },
  summer: { back: summerBack },
  fall: { back: fallBack, front: fallFront },
  winter: { back: winterBack, front: winterFront },
};

export interface SceneArtProps {
  id: SceneId;
  /** Height in scene units; the width is always SCENE_W. */
  h?: number;
  /** Ambient motion. Off for thumbnails and the share card. */
  animated?: boolean;
  /** Prefix for gradient ids, unique per drawn scene on a page. */
  uid: string;
  /** Pixel size. The share card needs it (Satori); in the app, CSS sizes the svg. */
  width?: number;
  height?: number;
  className?: string;
  style?: CSSProperties;
}

function Svg({ p, children }: { p: SceneArtProps; children: ReactNode }): ReactElement {
  const h = p.h ?? 800;
  return (
    <svg
      viewBox={`0 0 ${SCENE_W} ${h}`}
      preserveAspectRatio="xMidYMax slice"
      aria-hidden
      {...(p.width ? { width: p.width, height: p.height } : {})}
      {...(p.className ? { className: p.className } : {})}
      {...(p.style ? { style: p.style } : {})}
    >
      {children}
    </svg>
  );
}

export function SceneBack(p: SceneArtProps): ReactElement {
  const c = makeCtx(p.uid, p.h ?? 800, !!p.animated);
  return <Svg p={p}>{ART[p.id].back(c)}</Svg>;
}

/** The layer in front of the characters, or null for a scene that has none. */
export function SceneFront(p: SceneArtProps): ReactElement | null {
  const front = ART[p.id].front;
  if (!front) return null;
  const c = makeCtx(p.uid + "f", p.h ?? 800, !!p.animated);
  return <Svg p={p}>{front(c)}</Svg>;
}
