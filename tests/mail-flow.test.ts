/**
 * The mail's rules (src/components/game/mail/mailFlow.ts, decisions.md #49): the order letters come
 * out of an envelope in, what each one is to the player, and what the sheet says at each step.
 * The promise they keep: nothing is said before it is true, and the one letter worth waiting for
 * comes last.
 */
import { describe, it, expect } from "vitest";
import { LETTERS_BY_FREQUENCY } from "@/lib/economy";
import { QUICK_AFTER, bagWithMail, bestLine, caughtUp, countHead, countSub, finishers, hadFor, hadWithOwed, isRarest, mailNumber, mailNumberText, mailStatus, owedAfter, nextTearIsQuick, resetSitting, revealBeats, revealOrder, tagOf, type Mail } from "@/components/game/mail/mailFlow";

const idx = (ch: string) => ch.toLowerCase().charCodeAt(0) - 97;
const bag = (letters: string) => {
  const b = Array.from({ length: 26 }, () => 0);
  for (const ch of letters) b[idx(ch)]++;
  return b;
};
const pack = (letters: string) => [...letters].map(idx);
const names = (pulls: { idx: number }[]) => pulls.map((p) => String.fromCharCode(97 + p.idx)).join("");
const none = bag("");

describe("the mail's number", () => {
  it("is the commit id plus one: the contract counts from zero, and the first piece of mail is No. 1", () => {
    expect(mailNumber(0n)).toBe(1);
    expect(mailNumber(4511n)).toBe(4512);
    expect(mailNumberText(4512)).toBe("No. 4,512");
    expect(mailNumberText(7)).toBe("No. 7");
  });
});

describe("the order letters come out in", () => {
  it("plain letters keep the order the chain minted them in, and none is “best”", () => {
    const pulls = revealOrder(pack("esard"), bag("esard"));
    expect(names(pulls)).toBe("esard");
    expect(pulls.some((p) => p.best)).toBe(false);
  });

  it("a rare letter comes last, wherever the chain put it", () => {
    const pulls = revealOrder(pack("qesar"), none);
    expect(names(pulls)).toBe("esarq");
    expect(pulls[4]).toMatchObject({ rare: true, best: true });
  });

  it("a letter that finishes a word comes after the plain ones and before a rare one", () => {
    const pulls = revealOrder(pack("kqesr"), bag("funy"), new Map([[idx("k"), "FUNKY"]]));
    expect(names(pulls)).toBe("esrkq");
    expect(pulls[3]).toMatchObject({ finishes: "FUNKY", best: false });
    expect(pulls[4]).toMatchObject({ rare: true, best: true });
  });

  it("with no rare letter, the one that finishes a word is the best", () => {
    const pulls = revealOrder(pack("kesad"), bag("funy"), new Map([[idx("k"), "FUNKY"]]));
    expect(names(pulls)).toBe("esadk");
    expect(pulls[4]).toMatchObject({ finishes: "FUNKY", best: true, rare: false });
  });

  it("of two rare letters, the rarer is last", () => {
    const [rarest, second] = [LETTERS_BY_FREQUENCY[25], LETTERS_BY_FREQUENCY[24]].map((c) => c.toLowerCase());
    const pulls = revealOrder(pack(`${rarest}${second}e`), none);
    expect(names(pulls)).toBe(`e${second}${rarest}`);
    expect(isRarest(pulls[2].idx)).toBe(true);
    expect(isRarest(pulls[1].idx)).toBe(false);
  });

  it("“new” is a letter the bag held no copy of, and only its first copy in the piece", () => {
    const pulls = revealOrder(pack("ddea"), bag("e"));
    expect(pulls.map((p) => p.isNew)).toEqual([true, false, false, true]);
  });

  it("a second copy of a letter finishes nothing: the first did", () => {
    const pulls = revealOrder(pack("kke"), bag("funy"), new Map([[idx("k"), "FUNKY"]]));
    expect(pulls.filter((p) => p.finishes === "FUNKY")).toHaveLength(1);
  });

  it("a daily letter is one letter, and a rare one is still the best", () => {
    expect(revealOrder(pack("e"), none)).toMatchObject([{ best: false }]);
    expect(revealOrder(pack("q"), none)).toMatchObject([{ best: true, rare: true }]);
  });
});

describe("which letter finished a word", () => {
  it("is the one letter the bag was short of before (the game's one rule for “finishes”)", () => {
    expect(finishers(["FUNKY"], bag("funy"))).toEqual(new Map([[idx("k"), "FUNKY"]]));
  });

  it("a word that needed two of the pack's letters is finished by neither alone", () => {
    expect(finishers(["FUNKY"], bag("fun"))).toEqual(new Map());
  });

  it("a letter takes the first word in the caller's order (rarest first)", () => {
    const got = finishers(["JAZZY", "FUZZY"], bag("jazyfu"));
    expect(got).toEqual(new Map([[idx("z"), "JAZZY"]]));
  });

  it("a doubled letter counts: one z short of two", () => {
    expect(finishers(["FUZZY"], bag("fuzy"))).toEqual(new Map([[idx("z"), "FUZZY"]]));
    expect(finishers(["FUZZY"], bag("fuy"))).toEqual(new Map());
  });
});

describe("tags and lines", () => {
  const q = revealOrder(pack("q"), none)[0];
  const z = revealOrder(pack("z"), none)[0];
  const k = revealOrder(pack("k"), bag("funy"), new Map([[idx("k"), "FUNKY"]]))[0];
  const d = revealOrder(pack("d"), none)[0];
  const e = revealOrder(pack("e"), bag("e"))[0];

  it("a letter's tag: the word it finishes, else how rare it is, else that it is new, else none", () => {
    expect(tagOf(k)).toEqual({ text: "FUNKY", kind: "word" });
    expect(tagOf(q)).toEqual({ text: "rarest", kind: "rare" });
    expect(tagOf(z)).toEqual({ text: "rare", kind: "rare" });
    expect(tagOf(d)).toEqual({ text: "new", kind: "new" });
    expect(tagOf(e)).toBeNull();
  });

  it("a letter is written in its case (lowercase), with the right article", () => {
    expect(bestLine(q)).toBe("A q! The rarest letter in the game.");
    expect(bestLine(z)).toBe("A z! One of the rarest letters.");
    expect(bestLine(k)).toBe("A k: that finishes FUNKY.");
    expect(bestLine(revealOrder(pack("x"), none)[0])).toMatch(/^An x!/);
    expect(bestLine(e)).toBe("");
  });

  it("the count's headline names a rare letter, a daily letter, or the five", () => {
    expect(countHead(revealOrder(pack("esarq"), none))).toBe("A q came out.");
    expect(countHead(revealOrder(pack("e"), none))).toBe("It’s an e.");
    expect(countHead(revealOrder(pack("d"), none))).toBe("It’s a d.");
    expect(countHead(revealOrder(pack("esard"), none))).toBe("Five lowercase letters.");
  });

  it("how rare a letter is comes from the Mint's own numbers, and is not claimed without them", () => {
    const pulls = revealOrder(pack("esarq"), none);
    expect(countSub(pulls, { odds: "0.20%", packs: 100.4 })).toBe("The rarest letter: 0.20% of pulls, about one pack in 100.");
    expect(countSub(pulls, null)).toBe("The rarest letter in the game.");
    expect(countSub(pulls, { odds: "0%", packs: Infinity })).toBe("The rarest letter in the game.");
    expect(countSub(revealOrder(pack("esarz"), none), { odds: "0.45%", packs: 44.6 })).toBe("One of the rarest letters: 0.45% of pulls, about one pack in 45.");
  });

  it("a plain piece says where the letters are, and names a first", () => {
    expect(countSub(revealOrder(pack("esard"), bag("esar")))).toBe("All in your bag. The d is your first.");
    expect(countSub(revealOrder(pack("esar"), bag("esar")))).toBe("All in your bag.");
    expect(countSub(revealOrder(pack("e"), bag("e")))).toBe("It’s in your bag.");
  });

  it("several firsts are counted, never one of them named as if the rest weren't (a newcomer's first pack)", () => {
    // h, o, and l are new; the second and third o are copies in the same piece
    expect(countSub(revealOrder(pack("holoo"), none))).toBe("All in your bag. Three of them are new to you.");
    expect(countSub(revealOrder(pack("esard"), bag("esa")))).toBe("All in your bag. Two of them are new to you.");
    expect(countSub(revealOrder(pack("esard"), none))).toBe("All in your bag. All five are new to you.");
    // a first that also finishes a word is still a first
    expect(countSub(revealOrder(pack("kesad"), bag("funyesad"), new Map([[idx("k"), "FUNKY"]])))).toBe("All in your bag. The k is your first.");
  });
});

describe("the line under the envelope", () => {
  const base: Mail = { seq: 1, count: 5, free: false, phase: "wallet", number: null, letters: null, had: none, mine: true, torn: false };

  it("says only what is true at each step", () => {
    expect(mailStatus(base)).toBe("Confirm in your wallet.");
    expect(mailStatus({ ...base, phase: "paid" })).toBe("Paid. It’s in the mail.");
    expect(mailStatus({ ...base, phase: "found", number: 4512 })).toBe("No. 4,512 is yours. Minting your letters…");
    expect(mailStatus({ ...base, phase: "ready", number: 4512 })).toBe("They’re here. Tear along the top.");
  });

  it("a free pack is never “Paid”", () => {
    expect(mailStatus({ ...base, free: true, phase: "paid" })).toBe("It’s in the mail.");
    expect(mailStatus({ ...base, free: true, phase: "waiting" })).not.toMatch(/paid/i);
  });

  it("a daily letter is one letter", () => {
    expect(mailStatus({ ...base, count: 1, phase: "found", number: 9 })).toBe("No. 9 is yours. Minting your letter…");
    expect(mailStatus({ ...base, count: 1, phase: "ready" })).toBe("It’s here. Tear along the top.");
  });

  it("a pack that waits or is finishing says it is safe, and uses the note it was given", () => {
    expect(mailStatus({ ...base, phase: "waiting" })).toMatch(/paid for and safe onchain/);
    expect(mailStatus({ ...base, phase: "finishing" })).toMatch(/finishing onchain/);
    expect(mailStatus({ ...base, phase: "waiting", note: "A note." })).toBe("A note.");
  });
});

describe("when each letter comes out", () => {
  const plain = revealOrder(pack("esard"), bag("esard"));
  const withQ = revealOrder(pack("esarq"), none);

  it("every letter peeks, then comes out, in order, and the count shows after the last", () => {
    const { beats, done } = revealBeats(plain, false);
    expect(beats.map((b) => b.at)).toEqual([0, 1, 2, 3, 4]);
    for (const b of beats) expect(b.peek).toBeLessThan(b.out);
    for (let i = 1; i < beats.length; i++) expect(beats[i].peek).toBeGreaterThan(beats[i - 1].out);
    expect(done).toBeGreaterThan(beats[4].out);
  });

  it("the rare one is announced by a shake, and takes longer between its peek and its way out", () => {
    const { beats } = revealBeats(withQ, false);
    const q = beats[4];
    expect(q.shake).toBeDefined();
    expect(q.shake!).toBeLessThan(q.peek!);
    expect(q.out - q.peek!).toBeGreaterThan(beats[0].out - beats[0].peek!);
    expect(beats.slice(0, 4).every((b) => b.shake === undefined)).toBe(true);
  });

  it("the short version: plain letters come straight out, close together, and the best one still peeks", () => {
    const slow = revealBeats(withQ, false);
    const quick = revealBeats(withQ, true);
    expect(quick.beats.slice(0, 4).every((b) => b.peek === undefined)).toBe(true);
    expect(quick.beats[4].peek).toBeDefined();
    expect(quick.done).toBeLessThan(slow.done);
    expect(QUICK_AFTER).toBeGreaterThanOrEqual(2);
  });

  it("the short version starts after a few envelopes in one sitting, and a new sitting starts over", () => {
    resetSitting();
    const sitting = Array.from({ length: QUICK_AFTER + 2 }, () => nextTearIsQuick());
    expect(sitting).toEqual([...Array.from({ length: QUICK_AFTER }, () => false), true, true]);
    resetSitting();
    expect(nextTearIsQuick()).toBe(false);
    resetSitting();
  });

  it("the TENTH envelope of a sitting is the first short one (the owner's number)", () => {
    // starl3xx, 2026-11-27: "yes, move it to the 10th pack". It was the fourth, my own default.
    resetSitting();
    const sitting = Array.from({ length: 12 }, () => nextTearIsQuick());
    expect(sitting.indexOf(true) + 1).toBe(10);
    expect(sitting.slice(0, 9).some(Boolean)).toBe(false);
    expect(sitting.slice(9).every(Boolean)).toBe(true);
    resetSitting();
  });
});

describe("the bag as the chain has it", () => {
  // The game's read of the bag is often seconds behind a reveal, and the tear comes inside them.
  it("is what the bag held plus the piece's letters, when the read hasn't caught up", () => {
    const had = bag("funy");
    expect(bagWithMail(had, had, pack("kke"))).toEqual(bag("funykke"));
  });

  it("never lowers a count the read already shows", () => {
    // the read has caught up, and the player was given another e meanwhile
    expect(bagWithMail(bag("funykee"), bag("funy"), pack("ke"))).toEqual(bag("funykee"));
  });

  it("so a letter that finishes a word is known at the tear, with the bag's read still behind", () => {
    const had = bag("funy");
    const letters = pack("kesad");
    const stale = had; // the read shows none of the pack yet
    const after = bagWithMail(stale, had, letters);
    // FUNKY needs the k: spellable from the bag as the chain has it, not from the stale read
    for (const ch of "funky") expect(after[idx(ch)]).toBeGreaterThan(0);
    expect(stale[idx("k")]).toBe(0);
    expect(revealOrder(letters, had, finishers(["FUNKY"], had))[4]).toMatchObject({ finishes: "FUNKY", best: true });
  });
});

describe("what the bag held before a new piece, when its read is behind the last one", () => {
  const had = bag("funy");
  const owed = bagWithMail(had, had, pack("kesad")); // what the last piece left in the bag

  it("is never less than what the last piece left: its letters are not new again", () => {
    // "Rip another" seconds later, and the read still shows the bag from before the last piece
    const before = hadWithOwed(had, owed);
    expect(before).toEqual(owed);
    // the next piece brings another d: not the player's first
    expect(revealOrder(pack("d"), before)[0].isNew).toBe(false);
    // from the stale read it would have been called new
    expect(revealOrder(pack("d"), had)[0].isNew).toBe(true);
  });

  it("is the read itself once nothing is owed", () => {
    expect(hadWithOwed(bag("funykesad"), null)).toEqual(bag("funykesad"));
  });

  it("the read has caught up when it shows every owed letter, and not before", () => {
    expect(caughtUp(had, owed)).toBe(false);
    expect(caughtUp(bag("funykesa"), owed)).toBe(false);
    expect(caughtUp(bag("funykesad"), owed)).toBe(true);
    expect(caughtUp(bag("funykesadzz"), owed)).toBe(true);
  });

  it("errs safe when a letter was spent meanwhile: it counts high, and a high count names nothing as new", () => {
    // the player claimed FUNKY (its letters left the bag) and the read shows that
    const spent = bag("esad");
    const before = hadWithOwed(spent, owed);
    expect(before[idx("k")]).toBe(1);
    expect(revealOrder(pack("k"), before)[0].isNew).toBe(false);
  });
});

// Bugbot on #273: a pack opened for a LINKED wallet mints to that wallet, and "new" was still
// measured from the connected wallet's bag.
describe("what “new” is measured from", () => {
  it("is what the bag held before, for a piece that is this wallet's", () => {
    const had = bag("esa");
    expect(hadFor({ mine: true, had })).toBe(had);
    expect(revealOrder(pack("esard"), hadFor({ mine: true, had })).map((p) => p.isNew)).toEqual([false, false, false, true, true]);
  });

  it("calls nothing new when the letters went to another wallet, whatever this wallet holds", () => {
    const pulls = revealOrder(pack("esarq"), hadFor({ mine: false, had: none }));
    expect(pulls.some((p) => p.isNew)).toBe(false);
    expect(pulls.map((p) => tagOf(p)?.kind).filter(Boolean)).toEqual(["rare"]);
    // rare is still rare: that is about the letter, not about the bag
    expect(pulls[4]).toMatchObject({ rare: true, best: true });
  });

  it("calls nothing new for mail opened late: the bag read then may count its letters already", () => {
    // The pack was open before the card asked for it, and the bag has caught up: `had` holds the
    // pack's own k. Counted again, a second k would be said to finish a word that needs two.
    const had = bag("funyk");
    const pulls = revealOrder(pack("kesad"), hadFor({ mine: true, had, plain: true }));
    expect(pulls.some((p) => p.isNew)).toBe(false);
    // the same piece, when what it held before IS known, says what is new
    expect(revealOrder(pack("kesad"), hadFor({ mine: true, had: bag("funy") })).filter((p) => p.isNew)).toHaveLength(5);
  });
});

// Bugbot on #276: pieces can settle out of order (a daily letter found minutes late).
describe("what is owed after a piece is revealed", () => {
  it("is what the bag held plus the piece's letters, when nothing else is owed", () => {
    expect(owedAfter(bag("funy"), pack("ke"), null)).toEqual(bag("funyke"));
  });

  it("is never lowered by an older piece that settles late", () => {
    // a pack was opened after the daily was sent: the bag is owed its five letters
    const afterPack = bag("funyesard");
    // the daily, found minutes later, still carries the bag from BEFORE the pack
    const late = owedAfter(bag("funy"), pack("k"), afterPack);
    for (const ch of "esard") expect(late[idx(ch)]).toBeGreaterThanOrEqual(afterPack[idx(ch)]);
    expect(late[idx("k")]).toBe(1);
    // so the next envelope does not call the pack's letters new again
    expect(revealOrder(pack("d"), hadWithOwed(bag("funy"), late))[0].isNew).toBe(false);
  });

  it("a newer piece raises it as before", () => {
    expect(owedAfter(bag("funyk"), pack("zz"), bag("funyk"))).toEqual(bag("funykzz"));
  });
});
