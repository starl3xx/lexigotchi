/**
 * The first-day gate in the player's words (components/game/setGate.ts): every refusal the voucher
 * route can give has its own sentence, says when the word opens to everyone, and never blames the
 * word. The house copy rules cover the file (tests/copy-rules.test.ts).
 */
import { describe, it, expect } from "vitest";
import { gateLeft, gateRefusalNote } from "@/components/game/setGate";

const NOW = 1_800_000_000;
const UNTIL = NOW + 5 * 3600;

describe("how long until the gate lifts", () => {
  it("in hours, then minutes, then a moment", () => {
    expect(gateLeft(NOW + 23 * 3600, NOW)).toBe("about 23 hours");
    expect(gateLeft(NOW + 3600 + 1800, NOW)).toBe("about 2 hours");
    expect(gateLeft(NOW + 3600, NOW)).toBe("about 60 minutes");
    expect(gateLeft(NOW + 600, NOW)).toBe("about 10 minutes");
    expect(gateLeft(NOW + 60, NOW)).toBe("a moment");
    expect(gateLeft(NOW - 5, NOW)).toBe("a moment");
  });
  it("minutes up to an hour and a half, so it never says “about 1 hours”", () => {
    expect(gateLeft(NOW + 5399, NOW)).toBe("about 90 minutes");
    expect(gateLeft(NOW + 5400, NOW)).toBe("about 2 hours");
  });
});

describe("why a claim of a gated word was refused", () => {
  it("a second word: names the player's own word and when the rest open", () => {
    const n = gateRefusalNote("motel", { error: "limit_reached", words: ["CRANE"], limit: 1, until: UNTIL }, NOW, 0);
    expect(n.text).toBe("First day: one word per player from this set, and yours is CRANE. MOTEL opens to everyone in about 5 hours.");
    expect(n).toMatchObject({ tone: "info", openProfile: false });
  });
  it("a higher limit says the number", () => {
    const n = gateRefusalNote("MOTEL", { error: "limit_reached", words: ["CRANE", "GRAPE"], limit: 2, until: UNTIL }, NOW, 0);
    expect(n.text).toBe("First day: 2 words per player from this set, and you have yours. MOTEL opens to everyone in about 5 hours.");
  });
  it("an unverified player: what to link, and the profile opens", () => {
    for (const error of ["verification_required", "farcaster_wallet_unverified"]) {
      const n = gateRefusalNote("CRANE", { error, until: UNTIL }, NOW, 0);
      expect(n.text).toBe("First day: link Farcaster, X, or a Coinbase-verified wallet to claim from a new set. CRANE opens to everyone in about 5 hours.");
      expect(n.openProfile).toBe(true);
    }
  });
  it("an X account too new", () => {
    expect(gateRefusalNote("CRANE", { error: "x_too_young", until: UNTIL }, NOW, 0).text).toMatch(/^First day: your X account is too new/);
  });
  it("a wallet not shown to be the player's: sign in, and the profile opens", () => {
    const n = gateRefusalNote("CRANE", { error: "sign_in" }, NOW, UNTIL);
    expect(n.text).toBe("First day: sign in to your profile to show this wallet is yours, then claim CRANE again.");
    expect(n.openProfile).toBe(true);
  });
  it("somebody got there first", () => {
    expect(gateRefusalNote("CRANE", { error: "taken" }, NOW, UNTIL)).toEqual({ text: "CRANE was just claimed.", tone: "bad", openProfile: false });
  });
  it("anything the server couldn't check is 'try again', never 'not claimable'", () => {
    for (const error of ["try_again", "rate_limited", "verification_unavailable", "request_failed", "something_new"]) {
      const n = gateRefusalNote("CRANE", { error }, NOW, UNTIL);
      expect(n.text).toBe("Couldn’t get CRANE ready just now. Try again in a moment.");
      expect(n.tone).toBe("info");
    }
  });
  it("uses the gate's end the game already knows when the refusal carries none", () => {
    expect(gateRefusalNote("CRANE", { error: "limit_reached" }, NOW, NOW + 2 * 3600).text).toContain("in about 2 hours");
  });
});
