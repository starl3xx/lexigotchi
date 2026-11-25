import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { eq } from "drizzle-orm";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { getDb } from "@/lib/db/client";
import { swapOrders } from "@/lib/db/schema";
import { getPublicClient } from "@/lib/onchain/reads";
import { SEAPORT, seaportAbi, orderComponentsArg, orderTypedData, type LetterSwapOrder } from "@/lib/onchain/seaport";
import { addressOf } from "@/lib/onchain/addresses";
import { erc1155ApprovalAbi, lettersAbi } from "@/lib/onchain/abis";
import { playerFaces } from "@/lib/profile/faces";
import type { PublicFace } from "@/lib/profile/rules";

/** Makers' faces, kept a few minutes: the board polls every 15 s while it's on screen. */
const FACE_TTL_MS = 5 * 60_000;
const faceCache = new Map<string, { at: number; face: PublicFace | null }>();
async function makerFaces(makers: readonly string[]): Promise<Record<string, PublicFace>> {
  const now = Date.now();
  const missing = makers.filter((m) => (faceCache.get(m)?.at ?? 0) < now - FACE_TTL_MS);
  if (missing.length > 0) {
    try {
      const { profiles } = await playerFaces(missing);
      for (const m of missing) faceCache.set(m, { at: now, face: profiles[m] ?? null });
    } catch {
      /* faceless rows still trade */
    }
  }
  const out: Record<string, PublicFace> = {};
  for (const m of makers) {
    const f = faceCache.get(m)?.face;
    if (f) out[m] = f;
  }
  return out;
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The letter-swap bulletin board.
 *
 * POST — list a signed order. The server verifies the SHAPE (our fixed 1⇄1 letter format, the
 * maker matches the offerer), the SIGNATURE (so an offer that could never fill never lists), and
 * derives the orderHash on-chain. The DB is never the truth about validity: Seaport judges at fill.
 *
 * GET — open orders. Every row is checked against Seaport.getOrderStatus in one multicall and
 * anything filled/cancelled/expired is dropped (and pruned) — the chain arbitrates, we serve. An
 * order the maker can't currently honor is HIDDEN, not pruned: the maker no longer holds the letter
 * (they moved it to another wallet, spelled it, or traded it), revoked Seaport's approval, or bumped
 * their Seaport counter. The first two can come back, so the row stays. Each maker comes with the
 * face of their profile (lib/profile/faces.ts), so the board shows players, not addresses.
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
    // The signature too: an offer signed over another digest can never fill, and used to sit on the
    // board anyway (a wallet that read a missing EIP712Domain as empty; seaport.ts walletTypedDataJson).
    const signed = await getPublicClient().verifyTypedData({
      ...orderTypedData(o),
      message: orderComponentsArg(o),
      address: o.offerer as `0x${string}`,
      signature: sig as `0x${string}`,
    });
    if (!signed) return NextResponse.json({ ok: false, error: "bad_signature" }, { status: 400 });
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
    if (rows.length === 0) return NextResponse.json({ ok: true, orders: [], profiles: {} });

    const letters = addressOf("letters");
    const makers = [...new Set(rows.map((r) => r.maker))];
    const client = getPublicClient();
    const [status, held, approved, counters] = await Promise.all([
      client.multicall({
        allowFailure: false,
        contracts: rows.map((r) => ({
          address: SEAPORT, abi: seaportAbi, functionName: "getOrderStatus" as const,
          args: [r.orderHash as `0x${string}`],
        })),
      }) as unknown as Promise<readonly [boolean, boolean, bigint, bigint][]>,
      client.multicall({
        allowFailure: false,
        contracts: rows.map((r) => ({
          address: letters, abi: lettersAbi, functionName: "balanceOf" as const,
          args: [r.maker as `0x${string}`, BigInt(r.giveId)],
        })),
      }) as unknown as Promise<readonly bigint[]>,
      client.multicall({
        allowFailure: false,
        contracts: makers.map((m) => ({
          address: letters, abi: erc1155ApprovalAbi, functionName: "isApprovedForAll" as const,
          args: [m as `0x${string}`, SEAPORT],
        })),
      }) as unknown as Promise<readonly boolean[]>,
      client.multicall({
        allowFailure: false,
        contracts: makers.map((m) => ({
          address: SEAPORT, abi: seaportAbi, functionName: "getCounter" as const, args: [m as `0x${string}`],
        })),
      }) as unknown as Promise<readonly bigint[]>,
    ]);
    const approvedBy = new Map(makers.map((m, i) => [m, approved[i]]));
    const counterOf = new Map(makers.map((m, i) => [m, counters[i]]));

    const now = Math.floor(Date.now() / 1000);
    const open: typeof rows = [];
    for (let i = 0; i < rows.length; i++) {
      const [, cancelled, filled] = status[i];
      const o = JSON.parse(rows[i].orderJson) as LetterSwapOrder;
      const expired = Number(o.endTime) <= now;
      // A counter bump cancels every order the maker signed before it, for good.
      const superseded = counterOf.get(rows[i].maker) !== BigInt(o.counter);
      if (cancelled || filled > 0n || expired || superseded) {
        // spent — prune so the board stays small (the chain remains the record)
        await db.delete(swapOrders).where(eq(swapOrders.id, rows[i].id));
      } else if (held[i] > 0n && approvedBy.get(rows[i].maker)) {
        open.push(rows[i]);
      }
      // else: can't fill right now (letter gone, approval revoked): hidden, kept
    }
    return NextResponse.json({
      ok: true,
      profiles: await makerFaces([...new Set(open.map((r) => r.maker))]),
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
