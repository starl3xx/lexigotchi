/**
 * The pity a player just earned shows at once, before a lagging chain read
 * (src/lib/onchain/pityOverlay.ts). A miss that shows the old odds reads as "nothing happened".
 */
import { describe, it, expect } from "vitest";
import { HOLD_MS, knownPityAfter, overlayPity, pruneNotes } from "@/lib/onchain/pityOverlay";

const chain = (pity: Record<number, number>) => Array.from({ length: 26 }, (_, i) => pity[i] ?? 0);

describe("knownPityAfter", () => {
  it("knows a miss exactly: Rolls.reveal writes one more than the commit's pity", () => {
    expect(knownPityAfter(false, 0)).toBe(1);
    expect(knownPityAfter(false, 3)).toBe(4);
  });

  it("doesn't guess a hit: a stale signed success leaves pity unchanged on chain (Bugbot on #110)", () => {
    expect(knownPityAfter(true, 3)).toBeNull();
  });
});

describe("overlayPity", () => {
  it("shows the noted value while the chain read is still the old one", () => {
    const stale = chain({ 4: 2 });
    const shown = overlayPity(stale, { 4: { value: 3, at: 1_000 } }, 2_000);
    expect(shown[4]).toBe(3);
    expect(stale[4]).toBe(2); // input untouched
  });

  it("shows a hit's reset to 0 over a stale nonzero read", () => {
    expect(overlayPity(chain({ 0: 5 }), { 0: { value: 0, at: 0 } }, 10)[0]).toBe(0);
  });

  it("trusts the chain again once the note is older than the hold", () => {
    expect(overlayPity(chain({ 4: 2 }), { 4: { value: 3, at: 0 } }, HOLD_MS + 1)[4]).toBe(2);
  });
});

describe("pruneNotes", () => {
  it("drops a note the chain now agrees with, keeps one it doesn't yet", () => {
    const notes = { 4: { value: 3, at: 0 }, 7: { value: 1, at: 0 } };
    const kept = pruneNotes(chain({ 4: 3, 7: 0 }), notes, 100);
    expect(Object.keys(kept)).toEqual(["7"]);
  });

  it("drops aged-out notes, and returns the same object when nothing changes", () => {
    const notes = { 4: { value: 3, at: 0 } };
    expect(pruneNotes(chain({ 4: 2 }), notes, 100)).toBe(notes);
    expect(pruneNotes(chain({ 4: 2 }), notes, HOLD_MS + 1)).toEqual({});
  });
});
