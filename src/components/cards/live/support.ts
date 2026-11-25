/**
 * Whether this browser can draw a live back at all (WebGL 1 is enough), asked once and remembered.
 * Kept apart from ./liveSurface so asking doesn't load the drawing code (OGL loads only when a back
 * first goes live).
 */
let supported: boolean | null = null;

export function canDrawLive(): boolean {
  if (supported !== null) return supported;
  if (typeof document === "undefined") return false;
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    supported = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    supported = false;
  }
  return supported;
}
