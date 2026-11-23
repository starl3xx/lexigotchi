/**
 * readUntil (src/lib/onchain/settle.ts): after a claim, stake, or feed, keep re-reading the bag
 * until the change shows, because the first read after a send usually comes back stale.
 */
import { describe, it, expect } from "vitest";
import { readUntil, SETTLE_OFFSETS_MS } from "@/lib/onchain/settle";

/** A fake clock: records each wait instead of sleeping. */
function fakeSleep() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

describe("readUntil", () => {
  it("stops at the first read that shows the change", async () => {
    const reads = [[], [], ["ABATE"]];
    let n = 0;
    const { waits, sleep } = fakeSleep();
    const seen = await readUntil(async () => reads[n++] ?? [], (ws: string[]) => ws.includes("ABATE"), SETTLE_OFFSETS_MS, sleep);
    expect(seen).toBe(true);
    expect(n).toBe(3); // 0 s and 2 s missed; 5 s saw it; 10 s and 20 s never ran
    expect(waits).toEqual([2_000, 3_000]);
  });

  it("reads on the whole schedule, then reports a miss", async () => {
    let n = 0;
    const { waits, sleep } = fakeSleep();
    const seen = await readUntil(async () => (n++, false), (v) => v, SETTLE_OFFSETS_MS, sleep);
    expect(seen).toBe(false);
    expect(n).toBe(SETTLE_OFFSETS_MS.length);
    expect(waits.reduce((a, b) => a + b, 0)).toBe(20_000);
  });

  it("a read that throws is a miss, not the end", async () => {
    let n = 0;
    const { sleep } = fakeSleep();
    const seen = await readUntil(
      async () => {
        if (n++ === 0) throw new Error("rpc hiccup");
        return true;
      },
      (v) => v,
      SETTLE_OFFSETS_MS,
      sleep,
    );
    expect(seen).toBe(true);
    expect(n).toBe(2);
  });

  it("the first read happens at once", async () => {
    const { waits, sleep } = fakeSleep();
    expect(await readUntil(async () => true, (v) => v, SETTLE_OFFSETS_MS, sleep)).toBe(true);
    expect(waits).toEqual([]);
  });
});
