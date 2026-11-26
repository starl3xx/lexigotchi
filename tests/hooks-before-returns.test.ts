/**
 * A hook may never be called after a component's early return: when the condition flips while the
 * component is mounted, the hook count changes and React throws. The word's sheet did it (a word
 * leaves the bag while its sheet is open; Bugbot on #233). The project runs no linter, so this
 * holds the rule for the game's sheets, where "the thing this sheet is about has gone" is a
 * normal case.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "src/components/game/sheets";

/** Each top-level component's body: from `export function Name(` to the next line that is a lone `}`. */
function components(src: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /^(?:export )?function ([A-Z]\w*)\(/gm;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const end = src.indexOf("\n}\n", m.index);
    out.push({ name: m[1], body: src.slice(m.index, end < 0 ? undefined : end) });
  }
  return out;
}

describe("hooks stand above a component's early returns", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".tsx"));
  it("finds the sheets", () => {
    expect(files).toContain("WordSheet.tsx");
  });

  it.each(files)("%s", (file) => {
    for (const c of components(readFileSync(join(DIR, file), "utf8"))) {
      // an early return at the component's own indent: `  if (…) {` … `    return (` or `  if (…) return …;`
      const early = c.body.search(/\n  if \([^\n]*\) (?:return\b|\{\n    return\b)/);
      if (early < 0) continue;
      const after = c.body.slice(early);
      // a hook called at the component's own indent after that point (a hook inside a nested function is its own matter)
      const late = after.match(/\n  (?:const [^\n=]*= |)(use[A-Z]\w*)\(/);
      expect(late?.[1], `${file}: ${c.name} calls ${late?.[1]} after an early return`).toBeUndefined();
    }
  });
});
