/**
 * The database migrations (drizzle/) apply in order, and none is silently skipped.
 *
 * `drizzle-kit migrate` applies a migration only if its journal `when` is later than the newest
 * migration the database has recorded, and it says "migrations applied successfully" either way. So
 * a migration dated earlier than the one before it never runs: on 2026-11-24 the scenes migration
 * (then 0009, dated that day) came after main's 0009, which was dated a day ahead, and production
 * skipped it. Two branches that each add the next number end up like that after a merge; this test
 * fails on it instead. Dates may run ahead of the clock (main's do), so a new migration's `when` is
 * set by hand after the last one when needed.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import journal from "../drizzle/meta/_journal.json";

const DIR = join(__dirname, "..", "drizzle");

describe("drizzle migrations", () => {
  const entries = journal.entries;

  it("are numbered 0, 1, 2, … once each, and every one has its SQL file and snapshot", () => {
    entries.forEach((e, i) => {
      expect(e.idx).toBe(i);
      expect(e.tag.startsWith(String(i).padStart(4, "0") + "_")).toBe(true);
      expect(existsSync(join(DIR, `${e.tag}.sql`))).toBe(true);
      expect(existsSync(join(DIR, "meta", `${e.tag.slice(0, 4)}_snapshot.json`))).toBe(true);
    });
  });

  it("are dated strictly later than the one before, or migrate would skip them", () => {
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].when, `${entries[i].tag} must be dated after ${entries[i - 1].tag}`).toBeGreaterThan(entries[i - 1].when);
    }
  });
});
