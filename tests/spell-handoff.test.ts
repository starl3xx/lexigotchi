/**
 * The Dictionary's hand-off to Spell (components/game/spellHandoff; decisions.md #31): a word waits
 * between the tap and Spell mounting, and is taken exactly once. And the Dictionary itself must not
 * grow a claim path: one place claims.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { queueSpell, takeQueuedSpell } from "@/components/game/spellHandoff";

describe("handing a word to Spell", () => {
  it("gives the word once, then nothing", () => {
    expect(takeQueuedSpell()).toBeNull();
    queueSpell("bingo");
    expect(takeQueuedSpell()).toBe("BINGO");
    expect(takeQueuedSpell()).toBeNull();
  });

  it("keeps only the latest word", () => {
    queueSpell("BINGO");
    queueSpell("ABOUT");
    expect(takeQueuedSpell()).toBe("ABOUT");
    expect(takeQueuedSpell()).toBeNull();
  });
});

describe("one place claims", () => {
  const read = (f: string) => readFileSync(f, "utf8");

  it("the Dictionary and its word view never call claim", () => {
    for (const f of ["src/components/game/screens/DictionaryScreen.tsx", "src/components/game/sheets/LookupSheet.tsx", "src/components/game/useDictionary.ts"]) {
      expect(read(f), f).not.toMatch(/\bg\.claim\(|\.claim\(/);
    }
  });

  it("Spell takes the queued word on arrival", () => {
    const spell = read("src/components/game/screens/ClaimScreen.tsx");
    expect(spell).toContain("takeQueuedSpell()");
    // and only loads it when these letters still spell it
    expect(spell).toMatch(/takeQueuedSpell\(\);\s*\n\s*if \(!w \|\| !canSpell\(w, lower, upper\)\) return;/);
  });

  it("the list draws flat tiles, never the letter characters (80 words a page)", () => {
    const list = read("src/components/game/screens/DictionaryScreen.tsx");
    expect(list).toContain("<MiniTiles");
    expect(list).not.toMatch(/TileCharacter|TileWord|WordTiles/);
  });
});
