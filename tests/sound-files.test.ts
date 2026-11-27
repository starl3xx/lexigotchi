/**
 * The mail's sound files (decisions.md #49, part 4; public/sfx/mail/).
 *
 * The build asks only whether `drop.mp3` is there before it offers the Sound switch
 * (next.config.mjs), so a cue whose file is missing would be silent with nothing said. And each
 * file is the take the owner chose by ear: a file swapped by accident would sound in every pack
 * before anyone noticed. So every cue has a file, each file is the chosen take, and nothing else
 * sits in the folder. A new or changed sound changes this list in the same PR, with his word.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CUES, cueUrl, type Cue } from "@/lib/sound";

const DIR = join(__dirname, "..", "public", "sfx", "mail");

/** The first 12 hex digits of each chosen take's SHA-256, as decisions.md records them. */
const TAKES: Record<Cue, string> = {
  drop: "81d6dda2b38f",
  stamp: "9dd088eb3d7b",
  postmark: "d88493fade0a",
  rustle: "904d9bf8a324",
  tear: "01925566caec",
  hop: "88e143a9d884",
  rare: "5f0d76e1fc1a",
  word: "9b04df2872e3",
};

describe("the mail's sound files", () => {
  it("every cue has its file, where the game asks for it", () => {
    for (const cue of CUES) {
      expect(cueUrl(cue)).toBe(`/sfx/mail/${cue}.mp3`);
      expect(existsSync(join(DIR, `${cue}.mp3`)), `${cue}.mp3`).toBe(true);
    }
  });

  it("each file is the take the owner chose", () => {
    for (const cue of CUES) {
      const sha = createHash("sha256").update(readFileSync(join(DIR, `${cue}.mp3`))).digest("hex");
      expect(sha.slice(0, 12), `${cue}.mp3`).toBe(TAKES[cue]);
    }
  });

  it("the folder holds the eight cues and nothing else", () => {
    expect(readdirSync(DIR).sort()).toEqual(CUES.map((c) => `${c}.mp3`).sort());
  });

  it("they stay small: a player who turns sound on fetches all eight at once", () => {
    const total = CUES.reduce((sum, cue) => sum + readFileSync(join(DIR, `${cue}.mp3`)).length, 0);
    expect(total).toBeLessThan(150_000);
  });
});
