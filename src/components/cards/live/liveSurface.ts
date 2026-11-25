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

const MAT_INDEX: Record<CardMaterial, number> = { common: 0, uncommon: 1, rare: 2, legendary: 3, mythic: 4 };

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

// uv: 0–1 (y up); uLight: the light on the surface, 0–1 (y up); uTime: seconds (the glitter's turn).
const FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec2 uLight;
uniform float uMat;
uniform vec2 uRes;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }

void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  float px = 1.0 / uRes.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  vec2 lp = vec2(uLight.x * aspect, uLight.y);
  vec2 dl = p - lp;
  float d2 = dot(dl, dl);
  vec3 col;
  if (uMat < 0.5) {
    // walnut card stock: fibres, a soft light
    vec3 a = vec3(0.165, 0.125, 0.098);
    vec3 b = vec3(0.231, 0.176, 0.133);
    float grain = noise(p * vec2(3.0, 70.0)) * 0.5 + noise(p * vec2(9.0, 160.0)) * 0.5;
    col = mix(a, b, uv.y * 0.6 + grain * 0.4);
    col += exp(-d2 * 5.0) * 0.05;
  } else if (uMat < 1.5) {
    // satin jade: a broad, soft sheen
    col = mix(vec3(0.122, 0.361, 0.302), vec3(0.055, 0.227, 0.192), uv.y);
    col += exp(-d2 * 3.0) * vec3(0.13, 0.26, 0.22);
    col += exp(-d2 * 18.0) * 0.04;
  } else if (uMat < 2.5) {
    // sapphire foil: brushed lines; the highlight stretches along the brushing
    col = mix(vec3(0.114, 0.267, 0.522), vec3(0.043, 0.122, 0.251), uv.y);
    vec2 dir = normalize(vec2(0.85, -0.53));
    vec2 perp = vec2(-dir.y, dir.x);
    float along = dot(dl, dir);
    float across = dot(dl, perp);
    float lines = noise(vec2(dot(p, perp) * 420.0, dot(p, dir) * 3.0));
    col *= 0.94 + lines * 0.12;
    float streak = exp(-(along * along * 1.2 + across * across * 70.0));
    col += streak * vec3(0.55, 0.75, 1.0) * 0.28 * (0.7 + lines * 0.6);
  } else if (uMat < 3.5) {
    // polished gold: bands of reflection, a hot spot, glitter that catches as the light moves
    float band = 0.5 + 0.5 * sin((p.x * 1.4 + p.y * 2.2) * 3.0 + uLight.x * 4.0 - uLight.y * 2.0);
    col = mix(vec3(0.18, 0.125, 0.024), vec3(0.42, 0.29, 0.063), band);
    col += exp(-d2 * 9.0) * vec3(0.4, 0.3, 0.12);
    // glitter: one fleck in some cells of a fine grid, round and soft (not the square of its cell)
    vec2 g = uv * vec2(aspect, 1.0) / px * 0.2;
    vec2 cell = floor(g);
    float r = hash(cell);
    float round = 1.0 - smoothstep(0.12, 0.42, length(fract(g) - 0.5));
    float face = fract(r * 7.13 + uLight.x * 1.7 + uLight.y * 1.1 + uTime * 0.12);
    float spark = pow(max(0.0, 1.0 - abs(face - 0.5) * 18.0), 2.0) * step(0.9, r) * round * (0.1 + exp(-d2 * 2.2));
    col += spark * vec3(1.0, 0.94, 0.75) * 0.6;
  } else {
    // cut amethyst: facets around a table, each catching the light its own way; fire at the edges
    vec3 a = vec3(0.114, 0.051, 0.212);
    vec3 b = vec3(0.278, 0.137, 0.478);
    vec2 c = vec2(aspect * 0.5, 0.5);
    vec2 q = p - c;
    float ang = atan(q.y, q.x);
    float seg = floor((ang + 3.14159) / 6.28318 * 16.0);
    float fa = (seg + 0.5) / 16.0 * 6.28318 - 3.14159;
    vec2 lq = lp - c;
    float la = atan(lq.y, lq.x);
    float lit = 0.5 + 0.5 * cos(fa - la);
    float table = step(abs(q.x) / aspect * 1.9 + abs(q.y) * 1.9, 0.5);
    col = mix(b, a, lit * 0.42);
    col = mix(col, mix(a, b, 0.4) + exp(-d2 * 6.0) * 0.1, table);
    float e = fract((ang + 3.14159) / 6.28318 * 16.0);
    float edge = (1.0 - smoothstep(0.0, 0.05, e)) + smoothstep(0.95, 1.0, e);
    float tEdge = abs(abs(q.x) / aspect * 1.9 + abs(q.y) * 1.9 - 0.5);
    edge = max(edge * (1.0 - table), 1.0 - smoothstep(0.0, 0.012, tEdge));
    col += edge * 0.08;
    float flash = pow(max(0.0, cos(fa - la)), 24.0) * (0.2 + exp(-d2 * 1.6));
    col += edge * flash * hue(fract(seg / 16.0 + uLight.x * 0.6 + uTime * 0.03)) * 0.3;
    col += exp(-d2 * 12.0) * 0.11;
  }
  // card stock: a fine linen weave and a little grain, so the back reads as a printed card
  vec2 pc = vec2(uv.x * aspect, uv.y) / px;
  float linen = (sin(pc.x * 2.2) + sin(pc.y * 2.2)) * 0.5;
  col *= 1.0 + linen * 0.03;
  col += (hash(floor(pc)) - 0.5) * 0.05;
  // a quiet edge, so the frame reads
  vec2 v = uv - 0.5;
  col *= 1.0 - dot(v, v) * 0.7;
  gl_FragColor = vec4(col, 1.0);
}
`;

export interface LiveSurface {
  /** Move the light (0–1 from the top left) and draw one frame. */
  light(x: number, y: number): void;
  /** Fit the drawing buffer to the canvas's size and draw. */
  resize(): void;
  /** Sweep the light across the back once (about a second), then stop. */
  sweep(): void;
  /** Let the context go. */
  destroy(): void;
}

let current: LiveSurface | null = null;
/** What to tell the current back if a newer one takes the context. */
let evicted: (() => void) | null = null;

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
        setLight(0.05 + 0.4 * e, 0.15 + 0.2 * e);
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
