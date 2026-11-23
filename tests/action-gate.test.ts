/**
 * The in-progress status for player actions (src/lib/onchain/actionGate.ts). A tap must never look
 * ignored, and a second tap during the wait must never send a second transaction.
 */
import { describe, it, expect } from "vitest";
import { createActionGate, type Busy } from "@/lib/onchain/actionGate";

function setup() {
  const seen: (Busy | null)[] = [];
  const gate = createActionGate((b) => seen.push(b));
  return { gate, seen };
}

/** A flow the test finishes by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("createActionGate", () => {
  it("shows the action from the tap, follows its phases, and clears when it settles", async () => {
    const { gate, seen } = setup();
    const d = deferred<string>();
    const out = gate.run("Claiming HELLO", () => d.promise, "refused");
    expect(gate.current()).toEqual({ label: "Claiming HELLO", phase: "preparing" });
    gate.phase("wallet");
    gate.phase("wallet"); // no repeat render for the same phase
    gate.phase("working");
    d.resolve("done");
    expect(await out).toBe("done");
    expect(gate.current()).toBeNull();
    expect(seen.map((b) => b?.phase ?? null)).toEqual(["preparing", "wallet", "working", null]);
  });

  it("refuses a second action while one is in flight, without running it", async () => {
    const { gate } = setup();
    const d = deferred<void>();
    void gate.run("Buying a pack", () => d.promise, undefined);
    let ran = false;
    let heard = "";
    const second = await gate.run("Buying a pack", async () => { ran = true; return "sent"; }, "refused", (l) => { heard = l; });
    expect(second).toBe("refused");
    expect(ran).toBe(false);
    expect(heard).toBe("Buying a pack");
    d.resolve();
  });

  it("clears on a failure too, so one error doesn't lock every later tap", async () => {
    const { gate } = setup();
    await expect(gate.run("Feeding PIXEL", async () => { throw new Error("rpc down"); }, undefined)).rejects.toThrow("rpc down");
    expect(gate.current()).toBeNull();
    expect(await gate.run("Feeding PIXEL", async () => "ok", "refused")).toBe("ok");
  });

  it("dismiss releases the gate, and the old flow settling later can't clear a newer action", async () => {
    const { gate } = setup();
    const stuck = deferred<void>();
    void gate.run("Claiming HELLO", () => stuck.promise, undefined); // a wallet that never answers
    gate.dismiss();
    expect(gate.current()).toBeNull();

    const next = deferred<void>();
    void gate.run("Staking HELLO", () => next.promise, undefined);
    stuck.resolve(); // the abandoned request finally comes back
    await Promise.resolve();
    await Promise.resolve();
    expect(gate.current()?.label).toBe("Staking HELLO");
    next.resolve();
  });

  it("ignores a phase change with nothing in flight", () => {
    const { gate, seen } = setup();
    gate.phase("wallet");
    expect(seen).toEqual([]);
  });
});
