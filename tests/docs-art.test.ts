/**
 * The player docs' pictures (docs-site/images/*.svg) are drawn from the game's own character rig by
 * scripts/docs-art.tsx. They are files, so they go stale when the rig changes and nobody reruns the
 * script: a nervous letter's sweat was flipped in the game and the docs' picture of a roll kept the
 * old bead until the owner saw it (2026-11-27: "the nervous sweat fix didn't get implemented
 * everywhere (docs, notably)").
 *
 * So this runs the script's own check: every picture must be what the rig draws now.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

describe("the player docs' pictures", () => {
  it("are what the rig draws now (after a change to the rig, run `npm run docs:art` and commit what it writes)", () => {
    const run = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/docs-art.tsx", "--check"], { encoding: "utf8", timeout: 150_000 });
    expect(`${run.stdout}${run.stderr}`.trim()).toMatch(/^up to date: \d+ images/);
    expect(run.status).toBe(0);
  }, 180_000);

  it("the roll's nervous letter throws its sweat point last, as the game's does", () => {
    // the bead's path starts at its point, which is its lowest part (tests/tile-character.test.tsx
    // holds the same of the game's letter); the old bead started at its top
    const roll = readFileSync("docs-site/images/roll.svg", "utf8");
    expect(roll).toContain("M 0 7 C 4 1 5 -3 0 -5 C -5 -3 -4 1 0 7 Z");
    expect(roll).not.toContain("M 0 -7 C 4 -1 5 3 0 5");
  });
});
