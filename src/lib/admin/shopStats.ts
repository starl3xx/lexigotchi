/**
 * The Shop's numbers for the operator console (decisions.md #22), from its events: revenue to date,
 * $WORD sent to the pool, USDC that waited, and sales per item. Pure, so it's tested; the route reads
 * the events and the live settings.
 */
export interface PurchaseEvent {
  itemId: number;
  priceUsdc: bigint;
  toStudio: bigint;
  wordToPool: bigint;
  deferredUsdc: bigint;
}

export interface SweepEvent {
  usdcIn: bigint;
  wordOut: bigint;
  strayWord: bigint;
}

export interface ShopTotals {
  sales: number;
  /** USDC units paid by buyers. */
  grossUsdc: bigint;
  /** USDC units to the revenue wallet: the studio's revenue to date. */
  revenueUsdc: bigint;
  /** $WORD wei routed to the pool (with the bounty carve): at purchase plus by sweeps. */
  wordToPool: bigint;
  /** USDC units whose swap waited at purchase, ever (some since swept). */
  deferredEverUsdc: bigint;
  /** USDC units swept so far. */
  sweptUsdc: bigint;
  perItem: Map<number, { sales: number; grossUsdc: bigint; revenueUsdc: bigint }>;
}

export function shopTotals(purchases: readonly PurchaseEvent[], sweeps: readonly SweepEvent[]): ShopTotals {
  const t: ShopTotals = {
    sales: 0,
    grossUsdc: 0n,
    revenueUsdc: 0n,
    wordToPool: 0n,
    deferredEverUsdc: 0n,
    sweptUsdc: 0n,
    perItem: new Map(),
  };
  for (const p of purchases) {
    t.sales += 1;
    t.grossUsdc += p.priceUsdc;
    t.revenueUsdc += p.toStudio;
    t.wordToPool += p.wordToPool;
    t.deferredEverUsdc += p.deferredUsdc;
    const it = t.perItem.get(p.itemId) ?? { sales: 0, grossUsdc: 0n, revenueUsdc: 0n };
    it.sales += 1;
    it.grossUsdc += p.priceUsdc;
    it.revenueUsdc += p.toStudio;
    t.perItem.set(p.itemId, it);
  }
  for (const s of sweeps) {
    t.sweptUsdc += s.usdcIn;
    t.wordToPool += s.wordOut + s.strayWord;
  }
  return t;
}
