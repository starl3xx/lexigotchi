/**
 * The in-progress status for player actions (src/lib/onchain/actionGate.ts). A tap must never look
 * ignored, and a second tap during the wait must never send a second transaction.
 */
import { describe, it, expect } from "vitest";
import { createActionGate, type Busy, type SetPhase } from "@/lib/onchain/actionGate";

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
    let phase!: SetPhase;
    const out = gate.run("Claiming HELLO", (p) => { phase = p; return d.promise; }, "refused");
    expect(gate.current()).toEqual({ label: "Claiming HELLO", phase: "preparing" });
    phase("wallet");
    phase("wallet"); // no repeat render for the same phase
    phase("working");
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

  it("an abandoned action that wakes up can't move a newer action's status (Bugbot on #106)", async () => {
    const { gate } = setup();
    const stuck = deferred<void>();
    let oldPhase!: SetPhase;
    void gate.run("Buying a pack", (p) => { oldPhase = p; p("wallet"); return stuck.promise; }, undefined);
    gate.dismiss(); // Hide: the wallet never answered

    const next = deferred<void>();
    let newPhase!: SetPhase;
    void gate.run("Staking HELLO", (p) => { newPhase = p; return next.promise; }, undefined);
    oldPhase("working"); // the old wallet answers late; its flow moves on
    oldPhase("wallet"); // and asks for its reveal
    expect(gate.current()).toEqual({ label: "Staking HELLO", phase: "preparing" });
    newPhase("wallet");
    expect(gate.current()).toEqual({ label: "Staking HELLO", phase: "wallet" });
    next.resolve();
    stuck.resolve();
  });

  it("a phase change after the action settled does nothing", async () => {
    const { gate, seen } = setup();
    let phase!: SetPhase;
    await gate.run("Feeding PIXEL", async (p) => { phase = p; }, undefined);
    const renders = seen.length;
    phase("working");
    expect(seen).toHaveLength(renders);
    expect(gate.current()).toBeNull();
  });
});
