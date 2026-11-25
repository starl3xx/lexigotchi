/**
 * The Market's ROUTES, end to end (decisions.md #30): the route handlers themselves, against Seaport
 * on a local fork and a THROWAWAY local database. scripts/market-fork-check.ts proves the order;
 * this proves what the server does with it: what it refuses, what the board shows as letters sell,
 * leave, and come back, the cancel-then-relist, two listings sent together, and that a sale reaches
 * recent sales from the chain.
 *
 *   createdb lexi_market_check && for f in drizzle/0*.sql; do sed 's/--> statement-breakpoint//g' "$f" | psql -q -d lexi_market_check; done
 *   anvil --fork-url https://sepolia.base.org --port 8599
 *   NEXT_PUBLIC_CHAIN_ID=84532 NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8599 \
 *     DATABASE_URL=postgresql://localhost/lexi_market_check HOLDER=0x… WORD=STORE npx tsx scripts/market-routes-check.ts
 *
 * Start a fresh fork for each run (the checks begin from a seller Seaport has never seen).
 * HOLDER holds 6 or more of one letter; WORD is a claimed word that isn't staked. The fork takes
 * them (nothing reaches the real chain). **It empties the Market's tables**, so it refuses any
 * database or RPC that isn't on this machine. The seller and the buyers are Anvil's test accounts.
 */
import { createPublicClient, createTestClient, createWalletClient, encodeFunctionData, erc20Abi, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import postgres from "postgres";
import * as A from "../src/lib/onchain/addresses";
import * as S from "../src/lib/onchain/seaport";
import * as L from "../src/lib/onchain/letterSale";
import * as WS from "../src/lib/onchain/wordSale";
import { tokenIdOf } from "../src/lib/onchain/tokenId";
import * as letters_ from "../src/app/api/market/letters/route";
import * as sales_ from "../src/app/api/market/sales/route";
import * as words_ from "../src/app/api/swap/words/route";
import * as swaps_ from "../src/app/api/swap/orders/route";
import { markIndexed } from "../src/lib/db/shop";
import { closeDb } from "../src/lib/db/client";
import { bustLetterBook } from "../src/lib/market/letterBoard";

const local = (url: string | undefined) => !!url && /^[a-z]+:\/\/([^@/]*@)?(localhost|127\.0\.0\.1)([:/]|$)/.test(url);
if (!local(process.env.DATABASE_URL) || !local(process.env.NEXT_PUBLIC_RPC_URL)) {
  throw new Error("This check empties the Market's tables and moves letters: DATABASE_URL and NEXT_PUBLIC_RPC_URL must both be on this machine.");
}
if (!process.env.HOLDER) throw new Error("Set HOLDER to a wallet that holds 6 or more of one letter.");

const FORK = process.env.NEXT_PUBLIC_RPC_URL!;
const HOLDER = process.env.HOLDER as Hex;
const WORD = process.env.WORD ?? "STORE";
const seller = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const alice = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const carol = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
const transport = http(FORK);
const pub = createPublicClient({ chain: baseSepolia, transport });
const anvil = createTestClient({ chain: baseSepolia, transport, mode: "anvil" });
const wallet = (account: typeof seller) => createWalletClient({ account, chain: baseSepolia, transport });
const lettersAbi = parseAbi(["function balanceOf(address,uint256) view returns (uint256)", "function safeTransferFrom(address,address,uint256,uint256,bytes)"]);
const wordsAbi = parseAbi(["function ownerOf(uint256) view returns (address)", "function transferFrom(address,address,uint256)", "function approve(address,uint256)"]);
const mintAbi = parseAbi(["function mint(address,uint256)"]);
const letters = A.addressOf("letters"), words = A.addressOf("words"), word = A.wordTokenAddress();
const W = 10n ** 18n;

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${JSON.stringify(detail, (_k, v) => (typeof v === "bigint" ? v.toString() : v))?.slice(0, 400)}`}`); };
async function send(from: typeof seller, calls: { to: Hex; data?: Hex }[]) {
  for (const c of calls) {
    const hash = await wallet(from).sendTransaction({ to: c.to, data: c.data });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error("reverted");
  }
}
const get = async (mod: { GET: (r: Request) => Promise<Response> }, path: string) => (await mod.GET(new Request(`http://local${path}`))).json();
const post = async (mod: { POST: (r: Request) => Promise<Response> }, path: string, body: unknown) => {
  const res = await mod.POST(new Request(`http://local${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: res.status, ...(await res.json()) };
};
const sign = (order: S.SeaportOrder) => seller.signTypedData({ ...S.orderTypedData(order), message: S.orderComponentsArg(order) }) as Promise<Hex>;
const counter = () => pub.readContract({ address: S.SEAPORT, abi: S.seaportAbi, functionName: "getCounter", args: [seller.address] });
const now = async () => Number((await pub.getBlock()).timestamp);
const allowance = (who: Hex) => pub.readContract({ address: word, abi: erc20Abi, functionName: "allowance", args: [who, S.SEAPORT] });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  await sql`truncate letter_listings, market_sales, word_listings, swap_orders, shop_index`;
  await sql.end();
  // The sales' cursor starts at the fork's head: the history before it is the real chain's to read.
  await markIndexed(84532, A.addressOf("saleFees"), Number(await pub.getBlockNumber()));

  // ── setup: letters and a word to the test seller, $WORD to the buyer ──
  let letterId = -1, have = 0n;
  for (let id = 0; id < 52; id++) { const b = await pub.readContract({ address: letters, abi: lettersAbi, functionName: "balanceOf", args: [HOLDER, BigInt(id)] }); if (b > have) [letterId, have] = [id, b]; }
  await anvil.setBalance({ address: HOLDER, value: W });
  await anvil.impersonateAccount({ address: HOLDER });
  await pub.waitForTransactionReceipt({ hash: await createWalletClient({ account: HOLDER, chain: baseSepolia, transport }).writeContract({ address: letters, abi: lettersAbi, functionName: "safeTransferFrom", args: [HOLDER, seller.address, BigInt(letterId), 6n, "0x"] }) });
  await anvil.stopImpersonatingAccount({ address: HOLDER });
  const tokenId = tokenIdOf(WORD);
  const wordHolder = (await pub.readContract({ address: words, abi: wordsAbi, functionName: "ownerOf", args: [tokenId] })) as Hex;
  await anvil.setBalance({ address: wordHolder, value: W });
  await anvil.impersonateAccount({ address: wordHolder });
  await pub.waitForTransactionReceipt({ hash: await createWalletClient({ account: wordHolder, chain: baseSepolia, transport }).writeContract({ address: words, abi: wordsAbi, functionName: "transferFrom", args: [wordHolder, seller.address, tokenId] }) });
  await anvil.stopImpersonatingAccount({ address: wordHolder });
  for (const who of [alice]) await pub.waitForTransactionReceipt({ hash: await wallet(who).writeContract({ address: word, abi: mintAbi, functionName: "mint", args: [who.address, 10n ** 27n] }) });
  console.log(`letter id ${letterId}, word ${WORD}\n`);

  // ── letters: list ──
  const mk = async (qty: number, unitWhole: bigint, extraWei = 0n) => L.buildLetterSaleOrder({ maker: seller.address, letterId, qty, unitPriceWei: unitWhole * W + extraWei, counter: await counter(), nowSeconds: (await now()) - 60, salt: BigInt(Math.floor(Math.random() * 1e15)) });
  const order = await mk(5, 12_000n);
  const signature = await sign(order);
  let r = await post(letters_, "/api/market/letters", { order, signature });
  check("listing before the approval is refused", r.error === "not_approved", r);
  await send(seller, L.prepareLetterListingCalls([], false));
  r = await post(letters_, "/api/market/letters", { order, signature: signature.slice(0, -4) + "0000" });
  check("a signature that doesn't match is refused", r.error === "bad_signature", r);
  const frac = await mk(1, 12_000n, 7n);
  r = await post(letters_, "/api/market/letters", { order: frac, signature: await sign(frac) });
  check("a price that isn't whole $WORD is refused", r.error === "price_not_whole", r);
  const tooMany = await mk(7, 12_000n);
  r = await post(letters_, "/api/market/letters", { order: tooMany, signature: await sign(tooMany) });
  check("listing more letters than the wallet holds is refused", r.error === "not_enough_letters", r);
  r = await post(letters_, "/api/market/letters", { order, signature });
  check("a good listing is accepted", r.ok === true && /^0x[0-9a-f]{64}$/.test(r.orderHash), r);
  const hash = r.orderHash as string;
  const second = await mk(1, 9_000n);
  r = await post(letters_, "/api/market/letters", { order: second, signature: await sign(second) });
  check("a second live listing of the same letter is refused until the first is cancelled", r.error === "cancel_first", r);

  // ── letters: read ──
  let board = await get(letters_, "/api/market/letters");
  const top = board.book?.[letterId]?.asks?.[0];
  check("the board shows it: 5 for sale at 12,000 each, with no order or signature", top?.available === 5 && top?.unitPrice === 12_000 && top?.orderHash === hash && !("order" in top) && !("signature" in top), board);
  let one = await get(letters_, `/api/market/letters?order=${hash}`);
  check("the order is served by its hash", one.ok && one.available === 5 && one.qty === 5 && one.signature === signature, one);
  check("an unknown hash is gone", (await get(letters_, `/api/market/letters?order=0x${"9".repeat(64)}`)).error === "gone");

  // ── letters: buy 2, through the app's own call builder ──
  await send(alice, L.buyLettersCalls(one.order, one.signature, 2, await allowance(alice.address)));
  let page = await get(letters_, `/api/market/letters?letter=${letterId}`);
  check("after a sale of 2, the listing offers 3", page.asks?.[0]?.available === 3, page);
  let mine = await get(letters_, `/api/market/letters?mine=${seller.address}`);
  check("the seller sees it: 3 of 5 unsold, live", mine.listings?.[0]?.unsold === 3 && mine.listings?.[0]?.qty === 5 && mine.listings?.[0]?.state === "live", mine);
  let sold = await get(sales_, "/api/market/sales?fresh=1");
  const s0 = sold.sales?.[0];
  check("the sale is in recent sales: 2 letters, 24,000 in all, 12,000 each, both wallets", s0?.kind === "letter" && s0?.letterId === letterId && s0?.qty === 2 && s0?.price === 24_000 && s0?.unitPrice === 12_000 && s0?.seller === seller.address.toLowerCase() && s0?.buyer === alice.address.toLowerCase(), sold);
  check("and in that letter's going rate", sold.letters?.[letterId]?.last === 12_000 && sold.letters?.[letterId]?.units === 2, sold.letters);

  // ── letters: the seller's letters leave, and come back ──
  await send(seller, [{ to: letters, data: encodeFunctionData({ abi: lettersAbi, functionName: "safeTransferFrom", args: [seller.address, carol.address, BigInt(letterId), 4n, "0x"] }) }]);
  bustLetterBook();
  board = await get(letters_, "/api/market/letters");
  mine = await get(letters_, `/api/market/letters?mine=${seller.address}`);
  check("with the letters gone, the board hides it and the seller sees it paused", !board.book?.[letterId] && mine.listings?.[0]?.state === "paused" && mine.listings?.[0]?.available === 0 && mine.listings?.[0]?.unsold === 3, { board, mine });
  await send(carol, [{ to: letters, data: encodeFunctionData({ abi: lettersAbi, functionName: "safeTransferFrom", args: [carol.address, seller.address, BigInt(letterId), 2n, "0x"] }) }]);
  bustLetterBook();
  board = await get(letters_, "/api/market/letters");
  check("with 2 back, it offers 2 of the 3 unsold", board.book?.[letterId]?.asks?.[0]?.available === 2, board);

  // ── letters: a new price cancels the old order in the same send ──
  const stale = await get(letters_, `/api/market/letters?stale=${seller.address.toLowerCase()}:${letterId}`);
  check("the old order is offered for cancelling", stale.stale?.length === 1 && stale.stale[0].orderHash === hash, stale);
  await send(seller, L.prepareLetterListingCalls(stale.stale.map((x: { order: unknown }) => x.order), true));
  const relist = await mk(2, 9_000n);
  r = await post(letters_, "/api/market/letters", { order: relist, signature: await sign(relist) });
  check("after the cancel, the new price lists", r.ok === true, r);
  mine = await get(letters_, `/api/market/letters?mine=${seller.address}`);
  check("only the new listing is left, at 9,000", mine.listings?.length === 1 && mine.listings[0].unitPrice === 9_000, mine);
  check("the cancelled order is gone", (await get(letters_, `/api/market/letters?order=${hash}`)).error === "gone");

  // ── letters: two listings of one letter, sent together ──
  await send(seller, L.prepareLetterListingCalls([relist], true));
  const [one1, one2] = [await mk(1, 8_000n), await mk(1, 7_000n)];
  const [sig1, sig2] = [await sign(one1), await sign(one2)];
  const both = await Promise.all([post(letters_, "/api/market/letters", { order: one1, signature: sig1 }), post(letters_, "/api/market/letters", { order: one2, signature: sig2 })]);
  check("of two listings of one letter sent together, exactly one lists", both.filter((x) => x.ok === true).length === 1 && both.filter((x) => x.error === "cancel_first").length === 1, both);
  mine = await get(letters_, `/api/market/letters?mine=${seller.address}`);
  check("and the seller has exactly one listing of it", mine.listings?.length === 1, mine);

  // ── words: list, read, buy, last sale ──
  await send(seller, WS.prepareListingCalls(tokenId, [], false));
  const wOrder = WS.buildWordSaleOrder({ maker: seller.address, tokenId, priceWei: 2_000_000n * W, counter: await counter(), nowSeconds: (await now()) - 60, salt: 5n });
  const wSig = await sign(wOrder);
  r = await post(words_, "/api/swap/words", { order: wOrder, signature: wSig, word: WORD });
  check("a word lists", r.ok === true, r);
  let wb = await get(words_, "/api/swap/words");
  const row = wb.listings?.find((l: { word: string }) => l.word === WORD);
  check("the words board shows it, with no order or signature in the row", !!row && row.priceWei === String(2_000_000n * W) && !("order" in row) && !("signature" in row) && typeof row.listedAt === "string", wb);
  const wOne = await get(words_, `/api/swap/words?order=${row.orderHash}`);
  check("the word's order is served by its hash", wOne.ok && wOne.signature === wSig && WS.orderPriceWei(wOne.order) === 2_000_000n * W, wOne);
  await send(alice, WS.buyWordCalls(wOne.order, wOne.signature, await allowance(alice.address)));
  check("the buyer holds the word", ((await pub.readContract({ address: words, abi: wordsAbi, functionName: "ownerOf", args: [tokenId] })) as string).toLowerCase() === alice.address.toLowerCase());
  sold = await get(sales_, "/api/market/sales?fresh=1");
  // (the route waits 3 s between fresh catch-ups; this one may answer from the last read)
  if (!sold.sales?.some((x: { kind: string }) => x.kind === "word")) { await new Promise((res) => setTimeout(res, 3_200)); sold = await get(sales_, "/api/market/sales?fresh=1"); }
  const ws = sold.sales?.find((x: { kind: string }) => x.kind === "word");
  check("the word sale is in recent sales, with its rarity", ws?.word === WORD && ws?.price === 2_000_000 && typeof ws?.tier === "string" && ws?.buyer === alice.address.toLowerCase(), sold.sales);
  check("and in that rarity's going rate", sold.tiers?.[ws?.tier]?.sales === 1 && sold.tiers?.[ws?.tier]?.avg === 2_000_000, sold.tiers);
  check("a word's own history is served", (await get(sales_, `/api/market/sales?word=${WORD}`)).sales?.length === 1);
  check("the sold order is gone", (await get(words_, `/api/swap/words?order=${row.orderHash}`)).error === "gone");

  // ── the retired swap ──
  check("no new letter swap lists", (await post(swaps_, "/api/swap/orders", {})).status === 410);
  check("a maker with no old offers gets none", (await get(swaps_, `/api/swap/orders?maker=${seller.address}`)).orders?.length === 0);

  await closeDb();
  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await closeDb(); process.exit(1); });
