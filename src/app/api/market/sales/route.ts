/**
 * GET /api/market/sales: what sold on the Market lately (decisions.md #30), newest first, with what
 * each letter and each rarity has been going for, which the Market uses to suggest prices.
 * GET `?word=CRANE`: that word's own sales.
 *
 * It first reads any sale the table hasn't seen (lib/market/sales `catchUpSales`, at most every 20 s
 * per server; `?fresh=1`, sent right after a purchase, asks again after 3 s), so a sale shows whoever
 * made it and wherever, and it tells the sellers of the sales it found (after it answers). Public:
 * sales are onchain.
 */
import { NextResponse } from "next/server";
import { afterResponse } from "@/lib/afterResponse";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { isSuiteDeployed } from "@/lib/onchain/addresses";
import { NETWORK } from "@/lib/onchain/network";
import { isWord } from "@/lib/dictionary";
import { letterSaleStats, marketTables, recentSales, tierSaleStats, type SaleRow } from "@/lib/db/market";
import { catchUpSales } from "@/lib/market/sales";
import { marketFaces } from "@/lib/market/faces";
import type { LetterSaleStat, MarketSale, TierSaleStat } from "@/lib/market/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WEI = 10n ** 18n;
const whole = (wei: string) => Number(BigInt(wei) / WEI);
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

const CATCH_UP_EVERY_MS = 20_000;
const FRESH_EVERY_MS = 3_000;
const RECENT = 40;
let lastCatchUp = 0;
let running: Promise<unknown> | null = null;
/** Sends in flight: each started the moment its sales were recorded, awaited after the answer. */
let sending: Promise<unknown>[] = [];

/**
 * Tell the sellers of sales this server was the first to record (lib/notify/sold.ts). Started AT
 * ONCE, for each transaction's sales as they are recorded, and never awaited here: a sale is new
 * only once, so a send that waited for the catch-up to finish would be lost for good if the
 * function were stopped first (a long catch-up on a quiet day; Bugbot on #239), and the Market must
 * not wait on a push service either. The notifier is imported at the moment of use, inside a
 * catch, never at the top of this file: the senders behind it throw at import when armed without
 * their keys, and a bad setting must not take the Market's sales down with it.
 */
function tellNow(rows: SaleRow[]): void {
  sending.push(
    import("@/lib/notify/sold")
      .then((m) => m.notifySold(rows))
      .catch((err) => console.error("[sales] telling sellers failed:", String((err as Error)?.message ?? err).slice(0, 160))),
  );
}

/** Keep the function alive, after it has answered, until the sends it started are done. */
function finishSends(): void {
  if (sending.length === 0) return;
  const mine = sending;
  sending = [];
  afterResponse(async () => void (await Promise.allSettled(mine)));
}

async function caughtUp(fresh: boolean): Promise<void> {
  if (Date.now() - lastCatchUp <= (fresh ? FRESH_EVERY_MS : CATCH_UP_EVERY_MS)) return;
  lastCatchUp = Date.now();
  // One catch-up at a time per server; a failed one still answers with what's recorded.
  running ??= catchUpSales({ onNew: tellNow })
    .catch((err) => console.warn("[sales] catch-up failed:", String(err?.message ?? err).slice(0, 120)))
    .finally(() => {
      running = null;
    });
  await running;
}

function toSale(r: SaleRow): MarketSale {
  const price = whole(r.priceWei);
  return {
    kind: r.kind === "word" ? "word" : "letter",
    word: r.word ?? undefined,
    tier: r.tier ?? undefined,
    letterId: r.letterId ?? undefined,
    qty: r.qty,
    price,
    unitPrice: r.qty > 0 ? Math.floor(price / r.qty) : price,
    seller: r.seller,
    buyer: r.buyer,
    at: r.soldAt.getTime(),
    tx: r.txHash,
  };
}

export async function GET(req: Request) {
  if (!(await allow("market-read", clientIp(req)))) return json({ ok: false, error: "rate_limited" }, 429);
  if (!isSuiteDeployed()) return json({ ok: true, sales: [], letters: {}, tiers: {}, profiles: {} });
  const q = new URL(req.url).searchParams;
  try {
    // No table to keep them in yet (before migration 0017): nothing to read the chain for.
    if (!(await marketTables()).sales) return json({ ok: true, sales: [], letters: {}, tiers: {}, profiles: {} });
    await caughtUp(q.get("fresh") === "1");
    finishSends();
    const word = q.get("word")?.trim().toUpperCase();
    if (word !== undefined) {
      if (!isWord(word)) return json({ ok: false, error: "bad_word" }, 400);
      return json({ ok: true, sales: (await recentSales(NETWORK.id, 10, word)).map(toSale) });
    }
    const [rows, letterStats, tierStats] = await Promise.all([recentSales(NETWORK.id, RECENT), letterSaleStats(NETWORK.id), tierSaleStats(NETWORK.id)]);
    const sales = rows.map(toSale);
    const letters: Record<number, LetterSaleStat> = {};
    for (const s of letterStats) letters[s.letterId] = { last: whole(s.lastUnitWei), lastAt: s.lastAt.getTime(), avg: whole(s.avgUnitWei), units: s.units };
    const tiers: Record<string, TierSaleStat> = {};
    for (const t of tierStats) tiers[t.tier] = { sales: t.sales, avg: whole(t.avgWei), low: whole(t.lowWei), high: whole(t.highWei) };
    return json({ ok: true, sales, letters, tiers, profiles: await marketFaces(sales.flatMap((s) => [s.seller, s.buyer])) });
  } catch (err) {
    console.error("[sales] read failed:", String((err as Error)?.message ?? err).slice(0, 160));
    return json({ ok: false, error: "sales_unavailable" }, 502);
  }
}
