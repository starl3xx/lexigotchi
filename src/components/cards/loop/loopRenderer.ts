/**
 * The share loop's turning card (decisions.md #27), on OGL: the word's card face on
 * its front, and its back (the `/s/<word>/back` picture: the back's engraved plate with the word's
 * story on it, one picture), turning over and home again in six seconds. `render(t)`
 * draws the frame at time t, the same frame every time, so the video is the same however fast the
 * device: ./makeLoop steps it and encodes each frame.
 *
 * From the "Scene Cards" mock (approved 2026-11-25: "front, rotates, shows back, on a like 5-8s
 * loop"): the scene, a turn with a lift and the light crossing it as it passes edge-on, the back
 * catching the light, and the turn home. The light is a VEIL, never a glare (VEIL, below).
 */
import { Camera, Mesh, Plane, Program, Renderer, Texture, Transform } from "ogl";
import { CARD_CORNER } from "@/lib/cardArt/looks";

export const LOOP_SECONDS = 6;
/** One turn of a sine per loop, in radians a second. */
const ONCE = (2 * Math.PI) / LOOP_SECONDS;
/** The card's shape (1200×675, the game's 16:9 card): the card that turns. Its front is the card's
 *  face alone (`/s/<word>/card?face=1`), its back the back's picture, both this size. */
const CARD_ASPECT = 1200 / 675;
/** The card's corner (lib/cardArt/looks, CARD_CORNER of its width), in the shader's unit, which is the card's height. */
export const LOOP_CORNER = (CARD_CORNER * CARD_ASPECT).toFixed(4);
/** The game's paper, behind the card. */
const PAPER: [number, number, number] = [0.957, 0.918, 0.824];

const VERT = /* glsl */ `
attribute vec3 position;
attribute vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/**
 * How strong the light is as it crosses the turning card, of 1 (decisions.md #58, part 1). A card is
 * matte (starl3xx, 2026-11-27: "the cards have *reflections* but they shouldn't be super *shiny* --
 * the cards are matte finish in videos and all outputs and UI locations"; and of frames made with
 * this veil: "14A is good"). It was a glare: white ADDED at 0.55, the strongest light anywhere, and
 * at 0.9 s it hid the word. A veil lifts the inks a little and can never go past the paper, the way
 * a matte card takes light. Kept as a number so a test holds it faint.
 */
export const VEIL = 0.1;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tFront;
uniform sampler2D tBack;
uniform float uAspect;
uniform float uGlare;
uniform float uGlareX;
varying vec2 vUv;
float rounded(vec2 uv, float r) {
  vec2 q = abs(vec2((uv.x - 0.5) * uAspect, uv.y - 0.5)) - vec2(0.5 * uAspect - r, 0.5 - r);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  float sd = rounded(vUv, ${LOOP_CORNER});
  if (sd > 0.0) discard;
  vec3 col;
  if (gl_FrontFacing) {
    col = texture2D(tFront, vUv).rgb;
  } else {
    // the back: one picture, the engraved plate with the story of the word on it. Paper and ink: no
    // material is drawn here, and nothing on it catches a light of its own (decisions.md #58, part 2).
    col = texture2D(tBack, vec2(1.0 - vUv.x, vUv.y)).rgb;
  }
  // the light catching the card as it turns: a veil over a matte card (VEIL), never white added to it
  float g = exp(-pow((vUv.x - uGlareX) * 3.2 + (vUv.y - 0.5) * 1.2, 2.0) * 6.0) * uGlare;
  col = 1.0 - (1.0 - col) * (1.0 - g * ${VEIL.toFixed(2)});
  // its ink edge (sd runs negative inside; the last sliver before the edge is ink)
  col = mix(col, vec3(0.106, 0.09, 0.078), smoothstep(-0.014, -0.006, sd));
  gl_FragColor = vec4(col, 1.0);
}
`;

/** How many ruled lines cross the shadow's plane (about five of them fall where the shadow shows). */
export const SHADOW_ROWS = 12;
/**
 * How dark the shadow's ink is at its darkest (of 1), and how much of its row the heaviest line
 * fills. The owner, 2026-11-27, of the shadow at 0.5 and 0.7: "the shadow on the card video is way
 * too dark". It was a dark band under the card; at these it is a few faint ruled lines, a third as
 * dark and two thirds as heavy. Kept as numbers so a test holds them light.
 */
export const SHADOW_INK = 0.16;
export const SHADOW_WEIGHT = 0.45;
/**
 * The shadow under the card, engraved (decisions.md #48, part 9): ruled lines in the shape of the
 * shadow, each as heavy as the shadow is dark there, the way an engraving makes tone, and the way
 * the shadow under every letter is drawn (tileShapes, SHADOW_LINES). It was a soft blot. The
 * shadow is around the card, so it is drawn like the cards.
 *
 * `tone` is the old blot, kept as the measure: it still spreads as the card lifts (uSpread). Each
 * row holds one line, and the line fills as much of its row as the tone says, so the lines thin
 * to nothing toward the shadow's ends. No derivative is asked of the device (a plain soft edge),
 * so every device draws the same lines.
 *
 * The shadow is narrower than the blot was (1.45 across, where the blot had 1): a ruled line shows
 * to its very end, and the blot's faint ends ran under the game's name in the corner.
 */
const SHADOW_FRAG = /* glsl */ `
precision highp float;
uniform float uSpread;
varying vec2 vUv;
void main() {
  vec2 q = (vUv - 0.5) * vec2(1.45, 2.6);
  float tone = exp(-dot(q, q) * 9.0 / uSpread);
  float f = abs(fract(vUv.y * ${SHADOW_ROWS}.0) - 0.5) * 2.0;
  float w = tone * ${SHADOW_WEIGHT};
  float line = 1.0 - smoothstep(w - 0.14, w + 0.14, f);
  gl_FragColor = vec4(0.106, 0.09, 0.078, line * ${SHADOW_INK} * smoothstep(0.03, 0.14, tone));
}
`;

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Where the card is at time t of the loop: its turn (degrees), lift, tilt, and the light crossing it (`glare`: how much of the veil, and where). */
export function loopPose(t: number) {
  const s = ((t % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS;
  const turn1 = ease(clamp01((s - 1.8) / 0.9));
  const turn2 = ease(clamp01((s - 4.7) / 0.9));
  const turn = 180 * turn1 + 180 * turn2;
  const lift = Math.sin(Math.PI * clamp01((s - 1.8) / 0.9)) + Math.sin(Math.PI * clamp01((s - 4.7) / 0.9));
  // Every motion repeats exactly once a loop (ONCE: one turn of a sine per six seconds), so the
  // video loops without a jump at its seam (Bugbot on #214: the tilt used to snap ~5°).
  const tiltY = Math.sin(s * ONCE) * 5;
  const tiltX = Math.sin(s * ONCE + 1) * 3;
  // the light crossing the front early on, and crossing as each turn passes edge-on
  const g1 = Math.max(0, 1 - Math.abs(s - 0.9) / 0.6);
  const g2 = Math.sin(Math.PI * clamp01((s - 1.8) / 0.9));
  const g3 = Math.max(0, 1 - Math.abs(s - 3.6) / 0.7);
  const g4 = Math.sin(Math.PI * clamp01((s - 4.7) / 0.9));
  const glare = Math.max(g1, g2, g3, g4);
  const glareX =
    s < 1.8 ? (s - 0.3) / 1.2 : s < 2.7 ? 1.1 - clamp01((s - 1.8) / 0.9) * 1.2 : s < 4.7 ? (s - 2.9) / 1.4 : 1.1 - clamp01((s - 4.7) / 0.9) * 1.2;
  return { s, turn, lift, tiltX, tiltY, glare, glareX };
}

export interface LoopRenderer {
  /** Draw the frame at time t (seconds). */
  render(t: number): void;
  /** A new picture for the front: the video's living letters are drawn again for each frame (./liveFront). */
  setFront(image: TexImageSource): void;
  /** Let the context go. */
  destroy(): void;
}

/** A turning card on `canvas`, `width`×`height` pixels, its two faces from `front` and `back`. */
export function attachLoop(
  canvas: HTMLCanvasElement,
  { front, back, width, height }: { front: TexImageSource; back: TexImageSource; width: number; height: number },
): LoopRenderer {
  // The frame is read the moment it's drawn (./makeLoop): keep it until then.
  const renderer = new Renderer({ canvas, width, height, dpr: 1, alpha: false, antialias: true, preserveDrawingBuffer: true });
  const gl = renderer.gl;
  gl.clearColor(PAPER[0], PAPER[1], PAPER[2], 1);
  const camera = new Camera(gl, { fov: 30, aspect: width / height });
  camera.position.set(0, 0, 2.65);
  const scene = new Transform();
  const tFront = new Texture(gl, { image: front as HTMLImageElement, generateMipmaps: false });
  const tBack = new Texture(gl, { image: back as HTMLImageElement, generateMipmaps: false });
  const program = new Program(gl, {
    vertex: VERT,
    fragment: FRAG,
    cullFace: false,
    uniforms: {
      tFront: { value: tFront },
      tBack: { value: tBack },
      uAspect: { value: CARD_ASPECT },
      uGlare: { value: 0 },
      uGlareX: { value: 0 },
    },
  });
  const card = new Mesh(gl, { geometry: new Plane(gl, { width: CARD_ASPECT, height: 1 }), program });
  card.setParent(scene);
  const shadowProgram = new Program(gl, {
    vertex: VERT,
    fragment: SHADOW_FRAG,
    transparent: true,
    depthWrite: false,
    cullFace: false,
    uniforms: { uSpread: { value: 1 } },
  });
  const shadow = new Mesh(gl, { geometry: new Plane(gl, { width: CARD_ASPECT * 1.25, height: 0.5 }), program: shadowProgram });
  shadow.position.set(0, -0.68, -0.2);
  shadow.rotation.x = -Math.PI / 2.4;
  shadow.setParent(scene);

  return {
    render(t) {
      const p = loopPose(t);
      card.rotation.y = (p.turn + p.tiltY) * (Math.PI / 180);
      card.rotation.x = p.tiltX * (Math.PI / 180);
      card.position.z = p.lift * 0.22;
      card.position.y = p.lift * 0.03;
      shadowProgram.uniforms.uSpread.value = 1 + p.lift * 0.5;
      program.uniforms.uGlare.value = p.glare;
      program.uniforms.uGlareX.value = p.glareX;
      renderer.render({ scene, camera });
    },
    setFront(image) {
      tFront.image = image as HTMLImageElement;
      tFront.needsUpdate = true;
    },
    destroy() {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
