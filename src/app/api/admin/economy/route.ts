import { NextResponse } from "next/server";
import { economyPayload } from "@/lib/admin/metrics";

/** Economy detail: prices, fee splits, ROI, the health scorecard, sink analysis. */
export function GET() {
  return NextResponse.json(economyPayload());
}
