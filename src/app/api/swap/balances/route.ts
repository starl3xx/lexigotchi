import { NextResponse } from "next/server";
import { erc20Abi, getAddress, isAddress } from "viem";
import { getMainnetClient } from "@/lib/onchain/mainnet";
import { SWAP_TOKENS } from "@/lib/swap/kyber";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET ?address=0x… — that wallet's ETH, USDC, and $WORD on Base mainnet, in base units. */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address");
  if (!address || !isAddress(address)) return NextResponse.json({ ok: false, error: "bad_address" }, { status: 400 });
  const who = getAddress(address);
  const client = getMainnetClient();
  try {
    const [eth, usdc, word] = await Promise.all([
      client.getBalance({ address: who }),
      client.readContract({ address: SWAP_TOKENS.USDC.address, abi: erc20Abi, functionName: "balanceOf", args: [who] }),
      client.readContract({ address: SWAP_TOKENS.WORD.address, abi: erc20Abi, functionName: "balanceOf", args: [who] }),
    ]);
    return NextResponse.json(
      { ok: true, ETH: eth.toString(), USDC: usdc.toString(), WORD: word.toString() },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ ok: false, error: "read_failed" }, { status: 502 });
  }
}
