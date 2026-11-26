/**
 * Selling letters on the Market (decisions.md #30): a Seaport order that offers several of ONE letter
 * for a $WORD price each, with 10% of each letter's price paid to `SaleFees`, which routes it into
 * the Rewards Pool. A buyer takes any number of them.
 *
 * The shape is fixed, and the board's server (`/api/market/letters`) refuses anything else:
 *   offer:         `qty` of one ERC-1155 letter id (0-51)
 *   consideration: [ (unit - fee) x qty -> the seller, fee x qty -> SaleFees ], both $WORD
 *   PARTIAL_OPEN, zone and conduit zero, ending within LETTER_SALE_TTL_SECONDS
 *
 * **Every amount is a per-letter amount times `qty`.** Seaport fills part of an order as a fraction
 * (k of qty) of every item, and reverts when a share isn't a whole amount. Splitting the fee on the
 * TOTAL would not do: 3 letters at 1,005 wei each is a fee of 302 on the total, which doesn't divide
 * by 3. So the fee is split per letter (rounded up), then multiplied.
 *
 * Letters are approved to Seaport for the whole collection (ERC-1155 has no per-id approval), and
 * that approval never clears. An order the seller can't honor now (the letters were spelled or moved)
 * would fill again, at its old price, the next time they held that letter. So there is one live order
 * per seller per letter, and listing again cancels the earlier ones onchain in the same send.
 *
 * Pure, except the call builders' registry lookups; tested in tests/letter-sale.test.ts, and against
 * Seaport itself on a fork in scripts/market-fork-check.ts.
 */
import { encodeFunctionData, erc20Abi } from "viem";
import { addressOf, wordTokenAddress } from "./addresses";
import { erc1155ApprovalAbi } from "./abis";
import { SEAPORT, cancelOrderCalls, fulfillPartCalls, type SeaportOrder } from "./seaport";
import type { Call } from "./sendCalls";
import { DEFAULT_PARAMS } from "@/lib/params";

const ZERO32 = `0x${"0".repeat(64)}` as const;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as const;
const ERC20 = 1; // ItemType.ERC20
const ERC1155 = 3; // ItemType.ERC1155
const PARTIAL_OPEN = 1; // OrderType.PARTIAL_OPEN: anyone may fill, in parts
const WEI = 10n ** 18n;

/** The fee, in basis points of each letter's price: params `market.letterSaleFee` (10%). */
export const LETTER_SALE_FEE_BPS = BigInt(Math.round(DEFAULT_PARAMS.market.letterSaleFee * 10_000));
/** A listing lasts this long, then lapses on its own. */
export const LETTER_SALE_TTL_SECONDS = 30 * 24 * 3600;
/** The lowest price for one letter, in whole $WORD: below it the fee rounds to almost nothing. */
export const MIN_LETTER_PRICE = 100;
/** The most letters in one listing. Far above any bag; it keeps every amount well inside uint120. */
export const MAX_LETTER_QTY = 10_000;
/** Letter ids: 0-25 lowercase a-z, 26-51 UPPERCASE A-Z. */
export const LETTER_IDS = 52;

/** The fee and the seller's share of ONE letter's price. The fee rounds up, so it's never under 10%. */
export function splitUnitPrice(unitWei: bigint): { feeWei: bigint; sellerWei: bigint } {
  const feeWei = (unitWei * LETTER_SALE_FEE_BPS + 9_999n) / 10_000n;
  return { feeWei, sellerWei: unitWei - feeWei };
}

export function buildLetterSaleOrder(args: {
  maker: `0x${string}`;
  letterId: number;
  qty: number;
  /** What a buyer pays for one letter, $WORD wei. */
  unitPriceWei: bigint;
  counter: bigint;
  nowSeconds: number;
  salt: bigint;
}): SeaportOrder {
  const word = wordTokenAddress();
  const qty = BigInt(args.qty);
  const { feeWei, sellerWei } = splitUnitPrice(args.unitPriceWei);
  const pay = (wei: bigint, recipient: `0x${string}`) => ({
    itemType: ERC20, token: word, identifierOrCriteria: "0", startAmount: String(wei * qty), endAmount: String(wei * qty), recipient,
  });
  return {
    offerer: args.maker,
    zone: ZERO_ADDR,
    offer: [{ itemType: ERC1155, token: addressOf("letters"), identifierOrCriteria: String(args.letterId), startAmount: String(qty), endAmount: String(qty) }],
    consideration: [pay(sellerWei, args.maker), pay(feeWei, addressOf("saleFees"))],
    orderType: PARTIAL_OPEN,
    startTime: String(args.nowSeconds),
    endTime: String(args.nowSeconds + LETTER_SALE_TTL_SECONDS),
    zoneHash: ZERO32,
    salt: String(args.salt),
    conduitKey: ZERO32,
    counter: String(args.counter),
  };
}

export type LetterSaleCheck =
  | { ok: true; letterId: number; qty: number; unitPriceWei: bigint; unitFeeWei: bigint }
  | { ok: false; error: string };

const isUint = (s: unknown) => typeof s === "string" && /^\d{1,78}$/.test(s);
const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

/**
 * Is `o` exactly a letter-sale order the board accepts? The kind comes from the content, never from a
 * flag the client sends. Checks the shape, that both payments are a whole per-letter amount times the
 * quantity (so any part of it can fill), the fee (at least LETTER_SALE_FEE_BPS of each letter's price,
 * to SaleFees), the minimum price, and the time window. The signature, the seller's balance and
 * approval, and the counter are the route's, onchain.
 */
export function checkLetterSaleOrder(
  o: SeaportOrder | null | undefined,
  ctx: { letters: string; word: string; saleFees: string; nowSeconds: number },
): LetterSaleCheck {
  if (!o || typeof o.offerer !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(o.offerer)) return { ok: false, error: "bad_offerer" };
  const offer = o.offer;
  const pay = o.consideration;
  if (!Array.isArray(offer) || offer.length !== 1) return { ok: false, error: "bad_offer" };
  const item = offer[0];
  if (item.itemType !== ERC1155 || !same(item.token, ctx.letters) || !isUint(item.identifierOrCriteria) || !isUint(item.startAmount) || item.startAmount !== item.endAmount) {
    return { ok: false, error: "bad_offer" };
  }
  const letterId = Number(item.identifierOrCriteria);
  if (!Number.isInteger(letterId) || letterId < 0 || letterId >= LETTER_IDS) return { ok: false, error: "bad_letter" };
  const qty = BigInt(item.startAmount);
  if (qty < 1n || qty > BigInt(MAX_LETTER_QTY)) return { ok: false, error: "bad_quantity" };

  if (!Array.isArray(pay) || pay.length !== 2) return { ok: false, error: "bad_payment" };
  for (const p of pay) {
    if (p.itemType !== ERC20 || !same(p.token, ctx.word) || p.identifierOrCriteria !== "0" || !isUint(p.startAmount) || p.startAmount !== p.endAmount) {
      return { ok: false, error: "bad_payment" };
    }
  }
  if (!same(pay[0].recipient, o.offerer)) return { ok: false, error: "bad_payment" };
  if (!same(pay[1].recipient, ctx.saleFees)) return { ok: false, error: "bad_fee" };
  const sellerTotal = BigInt(pay[0].startAmount);
  const feeTotal = BigInt(pay[1].startAmount);
  // A buyer may take any number of the letters, so each payment must split evenly across them.
  if (sellerTotal % qty !== 0n || feeTotal % qty !== 0n) return { ok: false, error: "uneven_price" };
  const unitFeeWei = feeTotal / qty;
  const unitPriceWei = sellerTotal / qty + unitFeeWei;
  if (unitFeeWei * 10_000n < unitPriceWei * LETTER_SALE_FEE_BPS) return { ok: false, error: "bad_fee" };
  if (unitPriceWei < BigInt(MIN_LETTER_PRICE) * WEI) return { ok: false, error: "price_too_low" };
  if (o.zone !== ZERO_ADDR || o.zoneHash !== ZERO32 || o.conduitKey !== ZERO32 || o.orderType !== PARTIAL_OPEN) {
    return { ok: false, error: "bad_order" };
  }
  if (!isUint(o.startTime) || !isUint(o.endTime) || !isUint(o.salt) || !isUint(o.counter)) return { ok: false, error: "bad_order" };
  const start = Number(o.startTime);
  const end = Number(o.endTime);
  if (start > ctx.nowSeconds + 300 || end <= ctx.nowSeconds || end > ctx.nowSeconds + LETTER_SALE_TTL_SECONDS + 3_600) {
    return { ok: false, error: "bad_window" };
  }
  return { ok: true, letterId, qty: Number(qty), unitPriceWei, unitFeeWei };
}

/**
 * How many letters of a `qty`-letter order are still unsold, from Seaport's `getOrderStatus`
 * (`totalFilled` of `totalSize`; both 0 before the first fill). Seaport may keep the fraction in any
 * terms (2/5, or 4/10), so this works it out by cross-multiplying, rounding the sold part UP: a
 * letter that is partly accounted for is never offered.
 */
export function unsoldLetters(qty: number, totalFilled: bigint, totalSize: bigint): number {
  if (totalSize === 0n) return qty;
  const q = BigInt(qty);
  const sold = (q * totalFilled + totalSize - 1n) / totalSize;
  return Number(sold >= q ? 0n : q - sold);
}

/** The price of `count` letters from this order: what its payments add up to, times count / qty. */
export function lettersPriceWei(order: SeaportOrder, count: number): bigint {
  const qty = BigInt(order.offer[0].startAmount);
  const total = order.consideration.reduce((sum, p) => sum + BigInt(p.startAmount), 0n);
  return (total / qty) * BigInt(count);
}

/**
 * To list: cancel the seller's earlier, still-live orders for this letter (so a new price never
 * leaves an old one fillable), and approve the letters to Seaport if they aren't. Either can be
 * empty; then listing is a signature only.
 */
export function prepareLetterListingCalls(stale: readonly SeaportOrder[], approved: boolean): Call[] {
  return [
    ...stale.flatMap((o) => cancelOrderCalls(o)),
    ...(approved
      ? []
      : [{ to: addressOf("letters"), data: encodeFunctionData({ abi: erc1155ApprovalAbi, functionName: "setApprovalForAll", args: [SEAPORT, true] }) }]),
  ];
}

/**
 * To buy `count` letters: approve Seaport for exactly their price (when the allowance is short), then
 * fill that many of the order's `qty`. If fewer are left by the time it lands, Seaport fills what is
 * left and takes only that much $WORD.
 */
export function buyLettersCalls(order: SeaportOrder, signature: `0x${string}`, count: number, seaportAllowance: bigint): Call[] {
  const price = lettersPriceWei(order, count);
  return [
    ...(seaportAllowance >= price
      ? []
      : [{ to: wordTokenAddress(), data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [SEAPORT, price] }) }]),
    ...fulfillPartCalls(order, signature, BigInt(count), BigInt(order.offer[0].startAmount)),
  ];
}
