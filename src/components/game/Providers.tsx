"use client";
/**
 * Client providers for the playable mini app. `MiniAppProvider` (Neynar) wraps the Farcaster
 * Mini App SDK — it calls `sdk.actions.ready()`, exposes the user/context, haptics, and "added"
 * state via `useMiniApp()`. `NeynarContextProvider` powers Sign In With Neynar for players who
 * open Lexigotchi on the web (outside a Farcaster client). Everything Farcaster-specific lives
 * under here so the rest of the app never loads the SDK.
 */
import "@neynar/react/dist/style.css";
import { MiniAppProvider, NeynarContextProvider, Theme } from "@neynar/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { getWagmiConfig } from "@/lib/onchain/wagmi";

const NEYNAR_CLIENT_ID = process.env.NEXT_PUBLIC_NEYNAR_CLIENT_ID ?? "";

export function Providers({ children }: { children: ReactNode }) {
  // One QueryClient per mount, held in state so React strict-mode double-invocation and any
  // remount can't swap the cache out from under in-flight chain reads.
  const [queryClient] = useState(() => new QueryClient());
  const [wagmiConfig] = useState(getWagmiConfig);

  return (
    <NeynarContextProvider settings={{ clientId: NEYNAR_CLIENT_ID, defaultTheme: Theme.Light }}>
      <MiniAppProvider analyticsEnabled backButtonEnabled>
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </WagmiProvider>
      </MiniAppProvider>
    </NeynarContextProvider>
  );
}
