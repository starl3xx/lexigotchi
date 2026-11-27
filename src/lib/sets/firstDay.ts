/**
 * Who a set's first day is open to (decisions.md, "Collab sets", item 4). A set's rule is one of:
 *  - `verified`: every verified player (the default);
 *  - `allowlist`: only a player with a wallet on the list the operator imported;
 *  - `token`: only a player with a wallet that holds at least a minimum balance of one contract
 *    on Base, read at the moment the voucher is asked for.
 *
 * This is checked AFTER the player is verified and has proved the wallet is theirs (the voucher
 * route), and it adds to those: it never replaces them. Any wallet of the player's profile counts,
 * so a player who keeps a partner's token in a linked wallet claims from the one they play with.
 *
 * It fails CLOSED. A list or a balance that can't be read is "ask again" (null), never "yes"; a
 * rule that is missing a part lets nobody in.
 *
 * The token is read on Base MAINNET whatever network the game runs on: a partner's token lives
 * there, as Coinbase's attestations do (lib/onchain/mainnet.ts). On a test build the rule is still
 * about real holders.
 */
import { erc20Abi, getAddress } from "viem";
import type { WordSet } from "./rules";

export type FirstDaySet = Pick<WordSet, "id" | "gateRule" | "gateToken" | "gateMin">;

export interface FirstDayDeps {
  /** Whether any of these wallets is on the set's allowlist. May throw. */
  onAllowlist: (setId: number, wallets: readonly string[]) => Promise<boolean>;
  /** A wallet's balance of a contract on Base (ERC-20 units, or a count of ERC-721 tokens). May throw. */
  balanceOf: (token: string, wallet: string) => Promise<bigint>;
}

async function defaults(): Promise<FirstDayDeps> {
  const [{ onAllowlist }, { getMainnetClient }] = await Promise.all([import("@/lib/db/sets"), import("@/lib/onchain/mainnet")]);
  return {
    onAllowlist,
    balanceOf: (token, wallet) =>
      getMainnetClient().readContract({ address: getAddress(token), abi: erc20Abi, functionName: "balanceOf", args: [getAddress(wallet)] }),
  };
}

/**
 * Is the first day of `set` open to a player with these wallets (lowercase)? True, false, or null
 * when it couldn't be read (the caller answers "try again", and issues nothing).
 */
export async function firstDayOpenTo(set: FirstDaySet, wallets: readonly string[], deps?: FirstDayDeps): Promise<boolean | null> {
  if (set.gateRule === "verified") return true;
  if (wallets.length === 0) return false;
  const d = deps ?? (await defaults());
  if (set.gateRule === "allowlist") {
    try {
      return await d.onAllowlist(set.id, wallets);
    } catch {
      return null;
    }
  }
  // The token rule. A rule missing its contract or its minimum lets nobody in.
  if (!set.gateToken || !set.gateMin || !/^\d+$/.test(set.gateMin)) return false;
  const min = BigInt(set.gateMin);
  if (min <= 0n) return false;
  const reads = await Promise.allSettled(wallets.map((w) => d.balanceOf(set.gateToken as string, w)));
  if (reads.some((r) => r.status === "fulfilled" && r.value >= min)) return true;
  // Nobody was seen holding enough. If a read failed, that wallet might: ask again, never "no".
  return reads.some((r) => r.status === "rejected") ? null : false;
}
