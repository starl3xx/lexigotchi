/**
 * The note that today's free letter was claimed (src/lib/dailyNote.ts). Since the daily letter
 * comes by mail, which letter it was is the envelope's to say: it goes on the note when THAT
 * envelope is torn, and the note names its envelope so this survives a reload (Bugbot on #276).
 */
import { describe, it, expect } from "vitest";
import { awaitsLetter, dayOf, parseDailySeen, withDailyLetter, withDailyMail, type DailySeen } from "@/lib/dailyNote";

const note = (over: Partial<DailySeen> = {}): DailySeen => ({ day: 20784, idx: null, at: 1_795_700_000_000, ...over });
const reload = (seen: DailySeen | null) => parseDailySeen(JSON.stringify(seen));

describe("a stored note", () => {
  it("comes back as it was kept, with its envelope's number", () => {
    expect(reload(note({ mail: 190 }))).toEqual(note({ mail: 190 }));
    expect(reload(note({ mail: 190, idx: 20 }))).toEqual(note({ mail: 190, idx: 20 }));
  });

  it("a note from before letters came by mail has no envelope, and still reads", () => {
    expect(reload(note({ idx: 4 }))).toEqual(note({ idx: 4 }));
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
  it("goes on the note of the day it was pulled", () => {
    expect(withDailyMail(note(), 20784, 190)).toEqual(note({ mail: 190 }));
  });

  it("leaves another day's note alone, and no note stays no note", () => {
    const yesterday = note({ day: 20783 });
    expect(withDailyMail(yesterday, 20784, 190)).toBe(yesterday);
    expect(withDailyMail(null, 20784, 190)).toBeNull();
  });
});

describe("the letter, at the tear", () => {
  it("goes on the note that names that envelope", () => {
    expect(withDailyLetter(note({ mail: 190 }), 190, 20)).toEqual(note({ mail: 190, idx: 20 }));
  });

  it("after a reload too: the envelope waited, the page was closed, and it is torn the next visit", () => {
    const kept = reload(withDailyMail(note(), 20784, 190));
    expect(withDailyLetter(kept, 190, 20)).toEqual(note({ mail: 190, idx: 20 }));
  });

  it("another envelope (a pack, or an older daily) changes nothing", () => {
    const seen = note({ mail: 190 });
    expect(withDailyLetter(seen, 191, 3)).toBe(seen);
    expect(withDailyLetter(note(), 190, 3)).toEqual(note()); // a note that names no envelope
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

// Bugbot on #276, round two: an envelope opened from the card, or lost to a reload, must still
// end with its letter beside "claimed".
describe("a note that still waits for its letter", () => {
  it("is today's note with no letter on it", () => {
    expect(awaitsLetter(note(), 20784)).toBe(true);
    expect(awaitsLetter(note({ mail: 190 }), 20784)).toBe(true);
  });

  it("is not a note whose envelope was torn, another day's note, or no note", () => {
    expect(awaitsLetter(note({ idx: 20 }), 20784)).toBe(false);
    expect(awaitsLetter(note({ idx: 0 }), 20784)).toBe(false); // an "a" is a letter
    expect(awaitsLetter(note(), 20785)).toBe(false);
    expect(awaitsLetter(null, 20784)).toBe(false);
  });

  it("a daily opened from the card names itself on the note of the day it was committed", () => {
    // the commit's block time says which day it is; only that day's note learns it
    const day = dayOf(20784 * 86_400 + 3_600);
    expect(day).toBe(20784);
    expect(withDailyMail(note(), day, 190)).toEqual(note({ mail: 190 }));
    // yesterday's stranded letter, opened today, does not become today's
    expect(withDailyMail(note(), dayOf(20783 * 86_400 + 80_000), 150)).toEqual(note());
  });

  it("the day of a block time is the contract's: whole days since 1970, UTC", () => {
    expect(dayOf(0)).toBe(0);
    expect(dayOf(86_399)).toBe(0);
    expect(dayOf(86_400)).toBe(1);
    expect(dayOf(1_795_737_600n)).toBe(20784);
  });
});
