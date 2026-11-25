/**
 * Is this page inside a Farcaster host? Decided by the host's ANSWER, never by the web view.
 *
 * The Farcaster SDK talks to its host through `window.ReactNativeWebView` when that exists (the
 * Farcaster and Base apps are React Native), else through `window.parent`. But wallet browsers built
 * on React Native have `window.ReactNativeWebView` too (Rainbow's and MetaMask Mobile's, by their
 * source: react-native-webview adds it to every page). There the SDK posts
 * its questions to a wallet that never answers, `sdk.context` never settles, and Neynar's
 * MiniAppProvider, which renders nothing until it does, left /play blank (starl3xx, in Rainbow on
 * 2026-11-25). Upgrading the SDK doesn't help: 0.4.0 picks its endpoint the same way.
 *
 * So a top window with no React Native web view is the web at once: no host can reach it. Anywhere
 * else the page waits up to HOST_WAIT_MS for the host's context, then plays as the web. A host that
 * answers later still wins, because a real host taken for the web never gets `ready()` and keeps
 * its splash screen up for good.
 */
export type HostMode = "deciding" | "host" | "web";

/** How long a page that could be in a host waits for one: the SDK's own `isInMiniApp()` default. */
export const HOST_WAIT_MS = 1000;

/** Whether this window could be inside a host at all: an iframe, or a React Native web view. */
export function hostable(win: Window & { ReactNativeWebView?: unknown }): boolean {
  return Boolean(win.ReactNativeWebView) || win !== win.parent;
}

export interface WatchHostOptions {
  /** `hostable(window)`. */
  hostable: boolean;
  /** The host's context (the SDK's `sdk.context`), which never settles where nobody answers. */
  context: () => PromiseLike<unknown>;
  /** Called with "web", "host", or "web" and later "host". */
  set: (mode: Exclude<HostMode, "deciding">) => void;
  waitMs?: number;
}

let answered = false;

/**
 * True once a host has answered on this page. The Farcaster wallet connector reads it
 * (lib/onchain/wagmi): wagmi mounts inside MiniAppHost, after the decision, so it is already set
 * wherever a host answered in time, and a late answer remounts wagmi with it set.
 */
export const hostAnswered = (): boolean => answered;

/** Any context object is a host's answer (useViewer still needs its fid to say "farcaster"). */
const isAnswer = (ctx: unknown) => typeof ctx === "object" && ctx !== null;

/** Decide the mode and report it through `set`. Returns a function that stops listening. */
export function watchHost({ hostable, context, set, waitMs = HOST_WAIT_MS }: WatchHostOptions): () => void {
  if (!hostable) {
    set("web");
    return () => {};
  }
  let live = true;
  let host = false;
  const timer = setTimeout(() => {
    if (live && !host) set("web");
  }, waitMs);
  Promise.resolve()
    .then(context)
    .then((ctx) => {
      if (!isAnswer(ctx)) return;
      answered = true; // for the whole page, even after this watch stopped
      if (!live) return;
      host = true;
      clearTimeout(timer);
      set("host");
    })
    .catch(() => {
      /* no host: the timer says web */
    });
  return () => {
    live = false;
    clearTimeout(timer);
  };
}
