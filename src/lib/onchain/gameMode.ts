/**
 * Which store backs the game, in one place, so the game (`GameApp`) and the landing page agree.
 *
 * Chain-backed only when the suite actually has addresses on this network AND we're on a testnet —
 * mainnet stays on the mock until the remaining signer routes exist, because a half-wired real
 * economy is worse than an honest simulation. NEXT_PUBLIC_CHAIN_GAME=0 forces the mock back on for
 * side-by-side comparison.
 */
import { isSuiteDeployed } from "./addresses";
import { NETWORK } from "./network";

export function isChainBacked(): boolean {
  if (process.env.NEXT_PUBLIC_CHAIN_GAME === "0") return false;
  return isSuiteDeployed() && NETWORK.isTestnet;
}

/**
 * True only when play spends real $WORD: chain-backed AND on mainnet. False today by construction
 * (mainnet is held on the mock above); it turns true on its own the day `isChainBacked` stops
 * requiring a testnet, so the landing page's practice-balance note can never outlive the mock.
 */
export function isRealEconomy(): boolean {
  return isChainBacked() && !NETWORK.isTestnet;
}
