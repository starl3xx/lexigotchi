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
 *
 * Phases are scoped to their action: `run` hands the flow its OWN `phase` setter, and there is no
 * global one. After a Hide, an abandoned flow can wake up (a wallet answers late) and keep going,
 * and a global setter would then drive the status of whatever newer action is in flight.
 */

/** Where the action is: our own work, the wallet's prompt, or the chain after the wallet said yes. */
export type BusyPhase = "preparing" | "wallet" | "working";

export interface Busy {
  /** What the player asked for, as the pill says it: "Claiming HELLO". */
  label: string;
  phase: BusyPhase;
}

/** Moves one action's status. A no-op once that action has settled or been dismissed. */
export type SetPhase = (phase: BusyPhase) => void;

export interface ActionGate {
  current(): Busy | null;
  /**
   * Run one action under a status. `flow` gets this action's own phase setter. While another
   * action is in flight, `flow` does not run: `onRefused` hears the label of the one in flight and
   * `refused` comes back, so a second tap can never send a second transaction.
   */
  run<T>(
    label: string,
    flow: (phase: SetPhase) => Promise<T>,
    refused: T,
    onRefused?: (inFlight: string) => void,
  ): Promise<T>;
  /**
   * Hide the status and release the gate, for a request that never answers (a phone wallet left
   * unopened, a hung fetch). The flow itself keeps going; when it settles it no longer touches the status,
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
      const phase: SetPhase = (p) => {
        const now = live();
        if (now?.id !== id || now.busy.phase === p) return; // settled, dismissed, or unchanged
        set({ id, busy: { ...now.busy, phase: p } });
      };
      try {
        return await flow(phase);
      } finally {
        if (live()?.id === id) set(null);
      }
    },

    dismiss() {
      if (cur) set(null);
    },
  };
}
