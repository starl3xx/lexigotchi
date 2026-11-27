/**
 * Make the share loop as an MP4, in the player's browser: the turning card (./loopRenderer), with
 * its letters alive on its front (./liveFront, ./score; decisions.md #48, part 7), six
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
import type { Tier } from "@/lib/economy";
import type { SceneId } from "@/lib/scenes";
import type { LiveFront } from "./liveFront";
import { releaseLive } from "../live/liveSurface";
import { LOOP_SECONDS, attachLoop } from "./loopRenderer";
import { svgDataUri } from "@/lib/cardArt/engrave";
import { STAMP_FACE, STAMP_TURN, inkRgb, numberedFrom, oneInk, stampBox, stampRingSvg } from "../stamp";
import { LoopCancelled, loadImage } from "./loadImage";
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

/** How long the holder's picture may take before the video is made without the stamp. */
const STAMP_WAIT_MS = 4000;

/**
 * The back's picture, and what it says of itself: whether the card's number is on it (../stamp,
 * NUMBERED_HEADER). Fetched, not set as an image's address, because only a fetch can read the
 * header; the picture is then made from the bytes that came with it.
 *
 * **The caller lets the bytes go (`release`) only when the video is made.** The picture's address
 * stands for those bytes. WebKit may drop a picture's pixels and read them again from its address
 * when it is drawn: with the address already let go, the back would be drawn blank, with no error,
 * and the video would still be made (Bugbot on #257). If the picture can't be made, they go at once.
 */
export async function loadBack(src: string, signal?: AbortSignal): Promise<{ img: HTMLImageElement; numbered: boolean | null; release: () => void }> {
  const res = await fetch(src, { signal });
  if (!res.ok) throw new Error(`could not load ${src}`);
  const numbered = numberedFrom(res.headers);
  const url = URL.createObjectURL(await res.blob());
  try {
    const img = await loadImage(url, { signal });
    return { img, numbered, release: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
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

/** The holder's stamp for the video's back: their picture and the back's ink. Where it sits is the back's picture's to say (loadBack). */
export interface LoopStamp {
  src: string;
  ink: string;
}

/**
 * The back's picture with the holder's stamp drawn on it (../stamp: one ink, an engraved ring,
 * turned a little), as the game's back shows it. `face` is the holder's picture, already loaded
 * (or null: it didn't come). It is from another site (Farcaster's or X's), asked for openly: if
 * that site doesn't allow its pixels to be read, it doesn't load, or reading it here throws, and
 * the back is used as it is. `numbered` is what the back's picture said of itself. Nothing here
 * can stop a video from being made, or hold it up: the only wait is the ring, which is the page's own.
 */
async function stampedBack(back: HTMLImageElement, stamp: LoopStamp, face: HTMLImageElement | null, numbered: boolean): Promise<TexImageSource> {
  if (!face) return back;
  try {
    const ring = await loadImage(svgDataUri(stampRingSvg(stamp.ink)), { ms: STAMP_WAIT_MS });
    const W = back.naturalWidth || 1200;
    const H = back.naturalHeight || 675;
    const box = stampBox(numbered);
    const size = box.size * W;
    const d = Math.round(size * STAMP_FACE);
    // the picture, cut square from its middle, in one ink
    const one = document.createElement("canvas");
    one.width = d;
    one.height = d;
    const og = one.getContext("2d")!;
    const side = Math.min(face.naturalWidth, face.naturalHeight);
    og.drawImage(face, (face.naturalWidth - side) / 2, (face.naturalHeight - side) / 2, side, side, 0, 0, d, d);
    const px = og.getImageData(0, 0, d, d); // throws if the site didn't allow it
    oneInk(px.data, inkRgb(stamp.ink));
    og.putImageData(px, 0, 0);

    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const g = out.getContext("2d")!;
    g.drawImage(back, 0, 0, W, H);
    g.translate(box.cx * W, box.cy * W);
    g.rotate((STAMP_TURN * Math.PI) / 180);
    // a soft shadow under the stamp, as on the game's back
    g.save();
    g.shadowColor = "rgba(0, 0, 0, 0.4)";
    g.shadowBlur = 3;
    g.shadowOffsetY = 2;
    g.fillStyle = stamp.ink;
    g.beginPath();
    g.arc(0, 0, d / 2, 0, Math.PI * 2);
    g.fill();
    g.restore();
    g.save();
    g.beginPath();
    g.arc(0, 0, d / 2, 0, Math.PI * 2);
    g.clip();
    g.drawImage(one, -d / 2, -d / 2);
    g.restore();
    g.drawImage(ring, -size / 2, -size / 2, size, size);
    return out;
  } catch {
    return back;
  }
}

/** A file from this site, as a data: address (the letters' font goes inside each of their pictures). */
async function dataUrlOf(src: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(src, { signal });
  if (!res.ok) throw new Error(`could not load ${src}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(`could not read ${src}`));
    r.readAsDataURL(blob);
  });
}

/** What the living front needs: the card without its letters, and the word to stand on it. */
export interface LoopLive {
  /** The same-origin path of the card's front without its letters (lib/showcase, showcaseStagePath). */
  stage: string;
  word: string;
  upper: readonly boolean[];
  tier?: Tier;
  gild: number;
  scene: SceneId;
}

export { LoopCancelled };

/**
 * The video for one word: `front` and `back` are the same-origin paths of its share card and its
 * back picture. `live` makes the front's letters live; if they can't be drawn (a piece doesn't
 * load, a browser can't read one back), the still `front` is used, as before: a video is always
 * made. `onProgress` gets 0–1 as the frames go.
 */
export async function makeLoop({
  front,
  back,
  material,
  stamp,
  live,
  signal,
  onProgress,
}: {
  front: string;
  back: string;
  material: CardMaterial;
  /** The front's living letters. Without it the front is the still picture. */
  live?: LoopLive;
  /** The holder's stamp for the back, where they show one. */
  stamp?: LoopStamp;
  signal?: AbortSignal;
  onProgress?: (done: number) => void;
}): Promise<Blob> {
  const codec = await pickCodec();
  if (!codec) throw new Error("no H.264 encoder");
  // The holder's picture is asked for beside the card's two faces, with a limit of its own: it is
  // from another site, and a slow or silent one must not hold the video up. Late or refused: no stamp.
  const stampFace = stamp ? loadImage(stamp.src, { open: true, signal, ms: STAMP_WAIT_MS }).catch(() => null) : Promise.resolve(null);
  // The front: living letters on the card's stage, or (where that can't be drawn) the still picture.
  const frontFace = async (): Promise<{ img: TexImageSource; living: LiveFront | null }> => {
    if (live) {
      try {
        const [stage, fontDataUrl, { makeLiveFront }] = await Promise.all([loadImage(live.stage, { signal }), dataUrlOf("/fonts/soehne-fett.woff2", signal), import("./liveFront")]);
        const living = await makeLiveFront({ word: live.word, upper: live.upper, tier: live.tier, gild: live.gild, scene: live.scene, stage, fontDataUrl });
        return { img: living.canvas, living };
      } catch {
        // a piece didn't load, or this browser couldn't read one back: the still front, as before.
        // (A video that was called off ends just below: the still's own load stops at once.)
      }
    }
    return { img: await loadImage(front, { signal }), living: null };
  };
  const backLoad = loadBack(back, signal);
  const [frontLoaded, backLoaded] = await Promise.all([frontFace(), backLoad, document.fonts.load('800 30px "Soehne"').catch(() => [])]).catch((err) => {
    // the front failed, or the video was called off: a back that did load is let go
    backLoad.then((b) => b.release()).catch(() => {});
    throw signal?.aborted ? new LoopCancelled() : err;
  });
  // the back's bytes are kept until the last frame is drawn (loadBack says why)
  try {
    return await film({ codec, frontImg: frontLoaded.img, living: frontLoaded.living, backImg: backLoaded.img, numbered: backLoaded.numbered, material, stamp, stampFace, signal, onProgress });
  } finally {
    backLoaded.release();
  }
}

/** The frames, drawn and encoded: makeLoop, once both faces are in hand. */
async function film({
  codec,
  frontImg,
  living,
  backImg,
  numbered,
  material,
  stamp,
  stampFace,
  signal,
  onProgress,
}: {
  codec: string;
  /** The front: the still picture, or the living front's own canvas, drawn again for each frame. */
  frontImg: TexImageSource;
  living: LiveFront | null;
  backImg: HTMLImageElement;
  numbered: boolean | null;
  material: CardMaterial;
  stamp?: LoopStamp;
  stampFace: Promise<HTMLImageElement | null>;
  signal?: AbortSignal;
  onProgress?: (done: number) => void;
}): Promise<Blob> {
  if (signal?.aborted) throw new LoopCancelled();

  // the one WebGL context is the video's while it's made
  releaseLive();
  const glCanvas = document.createElement("canvas");
  // the stamp sits where the back's picture says its number is; a picture that doesn't say gets none
  const backFace = stamp && numbered !== null ? await stampedBack(backImg, stamp, await stampFace, numbered) : backImg;
  if (signal?.aborted) throw new LoopCancelled();
  const loop = attachLoop(glCanvas, { front: frontImg, back: backFace, material, width: VIDEO_WIDTH, height: VIDEO_HEIGHT });
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
      if (living) {
        // the letters as they are at this moment, then the card with them on it
        living.draw(i / VIDEO_FPS);
        loop.setFront(living.canvas);
      }
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
