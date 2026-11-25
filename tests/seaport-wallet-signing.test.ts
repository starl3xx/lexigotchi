/**
 * What a wallet signs must be what Seaport checks (starl3xx, 2026-11-25: "Listing failed:
 * bad_signature"). Wallets built on MetaMask's eth-sig-util treat a missing `EIP712Domain` type as an
 * EMPTY one, so the domain hashes as `EIP712Domain()` and the signature covers another digest. This
 * models that wallet: it hashes exactly the JSON the app sends, filling a missing EIP712Domain with [].
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { hashTypedData, recoverAddress, type TypedDataDefinition } from "viem";
import { privateKeyToAccount } from "viem/accounts";

vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532");

let SP: typeof import("@/lib/onchain/seaport");
let W: typeof import("@/lib/onchain/wordSale");
beforeAll(async () => {
  SP = await import("@/lib/onchain/seaport");
  W = await import("@/lib/onchain/wordSale");
});

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"); // a well-known test key

/** The digest an eth-sig-util wallet signs for this eth_signTypedData_v4 JSON. */
function walletDigest(json: string) {
  const t = JSON.parse(json);
  return hashTypedData({ ...t, types: { EIP712Domain: [], ...t.types } } as unknown as TypedDataDefinition);
}

describe("Seaport orders sent to wallets", () => {
  const order = () =>
    W.buildWordSaleOrder({ maker: account.address, tokenId: 42n, priceWei: 2_000_000n * 10n ** 18n, counter: 0n, nowSeconds: 1_795_000_000, salt: 7n });
  const seaportDigest = (o: ReturnType<typeof order>) =>
    hashTypedData({ ...SP.orderTypedData(o), message: SP.orderComponentsArg(o) } as unknown as TypedDataDefinition);

  it("the old JSON, with no EIP712Domain, made such a wallet sign another digest (the bug)", () => {
    const o = order();
    expect(walletDigest(JSON.stringify(SP.orderTypedData(o)))).not.toBe(seaportDigest(o));
  });

  it("the JSON the app sends now names the domain type, so the wallet signs exactly Seaport's digest", async () => {
    const o = order();
    const digest = walletDigest(SP.walletTypedDataJson(o));
    expect(digest).toBe(seaportDigest(o));
    const sig = await account.sign({ hash: digest });
    expect(await recoverAddress({ hash: seaportDigest(o), signature: sig })).toBe(account.address);
  });

  it("the letter offers go through the same JSON", () => {
    const o = SP.buildLetterSwapOrder({ maker: account.address, giveId: 1, wantId: 2, counter: 0n, nowSeconds: 1_795_000_000, salt: 9n });
    expect(walletDigest(SP.walletTypedDataJson(o))).toBe(
      hashTypedData({ ...SP.orderTypedData(o), message: SP.orderComponentsArg(o) } as unknown as TypedDataDefinition),
    );
  });
});
