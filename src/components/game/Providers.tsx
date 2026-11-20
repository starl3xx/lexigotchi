"use client";
/**
 * Client providers for the game, on the open web AND inside a Farcaster client.
 *
 * `MiniAppProvider` (Neynar) wraps the Farcaster Mini App SDK — it calls `sdk.actions.ready()`,
 * exposes the user/context, haptics, and "added" state via `useMiniApp()`. On the open web it
 * resolves to "not in a mini app" and stays out of the way.
 *
 * `RainbowKitProvider` owns the connect modal for web players (the wallet is the account; see
 * lib/onchain/wagmi). Inside a Farcaster client nothing ever opens it — the mini-app connector
 * auto-connects and no connect button renders — so the provider is inert there.
 *
 * NeynarContextProvider is GONE: it existed solely for Sign In With Neynar, which retired
 * 2026-08-14. Web identity now comes from Sign In With Farcaster (lib/auth/siwfWeb), which needs no
 * provider — just a session in sessionStorage.
 */
import "@neynar/react/dist/style.css";
import "@rainbow-me/rainbowkit/styles.css";
import { MiniAppProvider } from "@neynar/react";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { getWagmiConfig, APP_NAME } from "@/lib/onchain/wagmi";
import { walletTheme } from "./walletTheme";

export function Providers({ children }: { children: ReactNode }) {
  // One QueryClient per mount, held in state so React strict-mode double-invocation and any
  // remount can't swap the cache out from under in-flight chain reads.
  const [queryClient] = useState(() => new QueryClient());
  const [wagmiConfig] = useState(getWagmiConfig);

  return (
    <MiniAppProvider analyticsEnabled backButtonEnabled>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider
            theme={walletTheme}
            appInfo={{ appName: APP_NAME }}
            modalSize="compact"
          >
            {children}
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </MiniAppProvider>
  );
}
