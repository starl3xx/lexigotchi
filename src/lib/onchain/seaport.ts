import { encodeFunctionData } from "viem";
import { addressOf } from "./addresses";
import { NETWORK } from "./network";
import type { Call } from "./sendCalls";

/**
 * Seaport 1.6 — the letter swap's settlement layer (decisions.md "swap primitive, light").
 *
 * The whole point: letter-for-letter trading with NO new audited contracts. Makers sign an order
 * off-chain (EIP-712, free); the order sits in our DB (a bulletin board, never the truth); takers
 * fill on-chain through the attributed chokepoint. Seaport enforces everything — ownership,
 * approval, single-fill — and getOrderStatus is the read path's arbiter for what's still open.
 *
 * Fixed shape by design: 1 letter ⇄ 1 letter, full-open (anyone can fill), no zone, no conduit
 * (direct approvals to Seaport), no fees — the sim priced P2P letter trading feeless and the
 * royalty conversation lives elsewhere (decisions.md).
 */

/** Canonical Seaport 1.6 — same address on every chain, Base Sepolia included. */
export const SEAPORT = "0x0000000000000068F116a894984e2DB1123eB395" as const;
const ZERO32 = `0x${"0".repeat(64)}` as const;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as const;
const ERC1155 = 3; // ItemType.ERC1155
const FULL_OPEN = 0; // OrderType.FULL_OPEN

export interface LetterSwapOrder {
  offerer: `0x${string}`;
  zone: `0x${string}`;
  offer: { itemType: number; token: `0x${string}`; identifierOrCriteria: string; startAmount: string; endAmount: string }[];
  consideration: { itemType: number; token: `0x${string}`; identifierOrCriteria: string; startAmount: string; endAmount: string; recipient: `0x${string}` }[];
  orderType: number;
  startTime: string;
  endTime: string;
  zoneHash: `0x${string}`;
  salt: string;
  conduitKey: `0x${string}`;
  counter: string;
}

/** 30 days — long enough to sit on the board, short enough that stale boards clear themselves. */
const ORDER_TTL_SECONDS = 30 * 24 * 3600;

/** Deterministic-enough salt from entropy the caller supplies (never Date.now in tests). */
export function buildLetterSwapOrder(args: {
  maker: `0x${string}`;
  giveId: number;
  wantId: number;
  counter: bigint;
  nowSeconds: number;
  salt: bigint;
}): LetterSwapOrder {
  const letters = addressOf("letters");
  return {
    offerer: args.maker,
    zone: ZERO_ADDR,
    offer: [{
      itemType: ERC1155, token: letters,
      identifierOrCriteria: String(args.giveId), startAmount: "1", endAmount: "1",
    }],
    consideration: [{
      itemType: ERC1155, token: letters,
      identifierOrCriteria: String(args.wantId), startAmount: "1", endAmount: "1",
      recipient: args.maker,
    }],
    orderType: FULL_OPEN,
    startTime: String(args.nowSeconds),
    endTime: String(args.nowSeconds + ORDER_TTL_SECONDS),
    zoneHash: ZERO32,
    salt: String(args.salt),
    conduitKey: ZERO32,
    counter: String(args.counter),
  };
}

/** The EIP-712 payload a wallet signs (eth_signTypedData_v4). */
export function orderTypedData(order: LetterSwapOrder) {
  return {
    domain: { name: "Seaport", version: "1.6", chainId: NETWORK.id, verifyingContract: SEAPORT },
    types: {
      OrderComponents: [
        { name: "offerer", type: "address" }, { name: "zone", type: "address" },
        { name: "offer", type: "OfferItem[]" }, { name: "consideration", type: "ConsiderationItem[]" },
        { name: "orderType", type: "uint8" }, { name: "startTime", type: "uint256" },
        { name: "endTime", type: "uint256" }, { name: "zoneHash", type: "bytes32" },
        { name: "salt", type: "uint256" }, { name: "conduitKey", type: "bytes32" },
        { name: "counter", type: "uint256" },
      ],
      OfferItem: [
        { name: "itemType", type: "uint8" }, { name: "token", type: "address" },
        { name: "identifierOrCriteria", type: "uint256" }, { name: "startAmount", type: "uint256" },
        { name: "endAmount", type: "uint256" },
      ],
      ConsiderationItem: [
        { name: "itemType", type: "uint8" }, { name: "token", type: "address" },
        { name: "identifierOrCriteria", type: "uint256" }, { name: "startAmount", type: "uint256" },
        { name: "endAmount", type: "uint256" }, { name: "recipient", type: "address" },
      ],
    },
    primaryType: "OrderComponents" as const,
    message: order,
  };
}

const seaportAbi = [
  { type: "function", name: "fulfillOrder", stateMutability: "payable",
    inputs: [
      { name: "order", type: "tuple", components: [
        { name: "parameters", type: "tuple", components: [
          { name: "offerer", type: "address" }, { name: "zone", type: "address" },
          { name: "offer", type: "tuple[]", components: [
            { name: "itemType", type: "uint8" }, { name: "token", type: "address" },
            { name: "identifierOrCriteria", type: "uint256" }, { name: "startAmount", type: "uint256" },
            { name: "endAmount", type: "uint256" }] },
          { name: "consideration", type: "tuple[]", components: [
            { name: "itemType", type: "uint8" }, { name: "token", type: "address" },
            { name: "identifierOrCriteria", type: "uint256" }, { name: "startAmount", type: "uint256" },
            { name: "endAmount", type: "uint256" }, { name: "recipient", type: "address" }] },
          { name: "orderType", type: "uint8" }, { name: "startTime", type: "uint256" },
          { name: "endTime", type: "uint256" }, { name: "zoneHash", type: "bytes32" },
          { name: "salt", type: "uint256" }, { name: "conduitKey", type: "bytes32" },
          { name: "totalOriginalConsiderationItems", type: "uint256" }] },
        { name: "signature", type: "bytes" }] },
      { name: "fulfillerConduitKey", type: "bytes32" }],
    outputs: [{ type: "bool" }] },
  { type: "function", name: "cancel", stateMutability: "nonpayable",
    inputs: [{ name: "orders", type: "tuple[]", components: [
      { name: "offerer", type: "address" }, { name: "zone", type: "address" },
      { name: "offer", type: "tuple[]", components: [
        { name: "itemType", type: "uint8" }, { name: "token", type: "address" },
        { name: "identifierOrCriteria", type: "uint256" }, { name: "startAmount", type: "uint256" },
        { name: "endAmount", type: "uint256" }] },
      { name: "consideration", type: "tuple[]", components: [
        { name: "itemType", type: "uint8" }, { name: "token", type: "address" },
        { name: "identifierOrCriteria", type: "uint256" }, { name: "startAmount", type: "uint256" },
        { name: "endAmount", type: "uint256" }, { name: "recipient", type: "address" }] },
      { name: "orderType", type: "uint8" }, { name: "startTime", type: "uint256" },
      { name: "endTime", type: "uint256" }, { name: "zoneHash", type: "bytes32" },
      { name: "salt", type: "uint256" }, { name: "conduitKey", type: "bytes32" },
      { name: "counter", type: "uint256" }] }],
    outputs: [{ type: "bool" }] },
  { type: "function", name: "getOrderHash", stateMutability: "view",
    inputs: [{ name: "order", type: "tuple", components: [
      { name: "offerer", type: "address" }, { name: "zone", type: "address" },
      { name: "offer", type: "tuple[]", components: [
        { name: "itemType", type: "uint8" }, { name: "token", type: "address" },
        { name: "identifierOrCriteria", type: "uint256" }, { name: "startAmount", type: "uint256" },
        { name: "endAmount", type: "uint256" }] },
      { name: "consideration", type: "tuple[]", components: [
        { name: "itemType", type: "uint8" }, { name: "token", type: "address" },
        { name: "identifierOrCriteria", type: "uint256" }, { name: "startAmount", type: "uint256" },
        { name: "endAmount", type: "uint256" }, { name: "recipient", type: "address" }] },
      { name: "orderType", type: "uint8" }, { name: "startTime", type: "uint256" },
      { name: "endTime", type: "uint256" }, { name: "zoneHash", type: "bytes32" },
      { name: "salt", type: "uint256" }, { name: "conduitKey", type: "bytes32" },
      { name: "counter", type: "uint256" }] }],
    outputs: [{ type: "bytes32" }] },
  { type: "function", name: "getOrderStatus", stateMutability: "view",
    inputs: [{ name: "orderHash", type: "bytes32" }],
    outputs: [
      { name: "isValidated", type: "bool" }, { name: "isCancelled", type: "bool" },
      { name: "totalFilled", type: "uint256" }, { name: "totalSize", type: "uint256" }] },
  { type: "function", name: "getCounter", stateMutability: "view",
    inputs: [{ name: "offerer", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
export { seaportAbi };

/** Order → the on-chain OrderParameters tuple (adds totalOriginalConsiderationItems). */
function toParameters(o: LetterSwapOrder) {
  return {
    offerer: o.offerer, zone: o.zone,
    offer: o.offer.map((i) => ({ ...i, identifierOrCriteria: BigInt(i.identifierOrCriteria), startAmount: BigInt(i.startAmount), endAmount: BigInt(i.endAmount) })),
    consideration: o.consideration.map((i) => ({ ...i, identifierOrCriteria: BigInt(i.identifierOrCriteria), startAmount: BigInt(i.startAmount), endAmount: BigInt(i.endAmount) })),
    orderType: o.orderType, startTime: BigInt(o.startTime), endTime: BigInt(o.endTime),
    zoneHash: o.zoneHash, salt: BigInt(o.salt), conduitKey: o.conduitKey,
    totalOriginalConsiderationItems: BigInt(o.consideration.length),
  };
}

function toComponents(o: LetterSwapOrder) {
  const { totalOriginalConsiderationItems: _, ...params } = toParameters(o);
  return { ...params, counter: BigInt(o.counter) };
}

export function fulfillOrderCalls(order: LetterSwapOrder, signature: `0x${string}`): Call[] {
  return [{
    to: SEAPORT,
    data: encodeFunctionData({
      abi: seaportAbi, functionName: "fulfillOrder",
      args: [{ parameters: toParameters(order), signature }, ZERO32],
    }),
  }];
}

export function cancelOrderCalls(order: LetterSwapOrder): Call[] {
  return [{
    to: SEAPORT,
    data: encodeFunctionData({ abi: seaportAbi, functionName: "cancel", args: [[toComponents(order)]] }),
  }];
}

export { toComponents as orderComponentsArg };
