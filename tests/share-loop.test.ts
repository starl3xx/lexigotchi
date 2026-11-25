/**
 * The share loop (components/cards/loop; decisions: word cards, step 4): the card's turn, the same
 * every time; the back picture's route, which draws only dictionary words; and the rule that a
 * video in the game plays and rests (no `loop`: a page that never rests).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { LOOP_SECONDS, loopPose } from "@/components/cards/loop/loopRenderer";
import { showcaseBackPath } from "@/lib/showcase";

describe("the card's turn", () => {
  it("shows the scene, turns over, shows the back, and comes home", () => {
    expect(loopPose(0).turn).toBe(0); // the scene
    expect(loopPose(1.5).turn).toBe(0);
    expect(loopPose(3.3).turn).toBeCloseTo(180); // the back
    expect(loopPose(4.5).turn).toBeCloseTo(180);
    expect(loopPose(5.9).turn).toBeCloseTo(360); // the scene again
    expect(loopPose(LOOP_SECONDS).turn).toBe(0); // and round
  });

  it("is the same frame every time (the video is the same on every device)", () => {
    for (const t of [0.1, 2.25, 3.7, 5.05]) expect(loopPose(t)).toEqual(loopPose(t));
  });

  it("lifts the card as it turns, and rests it flat between", () => {
    expect(loopPose(2.25).lift).toBeGreaterThan(0.9);
    expect(loopPose(3.5).lift).toBeCloseTo(0);
  });
});

describe("the back picture", () => {
  it("lives beside the share card", () => {
    expect(showcaseBackPath("CRAne")).toBe("/s/CRAne/back");
  });

  it("draws only dictionary words (and the house cards), like the card", async () => {
    const { GET } = await import("@/app/s/[text]/back/route");
    const res = await GET(new Request("https://lexigotchi.test/s/zzzzz/back"), { params: Promise.resolve({ text: "zzzzz" }) });
    expect(res.status).toBe(404);
  });
});

describe("videos in the game", () => {
  const files = (p: string): string[] => (statSync(p).isDirectory() ? readdirSync(p).flatMap((f) => files(join(p, f))) : /\.tsx$/.test(p) ? [p] : []);
  it("never loop (each plays and rests)", () => {
    const bad = ["src/components/cards", "src/components/game"]
      .flatMap(files)
      .filter((f) => /<video\b[^>]*\bloop\b/s.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});
