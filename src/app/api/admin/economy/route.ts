import { NextResponse } from "next/server";
import { economyPayload } from "@/lib/admin/metrics";
import { fetchWordPrice } from "@/lib/oracle/wordPrice";

/**
 * Economy detail: prices, fee splits, ROI, the health scorecard, sink analysis.
 *
 * The sim payload is memoized and priced off the deterministic fallback peg; only `pegInfo` is
 * overwritten with the oracle's live answer, so the operator sees the market peg (with its source)
 * while the sim numbers stay comparable run to run.
 */
export async function GET() {
  const payload = economyPayload();
  const live = await fetchWordPrice();
  return NextResponse.json({
    ...payload,
    pegInfo: {
      wordUsd: live.priceUsd,
      wordPerUsd: live.wordPerUsd,
      source: live.source,
      fetchedAt: live.fetchedAt,
    },
  });
}
