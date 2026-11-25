"use client";
/**
 * The Farcaster host, or the web, decided by whether a host answers (lib/miniAppHost says why).
 *
 * Neynar's MiniAppProvider mounts only once a host has answered, so inside Farcaster and the Base
 * app it still calls `sdk.actions.ready()` (which drops the host's splash screen), shows the back
 * button, and reports notification opens. On the web, and in a wallet browser where nobody answers,
 * it never mounts: it would render nothing while it waited.
 *
 * `useMiniApp()` here replaces `@neynar/react`'s hook, which throws outside Neynar's provider. It
 * carries only what the game reads.
 */
import sdk, { type Context } from "@farcaster/miniapp-sdk";
import { MiniAppProvider, useMiniApp as useNeynarMiniApp } from "@neynar/react";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { hostable, watchHost, type HostMode } from "@/lib/miniAppHost";

export interface MiniApp {
  /** False while the page is still deciding. */
  isSDKLoaded: boolean;
  /** The host's context; null on the web. */
  context: Context.MiniAppContext | null;
  /** Saved to the player's Farcaster apps (the host's own flag). */
  added: boolean;
}

const DECIDING: MiniApp = { isSDKLoaded: false, context: null, added: false };
const WEB: MiniApp = { isSDKLoaded: true, context: null, added: false };
const MiniAppContext = createContext<MiniApp>(DECIDING);

export function useMiniApp(): MiniApp {
  return useContext(MiniAppContext);
}

export function MiniAppHost({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<HostMode>("deciding");
  useEffect(() => watchHost({ hostable: hostable(window), context: () => sdk.context, set: setMode }), []);

  // Nothing until decided, as before, so the server's HTML and the first paint don't change. A late
  // host answer swaps "web" for "host" and remounts the game once, early, on a slow host only.
  if (mode === "deciding") return null;
  if (mode === "web") return <MiniAppContext.Provider value={WEB}>{children}</MiniAppContext.Provider>;
  return (
    <MiniAppProvider analyticsEnabled backButtonEnabled>
      <HostBridge>{children}</HostBridge>
    </MiniAppProvider>
  );
}

/** Hands Neynar's state to the game. Neynar renders this only once its SDK has loaded. */
function HostBridge({ children }: { children: ReactNode }) {
  const mini = useNeynarMiniApp();
  const value = useMemo(
    () => ({ isSDKLoaded: mini.isSDKLoaded, context: mini.context, added: mini.added }),
    [mini.isSDKLoaded, mini.context, mini.added],
  );
  return <MiniAppContext.Provider value={value}>{children}</MiniAppContext.Provider>;
}
