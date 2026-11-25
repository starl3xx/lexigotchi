/**
 * The live material of a card's back (decisions.md #26): the back's satin, brushed
 * foil, gold, or cut amethyst drawn by WebGL (OGL), so the light moves across it as the pointer
 * moves, or as the phone tilts. The words and tiles stay in HTML above it, on their steady plates.
 *
 * Built for the GPU rules (starl3xx, 2026-11-25: "these artifacts are melting my laptop's GPU ...
 * as efficient as possible across all devices"):
 * - **One context, only while a back is up.** `attachSurface` makes it; attaching another first
 *   lets the old one go, and `destroy` loses the context outright, so the GPU memory returns.
 * - **On demand, never a loop.** A frame is drawn when something changes: the light moved (the
 *   pointer, a tilt), the card resized, or the one-second sweep that lights a back as it turns up.
 *   Between those, nothing runs.
 * - **Few pixels.** At most 1.25× the CSS size: the material is soft, and a phone's 3× is wasted
 *   on it. No antialiasing (a full-screen triangle has no edges).
 *
 * The shader is the "Scene Cards" mock's (deep treatment), so the live back and the CSS stand-in
 * (globals.css `.cb.m-*`, drawn where WebGL isn't) share their colors.
 */
import { Mesh, Program, Renderer, Triangle } from "ogl";
import type { CardMaterial } from "../material";
import { REST_LIGHT } from "./tilt";
import { MATERIAL_GLSL, MAT_INDEX } from "./materialGlsl";


/** The most pixels the material is ever drawn at, as a multiple of its CSS size. */
export const MAX_DPR = 1.25;
/** How long the light sweeps across a back as it turns up. */
export const SWEEP_MS = 1000;

const VERT = /* glsl */ `
attribute vec2 uv;
attribute vec2 position;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position, 0.0, 1.0); }
`;

// The material itself is ./materialGlsl, shared with the share loop.
const FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec2 uLight;
uniform float uMat;
uniform vec2 uRes;
varying vec2 vUv;
${MATERIAL_GLSL}
void main() {
  gl_FragColor = vec4(material(vUv, uLight, uTime, uMat, uRes.x / uRes.y, 1.0 / uRes.y), 1.0);
}
`;

export interface LiveSurface {
  /** Move the light (0–1 from the top left) and draw one frame. */
  light(x: number, y: number): void;
  /** Fit the drawing buffer to the canvas's size and draw. */
  resize(): void;
  /** Move the light as `light` does, unless the sweep is still running: a tilt waits for it. */
  nudge(x: number, y: number): void;
  /** Sweep the light across the back once (about a second), then stop where it rests (REST_LIGHT). */
  sweep(): void;
  /** Let the context go. */
  destroy(): void;
}

let current: LiveSurface | null = null;
/** What to tell the current back if a newer one takes the context. */
let evicted: (() => void) | null = null;

/**
 * Let the live back go, if one is up: something else needs the one WebGL context (the share loop,
 * ../loop). The back is told, and steps aside for its CSS material.
 */
export function releaseLive(): void {
  if (!current) return;
  const tell = evicted; // destroy() clears it
  current.destroy();
  tell?.();
}

/**
 * Draw `material` live on `canvas`. Only one live back at a time: the last one lets go first, and
 * is told (`onEvicted`), so it can step aside for its CSS material rather than show a dead canvas.
 * Returns null when WebGL won't start (the CSS material stays, as it would without WebGL).
 */
export function attachSurface(canvas: HTMLCanvasElement, material: CardMaterial, onEvicted?: () => void): LiveSurface | null {
  if (current) {
    const tell = evicted; // destroy() clears it
    current.destroy();
    tell?.();
  }
  evicted = onEvicted ?? null;
  let renderer: Renderer;
  try {
    renderer = new Renderer({ canvas, dpr: Math.min(MAX_DPR, window.devicePixelRatio || 1), alpha: false, antialias: false, powerPreference: "low-power" });
  } catch {
    return null;
  }
  const gl = renderer.gl;
  const start = performance.now();
  const program = new Program(gl, {
    vertex: VERT,
    fragment: FRAG,
    uniforms: { uTime: { value: 0 }, uLight: { value: [0.35, 0.7] }, uMat: { value: MAT_INDEX[material] }, uRes: { value: [1, 1] } },
  });
  const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

  // One frame at the next paint, however many changes asked for it.
  let queued = 0;
  let dead = false;
  const draw = () => {
    if (queued || dead) return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      if (dead) return;
      program.uniforms.uTime.value = (performance.now() - start) / 1000;
      renderer.render({ scene: mesh });
    });
  };
  const setLight = (x: number, y: number) => {
    program.uniforms.uLight.value = [Math.min(1, Math.max(0, x)), 1 - Math.min(1, Math.max(0, y))];
  };

  let sweepFrame = 0;
  const surface: LiveSurface = {
    light(x, y) {
      cancelAnimationFrame(sweepFrame);
      sweepFrame = 0;
      setLight(x, y);
      draw();
    },
    nudge(x, y) {
      // A phone sends its first reading at once, and every moment after: the sweep runs its course
      // (Bugbot on #213), and the tilt takes over from where it leaves the light.
      if (sweepFrame) return;
      surface.light(x, y);
    },
    resize() {
      // The layout box, not getBoundingClientRect: mid-turn the card is a 3D projection, narrower
      // than it will be, and a canvas sized from that leaves part of the back uncovered.
      const box = canvas.parentElement ?? canvas;
      renderer.setSize(Math.max(1, box.clientWidth), Math.max(1, box.clientHeight));
      program.uniforms.uRes.value = [gl.canvas.width, gl.canvas.height];
      draw();
    },
    sweep() {
      cancelAnimationFrame(sweepFrame);
      const t0 = performance.now();
      const step = (now: number) => {
        if (dead) return;
        const k = Math.min(1, (now - t0) / SWEEP_MS);
        const e = 1 - (1 - k) ** 3; // ease out
        // from the top left, across, to resting a little left of centre
        setLight(0.05 + (REST_LIGHT[0] - 0.05) * e, 0.15 + (REST_LIGHT[1] - 0.15) * e);
        program.uniforms.uTime.value = (now - start) / 1000;
        renderer.render({ scene: mesh });
        sweepFrame = k < 1 ? requestAnimationFrame(step) : 0;
      };
      sweepFrame = requestAnimationFrame(step);
    },
    destroy() {
      if (dead) return;
      dead = true;
      cancelAnimationFrame(queued);
      cancelAnimationFrame(sweepFrame);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      if (current === surface) {
        current = null;
        evicted = null;
      }
    },
  };
  surface.resize();
  current = surface;
  return surface;
}
