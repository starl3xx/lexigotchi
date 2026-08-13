import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { eq } from "drizzle-orm";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { getDb } from "@/lib/db/client";
import { swapOrders } from "@/lib/db/schema";
import { getPublicClient } from "@/lib/onchain/reads";
import { SEAPORT, seaportAbi, orderComponentsArg, type LetterSwapOrder } from "@/lib/onchain/seaport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The letter-swap bulletin board.
 *
 * POST — list a signed order. The server verifies the SHAPE (our fixed 1⇄1 letter format, the
 * maker matches the offerer) and derives the orderHash on-chain — but the SIGNATURE is Seaport's
 * to judge at fill time. A forged listing can't steal anything; it just fails to fill. The DB is
 * never the truth about validity.
 *
 * GET — open orders. Every row is checked against Seaport.getOrderStatus in one multicall and
 * anything filled/cancelled/expired is dropped (and pruned) — the chain arbitrates, we serve.
 */
export async function POST(req: Request) {
  if (!(await allow("record-add", clientIp(req)))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  let body: { order?: LetterSwapOrder; signature?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const o = body.order;
  const sig = body.signature;
  if (!o || typeof sig !== "string" || !/^0x[0-9a-fA-F]+$/.test(sig)) {
    return NextResponse.json({ ok: false, error: "bad_order" }, { status: 400 });
  }
  // Fixed shape only: one 1155 letter each way, letters contract both sides, maker is recipient.
  const giveId = Number(o.offer?.[0]?.identifierOrCriteria);
  const wantId = Number(o.consideration?.[0]?.identifierOrCriteria);
  const shapeOk =
    isAddress(o.offerer ?? "", { strict: false }) &&
    o.offer?.length === 1 && o.consideration?.length === 1 &&
    o.offer[0].itemType === 3 && o.consideration[0].itemType === 3 &&
    Number.isInteger(giveId) && giveId >= 0 && giveId < 52 &&
    Number.isInteger(wantId) && wantId >= 0 && wantId < 52 &&
    o.consideration[0].recipient?.toLowerCase() === o.offerer.toLowerCase() &&
    o.offer[0].startAmount === "1" && o.consideration[0].startAmount === "1";
  if (!shapeOk) return NextResponse.json({ ok: false, error: "bad_shape" }, { status: 400 });

  try {
    const orderHash = (await getPublicClient().readContract({
      address: SEAPORT, abi: seaportAbi, functionName: "getOrderHash",
      args: [orderComponentsArg(o)],
    })) as string;
    const db = getDb();
    await db
      .insert(swapOrders)
      .values({
        maker: o.offerer.toLowerCase(), giveId, wantId,
        orderJson: JSON.stringify(o), signature: sig, orderHash,
      })
      .onConflictDoNothing();
    return NextResponse.json({ ok: true, orderHash });
  } catch (err) {
    console.error("[swap] list failed:", err);
    return NextResponse.json({ ok: false, error: "list_failed" }, { status: 502 });
  }
}

export async function GET(req: Request) {
  if (!(await allow("status", clientIp(req)))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  try {
    const db = getDb();
    const rows = await db.select().from(swapOrders).limit(200);
    if (rows.length === 0) return NextResponse.json({ ok: true, orders: [] });

    const status = (await getPublicClient().multicall({
      allowFailure: false,
      contracts: rows.map((r) => ({
        address: SEAPORT, abi: seaportAbi, functionName: "getOrderStatus" as const,
        args: [r.orderHash as `0x${string}`],
      })),
    })) as unknown as readonly [boolean, boolean, bigint, bigint][];

    const now = Math.floor(Date.now() / 1000);
    const open: typeof rows = [];
    for (let i = 0; i < rows.length; i++) {
      const [, cancelled, filled] = status[i];
      const o = JSON.parse(rows[i].orderJson) as LetterSwapOrder;
      const expired = Number(o.endTime) <= now;
      if (cancelled || filled > 0n || expired) {
        // spent — prune so the board stays small (the chain remains the record)
        await db.delete(swapOrders).where(eq(swapOrders.id, rows[i].id));
      } else {
        open.push(rows[i]);
      }
    }
    return NextResponse.json({
      ok: true,
      orders: open.map((r) => ({
        maker: r.maker, giveId: r.giveId, wantId: r.wantId,
        order: JSON.parse(r.orderJson), signature: r.signature, orderHash: r.orderHash,
      })),
    });
  } catch (err) {
    console.error("[swap] read failed:", err);
    return NextResponse.json({ ok: false, error: "board_unavailable" }, { status: 502 });
  }
}
