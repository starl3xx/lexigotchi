import { NextResponse } from "next/server";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { isMissingTable } from "@/lib/db/profiles";
import { letterRowByHash, letterRowsOfLetter, letterRowsOfMakerLetter, letterRowsOfMakers, listLetterUnlessLive, marketTables } from "@/lib/db/market";
import { getPublicClient } from "@/lib/onchain/reads";
import { SEAPORT, seaportAbi, orderComponentsArg, orderTypedData, type SeaportOrder } from "@/lib/onchain/seaport";
import { addressOf, isSuiteDeployed, wordTokenAddress } from "@/lib/onchain/addresses";
import { erc1155ApprovalAbi, lettersAbi } from "@/lib/onchain/abis";
import { checkLetterSaleOrder, LETTER_IDS } from "@/lib/onchain/letterSale";
import { BOOK_DEPTH, bustLetterBook, checkLetterRows, pruneSpent, readLetterBook, refreshLetterBook, toAsk, toMine } from "@/lib/market/letterBoard";
import { parseWallets } from "@/lib/sceneSaves";
import { marketFaces as faces } from "@/lib/market/faces";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Letters for sale (decisions.md #30): Seaport orders offering some of one letter for $WORD each,
 * 10% of each to SaleFees. A buyer takes any number of them.
 *
 * POST `{ order, signature }`: list. The kind comes from the order's content (`checkLetterSaleOrder`:
 * the fixed shape, every payment a whole per-letter amount, and the fee). The route also checks the
 * SIGNATURE, that the seller holds every letter offered and approved Letters to Seaport, and the
 * counter. One live listing per seller per letter: an earlier one must be cancelled onchain first
 * (`cancel_first`), because the approval covers every letter for good, and an old order would fill
 * at its old price the next time the seller held that letter.
 *
 * GET: the board, every letter's cheapest open listings (lib/market/letterBoard.ts), and `open`:
 *   whether letters can be listed here yet (false until migration 0017 has run). `?fresh=1`, sent
 *   after a purchase or a cancel, reads the chain again in place of the few-second-old copy.
 * GET `?letter=<id>&offset=<n>`: more of one letter's listings, cheapest first.
 * GET `?order=<hash>`: one listing's signed order, to buy from or cancel. The board itself never
 *   carries orders or signatures, so it stays small however many listings there are.
 * GET `?mine=<a>,<b>`: these wallets' own listings, paused ones included, for the Sell page.
 * GET `?stale=<maker>:<letterId>`: that seller's orders for that letter that could still fill, for
 *   the client to cancel before listing it again.
 */

const WEI = 10n ** 18n;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  if (!(await allow("market-list", clientIp(req)))) return json({ ok: false, error: "rate_limited" }, 429);
  if (!isSuiteDeployed()) return json({ ok: false, error: "not_deployed" }, 503);
  const body = (await req.json().catch(() => null)) as { order?: SeaportOrder; signature?: string } | null;
  const order = body?.order;
  const signature = body?.signature;
  if (!order || typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) return json({ ok: false, error: "bad_request" }, 400);

  const now = Math.floor(Date.now() / 1000);
  const letters = addressOf("letters");
  const check = checkLetterSaleOrder(order, { letters, word: wordTokenAddress(), saleFees: addressOf("saleFees"), nowSeconds: now });
  if (!check.ok) return json({ ok: false, error: check.error }, 400);
  // Whole $WORD only, so the price the board shows is exactly the price paid.
  if (check.unitPriceWei % WEI !== 0n) return json({ ok: false, error: "price_not_whole" }, 400);

  const client = getPublicClient();
  const maker = order.offerer.toLowerCase() as `0x${string}`;
  try {
    if (!(await marketTables()).letters) return json({ ok: false, error: "not_configured" }, 503);
    const signed = await client.verifyTypedData({
      ...orderTypedData(order),
      message: orderComponentsArg(order),
      address: maker,
      signature: signature as `0x${string}`,
    });
    if (!signed) return json({ ok: false, error: "bad_signature" }, 400);

    const [held, approved, counter, orderHash] = await client.multicall({
      allowFailure: true,
      contracts: [
        { address: letters, abi: lettersAbi, functionName: "balanceOf", args: [maker, BigInt(check.letterId)] },
        { address: letters, abi: erc1155ApprovalAbi, functionName: "isApprovedForAll", args: [maker, SEAPORT] },
        { address: SEAPORT, abi: seaportAbi, functionName: "getCounter", args: [maker] },
        { address: SEAPORT, abi: seaportAbi, functionName: "getOrderHash", args: [orderComponentsArg(order)] },
      ],
    });
    if (held.status !== "success" || orderHash.status !== "success") return json({ ok: false, error: "try_again" }, 503);
    if ((held.result as bigint) < BigInt(check.qty)) return json({ ok: false, error: "not_enough_letters" }, 409);
    if (approved.status !== "success" || approved.result !== true) return json({ ok: false, error: "not_approved" }, 409);
    if (counter.status !== "success" || counter.result !== BigInt(order.counter)) return json({ ok: false, error: "bad_counter" }, 409);
    const hash = (orderHash.result as string).toLowerCase();

    // One live listing per seller per letter: a new price cancels the old one first. The check and
    // the insert share a lock, so two listings sent together can't both pass it.
    let spentRows: Awaited<ReturnType<typeof checkLetterRows>> = [];
    const listed = await listLetterUnlessLive(
      { maker, letterId: check.letterId, qty: check.qty, unitPriceWei: check.unitPriceWei.toString(), orderJson: JSON.stringify(order), signature, orderHash: hash },
      async (others) => {
        const states = await checkLetterRows(others, now);
        spentRows = states;
        return states.some((s) => !s.spent && !s.foreign);
      },
    );
    await pruneSpent(spentRows); // after the lock is released: it has its own connection
    if (!listed) return json({ ok: false, error: "cancel_first" }, 409);
    bustLetterBook();
    return json({ ok: true, orderHash: hash });
  } catch (err) {
    if (isMissingTable(err)) return json({ ok: false, error: "not_configured" }, 503);
    console.error("[letters-board] list failed:", String((err as Error)?.message ?? err).slice(0, 160));
    return json({ ok: false, error: "list_failed" }, 502);
  }
}

export async function GET(req: Request) {
  if (!(await allow("market-read", clientIp(req)))) return json({ ok: false, error: "rate_limited" }, 429);
  // `open: false`: nothing can be listed where the game's contracts aren't deployed.
  if (!isSuiteDeployed()) return json({ ok: true, open: false, book: {}, profiles: {} });
  const q = new URL(req.url).searchParams;
  try {
    const orderArg = q.get("order");
    if (orderArg !== null) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(orderArg)) return json({ ok: false, error: "bad_request" }, 400);
      const row = await letterRowByHash(orderArg);
      const [c] = row ? await checkLetterRows([row]) : [];
      if (!c || c.spent || c.foreign) {
        if (c?.spent) await pruneSpent([c]);
        return json({ ok: false, error: "gone" }, 404);
      }
      return json({ ok: true, order: c.order, signature: c.row.signature, qty: c.row.qty, available: c.available, unsold: c.unsold });
    }

    const staleArg = q.get("stale");
    if (staleArg !== null) {
      const [maker, id] = staleArg.toLowerCase().split(":");
      const letterId = Number(id);
      if (!/^0x[0-9a-f]{40}$/.test(maker ?? "") || !/^\d{1,2}$/.test(id ?? "") || letterId >= LETTER_IDS) return json({ ok: false, error: "bad_request" }, 400);
      const states = await checkLetterRows(await letterRowsOfMakerLetter(maker, letterId));
      await pruneSpent(states);
      return json({ ok: true, stale: states.filter((s) => !s.spent && !s.foreign).map((s) => ({ order: s.order, orderHash: s.row.orderHash })) });
    }

    const mineArg = q.get("mine");
    if (mineArg !== null) {
      const wallets = parseWallets(mineArg);
      if (!wallets) return json({ ok: false, error: "bad_request" }, 400);
      const states = await checkLetterRows(await letterRowsOfMakers(wallets));
      await pruneSpent(states);
      return json({ ok: true, listings: states.filter((s) => !s.spent && !s.foreign).map(toMine) });
    }

    const letterArg = q.get("letter");
    if (letterArg !== null) {
      const letterId = Number(letterArg);
      const offset = Number(q.get("offset") ?? "0");
      if (!/^\d{1,2}$/.test(letterArg) || letterId >= LETTER_IDS || !Number.isInteger(offset) || offset < 0 || offset > 5_000) {
        return json({ ok: false, error: "bad_request" }, 400);
      }
      const PAGE = 24;
      const rows = await letterRowsOfLetter(letterId, PAGE + 1, offset);
      const states = await checkLetterRows(rows.slice(0, PAGE));
      await pruneSpent(states);
      const asks = states.filter((s) => s.available > 0).map(toAsk);
      return json({ ok: true, asks, more: rows.length > PAGE, next: offset + PAGE, profiles: await faces(asks.map((a) => a.maker)) });
    }

    // `open`: can letters be listed here yet (migration 0017)? The Sell page asks before it offers to.
    if (!(await marketTables()).letters) return json({ ok: true, open: false, book: {}, depth: BOOK_DEPTH, profiles: {} });
    if (q.get("fresh") === "1") refreshLetterBook();
    const book = await readLetterBook();
    const makers = Object.values(book).flatMap((b) => b.asks.map((a) => a.maker));
    return json({ ok: true, open: true, book, depth: BOOK_DEPTH, profiles: await faces(makers) });
  } catch (err) {
    if (isMissingTable(err)) return json({ ok: true, open: false, book: {}, profiles: {}, listings: [], stale: [], asks: [] });
    console.error("[letters-board] read failed:", String((err as Error)?.message ?? err).slice(0, 160));
    return json({ ok: false, error: "board_unavailable" }, 502);
  }
}
