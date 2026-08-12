"use client";
/**
 * wagmi v2 + viem config — the app's connection to the chain.
 *
 * The active chain comes from `./network` (NEXT_PUBLIC_CHAIN_ID), so the connectors, the public
 * client, and the deployment registry can never disagree about which network we're on.
 *
 * Connectors, in the order they're offered:
 *   - Farcaster mini app — the in-client wallet, auto-connects when we're running inside a
 *     Farcaster/Base client. This is the primary path; `/play` is a mini app first.
 *   - injected — browser extension wallets on the web.
 *
 * `coinbaseWallet` is deliberately absent: wagmi's connector pulls in `@coinbase/cdp-sdk`, which
 * currently fails to resolve `@x402/evm/upto/client` and breaks the production build. Re-add it once
 * that upstream dependency resolves — it's the nice-to-have web fallback, not the primary path.
 *
 * WRITES DO NOT GO THROUGH WAGMI'S `useWriteContract`. Every write must carry the ERC-8021 builder
 * code, which means routing through `sendCallsAttributed` (./sendCalls) with the connector's raw
 * EIP-1193 provider. wagmi is here for connection state, chain switching, and READS (viem clients,
 * multicall). See docs/web3-runtime-plan.md and CLAUDE.md's builder-code rule.
 */
import { createConfig, http, type Config } from "wagmi";
import { injected } from "wagmi/connectors";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";
import { NETWORK } from "./network";
import { ACTIVE_CHAIN, base, baseSepolia } from "./chain";

export { ACTIVE_CHAIN };

/** Optional override; falls back to the chain's public RPC. A dedicated endpoint is strongly
 *  preferred — the public round-robin endpoints disagree about nonces under load. */
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || undefined;

let cached: Config | undefined;

/** The wagmi config, created lazily so it's only built in the browser. */
export function getWagmiConfig(): Config {
  if (cached) return cached;
  cached = createConfig({
    chains: [ACTIVE_CHAIN],
    connectors: [
      farcasterMiniApp(),
      injected({ shimDisconnect: true }),
    ],
    // Both ids are declared to satisfy wagmi's Record<chainId, Transport> (ACTIVE_CHAIN widens to
    // the union); only the configured chain's is ever used. The RPC override applies solely to the
    // active network, so a mainnet URL can't end up serving testnet reads.
    transports: {
      [base.id]: http(NETWORK.id === base.id ? RPC_URL : undefined),
      [baseSepolia.id]: http(NETWORK.id === baseSepolia.id ? RPC_URL : undefined),
    },
    ssr: true,
  });
  return cached;
}
