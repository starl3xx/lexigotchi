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
  /** The player's $WORD: one wallet (`address`) or several summed (`addresses`); `wallets` counts those holding any. */
  holder?: { address: string; balance: number; wallets?: number };
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
  // One wallet (`address`), or every wallet of a player (`addresses`, comma-separated, at most 10):
  // a player with linked wallets holds the sum.
  const u = new URL(req.url).searchParams;
  const address = u.get("address");
  const list = [...new Set((u.get("addresses") ?? address ?? "").split(",").map((a) => a.trim().toLowerCase()))]
    .filter((a) => isAddress(a, { strict: false }))
    .slice(0, 10);
  if (list.length > 0) {
    try {
      const balances = (await getMainnetClient().multicall({
        allowFailure: false,
        contracts: list.map((a) => ({
          address: WORD_TOKEN as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf" as const,
          args: [getAddress(a)],
        })),
      })) as bigint[];
      const total = balances.reduce((a, b) => a + b, 0n);
      body.holder = {
        address: getAddress(list[0]),
        balance: Number(total / 10n ** 18n),
        wallets: balances.filter((b) => b > 0n).length,
      };
    } catch {
      /* the page shows the rest */
    }
  }
  return NextResponse.json(body, {
    headers: { "Cache-Control": list.length ? "private, no-store" : "public, s-maxage=60, stale-while-revalidate=120" },
  });
}
