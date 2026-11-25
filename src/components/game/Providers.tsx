"use client";
/**
 * Client providers for the game, on the open web AND inside a Farcaster client.
 *
 * `MiniAppHost` decides whether a Farcaster host is there by whether one answers, and only then
 * mounts Neynar's `MiniAppProvider` (which calls `sdk.actions.ready()`). The game reads the host's
 * context and "added" state through `useMiniApp()` from ./MiniAppHost. On the web, and in a React
 * Native wallet browser such as Rainbow's, no host answers and the game plays as the web.
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
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { getWagmiConfig, APP_NAME } from "@/lib/onchain/wagmi";
import { walletTheme } from "./walletTheme";
import { MiniAppHost } from "./MiniAppHost";

export function Providers({ children }: { children: ReactNode }) {
  // One QueryClient per mount, held in state so React strict-mode double-invocation and any
  // remount can't swap the cache out from under in-flight chain reads.
  const [queryClient] = useState(() => new QueryClient());
  const [wagmiConfig] = useState(getWagmiConfig);

  return (
    <MiniAppHost>
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
    </MiniAppHost>
  );
}
