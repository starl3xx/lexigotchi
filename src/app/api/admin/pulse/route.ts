import { NextResponse } from "next/server";
import { pulsePayload } from "@/lib/admin/metrics";

/** Operator headline metrics, from the deterministic economy sim (memoized server-side). */
export function GET() {
  return NextResponse.json(pulsePayload());
}
