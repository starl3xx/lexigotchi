/**
 * Scenes (src/lib/scenes.ts, src/components/scenes/): the list, the unlock, where the word stands,
 * and the rules the drawings must keep so the share card (Satori) can draw them.
 */
import { describe, it, expect, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_SCENE,
  SCENES,
  SCENE_IDS,
  SCENE_UNLOCK_WORDS,
  canUseScene,
  isSceneId,
  parseScene,
  scenesUnlocked,
  shownScene,
} from "@/lib/scenes";
import { SceneBack, SceneFront } from "@/components/scenes/SceneArt";
import { SCENE_FLOOR, SCENE_W } from "@/components/scenes/kit";
import { sceneHeightFor, sceneLayout } from "@/components/scenes/layout";

describe("the scene list", () => {
  it("names every scene once, the Stage first", () => {
    expect(SCENES.map((s) => s.id)).toEqual([...SCENE_IDS]);
    expect(new Set(SCENES.map((s) => s.name)).size).toBe(SCENES.length);
    expect(SCENES[0].id).toBe(DEFAULT_SCENE);
    expect(DEFAULT_SCENE).toBe("stage");
  });

  it("reads a scene from a link, and anything unknown is the Stage", () => {
    expect(parseScene("winter")).toBe("winter");
    for (const bad of [null, undefined, "", "WINTER", "space", ["winter"], 3]) expect(parseScene(bad)).toBe("stage");
    expect(isSceneId("fall")).toBe(true);
    expect(isSceneId("autumn")).toBe(false);
  });

  it("player copy has no em dash", () => {
    for (const s of SCENES) expect(`${s.name} ${s.blurb}`).not.toMatch(/—/);
  });
});

describe("the unlock", () => {
  it("opens every scene at three words (starl3xx: an unlock for reaching, say, 3 words spelled)", () => {
    expect(SCENE_UNLOCK_WORDS).toBe(3);
    expect(scenesUnlocked(0)).toBe(false);
    expect(scenesUnlocked(2)).toBe(false);
    expect(scenesUnlocked(3)).toBe(true);
    expect(scenesUnlocked(40)).toBe(true);
  });

  it("always lets a player use the Stage", () => {
    expect(canUseScene("stage", 0)).toBe(true);
    expect(canUseScene("winter", 2)).toBe(false);
    expect(canUseScene("winter", 3)).toBe(true);
  });

  it("draws a saved choice only while it is unlocked, and keeps it for when it is again", () => {
    expect(shownScene("winter", 3)).toBe("winter");
    expect(shownScene("winter", 2)).toBe("stage");
    expect(shownScene(null, 9)).toBe("stage");
    expect(shownScene(undefined, 9)).toBe("stage");
  });
});

describe("where the word stands", () => {
  it("puts the feet on the floor line, the row centered between the Stage's curtains", () => {
    const l = sceneLayout(5, SCENE_W, 800);
    expect(l.feetY).toBe(800 - SCENE_FLOOR);
    expect(Math.abs(2 * l.rowLeft + l.rowW - SCENE_W)).toBeLessThanOrEqual(1);
    expect(l.rowLeft).toBeGreaterThanOrEqual(190); // clear of the curtains' gathered folds
    expect(l.rowTop).toBeLessThan(l.feetY);
  });

  it("scales with the box, so the app and the card agree", () => {
    const phone = sceneLayout(5, 360, 240);
    const card = sceneLayout(5, SCENE_W, 800);
    expect(phone.feetY).toBe(240 - Math.round(SCENE_FLOOR * 0.3));
    expect(Math.abs(phone.tileW - card.tileW * 0.3)).toBeLessThanOrEqual(1);
  });

  it("keeps the feet on the line on X's shorter card", () => {
    expect(sceneLayout(5, SCENE_W, 630).feetY).toBe(630 - SCENE_FLOOR);
    expect(sceneHeightFor(360, 240)).toBe(800);
    expect(sceneHeightFor(1200, 630)).toBe(630);
  });
});

/** Every element inside a scene's <svg>: what Satori serializes as text. */
function inner(el: ReactElement): ReactNode {
  // SceneBack/SceneFront return <Svg p>{layer}</Svg>; Satori calls Svg, then serializes the rest.
  return (el.props as { children: ReactNode }).children;
}

function walk(node: ReactNode, visit: (el: ReactElement) => void) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (!isValidElement(node)) return;
  visit(node);
  walk((node.props as { children?: ReactNode }).children, visit);
}

describe("the drawings keep the share card's rules", () => {
  const layers = SCENE_IDS.flatMap((id) =>
    [630, 800].flatMap((h) => [
      { name: `${id} back ${h}`, el: SceneBack({ id, h, uid: "t" }) },
      ...(SceneFront({ id, h, uid: "t" }) ? [{ name: `${id} front ${h}`, el: SceneFront({ id, h, uid: "t" })! }] : []),
    ]),
  );

  it.each(layers.map((l) => [l.name, l.el] as const))("%s: plain SVG elements only (no component, no fragment)", (_, el) => {
    const bad: string[] = [];
    walk(inner(el), (e) => {
      if (typeof e.type !== "string") bad.push(String((e.type as { name?: string }).name ?? e.type));
    });
    expect(bad).toEqual([]);
  });

  it.each(layers.map((l) => [l.name, l.el] as const))("%s: no attribute left undefined, no class, no text", (_, el) => {
    const bad: string[] = [];
    walk(inner(el), (e) => {
      for (const [k, v] of Object.entries(e.props as Record<string, unknown>)) {
        if (k !== "children" && v === undefined) bad.push(`${String(e.type)}.${k}`);
        if (k === "className" || k === "style") bad.push(`${String(e.type)}.${k} (still picture)`);
      }
      if (e.type === "text") bad.push("text");
    });
    expect(bad).toEqual([]);
  });

  it("moves only when animated", () => {
    for (const id of SCENE_IDS) {
      const still = renderToStaticMarkup(SceneBack({ id, uid: "s" })) + renderToStaticMarkup(SceneFront({ id, uid: "s" }) ?? <g />);
      const moving = renderToStaticMarkup(SceneBack({ id, uid: "s", animated: true })) + renderToStaticMarkup(SceneFront({ id, uid: "s", animated: true }) ?? <g />);
      expect(still).not.toMatch(/scn-/);
      expect(moving).toMatch(/scn-/);
    }
  });

  it("renders every scene without a React warning (a missing key in a list, say)", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const id of SCENE_IDS) {
        for (const animated of [false, true]) {
          renderToStaticMarkup(SceneBack({ id, uid: "w", animated }));
          const front = SceneFront({ id, uid: "w", animated });
          if (front) renderToStaticMarkup(front);
        }
      }
      expect(warn.mock.calls.map((c) => String(c[0]).slice(0, 120))).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it("draws the same picture every time (seeded, not random)", () => {
    for (const id of SCENE_IDS) {
      expect(renderToStaticMarkup(SceneBack({ id, uid: "s" }))).toBe(renderToStaticMarkup(SceneBack({ id, uid: "s" })));
    }
  });

  it("names its gradients after the scene's uid, so two scenes on a page never share one", () => {
    const a = renderToStaticMarkup(SceneBack({ id: "stage", uid: "a1" }));
    const ids = [...a.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((x) => x.startsWith("a1-"))).toBe(true);
  });
});
