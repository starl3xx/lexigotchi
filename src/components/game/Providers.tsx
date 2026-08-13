"use client";
/**
 * Client providers for the playable mini app. `MiniAppProvider` (Neynar) wraps the Farcaster
 * Mini App SDK — it calls `sdk.actions.ready()`, exposes the user/context, haptics, and "added"
 * state via `useMiniApp()`.
 *
 * NeynarContextProvider is GONE: it existed solely for Sign In With Neynar, which retires
 * 2026-08-14. Web identity now comes from Sign In With Farcaster (lib/auth/siwfWeb), which needs no
 * provider — just a session in sessionStorage. MiniAppProvider stays; useMiniApp is still the source
 * of truth inside a Farcaster host.
 */
import "@neynar/react/dist/style.css";
import { MiniAppProvider } from "@neynar/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { getWagmiConfig } from "@/lib/onchain/wagmi";


export function Providers({ children }: { children: ReactNode }) {
  // One QueryClient per mount, held in state so React strict-mode double-invocation and any
  // remount can't swap the cache out from under in-flight chain reads.
  const [queryClient] = useState(() => new QueryClient());
  const [wagmiConfig] = useState(getWagmiConfig);

  return (
    <MiniAppProvider analyticsEnabled backButtonEnabled>
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </WagmiProvider>
    </MiniAppProvider>
  );
}
