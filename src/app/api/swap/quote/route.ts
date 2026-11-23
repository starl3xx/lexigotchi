import { NextResponse } from "next/server";
import { KYBER_API, SWAP_TOKENS, isSwapSymbol, priceImpactPct, validPair } from "@/lib/swap/kyber";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET ?from=ETH|USDC|WORD&to=…&amount=<base units> — a KyberSwap quote for the $WORD swap card
 * (lib/swap/kyber has the rules). Returns the expected output, both sides in dollars, the price
 * impact, and the opaque route summary the build step needs.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const from = q.get("from"), to = q.get("to"), amount = q.get("amount") ?? "";
  if (!isSwapSymbol(from) || !isSwapSymbol(to) || !validPair(from, to)) return NextResponse.json({ ok: false, error: "bad_pair" }, { status: 400 });
  if (!/^[1-9][0-9]{0,40}$/.test(amount)) return NextResponse.json({ ok: false, error: "bad_amount" }, { status: 400 });
  try {
    const url = `${KYBER_API}/routes?tokenIn=${SWAP_TOKENS[from].address}&tokenOut=${SWAP_TOKENS[to].address}&amountIn=${amount}`;
    const res = await fetch(url, { headers: { "x-client-id": "lexigotchi", accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
    const body = (await res.json()) as { code?: number; data?: { routeSummary?: Record<string, unknown> } };
    const rs = body.data?.routeSummary;
    if (!res.ok || body.code !== 0 || !rs) return NextResponse.json({ ok: false, error: "no_route" }, { status: 502 });
    const inUsd = Number(rs.amountInUsd), outUsd = Number(rs.amountOutUsd);
    return NextResponse.json(
      {
        ok: true,
        amountIn: String(rs.amountIn),
        amountOut: String(rs.amountOut),
        amountInUsd: Number.isFinite(inUsd) ? inUsd : null,
        amountOutUsd: Number.isFinite(outUsd) ? outUsd : null,
        priceImpactPct: priceImpactPct(inUsd, outUsd),
        routeSummary: rs,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ ok: false, error: "quote_failed" }, { status: 502 });
  }
}
