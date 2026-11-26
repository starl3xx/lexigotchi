/**
 * A player's choice of reminders (lib/notify/kinds.ts, lib/db/reminderPrefs.ts): which kinds they
 * get, for every channel. The promises under test: a player who changes nothing gets what they got
 * before choices existed; a kind turned off is never sent; and choices that can't be read send
 * nothing, where a table that doesn't exist yet sends the defaults.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KIND_INFO, REMINDER_KINDS, changedFromDefaults, effectiveKinds, parseChoices, wantsKind } from "@/lib/notify/kinds";
import { prefsBookFrom } from "@/lib/db/reminderPrefs";

const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";

describe("the kinds", () => {
  it("every kind that existed before choices did is on by default: nothing changes for a player who changes nothing", () => {
    for (const k of ["hunger", "daily", "jackpot", "sold"] as const) expect(wantsKind(undefined, k)).toBe(true);
    expect(effectiveKinds(null)).toEqual({ hunger: true, daily: true, jackpot: true, sold: true });
  });

  it("each has words for its checkbox", () => {
    for (const k of REMINDER_KINDS) {
      expect(KIND_INFO[k].label.length).toBeGreaterThan(5);
      expect(KIND_INFO[k].hint.length).toBeGreaterThan(10);
    }
  });

  it("a choice wins over the default, kind by kind", () => {
    expect(wantsKind({ daily: false }, "daily")).toBe(false);
    expect(wantsKind({ daily: false }, "hunger")).toBe(true);
    expect(effectiveKinds({ daily: false, sold: false })).toEqual({ hunger: true, daily: false, jackpot: true, sold: false });
  });

  it("takes only known kinds with true or false from outside", () => {
    expect(parseChoices({ daily: false, hunger: true })).toEqual({ daily: false, hunger: true });
    // a kind from a newer build is dropped, not refused: its row must still read
    expect(parseChoices({ daily: false, someday: true })).toEqual({ daily: false });
    for (const bad of [null, undefined, "daily", 5, [], ["daily"], { daily: "no" }, { daily: 0 }, { hunger: null }]) expect(parseChoices(bad)).toBeNull();
  });

  it("stores only what differs from the defaults", () => {
    expect(changedFromDefaults({ daily: false, hunger: true, sold: true })).toEqual({ daily: false });
    expect(changedFromDefaults({ daily: true })).toEqual({});
  });
});

describe("the book of everyone’s choices", () => {
  const book = prefsBookFrom([
    { account: A.toUpperCase().replace("0X", "0x"), kinds: { daily: false } },
    { account: B, kinds: { sold: false, daily: true } },
  ]);

  it("answers by account, whatever the address’s case", () => {
    expect(book.wants(A, "daily")).toBe(false);
    expect(book.wants(A, "hunger")).toBe(true);
    expect(book.wants(B, "sold")).toBe(false);
    // an account with no row follows the defaults
    expect(book.wants("0x00000000000000000000000000000000000000cc", "daily")).toBe(true);
  });

  it("lists the accounts that chose a value, to find an opt-out without scanning every player", () => {
    expect(book.chose("daily", false)).toEqual([A]);
    expect(book.chose("daily", true)).toEqual([B]);
    expect(book.chose("hunger", false)).toEqual([]);
  });

  it("a stored row that isn’t choices at all reads as no choices", () => {
    expect(prefsBookFrom([{ account: A, kinds: "broken" }]).wants(A, "daily")).toBe(true);
  });

  it("refuses everything when the choices could not be read", () => {
    const blind = prefsBookFrom([], false);
    expect(blind.known).toBe(false);
    for (const k of REMINDER_KINDS) expect(blind.wants(A, k)).toBe(false);
    expect(blind.chose("daily", false)).toEqual([]);
  });
});

describe("loadPrefs", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock("@/lib/db/client"));
  const dbThatThrows = (err: unknown) =>
    vi.doMock("@/lib/db/client", () => ({
      getDb: () => ({
        select: () => ({
          from: async () => {
            throw err;
          },
        }),
      }),
    }));

  it("reads a missing table as the defaults: the migration hasn’t run, so nobody has chosen", async () => {
    dbThatThrows(Object.assign(new Error('relation "reminder_prefs" does not exist'), { code: "42P01" }));
    const book = await (await import("@/lib/db/reminderPrefs")).loadPrefs();
    expect(book.known).toBe(true);
    expect(book.wants(A, "hunger")).toBe(true);
  });

  it("reads any other failure as unknown, and sends nothing: someone may have turned a kind off", async () => {
    dbThatThrows(new Error("connection terminated"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const book = await (await import("@/lib/db/reminderPrefs")).loadPrefs();
    expect(book.known).toBe(false);
    expect(book.wants(A, "hunger")).toBe(false);
    quiet.mockRestore();
  });
});
