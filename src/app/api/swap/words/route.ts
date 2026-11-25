import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { getDb } from "@/lib/db/client";
import { wordListings } from "@/lib/db/schema";
import { isMissingTable } from "@/lib/db/profiles";
import { getPublicClient } from "@/lib/onchain/reads";
import { SEAPORT, seaportAbi, orderComponentsArg, orderTypedData } from "@/lib/onchain/seaport";
import { addressOf, isSuiteDeployed, wordTokenAddress } from "@/lib/onchain/addresses";
import { prestigeAbi, stakingAbi, wordsAbi } from "@/lib/onchain/abis";
import { tokenIdOf } from "@/lib/onchain/tokenId";
import { checkWordSaleOrder, type SeaportOrder } from "@/lib/onchain/wordSale";
import { playerFaces } from "@/lib/profile/faces";
import type { PublicFace } from "@/lib/profile/rules";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Words for sale (decisions.md #18): Seaport orders offering one Word for $WORD, 10% to SaleFees.
 *
 * POST `{ order, signature, word }`: list. The kind comes from the order's content
 * (`checkWordSaleOrder`: the fixed shape and the fee), and unlike the letter board this route also
 * checks the SIGNATURE (a forged listing would put a fake price on someone's word), that the
 * offerer owns the word and approved it to Seaport, and the counter. One live listing per word per
 * seller: an earlier one must be cancelled onchain first (`cancel_first`), so a new price never
 * leaves the old one fillable.
 *
 * GET: what's for sale, each with the word's state read live (its case, prestige, pity, hunger),
 * never from the listing. Spent rows are pruned; rows that can't fill right now are hidden but kept.
 * GET `?stale=<maker>:<tokenId>`: that seller's orders for that word that could still fill, for
 * the client to cancel before listing it again.
 */

type Row = typeof wordListings.$inferSelect;
type Status = readonly [boolean, boolean, bigint, bigint]; // isValidated, isCancelled, totalFilled, totalSize

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Rows whose order can never fill again: filled, cancelled, expired, or superseded by a counter bump. */
function spent(row: Row, status: Status | undefined, counter: bigint | undefined, now: number): boolean {
  const o = JSON.parse(row.orderJson) as SeaportOrder;
  if (!status) return false; // couldn't read: keep, decide next time
  const [, cancelled, filled] = status;
  return cancelled || filled > 0n || Number(o.endTime) <= now || (counter !== undefined && counter !== BigInt(o.counter));
}

async function readStatus(rows: Row[]) {
  const client = getPublicClient();
  const makers = [...new Set(rows.map((r) => r.maker))] as `0x${string}`[];
  const [status, counters] = await Promise.all([
    client.multicall({
      allowFailure: true,
      contracts: rows.map((r) => ({
        address: SEAPORT, abi: seaportAbi, functionName: "getOrderStatus" as const, args: [r.orderHash as `0x${string}`],
      })),
    }),
    client.multicall({
      allowFailure: true,
      contracts: makers.map((m) => ({ address: SEAPORT, abi: seaportAbi, functionName: "getCounter" as const, args: [m] })),
    }),
  ]);
  const counterOf = new Map(makers.map((m, i) => [m, counters[i].status === "success" ? (counters[i].result as bigint) : undefined]));
  return rows.map((r, i) => ({
    status: status[i].status === "success" ? (status[i].result as unknown as Status) : undefined,
    counter: counterOf.get(r.maker as `0x${string}`),
  }));
}

export async function POST(req: Request) {
  if (!(await allow("record-add", clientIp(req)))) return json({ ok: false, error: "rate_limited" }, 429);
  if (!isSuiteDeployed()) return json({ ok: false, error: "not_deployed" }, 503);
  const body = (await req.json().catch(() => null)) as { order?: SeaportOrder; signature?: string; word?: string } | null;
  const order = body?.order;
  const signature = body?.signature;
  const word = typeof body?.word === "string" ? body.word.trim().toUpperCase() : "";
  if (!order || typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature) || !/^[A-Z]{5}$/.test(word)) {
    return json({ ok: false, error: "bad_request" }, 400);
  }
  const now = Math.floor(Date.now() / 1000);
  const words = addressOf("words");
  const check = checkWordSaleOrder(order, { words, word: wordTokenAddress(), saleFees: addressOf("saleFees"), nowSeconds: now });
  if (!check.ok) return json({ ok: false, error: check.error }, 400);
  if (tokenIdOf(word) !== check.tokenId) return json({ ok: false, error: "bad_word" }, 400);

  const client = getPublicClient();
  const maker = order.offerer.toLowerCase() as `0x${string}`;
  try {
    const signed = await client.verifyTypedData({
      ...orderTypedData(order),
      message: orderComponentsArg(order),
      address: maker,
      signature: signature as `0x${string}`,
    });
    if (!signed) return json({ ok: false, error: "bad_signature" }, 400);

    const id = check.tokenId;
    const [owner, approved, all, counter, claimedAt, orderHash] = await client.multicall({
      allowFailure: true,
      contracts: [
        { address: words, abi: wordsAbi, functionName: "ownerOf", args: [id] },
        { address: words, abi: wordsAbi, functionName: "getApproved", args: [id] },
        { address: words, abi: wordsAbi, functionName: "isApprovedForAll", args: [maker, SEAPORT] },
        { address: SEAPORT, abi: seaportAbi, functionName: "getCounter", args: [maker] },
        { address: words, abi: wordsAbi, functionName: "claimedAt", args: [id] },
        { address: SEAPORT, abi: seaportAbi, functionName: "getOrderHash", args: [orderComponentsArg(order)] },
      ],
    });
    if (owner.status !== "success" || String(owner.result).toLowerCase() !== maker) return json({ ok: false, error: "not_owner" }, 409);
    const isApproved =
      (approved.status === "success" && String(approved.result).toLowerCase() === SEAPORT.toLowerCase()) ||
      (all.status === "success" && all.result === true);
    if (!isApproved) return json({ ok: false, error: "not_approved" }, 409);
    if (counter.status !== "success" || counter.result !== BigInt(order.counter)) return json({ ok: false, error: "bad_counter" }, 409);
    if (claimedAt.status !== "success" || orderHash.status !== "success") return json({ ok: false, error: "try_again" }, 503);

    // One live listing per word per seller: a price change cancels the old one first.
    const db = getDb();
    const earlier = await db
      .select()
      .from(wordListings)
      .where(and(eq(wordListings.maker, maker), eq(wordListings.tokenId, id.toString())));
    const others = earlier.filter((r) => r.orderHash !== orderHash.result);
    if (others.length > 0) {
      const states = await readStatus(others);
      if (others.some((r, i) => !spent(r, states[i].status, states[i].counter, now))) return json({ ok: false, error: "cancel_first" }, 409);
    }

    await db
      .insert(wordListings)
      .values({
        maker,
        tokenId: id.toString(),
        word,
        priceWei: check.priceWei.toString(),
        claimedAt: Number(claimedAt.result),
        orderJson: JSON.stringify(order),
        signature,
        orderHash: orderHash.result as string,
      })
      .onConflictDoNothing();
    return json({ ok: true, orderHash: orderHash.result });
  } catch (err) {
    if (isMissingTable(err)) return json({ ok: false, error: "not_configured" }, 503);
    console.error("[words-board] list failed:", String((err as Error)?.message ?? err).slice(0, 160));
    return json({ ok: false, error: "list_failed" }, 502);
  }
}

export async function GET(req: Request) {
  if (!(await allow("status", clientIp(req)))) return json({ ok: false, error: "rate_limited" }, 429);
  if (!isSuiteDeployed()) return json({ ok: true, listings: [], profiles: {} });
  const now = Math.floor(Date.now() / 1000);
  const url = new URL(req.url);
  const staleArg = url.searchParams.get("stale");
  try {
    const db = getDb();
    if (staleArg) {
      const [maker, tokenId] = staleArg.toLowerCase().split(":");
      if (!/^0x[0-9a-f]{40}$/.test(maker ?? "") || !/^\d{1,78}$/.test(tokenId ?? "")) return json({ ok: false, error: "bad_request" }, 400);
      const rows = await db.select().from(wordListings).where(and(eq(wordListings.maker, maker), eq(wordListings.tokenId, tokenId)));
      const states = rows.length > 0 ? await readStatus(rows) : [];
      const live = rows.filter((r, i) => !spent(r, states[i].status, states[i].counter, now));
      return json({ ok: true, stale: live.map((r) => ({ order: JSON.parse(r.orderJson), orderHash: r.orderHash })) });
    }

    const rows = await db.select().from(wordListings).limit(300);
    if (rows.length === 0) return json({ ok: true, listings: [], profiles: {} });
    const states = await readStatus(rows);
    const open: Row[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (spent(rows[i], states[i].status, states[i].counter, now)) {
        await db.delete(wordListings).where(eq(wordListings.id, rows[i].id));
      } else {
        open.push(rows[i]);
      }
    }
    if (open.length === 0) return json({ ok: true, listings: [], profiles: {} });

    // The word's state, live: a listing's snapshot could be days old.
    const words = addressOf("words");
    const staking = addressOf("staking");
    const prestige = addressOf("prestige");
    const makers = [...new Set(open.map((r) => r.maker))] as `0x${string}`[];
    const client = getPublicClient();
    const PER = 11;
    const [detail, alls] = await Promise.all([
      client.multicall({
        allowFailure: true,
        contracts: open.flatMap((r) => {
          const id = BigInt(r.tokenId);
          return [
            { address: words, abi: wordsAbi, functionName: "ownerOf" as const, args: [id] },
            { address: words, abi: wordsAbi, functionName: "getApproved" as const, args: [id] },
            { address: words, abi: wordsAbi, functionName: "claimedAt" as const, args: [id] },
            { address: words, abi: wordsAbi, functionName: "prestigeLevel" as const, args: [id] },
            { address: prestige, abi: prestigeAbi, functionName: "prestigePity" as const, args: [id] },
            { address: staking, abi: stakingAbi, functionName: "lastFed" as const, args: [id] },
            ...Array.from({ length: 5 }, (_, pos) => ({
              address: words, abi: wordsAbi, functionName: "escrowLetter" as const, args: [id, pos] as const,
            })),
          ];
        }),
      }),
      client.multicall({
        allowFailure: true,
        contracts: makers.map((m) => ({ address: words, abi: wordsAbi, functionName: "isApprovedForAll" as const, args: [m, SEAPORT] })),
      }),
    ]);
    const allOf = new Map(makers.map((m, i) => [m, alls[i].status === "success" && alls[i].result === true]));

    const listings = [];
    for (let i = 0; i < open.length; i++) {
      const r = open[i];
      const d = detail.slice(i * PER, i * PER + PER);
      const ok = (k: number) => d[k].status === "success";
      const owner = ok(0) ? String(d[0].result).toLowerCase() : null;
      const approved = (ok(1) && String(d[1].result).toLowerCase() === SEAPORT.toLowerCase()) || allOf.get(r.maker as `0x${string}`) === true;
      const claimedAt = ok(2) ? Number(d[2].result) : -1;
      // Fillable now: the seller still holds it, unstaked, approved, and it's the same claim it was.
      if (owner !== r.maker || !approved || claimedAt !== r.claimedAt) continue;
      const claimedAtRaw = claimedAt;
      const lastFedRaw = ok(5) ? Number(d[5].result) : 0;
      const lastFedAt = lastFedRaw < claimedAtRaw ? 0 : lastFedRaw;
      listings.push({
        maker: r.maker,
        word: r.word,
        tokenId: r.tokenId,
        priceWei: r.priceWei,
        order: JSON.parse(r.orderJson),
        signature: r.signature,
        orderHash: r.orderHash,
        upper: Array.from({ length: 5 }, (_, pos) => {
          const e = d[6 + pos];
          return e.status === "success" ? Boolean((e.result as unknown as readonly [number, boolean])[1]) : false;
        }),
        prestigeLevel: ok(3) ? Number(d[3].result) : 0,
        prestigePity: ok(4) ? Number(d[4].result) : 0,
        lastFedAt,
        listedAt: r.createdAt.toISOString(),
      });
    }

    let profiles: Record<string, PublicFace> = {};
    try {
      profiles = (await playerFaces([...new Set(listings.map((l) => l.maker))])).profiles;
    } catch {
      /* faceless rows still sell */
    }
    return json({ ok: true, listings, profiles });
  } catch (err) {
    if (isMissingTable(err)) return json({ ok: true, listings: [], profiles: {} });
    console.error("[words-board] read failed:", String((err as Error)?.message ?? err).slice(0, 160));
    return json({ ok: false, error: "board_unavailable" }, 502);
  }
}
