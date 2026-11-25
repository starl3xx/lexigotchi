/**
 * Selling words on the in-game board (decisions.md #18): a Seaport order that offers one Word for a
 * $WORD price, with 10% of it paid to `SaleFees`, which routes it into the Rewards Pool.
 *
 * The shape is fixed, and the board's server (`/api/swap/words`) refuses anything else, because the
 * fee only exists if the signed order carries it:
 *   offer:         one ERC-721 Word (amount 1), approved to Seaport for this token only
 *   consideration: [ price - fee → the seller, fee → SaleFees ], both $WORD, fixed amounts
 *   zone and conduit zero, full-open, ending within ORDER_TTL_SECONDS
 *
 * A per-token approval (Words.approve(SEAPORT, tokenId)) instead of approving all words: ERC-721
 * clears it on any transfer or burn, so staking, moving, or dissolving the word stops its listings,
 * and a phished signature can reach this one word only. The buyer approves the exact price, never
 * an unlimited allowance.
 *
 * Pure, except the call builders' registry lookups; tested in tests/word-sale.test.ts.
 */
import { encodeFunctionData, erc20Abi } from "viem";
import { addressOf, wordTokenAddress } from "./addresses";
import { wordsAbi } from "./abis";
import { SEAPORT, cancelOrderCalls, fulfillOrderCalls, type LetterSwapOrder } from "./seaport";
import type { Call } from "./sendCalls";
import { DEFAULT_PARAMS } from "@/lib/params";

/** A Seaport order (the same OrderComponents the letter board signs). */
export type SeaportOrder = LetterSwapOrder;

const ZERO32 = `0x${"0".repeat(64)}` as const;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as const;
const ERC20 = 1; // ItemType.ERC20
const ERC721 = 2; // ItemType.ERC721
const FULL_OPEN = 0;

/** The fee, in basis points of the price the buyer pays: params `market.wordSaleFee` (10%). */
export const WORD_SALE_FEE_BPS = BigInt(Math.round(DEFAULT_PARAMS.market.wordSaleFee * 10_000));
/** A listing lasts this long, then lapses on its own (a seller relists to keep it up). */
export const WORD_SALE_TTL_SECONDS = 30 * 24 * 3600;
/** The lowest price, in whole $WORD: below it the fee would round to almost nothing. */
export const MIN_WORD_PRICE = 1_000;
const WEI = 10n ** 18n;

/** The fee and the seller's share of `priceWei`. The fee rounds UP, so it's never below 10%. */
export function splitPrice(priceWei: bigint): { feeWei: bigint; sellerWei: bigint } {
  const feeWei = (priceWei * WORD_SALE_FEE_BPS + 9_999n) / 10_000n;
  return { feeWei, sellerWei: priceWei - feeWei };
}

export function buildWordSaleOrder(args: {
  maker: `0x${string}`;
  tokenId: bigint;
  priceWei: bigint;
  counter: bigint;
  nowSeconds: number;
  salt: bigint;
}): SeaportOrder {
  const word = wordTokenAddress();
  const { feeWei, sellerWei } = splitPrice(args.priceWei);
  return {
    offerer: args.maker,
    zone: ZERO_ADDR,
    offer: [{ itemType: ERC721, token: addressOf("words"), identifierOrCriteria: String(args.tokenId), startAmount: "1", endAmount: "1" }],
    consideration: [
      { itemType: ERC20, token: word, identifierOrCriteria: "0", startAmount: String(sellerWei), endAmount: String(sellerWei), recipient: args.maker },
      { itemType: ERC20, token: word, identifierOrCriteria: "0", startAmount: String(feeWei), endAmount: String(feeWei), recipient: addressOf("saleFees") },
    ],
    orderType: FULL_OPEN,
    startTime: String(args.nowSeconds),
    endTime: String(args.nowSeconds + WORD_SALE_TTL_SECONDS),
    zoneHash: ZERO32,
    salt: String(args.salt),
    conduitKey: ZERO32,
    counter: String(args.counter),
  };
}

export type WordSaleCheck =
  | { ok: true; tokenId: bigint; priceWei: bigint; feeWei: bigint }
  | { ok: false; error: string };

const isUint = (s: unknown) => typeof s === "string" && /^\d{1,78}$/.test(s);
const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

/**
 * Is `o` exactly a word-sale order the board accepts? The kind comes from the content, never from a
 * flag the client sends. Checks the shape, the fee (at least WORD_SALE_FEE_BPS of the total, to
 * SaleFees), the minimum price, and the time window; the signature, ownership, approval, and counter
 * are the route's, onchain.
 */
export function checkWordSaleOrder(
  o: SeaportOrder | null | undefined,
  ctx: { words: string; word: string; saleFees: string; nowSeconds: number },
): WordSaleCheck {
  if (!o || typeof o.offerer !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(o.offerer)) return { ok: false, error: "bad_offerer" };
  const offer = o.offer;
  const pay = o.consideration;
  if (!Array.isArray(offer) || offer.length !== 1) return { ok: false, error: "bad_offer" };
  const item = offer[0];
  if (item.itemType !== ERC721 || !same(item.token, ctx.words) || !isUint(item.identifierOrCriteria) || item.startAmount !== "1" || item.endAmount !== "1") {
    return { ok: false, error: "bad_offer" };
  }
  if (!Array.isArray(pay) || pay.length !== 2) return { ok: false, error: "bad_payment" };
  for (const p of pay) {
    if (p.itemType !== ERC20 || !same(p.token, ctx.word) || p.identifierOrCriteria !== "0" || !isUint(p.startAmount) || p.startAmount !== p.endAmount) {
      return { ok: false, error: "bad_payment" };
    }
  }
  if (!same(pay[0].recipient, o.offerer)) return { ok: false, error: "bad_payment" };
  if (!same(pay[1].recipient, ctx.saleFees)) return { ok: false, error: "bad_fee" };
  const sellerWei = BigInt(pay[0].startAmount);
  const feeWei = BigInt(pay[1].startAmount);
  const priceWei = sellerWei + feeWei;
  if (feeWei * 10_000n < priceWei * WORD_SALE_FEE_BPS) return { ok: false, error: "bad_fee" };
  if (priceWei < BigInt(MIN_WORD_PRICE) * WEI) return { ok: false, error: "price_too_low" };
  if (o.zone !== ZERO_ADDR || o.zoneHash !== ZERO32 || o.conduitKey !== ZERO32 || o.orderType !== FULL_OPEN) {
    return { ok: false, error: "bad_order" };
  }
  if (!isUint(o.startTime) || !isUint(o.endTime) || !isUint(o.salt) || !isUint(o.counter)) return { ok: false, error: "bad_order" };
  const start = Number(o.startTime);
  const end = Number(o.endTime);
  if (start > ctx.nowSeconds + 300 || end <= ctx.nowSeconds || end > ctx.nowSeconds + WORD_SALE_TTL_SECONDS + 3_600) {
    return { ok: false, error: "bad_window" };
  }
  return { ok: true, tokenId: BigInt(item.identifierOrCriteria), priceWei, feeWei };
}

/** The price the buyer pays: what the order's two payments add up to. */
export function orderPriceWei(o: SeaportOrder): bigint {
  return o.consideration.reduce((sum, p) => sum + BigInt(p.startAmount), 0n);
}

/**
 * To list: cancel the seller's earlier, still-live orders for this word (so a relist or a word that
 * came back can't fill at an old price), and approve this word to Seaport if it isn't. Either can
 * be empty; then listing is a signature only.
 */
export function prepareListingCalls(tokenId: bigint, stale: readonly SeaportOrder[], approved: boolean): Call[] {
  return [
    ...(stale.length > 0 ? stale.flatMap((o) => cancelOrderCalls(o)) : []),
    ...(approved
      ? []
      : [{ to: addressOf("words"), data: encodeFunctionData({ abi: wordsAbi, functionName: "approve", args: [SEAPORT, tokenId] }) }]),
  ];
}

/** To buy: approve Seaport for exactly the price (when the allowance is short), then fill. */
export function buyWordCalls(order: SeaportOrder, signature: `0x${string}`, seaportAllowance: bigint): Call[] {
  const price = orderPriceWei(order);
  return [
    ...(seaportAllowance >= price
      ? []
      : [{ to: wordTokenAddress(), data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [SEAPORT, price] }) }]),
    ...fulfillOrderCalls(order, signature),
  ];
}
