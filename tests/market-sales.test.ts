/**
 * Recent sales (decisions.md #29): which Seaport fills count as a sale on the Market. The table is a
 * copy of public history that anyone can add to by buying, so a fill that isn't a Word or letters
 * sold for $WORD, with the sale fee paid, must never get in.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import sepolia from "../config/deployments.base-sepolia.json";

vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532");

let M: typeof import("@/lib/market/sales");
let tokenIdOf: typeof import("@/lib/onchain/tokenId").tokenIdOf;
beforeAll(async () => {
  M = await import("@/lib/market/sales");
  ({ tokenIdOf } = await import("@/lib/onchain/tokenId"));
});

const WEI = 10n ** 18n;
const C = { words: sepolia.contracts.words, letters: sepolia.contracts.letters, word: sepolia.wordToken, saleFees: sepolia.contracts.saleFees };
const SELLER = "0x1111111111111111111111111111111111111111" as const;
const BUYER = "0x2222222222222222222222222222222222222222" as const;
const HASH = `0x${"ab".repeat(32)}` as const;
const pay = (amount: bigint, recipient: string, token: string = C.word) => ({ itemType: 1, token: token as `0x${string}`, identifier: 0n, amount, recipient: recipient as `0x${string}` });
const fill = (offer: { itemType: number; token: string; identifier: bigint; amount: bigint }, consideration = [pay(90n * WEI, SELLER), pay(10n * WEI, C.saleFees)]) => ({
  orderHash: HASH, offerer: SELLER, recipient: BUYER, offer: [{ ...offer, token: offer.token as `0x${string}` }], consideration,
});

describe("a fill as a Market sale", () => {
  it("reads a word sale: the word, its rarity, both wallets, and the price with its fee", () => {
    const sale = M.saleOfFill(fill({ itemType: 2, token: C.words, identifier: tokenIdOf("CRANE"), amount: 1n }), C);
    expect(sale).toMatchObject({ kind: "word", word: "CRANE", qty: 1, seller: SELLER, buyer: BUYER, priceWei: String(100n * WEI), feeWei: String(10n * WEI), letterId: null });
    expect(sale?.tier).toBeTruthy();
  });

  it("reads a part of a letter listing by the amounts that filled", () => {
    // 2 of a 5-letter order: Seaport's event carries 2 letters and 2 letters' payments.
    const sale = M.saleOfFill(fill({ itemType: 3, token: C.letters, identifier: 48n, amount: 2n }, [pay(72n * WEI, SELLER), pay(8n * WEI, C.saleFees)]), C);
    expect(sale).toMatchObject({ kind: "letter", letterId: 48, qty: 2, priceWei: String(80n * WEI), feeWei: String(8n * WEI), word: null, tier: null });
  });

  it("knows every dictionary word by its token id, and no other", () => {
    expect(M.wordOfTokenId(tokenIdOf("jazzy"))).toBe("JAZZY");
    expect(M.wordOfTokenId(123n)).toBeNull();
  });

  it("refuses a fill that paid no sale fee", () => {
    expect(M.saleOfFill(fill({ itemType: 3, token: C.letters, identifier: 1n, amount: 1n }, [pay(100n * WEI, SELLER)]), C)).toBeNull();
  });

  it("refuses a fill paid in anything but $WORD", () => {
    const other = "0x3333333333333333333333333333333333333333";
    expect(M.saleOfFill(fill({ itemType: 3, token: C.letters, identifier: 1n, amount: 1n }, [pay(90n, SELLER, other), pay(10n, C.saleFees)]), C)).toBeNull();
  });

  it("refuses anything that isn't one of the game's Words or letters", () => {
    const other = "0x3333333333333333333333333333333333333333";
    expect(M.saleOfFill(fill({ itemType: 2, token: other, identifier: tokenIdOf("CRANE"), amount: 1n }), C)).toBeNull();
    expect(M.saleOfFill(fill({ itemType: 2, token: C.words, identifier: 123n, amount: 1n }), C)).toBeNull(); // not a dictionary word
    expect(M.saleOfFill(fill({ itemType: 3, token: C.letters, identifier: 52n, amount: 1n }), C)).toBeNull(); // not a letter id
    expect(M.saleOfFill(fill({ itemType: 3, token: C.words, identifier: 1n, amount: 1n }), C)).toBeNull(); // the wrong kind for the contract
    const two = fill({ itemType: 3, token: C.letters, identifier: 1n, amount: 1n });
    two.offer.push(two.offer[0]);
    expect(M.saleOfFill(two, C)).toBeNull();
  });
});
