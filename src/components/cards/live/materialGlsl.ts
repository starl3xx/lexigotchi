/**
 * A card back's material as a GLSL function: satin, brushed foil, gold with glitter, or cut amethyst
 * with fire, lit by a light at `L`. One source for both places it is drawn, so they can't drift: the
 * live back (./liveSurface) and the share loop's turning card (../loop). The deep treatment of the
 * "Scene Cards" mock; its colors match the CSS stand-in (globals.css `.cb.m-*`).
 *
 *   vec3 material(vec2 uv, vec2 L, float t, float mat, float aspect, float px)
 *     uv, L: 0–1, y up · t: seconds (the glitter and the fire turn with it) · mat: 0 common …
 *     4 mythic (MAT_INDEX) · aspect: width ÷ height · px: one pixel, in uv's height
 */
import type { CardMaterial } from "../material";

export const MAT_INDEX: Record<CardMaterial, number> = { common: 0, uncommon: 1, rare: 2, legendary: 3, mythic: 4 };

export const MATERIAL_GLSL = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }

vec3 material(vec2 uv, vec2 L, float t, float mat, float aspect, float px) {
  vec2 p = vec2(uv.x * aspect, uv.y);
  vec2 lp = vec2(L.x * aspect, L.y);
  vec2 dl = p - lp;
  float d2 = dot(dl, dl);
  vec3 col;
  if (mat < 0.5) {
    // walnut card stock: fibres, a soft light
    vec3 a = vec3(0.165, 0.125, 0.098);
    vec3 b = vec3(0.231, 0.176, 0.133);
    float grain = noise(p * vec2(3.0, 70.0)) * 0.5 + noise(p * vec2(9.0, 160.0)) * 0.5;
    col = mix(a, b, uv.y * 0.6 + grain * 0.4);
    col += exp(-d2 * 5.0) * 0.05;
  } else if (mat < 1.5) {
    // satin jade: a broad, soft sheen
    col = mix(vec3(0.122, 0.361, 0.302), vec3(0.055, 0.227, 0.192), uv.y);
    col += exp(-d2 * 3.0) * vec3(0.13, 0.26, 0.22);
    col += exp(-d2 * 18.0) * 0.04;
  } else if (mat < 2.5) {
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
  } else if (mat < 3.5) {
    // polished gold: bands of reflection, a hot spot, glitter that catches as the light moves
    float band = 0.5 + 0.5 * sin((p.x * 1.4 + p.y * 2.2) * 3.0 + L.x * 4.0 - L.y * 2.0);
    col = mix(vec3(0.18, 0.125, 0.024), vec3(0.42, 0.29, 0.063), band);
    col += exp(-d2 * 9.0) * vec3(0.4, 0.3, 0.12);
    // glitter: one fleck in some cells of a fine grid, round and soft (not the square of its cell)
    vec2 g = uv * vec2(aspect, 1.0) / px * 0.2;
    vec2 cell = floor(g);
    float r = hash(cell);
    float round = 1.0 - smoothstep(0.12, 0.42, length(fract(g) - 0.5));
    float face = fract(r * 7.13 + L.x * 1.7 + L.y * 1.1 + t * 0.12);
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
    col += edge * flash * hue(fract(seg / 16.0 + L.x * 0.6 + t * 0.03)) * 0.3;
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
  return col;
}
`;
