/**
 * Which store backs the game, in one place, so the game (`GameApp`) and the landing page agree.
 *
 * Chain-backed exactly when the suite has addresses on this network. Mainnet's registry
 * (config/deployments.json) is all-null until the deploy, so production stays on the practice game
 * until the day the mainnet addresses are committed, and then becomes the real game in the same
 * deploy, with no second switch to forget. (Mainnet used to be held on the mock regardless, until
 * the paid pack and the wallet-only roll/ascension reveals existed; they do now: PR #94.)
 * NEXT_PUBLIC_CHAIN_GAME=0 forces the mock back on, as an emergency brake or for comparison.
 */
import { isSuiteDeployed } from "./addresses";
import { NETWORK } from "./network";

export function isChainBacked(): boolean {
  if (process.env.NEXT_PUBLIC_CHAIN_GAME === "0") return false;
  return isSuiteDeployed();
}

/**
 * True only when play spends real $WORD: chain-backed AND on mainnet. False until the mainnet
 * addresses are committed; it turns true on its own in that deploy, so the landing page's
 * practice-balance note can never outlive the mock.
 */
export function isRealEconomy(): boolean {
  return isChainBacked() && !NETWORK.isTestnet;
}
