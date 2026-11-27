/**
 * Buying from the Shop (decisions.md #22): the calls, the permit, and which way to pay. Pure, so it's
 * tested; the provider sends through `sendCallsAttributed` (the builder code rides every write).
 *
 * Three ways, best first:
 * - "batch": the wallet speaks ERC-5792, so approve (exactly the price) + buy go out as one send.
 * - "permit": no ERC-5792. The player signs a USDC EIP-2612 permit for exactly the price (a free
 *   signature), and one transaction runs `buyWithPermit`.
 * - "approve-then-buy": the wallet can't sign the permit either. Approve, wait for it to land, then buy.
 * A standing allowance that covers the price skips all of that: a plain `buy`.
 */
import { encodeFunctionData, hexToSignature, type Hex } from "viem";
import { erc20Abi, shopAbi } from "@/lib/onchain/abis";
import type { Call } from "@/lib/onchain/sendCalls";

/**
 * What the status pill says while a purchase is in flight (the action gate's label). Named here
 * because the Shop's Buy buttons ask the gate whether THIS is the action in flight (game/useShop,
 * useShopBuy): the provider and the buttons must mean the same words.
 */
export const SHOP_BUY_LABEL = "Buying";

export type BuyRoute = "allowance" | "batch" | "permit" | "approve-then-buy";

/**
 * How this purchase pays. `batch` says the wallet answered `wallet_getCapabilities` (ERC-5792).
 * The buyer's minimum $WORD out is always 0: the Shop raises it to its own floor, and the $WORD goes
 * to the pool, not to the buyer, so the buyer has nothing to protect.
 */
export function buyRoute(a: { allowance: bigint; price: bigint; batch: boolean }): Exclude<BuyRoute, "approve-then-buy"> {
  if (a.allowance >= a.price) return "allowance";
  return a.batch ? "batch" : "permit";
}

/** Approve exactly the price: never a standing allowance the Shop doesn't need. */
export function approveCall(usdc: `0x${string}`, shop: `0x${string}`, price: bigint): Call {
  return { to: usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [shop, price] }) };
}

export function buyCall(shop: `0x${string}`, itemId: number, recipient: `0x${string}`): Call {
  return { to: shop, data: encodeFunctionData({ abi: shopAbi, functionName: "buy", args: [BigInt(itemId), recipient, 0n] }) };
}

export function buyWithPermitCall(
  shop: `0x${string}`,
  itemId: number,
  recipient: `0x${string}`,
  deadline: bigint,
  sig: Hex,
): Call {
  const { v, r, s, yParity } = hexToSignature(sig);
  // A 64-byte (EIP-2098) signature carries only yParity: v is 27 + yParity.
  const vv = Number(v ?? BigInt(27 + (yParity ?? 0)));
  return {
    to: shop,
    data: encodeFunctionData({
      abi: shopAbi,
      functionName: "buyWithPermit",
      args: [BigInt(itemId), recipient, 0n, deadline, vv, r, s],
    }),
  };
}

/**
 * The permit as wallets sign it (`eth_signTypedData_v4`), WITH `EIP712Domain` in `types`: eth-sig-util
 * wallets read a missing domain type as an empty domain and sign another digest (every MetaMask word
 * listing failed bad_signature until #187). The domain's name and version are read from the token
 * (Circle's USDC and MockUSDC both say "USD Coin" and "2").
 */
export function permitTypedDataJson(a: {
  usdc: `0x${string}`;
  name: string;
  version: string;
  chainId: number;
  owner: `0x${string}`;
  spender: `0x${string}`;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
}): string {
  return JSON.stringify({
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    domain: { name: a.name, version: a.version, chainId: a.chainId, verifyingContract: a.usdc },
    message: {
      owner: a.owner,
      spender: a.spender,
      value: a.value.toString(),
      nonce: a.nonce.toString(),
      deadline: a.deadline.toString(),
    },
  });
}

/** A wallet's "I can't do that" for a signing or capability request (not the player saying no). */
export function isUnsupported(err: unknown): boolean {
  const code = (err as { code?: number })?.code;
  if (code === 4001) return false;
  if (code === 4200 || code === 4100 || code === -32601) return true;
  return /unsupported|not support|method not found|not implemented/i.test(String((err as { message?: string })?.message ?? ""));
}
