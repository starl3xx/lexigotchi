import { NextResponse } from "next/server";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { isAddress } from "viem";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { addressOf } from "@/lib/onchain/addresses";
import { merkleEpochsAbi } from "@/lib/onchain/abis";
import { getPublicClient } from "@/lib/onchain/reads";
import type { EpochFile } from "@/lib/keeper/tree";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET `?wallets=0xa,0xb` — every unclaimed reward leaf whose payee is one of the given wallets.
 *
 * The keeper publishes each epoch's full tree (proofs included) to keeper-output/; this route is
 * the read side: filter the union bag's wallets against the leaves, drop what the chain says is
 * already claimed, hand back everything needed to build claim() calls. Proofs are public by
 * design — a leaf pays its baked-in account no matter who submits it, so serving them gates
 * nothing. No keeper-output directory just means no epochs have opened: an empty answer, not an
 * error, because on a fresh deploy that is the truth.
 */
const OUT = "keeper-output";

export async function GET(req: Request) {
  if (!(await allow("status", clientIp(req)))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const raw = new URL(req.url).searchParams.get("wallets") ?? "";
  const wallets = new Set<string>(
    raw.split(",").map((w) => w.trim().toLowerCase()).filter((w) => isAddress(w, { strict: false })),
  );
  if (wallets.size === 0) return NextResponse.json({ ok: false, error: "bad_wallets" }, { status: 400 });

  if (!existsSync(OUT)) return NextResponse.json({ ok: true, claimables: [] });

  // Every published epoch's leaves for these wallets…
  const candidates: {
    stream: "yield" | "bounty"; epochId: string; tokenId: string;
    account: `0x${string}`; amount: string; proof: `0x${string}`[];
  }[] = [];
  for (const file of readdirSync(OUT)) {
    const m = /^(yield|bounty)-(\d+)\.json$/.exec(file);
    if (!m) continue;
    const epoch = JSON.parse(readFileSync(`${OUT}/${file}`, "utf8")) as import("@/lib/keeper/tree").EpochFile;
    for (const e of epoch.entries) {
      if (wallets.has(e.account.toLowerCase())) {
        candidates.push({ stream: m[1] as "yield" | "bounty", epochId: m[2], ...e });
      }
    }
  }
  if (candidates.length === 0) return NextResponse.json({ ok: true, claimables: [] });

  // …minus what the chain says is already claimed.
  const claimed = (await getPublicClient().multicall({
    allowFailure: false,
    contracts: candidates.map((c) => ({
      address: addressOf(c.stream === "yield" ? "yieldDistributor" : "bounty"),
      abi: merkleEpochsAbi,
      functionName: "hasClaimed" as const,
      args: [BigInt(c.epochId), BigInt(c.tokenId)],
    })),
  })) as unknown as boolean[];

  return NextResponse.json({ ok: true, claimables: candidates.filter((_, i) => !claimed[i]) });
}
