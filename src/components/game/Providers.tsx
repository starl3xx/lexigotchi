"use client";
/**
 * Client providers for the playable mini app. `MiniAppProvider` (Neynar) wraps the Farcaster
 * Mini App SDK — it calls `sdk.actions.ready()`, exposes the user/context, haptics, and "added"
 * state via `useMiniApp()`. `NeynarContextProvider` powers Sign In With Neynar for players who
 * open Lexigotchi on the web (outside a Farcaster client). Everything Farcaster-specific lives
 * under here so the rest of the marketing site never loads the SDK.
 */
import "@neynar/react/dist/style.css";
import { MiniAppProvider, NeynarContextProvider, Theme } from "@neynar/react";
import type { ReactNode } from "react";

const NEYNAR_CLIENT_ID = process.env.NEXT_PUBLIC_NEYNAR_CLIENT_ID ?? "";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NeynarContextProvider settings={{ clientId: NEYNAR_CLIENT_ID, defaultTheme: Theme.Light }}>
      <MiniAppProvider analyticsEnabled backButtonEnabled>
        {children}
      </MiniAppProvider>
    </NeynarContextProvider>
  );
}
