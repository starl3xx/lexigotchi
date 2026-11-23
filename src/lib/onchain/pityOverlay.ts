/**
 * The pity the player just earned, shown before the chain read catches up.
 *
 * A roll's outcome is known the moment the server signs it, but the pity READ that follows comes
 * from a public RPC, which routinely answers with the pre-reveal state. A tester missed a roll,
 * approved both transactions, saw the same odds as before, and concluded nothing had happened. So
 * the provider notes the value it knows, and this overlay shows it until the chain agrees, or for
 * at most `HOLD_MS` (after that the chain is trusted, even if it still disagrees).
 *
 * Only a MISS is known: it sets pity to exactly `pityAtCommit + 1` (Rolls allows one open roll per
 * letter, so nothing moves it between commit and reveal). A hit usually resets it to 0, but a
 * signed success that no longer applies at reveal (the letter was spent, the slot raised) leaves it
 * unchanged, and the client can't tell which. So a hit waits for the read (Bugbot on #110). Notes
 * are filed per wallet by the caller, so a wallet switch never shows one wallet's note over
 * another's pity.
 *
 * Pure, so the rules are tested directly (tests/pity-overlay.test.ts).
 */

/** Longest a known value overrides the chain. Reads catch up within seconds; this is a backstop. */
export const HOLD_MS = 60_000;

export interface PityNote {
  /** Pity the reveal set on chain for this letter. */
  value: number;
  /** When it was noted (ms). */
  at: number;
}

/**
 * The pity a resolved roll is KNOWN to leave on chain for its letter, or null when only the chain
 * can say (a hit: see the header).
 */
export function knownPityAfter(success: boolean, pityAtCommit: number): number | null {
  return success ? null : pityAtCommit + 1;
}

/** The chain's pity per letter, with each fresh note laid over it. Never mutates the input. */
export function overlayPity(chain: readonly number[], notes: Readonly<Record<number, PityNote>>, now: number): number[] {
  const out = [...chain];
  for (const [k, note] of Object.entries(notes)) {
    const i = Number(k);
    if (i < 0 || i >= out.length || now - note.at > HOLD_MS) continue;
    out[i] = note.value;
  }
  return out;
}

/** Drop the notes the chain now agrees with, or that have aged out. Returns the same object when nothing changes. */
export function pruneNotes(
  chain: readonly number[],
  notes: Readonly<Record<number, PityNote>>,
  now: number,
): Readonly<Record<number, PityNote>> {
  let changed = false;
  const kept: Record<number, PityNote> = {};
  for (const [k, note] of Object.entries(notes)) {
    const i = Number(k);
    if (chain[i] === note.value || now - note.at > HOLD_MS) {
      changed = true;
      continue;
    }
    kept[i] = note;
  }
  return changed ? kept : notes;
}
