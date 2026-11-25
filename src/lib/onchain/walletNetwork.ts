/**
 * The network the connected wallet should switch to, when it isn't on one the screen can use
 * (WalletNetworkNotice). Works for any build: on the testnet build the game wants Base Sepolia, and
 * at launch it wants Base, so a wallet on Ethereum, Arbitrum, or anywhere else is told to switch.
 * The $WORD page's swap always wants Base.
 *
 * Reads come from our RPC, so a wallet on the wrong network looks fine until something is sent,
 * and every send asks the wallet to switch first (sendCalls' `ensureChain`). Some wallets refuse:
 * Rainbow's browser connected on Base and answered the switch to Base Sepolia with its own
 * "Unsupported Chain" alert, and the game said nothing (starl3xx, 2026-11-25). RainbowKit's account
 * modal, which held the only Disconnect, also goes away on a network RainbowKit doesn't know.
 */
import { BASE, NETWORK, networkById, type NetworkDef } from "./network";

/**
 * Screens whose sends go to Base mainnet whatever the build: the $WORD page, home of the $WORD swap
 * (SwapCard). Not the Market (the "swap" view): its words and letters trade on the game's network.
 */
export const MAINNET_VIEWS: ReadonlySet<string> = new Set(["word"]);

/**
 * Null when the wallet is fine where it is. On the $WORD page either Base or the game's network is
 * fine (a testnet player reading it isn't nagged); anything else switches to Base.
 */
export function networkToSwitchTo(o: {
  chainBacked: boolean;
  address: string | undefined;
  walletChainId: number | undefined;
  view: string;
  game?: NetworkDef;
}): NetworkDef | null {
  const game = o.game ?? NETWORK;
  if (!o.chainBacked || !o.address || o.walletChainId === undefined) return null;
  if (MAINNET_VIEWS.has(o.view)) return o.walletChainId === BASE.id || o.walletChainId === game.id ? null : BASE;
  return o.walletChainId === game.id ? null : game;
}

/** A switch that `ensureChain` confirmed: this wallet left `from` for `to`. */
export interface ConfirmedMove {
  address: string;
  from: number;
  to: number;
}

/**
 * A confirmed move counts only while wagmi still reports the same wallet on the network it left.
 * Once wagmi reports another network or another wallet (or none), it has caught up and is right
 * from then on, even if it later reports `from` again: a switch back, or a new wallet there, must
 * show the notice (Bugbot on #202). The caller forgets a move this returns null for.
 */
export function keepMove(moved: ConfirmedMove | null, reported: number | undefined, address: string | undefined): ConfirmedMove | null {
  if (!moved || !address || reported !== moved.from) return null;
  return address.toLowerCase() === moved.address.toLowerCase() ? moved : null;
}

/**
 * The wallet's network as far as the game knows. wagmi learns of a switch from the wallet's
 * chainChanged event, and some wallets never send one; wagmi also can't be told of Base on a testnet
 * build (it's configured with the game's network only). So while wagmi still reports the network a
 * confirmed switch left, the switch's target wins (Bugbot on #202). Pass a move through `keepMove`.
 */
export function knownWalletChain(reported: number | undefined, moved: ConfirmedMove | null): number | undefined {
  return moved && reported === moved.from ? moved.to : reported;
}

const OTHER_NAMES: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  56: "BNB Chain",
  137: "Polygon",
  324: "zkSync",
  42161: "Arbitrum",
  43114: "Avalanche",
  59144: "Linea",
  81457: "Blast",
  534352: "Scroll",
  7777777: "Zora",
  11155111: "Sepolia",
};

/** A network's name for a player, or "another network". */
export function walletNetworkName(id: number): string {
  return networkById(id)?.name ?? OTHER_NAMES[id] ?? "another network";
}

/** Why a switch didn't happen: the player said no, or the wallet couldn't or wouldn't. */
export type SwitchRefusal = "declined" | "unavailable";

export function switchRefusal(err: unknown): SwitchRefusal {
  let e = err as { code?: number; cause?: unknown; data?: { originalError?: { code?: number } } } | undefined;
  for (let depth = 0; e && depth < 8; depth++) {
    if (e.code === 4001 || e.data?.originalError?.code === 4001) return "declined";
    e = e.cause as typeof e;
  }
  return "unavailable";
}
