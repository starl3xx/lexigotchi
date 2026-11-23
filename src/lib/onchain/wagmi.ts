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
 * ── One Coinbase Wallet connector ─────────────────────────────────────────────────────────────
 * Base Account (wagmi's `baseAccount`, via RainbowKit's wrapper) replaces the old hand-added
 * `coinbaseWallet` connector. Coinbase renamed Base Account to Coinbase Wallet (2026-11), so the
 * modal lists it under that name (`coinbaseWalletAccount` below); the connector and SDK are the
 * same. It is one choice among many — no player needs one. It is
 * listed because it needs no extension (it runs in a popup) and because Base documents support for
 * both capabilities sendCallsAttributed asks for (ERC-8021 `dataSuffix`, ERC-7677 paymaster).
 * Whether the other wallets honour those optional capabilities is UNVERIFIED — see the PR that
 * added this file's modal. Its @coinbase/cdp-sdk → @x402/* imports are aliased to false in
 * next.config.
 *
 * WRITES DO NOT GO THROUGH WAGMI'S `useWriteContract`. Every write must carry the ERC-8021 builder
 * code, which means routing through `sendCallsAttributed` (./sendCalls) with the connector's raw
 * EIP-1193 provider. wagmi is here for connection state, chain switching, and READS (viem clients,
 * multicall). See docs/web3-runtime-plan.md and CLAUDE.md's builder-code rule.
 */
import { createConfig, http, type Config } from "wagmi";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";
import { connectorsForWallets, type Wallet, type WalletList } from "@rainbow-me/rainbowkit";
import {
  baseAccount,
  coinbaseWallet,
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
 * RainbowKit's generic "Browser Wallet", shown only when the browser actually HAS one. RainbowKit
 * always lists it, so a phone browser with no wallet offered a button that could only fail. The
 * rule runs once, in the browser, when the config is built — extensions inject `window.ethereum`
 * before page scripts run, and in-app wallet browsers (MetaMask, Coinbase Wallet) have it from the
 * start. On the server it is always hidden, which is harmless: no modal renders there.
 */
const browserWallet = (): Wallet => ({
  ...injectedWallet(),
  hidden: () => typeof window === "undefined" || !(window as { ethereum?: unknown }).ethereum,
});

/**
 * Base Account under its new name. Coinbase renamed it Coinbase Wallet, and its popup says so, but
 * RainbowKit 2.2 still labels the row "Base". Only the label and icon change: the connector (id
 * `baseAccount`, which SignInWithCoinbaseWallet looks up), the SDK, and the popup are Base
 * Account's. The icon is RainbowKit's own Coinbase Wallet icon (the classic mark; a row needs one).
 */
export const coinbaseWalletAccount = (params: Parameters<typeof baseAccount>[0]): Wallet => {
  const cb = coinbaseWallet(params);
  return { ...baseAccount(params), name: "Coinbase Wallet", iconUrl: cb.iconUrl, iconBackground: cb.iconBackground };
};

/**
 * The modal's wallet list. MetaMask and Rainbow fall back to WalletConnect when their extension is
 * missing, so they only appear when a project id exists; Rabby, Phantom, Coinbase Wallet and the
 * generic browser wallet never touch WalletConnect and are always offered (RainbowKit itself hides
 * the desktop-extension wallets on phones). Without a project id a phone browser with no wallet
 * gets Coinbase Wallet and nothing else, so production needs the id.
 */
export function walletList(projectId: string = WALLETCONNECT_PROJECT_ID): WalletList {
  if (projectId) {
    return [
      { groupName: "Popular", wallets: [metaMaskWallet, rainbowWallet, coinbaseWalletAccount, walletConnectWallet] },
      { groupName: "More", wallets: [rabbyWallet, phantomWallet, browserWallet] },
    ];
  }
  return [
    { groupName: "Popular", wallets: [coinbaseWalletAccount, rabbyWallet] },
    { groupName: "More", wallets: [phantomWallet, browserWallet] },
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
