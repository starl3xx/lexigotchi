import { NextResponse } from "next/server";
import { erc20Abi, getAddress, isAddress } from "viem";
import { getMainnetClient } from "@/lib/onchain/mainnet";
import { fetchWordPrice } from "@/lib/oracle/wordPrice";
import { DEAD_ADDRESS, WORD_TOKEN, WORD_POOLS_URL, parseTopPool, summarizeSupply, type WordPool, type WordSupply } from "@/lib/wordStats";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET — the real $WORD token's numbers for the in-game $WORD page (lib/wordStats explains each):
 * the price (the app's oracle), supply and both kinds of burn (Base mainnet, always, whatever
 * network the game runs on), the deepest pool (GeckoTerminal), and Let's Have A Word!'s staking
 * and burn counter. Cached a minute; every part is optional, and a part that fails is absent.
 *
 * `?address=0x…` adds that wallet's $WORD balance on mainnet (not cached).
 */
const TTL_MS = 60_000;
const LHAW_TOKENOMICS = "https://letshaveaword.fun/api/word-tokenomics";

export interface WordSummary {
  ok: true;
  price: { usd: number; marketCapUsd: number | null; live: boolean };
  supply?: WordSupply;
  pool?: WordPool;
  lhaw?: { staked: number | null; burned: number | null };
  holder?: { address: string; balance: number };
}

let cached: { at: number; body: WordSummary } | null = null;

async function getJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6_000), headers: { accept: "application/json" } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

const n = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

async function build(): Promise<WordSummary> {
  const client = getMainnetClient();
  const token = WORD_TOKEN as `0x${string}`;
  const [price, supply, poolJson, lhaw] = await Promise.all([
    fetchWordPrice(),
    Promise.all([
      client.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }),
      client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [DEAD_ADDRESS] }),
    ])
      .then(([total, dead]) => summarizeSupply(total, dead))
      .catch(() => undefined),
    getJson(WORD_POOLS_URL),
    getJson(LHAW_TOKENOMICS) as Promise<Record<string, unknown> | null>,
  ]);
  const body: WordSummary = {
    ok: true,
    price: { usd: price.priceUsd, marketCapUsd: price.fdvUsd, live: price.source === "geckoterminal" },
  };
  if (supply) body.supply = supply;
  const pool = parseTopPool(poolJson);
  if (pool) body.pool = pool;
  if (lhaw) body.lhaw = { staked: n(lhaw.totalStaked), burned: n(lhaw.totalBurned) };
  return body;
}

export async function GET(req: Request) {
  const now = Date.now();
  if (!cached || now - cached.at > TTL_MS) {
    const fresh = await build();
    // Keep a part that answered last time rather than blank it on one failed refresh.
    cached = {
      at: now,
      body: { ...fresh, supply: fresh.supply ?? cached?.body.supply, pool: fresh.pool ?? cached?.body.pool, lhaw: fresh.lhaw ?? cached?.body.lhaw },
    };
  }
  const body: WordSummary = { ...cached.body };
  const address = new URL(req.url).searchParams.get("address");
  if (address && isAddress(address)) {
    try {
      const balance = await getMainnetClient().readContract({
        address: WORD_TOKEN as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [getAddress(address)],
      });
      body.holder = { address: getAddress(address), balance: Number(balance / 10n ** 18n) };
    } catch {
      /* the page shows the rest */
    }
  }
  return NextResponse.json(body, {
    headers: { "Cache-Control": address ? "private, no-store" : "public, s-maxage=60, stale-while-revalidate=120" },
  });
}
