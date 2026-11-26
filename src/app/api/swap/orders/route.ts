import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { getDb } from "@/lib/db/client";
import { swapOrders } from "@/lib/db/schema";
import { isMissingTable } from "@/lib/db/profiles";
import { getPublicClient } from "@/lib/onchain/reads";
import { SEAPORT, seaportAbi, type SeaportOrder } from "@/lib/onchain/seaport";
import { isSuiteDeployed } from "@/lib/onchain/addresses";
import { parseWallets } from "@/lib/sceneSaves";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The old letter swap (one letter for one letter), retired by decisions.md #30: letters sell for
 * $WORD now (`/api/market/letters`). Nothing new lists here, and the board no longer shows these
 * offers, so nobody is handed one to fill.
 *
 * What stays is the way out. An offer is a signed Seaport order, and it stays fillable onchain until
 * its maker cancels it or it expires (30 days from signing), whatever this app shows.
 * GET `?maker=<a>,<b>`: those wallets' old offers that could still fill, each with its order, so the
 * maker can cancel them from Sell. Spent rows (filled, cancelled, expired, or behind a counter bump)
 * are pruned.
 */
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST() {
  return json({ ok: false, error: "retired" }, 410);
}

export async function GET(req: Request) {
  if (!(await allow("market-read", clientIp(req)))) return json({ ok: false, error: "rate_limited" }, 429);
  if (!isSuiteDeployed()) return json({ ok: true, orders: [] });
  const makers = parseWallets(new URL(req.url).searchParams.get("maker"));
  if (!makers) return json({ ok: true, orders: [] });
  try {
    const db = getDb();
    const rows = await db.select().from(swapOrders).where(inArray(swapOrders.maker, makers)).limit(100);
    if (rows.length === 0) return json({ ok: true, orders: [] });
    const client = getPublicClient();
    const [status, counters] = await Promise.all([
      client.multicall({
        allowFailure: true,
        contracts: rows.map((r) => ({ address: SEAPORT, abi: seaportAbi, functionName: "getOrderStatus" as const, args: [r.orderHash as `0x${string}`] as const })),
      }),
      client.multicall({
        allowFailure: true,
        contracts: makers.map((m) => ({ address: SEAPORT, abi: seaportAbi, functionName: "getCounter" as const, args: [m as `0x${string}`] as const })),
      }),
    ]);
    const counterOf = new Map(makers.map((m, i) => [m, counters[i].status === "success" ? (counters[i].result as bigint) : undefined]));
    const now = Math.floor(Date.now() / 1000);
    const open = [];
    for (let i = 0; i < rows.length; i++) {
      const order = JSON.parse(rows[i].orderJson) as SeaportOrder;
      const s = status[i].status === "success" ? (status[i].result as unknown as readonly [boolean, boolean, bigint, bigint]) : undefined;
      const counter = counterOf.get(rows[i].maker);
      const spent = Number(order.endTime) <= now || (!!s && (s[1] || s[2] > 0n)) || (counter !== undefined && counter !== BigInt(order.counter));
      if (spent) await db.delete(swapOrders).where(eq(swapOrders.id, rows[i].id));
      else open.push({ maker: rows[i].maker, giveId: rows[i].giveId, wantId: rows[i].wantId, order, orderHash: rows[i].orderHash, endsAt: Number(order.endTime) * 1000 });
    }
    return json({ ok: true, orders: open });
  } catch (err) {
    if (isMissingTable(err)) return json({ ok: true, orders: [] });
    console.error("[swap] read failed:", String((err as Error)?.message ?? err).slice(0, 160));
    return json({ ok: false, error: "board_unavailable" }, 502);
  }
}
