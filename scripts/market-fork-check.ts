/**
 * Proves the Market's letter listings against Seaport itself, on a local fork (decisions.md #29).
 * The unit tests check the order's shape; only Seaport can say that a part of it fills.
 *
 *   anvil --fork-url https://sepolia.base.org --port 8599
 *   NEXT_PUBLIC_CHAIN_ID=84532 FORK_URL=http://127.0.0.1:8599 HOLDER=0x… npx tsx scripts/market-fork-check.ts
 *
 * Start a fresh fork for each run (the checks count from an untouched seller and buyers).
 * HOLDER is any wallet that holds 5 or more of one letter on that network: the fork takes them from
 * it (nothing is sent to the real chain). It never touches a real key: the seller and the buyers are
 * Anvil's well-known test accounts.
 *
 * It runs the app's own builders (buildLetterSaleOrder, buyLettersCalls, cancelOrderCalls) and the
 * same typed data a wallet signs, then checks what Seaport did:
 *   1. list 5, buy 2: the letters, the seller's 90%, and the fee all move by exactly 2 letters' worth
 *   2. ask for 5 when 3 are left: Seaport fills 3 and takes 3 letters' worth, no more (this buy
 *      carries the builder suffix after its calldata, as the app's sends do)
 *   3. a sold-out order can't fill again
 *   4. an order whose payments don't divide by the quantity can't fill in part (why the fee is split
 *      per letter)
 *   5. a cancelled order can't fill, and a new one at another price can
 */
import { createPublicClient, createTestClient, createWalletClient, erc20Abi, http, parseAbi, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { addressOf, wordTokenAddress } from "../src/lib/onchain/addresses";
import { SEAPORT, cancelOrderCalls, fulfillPartCalls, orderComponentsArg, orderTypedData, seaportAbi, type SeaportOrder } from "../src/lib/onchain/seaport";
import { buildLetterSaleOrder, buyLettersCalls, checkLetterSaleOrder, lettersPriceWei, prepareLetterListingCalls, splitUnitPrice, unsoldLetters } from "../src/lib/onchain/letterSale";
import { appendBuilderSuffix } from "../src/lib/onchain/builderCode";
import type { Call } from "../src/lib/onchain/sendCalls";

const FORK_URL = process.env.FORK_URL ?? "http://127.0.0.1:8599";
const HOLDER = process.env.HOLDER as Hex | undefined;
if (!HOLDER) throw new Error("Set HOLDER to a wallet that holds 5 or more of one letter.");

// Anvil's published test keys: worthless anywhere but a local fork.
const seller = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const alice = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const bob = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");

const transport = http(FORK_URL);
const pub = createPublicClient({ chain: baseSepolia, transport });
const anvil = createTestClient({ chain: baseSepolia, transport, mode: "anvil" });
const wallet = (account: typeof seller) => createWalletClient({ account, chain: baseSepolia, transport });

const lettersAbi = parseAbi([
  "function balanceOf(address,uint256) view returns (uint256)",
  "function safeTransferFrom(address,address,uint256,uint256,bytes)",
  "function isApprovedForAll(address,address) view returns (bool)",
]);
const mintAbi = parseAbi(["function mint(address,uint256)"]);

const letters = addressOf("letters");
const word = wordTokenAddress();
const saleFees = addressOf("saleFees");

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function send(from: typeof seller, calls: Call[]) {
  let receipt;
  for (const c of calls) {
    const hash = await wallet(from).sendTransaction({ to: c.to, data: c.data });
    receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("reverted");
  }
  return receipt!;
}
async function reverts(from: typeof seller, calls: Call[]): Promise<boolean> {
  try {
    await send(from, calls);
    return false;
  } catch {
    return true;
  }
}
const lettersOf = (who: Hex, id: number) => pub.readContract({ address: letters, abi: lettersAbi, functionName: "balanceOf", args: [who, BigInt(id)] });
const wordOf = (who: Hex) => pub.readContract({ address: word, abi: erc20Abi, functionName: "balanceOf", args: [who] });
const allowanceOf = (who: Hex) => pub.readContract({ address: word, abi: erc20Abi, functionName: "allowance", args: [who, SEAPORT] });

async function sign(order: SeaportOrder): Promise<Hex> {
  // What a wallet signs (walletTypedDataJson is this, plus the domain's own type for eth-sig-util).
  return seller.signTypedData({ ...orderTypedData(order), message: orderComponentsArg(order) });
}
async function status(order: SeaportOrder) {
  const hash = await pub.readContract({ address: SEAPORT, abi: seaportAbi, functionName: "getOrderHash", args: [orderComponentsArg(order)] });
  const [, cancelled, filled, size] = await pub.readContract({ address: SEAPORT, abi: seaportAbi, functionName: "getOrderStatus", args: [hash] });
  return { cancelled, filled, size };
}
async function newOrder(letterId: number, qty: number, unitPriceWei: bigint): Promise<SeaportOrder> {
  const counter = await pub.readContract({ address: SEAPORT, abi: seaportAbi, functionName: "getCounter", args: [seller.address] });
  const now = Number((await pub.getBlock()).timestamp);
  return buildLetterSaleOrder({ maker: seller.address, letterId, qty, unitPriceWei, counter, nowSeconds: now - 60, salt: BigInt(Math.floor(Math.random() * 1e15)) });
}

async function main() {
  // Find a letter the holder has 5+ of, and take 12 of them (or all it has) into the test seller.
  let letterId = -1;
  let have = 0n;
  for (let id = 0; id < 52; id++) {
    const b = await lettersOf(HOLDER!, id);
    if (b > have) [letterId, have] = [id, b];
  }
  if (have < 5n) throw new Error("HOLDER holds fewer than 5 of every letter.");
  const take = have < 12n ? have : 12n;
  await anvil.setBalance({ address: HOLDER!, value: 10n ** 18n });
  await anvil.impersonateAccount({ address: HOLDER! });
  const moved = await createWalletClient({ account: HOLDER!, chain: baseSepolia, transport }).writeContract({
    address: letters, abi: lettersAbi, functionName: "safeTransferFrom", args: [HOLDER!, seller.address, BigInt(letterId), take, "0x"],
  });
  await pub.waitForTransactionReceipt({ hash: moved });
  await anvil.stopImpersonatingAccount({ address: HOLDER! });
  for (const buyer of [alice, bob]) {
    const hash = await wallet(buyer).writeContract({ address: word, abi: mintAbi, functionName: "mint", args: [buyer.address, 10n ** 27n] });
    await pub.waitForTransactionReceipt({ hash });
  }
  console.log(`letter id ${letterId}: the test seller holds ${take}\n`);

  // An awkward price on purpose: the fee doesn't come to a round number of wei.
  const unit = 12_345n * 10n ** 18n + 7n;
  const { feeWei, sellerWei } = splitUnitPrice(unit);

  // ── 1. list 5, buy 2 ──────────────────────────────────────────────────────────────────────
  const approved = await pub.readContract({ address: letters, abi: lettersAbi, functionName: "isApprovedForAll", args: [seller.address, SEAPORT] });
  await send(seller, prepareLetterListingCalls([], approved));
  const order = await newOrder(letterId, 5, unit);
  const signature = await sign(order);
  const shape = checkLetterSaleOrder(order, { letters, word, saleFees, nowSeconds: Number((await pub.getBlock()).timestamp) });
  check("the board's validator accepts the order the builder makes", shape.ok && shape.qty === 5 && shape.unitPriceWei === unit);

  let before = { sellerWord: await wordOf(seller.address), fees: await wordOf(saleFees), aliceWord: await wordOf(alice.address) };
  const r1 = await send(alice, buyLettersCalls(order, signature, 2, await allowanceOf(alice.address)));
  check("buy 2 of 5: the buyer holds 2", (await lettersOf(alice.address, letterId)) === 2n);
  check("buy 2 of 5: the seller is paid 90% of 2 letters", (await wordOf(seller.address)) - before.sellerWord === sellerWei * 2n);
  check("buy 2 of 5: the fee contract gets 10% of 2 letters", (await wordOf(saleFees)) - before.fees === feeWei * 2n);
  check("buy 2 of 5: the buyer pays exactly 2 letters' price", before.aliceWord - (await wordOf(alice.address)) === unit * 2n);
  check("buy 2 of 5: no allowance is left over", (await allowanceOf(alice.address)) === 0n);
  let s = await status(order);
  check("buy 2 of 5: Seaport says 3 are unsold", unsoldLetters(5, s.filled, s.size) === 3, `filled ${s.filled}/${s.size}`);
  const fills = parseEventLogs({ abi: seaportAbi, eventName: "OrderFulfilled", logs: r1.logs });
  const fill = fills[0]?.args;
  check(
    "the fill event names the letter, the 2 sold, and both payments",
    fills.length === 1 && fill.offer[0].amount === 2n && Number(fill.offer[0].identifier) === letterId &&
      fill.offer[0].token.toLowerCase() === letters.toLowerCase() &&
      fill.consideration[0].amount === sellerWei * 2n && fill.consideration[1].amount === feeWei * 2n &&
      fill.consideration[1].recipient.toLowerCase() === saleFees.toLowerCase() &&
      fill.recipient.toLowerCase() === alice.address.toLowerCase() && fill.offerer.toLowerCase() === seller.address.toLowerCase(),
  );

  // ── 2. ask for 5 when 3 are left ──────────────────────────────────────────────────────────
  before = { sellerWord: await wordOf(seller.address), fees: await wordOf(saleFees), aliceWord: await wordOf(bob.address) };
  // This buy carries the app's builder suffix after its calldata (ERC-8021, lib/onchain/builderCode.ts),
  // as every plain send from the game does: Seaport must take the extra bytes.
  await send(bob, buyLettersCalls(order, signature, 5, await allowanceOf(bob.address)).map((c) => ({ ...c, data: appendBuilderSuffix(c.data) })));
  check("ask for 5 with 3 left: the buyer gets 3", (await lettersOf(bob.address, letterId)) === 3n);
  check("ask for 5 with 3 left: the buyer pays for 3", before.aliceWord - (await wordOf(bob.address)) === unit * 3n);
  check("ask for 5 with 3 left: the seller is paid for 3", (await wordOf(seller.address)) - before.sellerWord === sellerWei * 3n);
  s = await status(order);
  check("the order is sold out", unsoldLetters(5, s.filled, s.size) === 0 && s.filled === s.size, `filled ${s.filled}/${s.size}`);

  // ── 3. a sold-out order can't fill again ──────────────────────────────────────────────────
  check("a sold-out order can't fill again", await reverts(alice, buyLettersCalls(order, signature, 1, await allowanceOf(alice.address))));

  // ── 4. payments that don't divide by the quantity can't fill in part ──────────────────────
  // The fee split on the TOTAL of 3 letters at an odd price: 10% of 3,015 wei over the minimum is not
  // a multiple of 3, so a third of the order has no whole amount.
  const total = (100n * 10n ** 18n + 5n) * 3n;
  const totalFee = (total * 1_000n + 9_999n) / 10_000n;
  const uneven = await newOrder(letterId, 3, 100n * 10n ** 18n);
  uneven.consideration[0].startAmount = uneven.consideration[0].endAmount = String(total - totalFee);
  uneven.consideration[1].startAmount = uneven.consideration[1].endAmount = String(totalFee);
  const unevenSig = await sign(uneven);
  const unevenShape = checkLetterSaleOrder(uneven, { letters, word, saleFees, nowSeconds: Number((await pub.getBlock()).timestamp) });
  check("the validator refuses payments that don't divide by the quantity", !unevenShape.ok && unevenShape.error === "uneven_price", unevenShape.ok ? "" : unevenShape.error);
  await send(alice, [{ to: word, data: (await import("viem")).encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [SEAPORT, total] }) }]);
  check("Seaport refuses to fill 1 of 3 of such an order", await reverts(alice, fulfillPartCalls(uneven, unevenSig, 1n, 3n)));

  // ── 5. cancel, then a new price ───────────────────────────────────────────────────────────
  const first = await newOrder(letterId, 4, unit);
  const firstSig = await sign(first);
  await send(bob, buyLettersCalls(first, firstSig, 1, await allowanceOf(bob.address)));
  const second = await newOrder(letterId, 3, unit * 2n);
  const secondSig = await sign(second);
  await send(seller, prepareLetterListingCalls([first], true)); // what listing again sends
  check("a cancelled order is marked cancelled", (await status(first)).cancelled);
  check("a cancelled order can't fill", await reverts(alice, buyLettersCalls(first, firstSig, 1, 10n ** 30n)));
  const aliceBefore = await wordOf(alice.address);
  await send(alice, buyLettersCalls(second, secondSig, 3, await allowanceOf(alice.address)));
  check("the new listing fills whole, at the new price", aliceBefore - (await wordOf(alice.address)) === lettersPriceWei(second, 3) && lettersPriceWei(second, 3) === unit * 6n);
  check("cancelOrderCalls is one call per order", cancelOrderCalls(first).length === 1);

  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
