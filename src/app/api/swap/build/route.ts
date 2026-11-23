import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { KYBER_API, KYBER_ROUTER, SLIPPAGE_BPS, checkBuild, symbolOf, validPair } from "@/lib/swap/kyber";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST { routeSummary, sender, slippageBps } — the transaction for a quoted $WORD swap, built by
 * KyberSwap with the recipient set to the sender, and checked before it leaves (lib/swap/kyber):
 * an allowed pair, the pinned router, and the quoted input amount.
 */
export async function POST(req: Request) {
  let input: { routeSummary?: Record<string, unknown>; sender?: string; slippageBps?: number };
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  const rs = input.routeSummary;
  const from = symbolOf(String(rs?.tokenIn ?? "")), to = symbolOf(String(rs?.tokenOut ?? ""));
  if (!rs || !from || !to || !validPair(from, to)) return NextResponse.json({ ok: false, error: "bad_pair" }, { status: 400 });
  if (!input.sender || !isAddress(input.sender)) return NextResponse.json({ ok: false, error: "bad_sender" }, { status: 400 });
  const slippage = Math.round(Number(input.slippageBps ?? SLIPPAGE_BPS.default));
  if (!(slippage >= SLIPPAGE_BPS.min && slippage <= SLIPPAGE_BPS.max)) return NextResponse.json({ ok: false, error: "bad_slippage" }, { status: 400 });
  const sender = getAddress(input.sender);
  try {
    const res = await fetch(`${KYBER_API}/route/build`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-client-id": "lexigotchi" },
      body: JSON.stringify({ routeSummary: rs, sender, recipient: sender, slippageTolerance: slippage, source: "lexigotchi" }),
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await res.json()) as { code?: number; data?: { routerAddress?: string; amountIn?: string; amountOut?: string; data?: string; transactionValue?: string } };
    const b = body.data;
    if (!res.ok || body.code !== 0 || !b) return NextResponse.json({ ok: false, error: "build_failed" }, { status: 502 });
    const problem = checkBuild(b, { amountIn: String(rs.amountIn) });
    if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 502 });
    return NextResponse.json(
      {
        ok: true,
        from,
        to,
        router: KYBER_ROUTER,
        data: b.data,
        value: b.transactionValue ?? "0",
        amountIn: b.amountIn,
        amountOut: b.amountOut,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ ok: false, error: "build_failed" }, { status: 502 });
  }
}
