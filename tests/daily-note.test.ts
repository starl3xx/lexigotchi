/**
 * The note that today's free letter was claimed (src/lib/dailyNote.ts). The letter is on the note
 * from the send. Since the daily letter comes by mail, saying which letter is the envelope's, and
 * that is a DISPLAY rule: the tile is hidden while a sealed one-letter envelope stands in this
 * browser, and shows otherwise. So nothing has to "find its envelope": an envelope lost to a reload
 * costs the ceremony only (Bugbot on #276 took five rounds on the other design).
 */
import { describe, it, expect } from "vitest";
import { dailySealed, parseDailySeen, withDailyLetter, withDailyMail, type DailySeen } from "@/lib/dailyNote";

const note = (over: Partial<DailySeen> = {}): DailySeen => ({ day: 20784, idx: null, at: 1_795_700_000_000, ...over });
const reload = (seen: DailySeen | null) => parseDailySeen(JSON.stringify(seen));

describe("a stored note", () => {
  it("comes back as it was kept, with its letter and its envelope's number", () => {
    expect(reload(note({ idx: 20 }))).toEqual(note({ idx: 20 }));
    expect(reload(note({ idx: 20, mail: 190 }))).toEqual(note({ idx: 20, mail: 190 }));
  });

  it("a note with no letter reads too: the letter is simply not known here (no bundle)", () => {
    expect(reload(note())).toEqual(note());
    expect("mail" in (reload(note()) as DailySeen)).toBe(false);
  });

  it("anything else is no note", () => {
    for (const raw of [null, undefined, "", "null", "not json", "{}", JSON.stringify({ day: "today", at: 1 }), JSON.stringify({ day: 1 })]) expect(parseDailySeen(raw)).toBeNull();
  });

  it("drops an envelope number that isn't one", () => {
    for (const mail of [0, -3, 1.5, "190", null]) expect("mail" in (parseDailySeen(JSON.stringify({ ...note(), mail })) as DailySeen)).toBe(false);
  });
});

describe("naming the envelope", () => {
  it("goes on the note of the day it was pulled, and keeps the letter it had", () => {
    expect(withDailyMail(note({ idx: 20 }), 20784, 190)).toEqual(note({ idx: 20, mail: 190 }));
  });

  it("leaves another day's note alone, and no note stays no note", () => {
    const yesterday = note({ day: 20783 });
    expect(withDailyMail(yesterday, 20784, 190)).toBe(yesterday);
    expect(withDailyMail(null, 20784, 190)).toBeNull();
  });
});

describe("the letter the chain minted, at the tear", () => {
  it("is written over the one the send was made with, on the note that names that envelope", () => {
    expect(withDailyLetter(note({ idx: 20, mail: 190 }), 190, 4)).toEqual(note({ idx: 4, mail: 190 }));
    expect(withDailyLetter(note({ mail: 190 }), 190, 4)).toEqual(note({ idx: 4, mail: 190 }));
  });

  it("another envelope (a pack, or an older daily) changes nothing", () => {
    const seen = note({ idx: 20, mail: 190 });
    expect(withDailyLetter(seen, 191, 3)).toBe(seen);
    expect(withDailyLetter(note({ idx: 20 }), 190, 3)).toEqual(note({ idx: 20 })); // a note that names no envelope
    expect(withDailyLetter(null, 190, 3)).toBeNull();
  });

  it("never stamps the note again: tearing yesterday's envelope today does not claim today's letter", () => {
    const yesterday = note({ day: 20783, at: 1_795_600_000_000, mail: 150 });
    const torn = withDailyLetter(yesterday, 150, 7) as DailySeen;
    expect(torn.day).toBe(20783);
    expect(torn.at).toBe(1_795_600_000_000);
    expect(torn.idx).toBe(7);
  });
});

describe("is today's letter still sealed in an envelope here?", () => {
  const nothing = { hand: null, kept: [], open: [], mail: undefined };
  const hand = (over: Partial<{ count: number; torn: boolean; phase: string; number: number | null }> = {}) => ({ count: 1, torn: false, phase: "ready", number: 190, ...over });

  it("no envelope stands: the tile shows (a reload mid-way, another browser, a torn envelope)", () => {
    expect(dailySealed(nothing)).toBe(false);
    expect(dailySealed({ ...nothing, hand: hand({ torn: true }) })).toBe(false);
  });

  it("in hand, on its way or waiting to be torn: sealed", () => {
    for (const phase of ["wallet", "paid", "found", "ready"]) expect(dailySealed({ ...nothing, hand: hand({ phase, number: phase === "ready" || phase === "found" ? 190 : null }) })).toBe(true);
  });

  it("a piece stuck on “waiting” or “finishing” does not hide the tile: nothing may ever come of it", () => {
    expect(dailySealed({ ...nothing, hand: hand({ phase: "waiting", number: null }) })).toBe(false);
    expect(dailySealed({ ...nothing, hand: hand({ phase: "finishing" }) })).toBe(false);
  });

  it("a pack in hand is not the daily letter", () => {
    expect(dailySealed({ ...nothing, hand: hand({ count: 5 }) })).toBe(false);
  });

  it("kept as mail here, never torn: sealed, and a kept pack is not", () => {
    expect(dailySealed({ ...nothing, kept: [{ number: 190, letters: [4] }] })).toBe(true);
    expect(dailySealed({ ...nothing, kept: [{ number: 191, letters: [4, 3, 2, 1, 0] }] })).toBe(false);
  });

  it("a one-letter commit of this wallet's still to be opened: sealed (the card shows it)", () => {
    expect(dailySealed({ ...nothing, open: [{ count: 1, mine: true }] })).toBe(true);
    expect(dailySealed({ ...nothing, open: [{ count: 5, mine: true }] })).toBe(false);
    // a linked wallet's daily is not this wallet's letter
    expect(dailySealed({ ...nothing, open: [{ count: 1, mine: false }] })).toBe(false);
  });

  it("when the note names its envelope, an OLDER daily letter still unopened does not hide today's", () => {
    // yesterday's envelope (No. 150) is still kept; today's (No. 190) was torn
    expect(dailySealed({ ...nothing, kept: [{ number: 150, letters: [7] }], mail: 190 })).toBe(false);
    expect(dailySealed({ ...nothing, hand: hand({ number: 150 }), mail: 190 })).toBe(false);
    // today's own, kept or in hand, does
    expect(dailySealed({ ...nothing, kept: [{ number: 150, letters: [7] }, { number: 190, letters: [4] }], mail: 190 })).toBe(true);
    expect(dailySealed({ ...nothing, hand: hand({ number: 190 }), mail: 190 })).toBe(true);
  });

  it("a piece on its way has no number yet, and it is today's", () => {
    expect(dailySealed({ ...nothing, hand: hand({ phase: "paid", number: null }), mail: undefined })).toBe(true);
    // a note that already names an envelope, with a NEW piece on its way, cannot be about that piece
    // (one daily a day), but an unnumbered piece is never mistaken for an old one
    expect(dailySealed({ ...nothing, hand: hand({ phase: "paid", number: null }), mail: 190 })).toBe(true);
  });
});
