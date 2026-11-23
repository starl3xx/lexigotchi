/**
 * The in-progress status for a player action, from the tap to the last read, one at a time.
 *
 * Why it exists: between a tap and the wallet prompt the app does real work (a Merkle proof, a
 * signed voucher, chain reads, the chain check), and on a slow RPC or a cold server that takes
 * seconds. With nothing on screen, a tap looked ignored, and the natural answer to an ignored tap
 * is a second tap: on a paid action, a second commit. So every action runs through `run`, which
 * shows a status (the game's BusyPill) and refuses a second action while one is in flight.
 *
 * Pure (no React) so the rules are tested directly (tests/action-gate.test.ts). The provider owns
 * one gate and mirrors its state into React with `onChange`.
 */

/** Where the action is: our own work, the wallet's prompt, or the chain after the wallet said yes. */
export type BusyPhase = "preparing" | "wallet" | "working";

export interface Busy {
  /** What the player asked for, as the pill says it: "Claiming HELLO". */
  label: string;
  phase: BusyPhase;
}

export interface ActionGate {
  current(): Busy | null;
  /**
   * Run one action under a status. While another is in flight, `flow` does not run: `onRefused`
   * hears the label of the one in flight and `refused` comes back, so a second tap can never send
   * a second transaction.
   */
  run<T>(label: string, flow: () => Promise<T>, refused: T, onRefused?: (inFlight: string) => void): Promise<T>;
  /** Move the action in flight to a new phase. A no-op when nothing is in flight. */
  phase(phase: BusyPhase): void;
  /**
   * Hide the status and release the gate, for a wallet request that never answers (a phone wallet
   * left unopened). The flow itself keeps going; when it settles it no longer touches the status,
   * so it can't clear a newer action's.
   */
  dismiss(): void;
}

export function createActionGate(onChange: (busy: Busy | null) => void): ActionGate {
  let cur: { id: number; busy: Busy } | null = null;
  let seq = 0;
  const set = (next: { id: number; busy: Busy } | null) => {
    cur = next;
    onChange(next ? next.busy : null);
  };
  // Read through a call: after `if (cur) return`, TypeScript keeps `cur` narrowed to null across
  // the awaits below, though another action (or dismiss) may have changed it meanwhile.
  const live = () => cur;

  return {
    current: () => cur?.busy ?? null,

    async run(label, flow, refused, onRefused) {
      if (cur) {
        onRefused?.(cur.busy.label);
        return refused;
      }
      const id = ++seq;
      set({ id, busy: { label, phase: "preparing" } });
      try {
        return await flow();
      } finally {
        if (live()?.id === id) set(null);
      }
    },

    phase(phase) {
      if (!cur || cur.busy.phase === phase) return;
      set({ id: cur.id, busy: { ...cur.busy, phase } });
    },

    dismiss() {
      if (cur) set(null);
    },
  };
}
