/**
 * The four-bucket $WORD ledger — the solvency core.
 *
 * Every fee is routed via a Split into Pool / Jackpot / Burn / Treasury. Faucets (yield,
 * jackpot) only ever pay what their bucket holds, so insolvency is unrepresentable here —
 * the ledger ENFORCES the spec's "solvency by construction" claim and throws if any code
 * path would violate it. The sim's job is then to show how the solvent system *behaves*.
 */
import type { Split } from "../params";

export class Ledger {
  pool = 0;
  jackpot = 0;
  burnedTotal = 0;
  treasuryTotal = 0;
  externalInflowTotal = 0;

  // Per-day flow counters (reset each day via `beginDay`).
  poolInflowToday = 0;
  poolOutflowToday = 0;
  /** Gross $WORD routed through the ledger today (all buckets) — used to size secondary GMV. */
  grossRoutedToday = 0;

  beginDay(): void {
    this.poolInflowToday = 0;
    this.poolOutflowToday = 0;
    this.grossRoutedToday = 0;
  }

  /** Route an incoming $WORD fee into the four buckets per `split`. */
  route(amount: number, split: Split): void {
    if (amount < 0) throw new Error(`Ledger.route: negative amount ${amount}`);
    const toPool = amount * split.pool;
    this.pool += toPool;
    this.jackpot += amount * split.jackpot;
    this.burnedTotal += amount * split.burn;
    this.treasuryTotal += amount * split.treasury;
    this.poolInflowToday += toPool;
    this.grossRoutedToday += amount;
  }

  /** Record exogenous $WORD entering the economy (player DEX buys / top-ups). */
  recordExternalInflow(amount: number): void {
    this.externalInflowTotal += amount;
  }

  /** Pay `amount` out of the Rewards Pool (yield). Caps at the balance; never negative. */
  payFromPool(amount: number): number {
    const paid = Math.min(amount, this.pool);
    this.pool -= paid;
    this.poolOutflowToday += paid;
    if (this.pool < -1e-9) throw new Error("Pool went negative");
    return paid;
  }

  /** Pay the entire jackpot pot to a winner; returns the amount paid. */
  payJackpot(): number {
    const paid = this.jackpot;
    this.jackpot = 0;
    return paid;
  }

  /** Invariant: no bucket may be negative. Called every day by the sim. */
  assertSolvent(): void {
    if (this.pool < -1e-9) throw new Error(`Insolvent: pool=${this.pool}`);
    if (this.jackpot < -1e-9) throw new Error(`Insolvent: jackpot=${this.jackpot}`);
    if (this.burnedTotal < -1e-9 || this.treasuryTotal < -1e-9) {
      throw new Error("Insolvent: burn/treasury negative");
    }
  }
}
