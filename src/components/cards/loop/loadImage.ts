/**
 * A picture, loaded for the share video (./makeLoop), in a way that can be called off and can't
 * wait for ever. Closing the sheet calls a video off (`signal`), and a picture from another site
 * (the holder's own, for the stamp) may be slow or never answer: without a limit the video stayed
 * at "Making the video" with no way out (Bugbot on #257).
 */
export class LoopCancelled extends Error {}

export interface LoadOptions {
  /**
   * A picture from another site, asked for in a way that lets a canvas keep its pixels (the site
   * must allow it, or it doesn't load). Without it: a picture from this site, or WebGL refuses it
   * as a texture.
   */
  open?: boolean;
  /** Called off: the load stops and rejects with LoopCancelled. */
  signal?: AbortSignal;
  /** Give up after this long. */
  ms?: number;
}

export function loadImage(src: string, { open = false, signal, ms }: LoadOptions = {}): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new LoopCancelled());
      return;
    }
    const img = new Image();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      img.onload = null;
      img.onerror = null;
    };
    // stop the request too: a picture nobody waits for shouldn't go on loading
    const stop = (why: Error) => {
      settle();
      img.src = "";
      reject(why);
    };
    const onAbort = () => stop(new LoopCancelled());
    signal?.addEventListener("abort", onAbort, { once: true });
    if (ms !== undefined) timer = setTimeout(() => stop(new Error(`${src.slice(0, 80)} took too long`)), ms);
    if (open) img.crossOrigin = "anonymous";
    img.onload = () => {
      settle();
      resolve(img);
    };
    img.onerror = () => {
      settle();
      reject(new Error(`could not load ${src.slice(0, 80)}`));
    };
    img.src = src;
  });
}
