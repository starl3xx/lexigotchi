/**
 * The cards are matte (decisions.md #58). starl3xx, 2026-11-27: "the cards have *reflections* but
 * they shouldn't be super *shiny* -- the cards are matte finish in videos and all outputs and UI
 * locations... and the effect(s) we use to achieve these should be, yes, “Neo-Victorian engraving
 * illustration: ruled linework in ink, on paper.”"
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { VEIL, loopPose, LOOP_SECONDS } from "@/components/cards/loop/loopRenderer";

const read = (p: string) => readFileSync(p, "utf8");

describe("the share video (part 1: \"14A is good\")", () => {
  const src = read("src/components/cards/loop/loopRenderer.ts");

  it("crosses the card with a veil, never with white added to it", () => {
    // a veil: what is left of the dark is scaled down, so no ink can pass the paper (white stays white, black lifts a tenth)
    expect(src).toContain("col = 1.0 - (1.0 - col) * (1.0 - g * ${VEIL.toFixed(2)});");
    expect(src).not.toMatch(/col \+= g/);
    expect(src).not.toMatch(/\* 0\.55/);
  });

  it("is faint: under a fifth of the glare it replaced", () => {
    expect(VEIL).toBeLessThanOrEqual(0.1);
    expect(VEIL / 0.55).toBeLessThan(0.2);
    // the veil at its strongest lifts black to a tenth grey, and leaves white as it is
    const lift = (c: number, g: number) => 1 - (1 - c) * (1 - g * VEIL);
    expect(lift(0, 1)).toBeCloseTo(VEIL, 5);
    expect(lift(1, 1)).toBe(1);
  });

  it("still crosses when it did: the light's path is unchanged", () => {
    expect(loopPose(0.9).glare).toBeCloseTo(1, 5);
    expect(loopPose(0).glare).toBeCloseTo(loopPose(LOOP_SECONDS).glare, 5);
  });
});
