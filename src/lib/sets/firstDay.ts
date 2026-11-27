/**
 * Who a set's first day is open to (decisions.md, "Collab sets", item 4). A set's rule is one of:
 *  - `verified`: every verified player (the default);
 *  - `allowlist`: only a player with a wallet on the list the operator imported;
 *  - `token`: only a player with a wallet that holds at least a minimum balance of one contract
 *    on Base, read at the moment the voucher is asked for.
 *
 * This is checked AFTER the player is verified and has proved the wallet is theirs (the voucher
 * route), and it adds to those: it never replaces them.
 *
 * The voucher route asks about ONE wallet: the one that will send the claim. A wallet elsewhere in
 * the player's profile doesn't count for it, because a listed wallet could then be linked into one
 * verified profile after another and let each of them in. The claiming wallet is also the one the
 * voucher's row is counted under, so a wallet that moves to another profile brings its word with
 * it (lib/db/setVouchers.ts). The route does look at the profile's other wallets, only to tell the
 * player "claim with the wallet of yours that qualifies".
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

/** The real reads. Each loads only what it needs, when it is asked: a token's balance never touches the database. */
const REAL: FirstDayDeps = {
  onAllowlist: async (setId, wallets) => (await import("@/lib/db/sets")).onAllowlist(setId, wallets),
  balanceOf: async (token, wallet) =>
    (await import("@/lib/onchain/mainnet"))
      .getMainnetClient()
      .readContract({ address: getAddress(token), abi: erc20Abi, functionName: "balanceOf", args: [getAddress(wallet)] }),
};

/**
 * Can this contract's `balanceOf` be read on Base? Asked before a release is built for a token
 * rule: a mistyped address (or a contract that isn't a token) would make EVERY balance read fail,
 * so every player would be told "try again" for the whole first day, and the rule can't be
 * changed after the release. The balance asked about is a burn address's: any answer will do.
 */
export async function tokenReadable(token: string, deps: Pick<FirstDayDeps, "balanceOf"> = REAL): Promise<boolean> {
  try {
    await deps.balanceOf(token, "0x000000000000000000000000000000000000dead");
    return true;
  } catch {
    return false;
  }
}

/**
 * Is the first day of `set` open to these wallets (lowercase)? True when ANY of them is let in,
 * false, or null when it couldn't be read (the caller answers "try again", and issues nothing).
 */
export async function firstDayOpenTo(set: FirstDaySet, wallets: readonly string[], d: FirstDayDeps = REAL): Promise<boolean | null> {
  if (set.gateRule === "verified") return true;
  if (wallets.length === 0) return false;
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
