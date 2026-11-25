/**
 * Whether this browser can draw a live back at all (WebGL 1 is enough), asked once and remembered.
 * Kept apart from ./liveSurface so asking doesn't load the drawing code (OGL loads only when a back
 * first goes live).
 */
let videoOk: Promise<boolean> | null = null;
/** The video's frame and the H.264 profiles it tries (../loop/makeLoop uses the same). */
export const VIDEO = { width: 1280, height: 720, fps: 30, bitrate: 4_000_000, codecs: ["avc1.42001f", "avc1.4d0028", "avc1.640028"] } as const;

/**
 * Whether this browser can make the share loop: WebGL, WebCodecs, and an H.264 encoder that takes
 * the video's frame. Asked once; it loads nothing (the loop's code loads only when asked to make
 * one), so offering the button costs no download.
 */
export function canMakeLoop(): Promise<boolean> {
  videoOk ??= (async () => {
    if (typeof window === "undefined" || typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined" || !canDrawLive()) return false;
    for (const codec of VIDEO.codecs) {
      try {
        const r = await VideoEncoder.isConfigSupported({ codec, width: VIDEO.width, height: VIDEO.height, bitrate: VIDEO.bitrate, framerate: VIDEO.fps });
        if (r.supported) return true;
      } catch {
        // try the next
      }
    }
    return false;
  })();
  return videoOk;
}

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
