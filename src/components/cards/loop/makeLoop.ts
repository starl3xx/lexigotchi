/**
 * Make the share loop as an MP4, in the player's browser: the turning card (./loopRenderer), six
 * seconds at 30 frames a second, 1280×720 (X's video shape), with the game's name in a corner (a
 * saved picture or video travels without its link; decisions.md #23). Encoded by the browser's own
 * H.264 encoder (WebCodecs) and packed into MP4 by mp4-muxer. MediaRecorder needs no package, but it
 * records in real time and drops frames on a slow device; this draws each frame and waits for the
 * encoder, so every device makes the same six seconds.
 *
 * Loaded only when the player asks for a video (OGL and the muxer stay out of the first download).
 * One WebGL context: the live back, if one is up, lets go first, and this context is lost when the
 * video is made, fails, or is called off (`signal`).
 */
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import type { CardMaterial } from "../material";
import { releaseLive } from "../live/liveSurface";
import { LOOP_SECONDS, attachLoop } from "./loopRenderer";
import { VIDEO } from "../live/support";

// The frame, rate, and H.264 profiles (the plainest first: every browser that encodes H.264 takes
// Baseline) are ../live/support's, which asks whether the browser can make the video at all.
const VIDEO_WIDTH = VIDEO.width;
const VIDEO_HEIGHT = VIDEO.height;
const VIDEO_FPS = VIDEO.fps;
const BITRATE = VIDEO.bitrate;
const FRAMES = LOOP_SECONDS * VIDEO_FPS;

async function pickCodec(): Promise<string | null> {
  for (const codec of VIDEO.codecs) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width: VIDEO_WIDTH, height: VIDEO_HEIGHT, bitrate: BITRATE, framerate: VIDEO_FPS });
      if (r.supported) return codec;
    } catch {
      // try the next
    }
  }
  return null;
}

/** An image from this site (same origin, or WebGL refuses it as a texture). */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

/**
 * The game's name, quiet, in the bottom right corner. The video's corners are the game's paper,
 * not a scene (the saved card's corner is), so it's ink on paper, not cream with a halo.
 */
function drawMark(g: CanvasRenderingContext2D) {
  g.save();
  g.font = '800 24px "Soehne", system-ui, sans-serif';
  g.textAlign = "right";
  g.textBaseline = "alphabetic";
  g.fillStyle = "rgba(27, 23, 20, 0.6)";
  g.fillText("LEXIGOTCHI", VIDEO_WIDTH - 32, VIDEO_HEIGHT - 26);
  g.restore();
}

export class LoopCancelled extends Error {}

/**
 * The video for one word: `front` and `back` are the same-origin paths of its share card and its
 * back picture. `onProgress` gets 0–1 as the frames go.
 */
export async function makeLoop({
  front,
  back,
  material,
  signal,
  onProgress,
}: {
  front: string;
  back: string;
  material: CardMaterial;
  signal?: AbortSignal;
  onProgress?: (done: number) => void;
}): Promise<Blob> {
  const codec = await pickCodec();
  if (!codec) throw new Error("no H.264 encoder");
  const [frontImg, backImg] = await Promise.all([loadImage(front), loadImage(back), document.fonts.load('800 30px "Soehne"').catch(() => [])]);
  if (signal?.aborted) throw new LoopCancelled();

  // the one WebGL context is the video's while it's made
  releaseLive();
  const glCanvas = document.createElement("canvas");
  const loop = attachLoop(glCanvas, { front: frontImg, back: backImg, material, width: VIDEO_WIDTH, height: VIDEO_HEIGHT });
  // each frame: the turning card, then the name over it, on a plain canvas the encoder reads
  const out = document.createElement("canvas");
  out.width = VIDEO_WIDTH;
  out.height = VIDEO_HEIGHT;
  const g = out.getContext("2d")!;

  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: "avc", width: VIDEO_WIDTH, height: VIDEO_HEIGHT, frameRate: VIDEO_FPS }, fastStart: "in-memory" });
  let failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      failure = e;
    },
  });
  try {
    encoder.configure({ codec, width: VIDEO_WIDTH, height: VIDEO_HEIGHT, bitrate: BITRATE, framerate: VIDEO_FPS });
    for (let i = 0; i < FRAMES; i++) {
      if (signal?.aborted) throw new LoopCancelled();
      if (failure) throw failure;
      loop.render(i / VIDEO_FPS);
      g.drawImage(glCanvas, 0, 0);
      drawMark(g);
      const frame = new VideoFrame(out, { timestamp: Math.round((i * 1e6) / VIDEO_FPS), duration: Math.round(1e6 / VIDEO_FPS) });
      encoder.encode(frame, { keyFrame: i % (VIDEO_FPS * 2) === 0 });
      frame.close();
      // the encoder sets the pace: never more than a few frames ahead of it; and the page breathes
      while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      onProgress?.((i + 1) / FRAMES);
    }
    await encoder.flush();
    if (failure) throw failure;
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: "video/mp4" });
  } finally {
    if (encoder.state !== "closed") encoder.close();
    loop.destroy();
  }
}
