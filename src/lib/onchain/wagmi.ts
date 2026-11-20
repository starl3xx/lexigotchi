"use client";
/**
 * wagmi v2 + viem config — the app's connection to the chain.
 *
 * The active chain comes from `./network` (NEXT_PUBLIC_CHAIN_ID), so the connectors, the public
 * client, and the deployment registry can never disagree about which network we're on.
 *
 * ── Who connects how ──────────────────────────────────────────────────────────────────────────
 * Lexigotchi is a standalone onchain game: the WALLET is the player's account. Farcaster and a
 * Coinbase verification are optional links on top (they unlock the free daily), never the way in.
 *
 *   - Farcaster mini app — index 0, OUTSIDE the RainbowKit list. It auto-connects inside a
 *     Farcaster/Base client and must never appear in the web modal (connecting it outside a host
 *     fails). RainbowKit hides it on its own: the modal lists only connectors it built itself plus
 *     EIP-6963 announcements (which carry a data: icon — this one's icon is an https URL).
 *     useOnchain.connect assumes it sits at index 0.
 *   - Everything else comes from RainbowKit's `connectorsForWallets`, rendered by its modal.
 *     Installed extensions (MetaMask, Rabby, Phantom, Coinbase Wallet…) also announce themselves
 *     over EIP-6963 and show up under "Installed" with no entry here.
 *
 * ── WalletConnect is opt-in by env ────────────────────────────────────────────────────────────
 * Phone wallets on a desktop browser (and MetaMask/Rainbow without their extension) connect over
 * WalletConnect, which needs a Reown project id. Without NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID the
 * WalletConnect-backed wallets are left OUT of the list rather than shipped with a placeholder id —
 * a placeholder renders a QR code that no wallet can ever scan, which is worse than no button.
 *
 * ── One Base connector ────────────────────────────────────────────────────────────────────────
 * Base Account (wagmi's `baseAccount`, via RainbowKit's wrapper) replaces the old hand-added
 * `coinbaseWallet` connector. It is one choice among many — no player needs a Base account — but it
 * is the only listed wallet that makes a passkey wallet in the browser with nothing installed, and
 * the only one that honours our ERC-7677 paymaster capability, so it stays in the popular group.
 * Its @coinbase/cdp-sdk → @x402/* imports are aliased to false in next.config.
 *
 * WRITES DO NOT GO THROUGH WAGMI'S `useWriteContract`. Every write must carry the ERC-8021 builder
 * code, which means routing through `sendCallsAttributed` (./sendCalls) with the connector's raw
 * EIP-1193 provider. wagmi is here for connection state, chain switching, and READS (viem clients,
 * multicall). See docs/web3-runtime-plan.md and CLAUDE.md's builder-code rule.
 */
import { createConfig, http, type Config } from "wagmi";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";
import { connectorsForWallets, type WalletList } from "@rainbow-me/rainbowkit";
import {
  baseAccount,
  injectedWallet,
  metaMaskWallet,
  phantomWallet,
  rabbyWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { NETWORK } from "./network";
import { ACTIVE_CHAIN, base, baseSepolia } from "./chain";

export { ACTIVE_CHAIN };

/** Optional override; falls back to the chain's public RPC. A dedicated endpoint is strongly
 *  preferred — the public round-robin endpoints disagree about nonces under load. */
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || undefined;

/** Reown (WalletConnect) project id. Unset = no WalletConnect wallets (see the header). */
const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

export const APP_NAME = "Lexigotchi";

/**
 * The modal's wallet list. MetaMask and Rainbow fall back to WalletConnect when their extension is
 * missing, so they only appear when a project id exists; Rabby, Phantom, Base Account and the
 * generic injected wallet never touch WalletConnect and are always offered.
 */
export function walletList(projectId: string = WALLETCONNECT_PROJECT_ID): WalletList {
  if (projectId) {
    return [
      { groupName: "Popular", wallets: [metaMaskWallet, rainbowWallet, baseAccount, walletConnectWallet] },
      { groupName: "More", wallets: [rabbyWallet, phantomWallet, injectedWallet] },
    ];
  }
  return [
    { groupName: "Popular", wallets: [baseAccount, rabbyWallet] },
    { groupName: "More", wallets: [phantomWallet, injectedWallet] },
  ];
}

let cached: Config | undefined;

/** The wagmi config, created lazily so it's only built in the browser. */
export function getWagmiConfig(): Config {
  if (cached) return cached;
  const webWallets = connectorsForWallets(walletList(), {
    appName: APP_NAME,
    // Only read by the WalletConnect-backed wallets, which walletList() omits when this is empty.
    projectId: WALLETCONNECT_PROJECT_ID,
  });
  cached = createConfig({
    chains: [ACTIVE_CHAIN],
    connectors: [farcasterMiniApp(), ...webWallets],
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
