// @vitest-environment jsdom
/**
 * Mail that arrived and was never torn open, kept in the browser (src/lib/mailbox.ts, decisions.md
 * #49). It is ceremony only: the letters are in the bag whatever this list holds. So the rule that
 * matters is that nothing here can throw or invent: a value it can't read is "no unopened mail".
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MAILBOX_MAX, mailboxKey, parseMailbox, readMailbox, withMail, withoutMail, writeMailbox, type UnopenedMail } from "@/lib/mailbox";

const bag = Array.from({ length: 26 }, () => 0);
const piece = (number: number, letters = [17, 8, 3, 3, 0]): UnopenedMail => ({ number, letters, had: bag, at: 1_764_000_000_000 + number });

describe("the key", () => {
  it("names the chain, the Letters contract, and the wallet, in one letter case", () => {
    expect(mailboxKey(84532, "0xB6E3B233Ff7cEB709f20A36FA947a53E47e600CC", "0x0Fc0F78fc939606db65F5BBF2F3715262C0b2F6E")).toBe(
      "lexi-mail:84532:0xb6e3b233ff7ceb709f20a36fa947a53e47e600cc:0x0fc0f78fc939606db65f5bbf2f3715262c0b2f6e",
    );
  });

  it("a redeployed contract is another mailbox: commit numbers start again", () => {
    expect(mailboxKey(84532, "0xaaa", "0x1")).not.toBe(mailboxKey(84532, "0xbbb", "0x1"));
    expect(mailboxKey(84532, "0xaaa", "0x1")).not.toBe(mailboxKey(8453, "0xaaa", "0x1"));
  });
});

describe("reading a stored value", () => {
  it("gives back well-formed pieces, oldest first", () => {
    expect(parseMailbox(JSON.stringify([piece(9), piece(4)]))).toEqual([piece(4), piece(9)]);
  });

  it("nothing, garbage, and another shape are all “no unopened mail”", () => {
    for (const raw of [null, undefined, "", "not json", "{}", "42", JSON.stringify({ number: 1 })]) expect(parseMailbox(raw)).toEqual([]);
  });

  it("drops a piece that isn't one, and keeps the rest", () => {
    const bad = [
      { ...piece(1), letters: [26] }, // an uppercase id is not a pull
      { ...piece(2), letters: [] },
      { ...piece(3), letters: [0, 1, 2, 3, 4, 5] },
      { ...piece(4), had: [1, 2, 3] },
      { ...piece(5), number: 0 },
      { ...piece(6), number: 1.5 },
      { ...piece(7), at: "yesterday" },
      null,
      "mail",
    ];
    expect(parseMailbox(JSON.stringify([...bad, piece(8)]))).toEqual([piece(8)]);
  });

  it("keeps “plain” only when it is true (a piece whose bag-before isn't known says nothing about new)", () => {
    const plain = { ...piece(4), plain: true as const };
    expect(parseMailbox(JSON.stringify([plain]))).toEqual([plain]);
    expect(parseMailbox(JSON.stringify([{ ...piece(4), plain: false }]))).toEqual([piece(4)]);
    expect(parseMailbox(JSON.stringify([{ ...piece(4), plain: "yes" }]))).toEqual([piece(4)]);
    expect("plain" in parseMailbox(JSON.stringify([piece(4)]))[0]).toBe(false);
  });

  it("a piece is its number: the same one stored twice is one piece", () => {
    expect(parseMailbox(JSON.stringify([piece(4), piece(4, [1])]))).toEqual([piece(4)]);
  });

  it("keeps the newest few", () => {
    const many = Array.from({ length: MAILBOX_MAX + 5 }, (_, i) => piece(i + 1));
    const kept = parseMailbox(JSON.stringify(many));
    expect(kept).toHaveLength(MAILBOX_MAX);
    expect(kept[0].number).toBe(6);
  });
});

describe("adding and removing", () => {
  it("adds a piece once, and replaces it by number", () => {
    const list = withMail(withMail([], piece(4)), piece(4, [16]));
    expect(list).toEqual([piece(4, [16])]);
  });

  it("removes by number, and removing one that isn't there changes nothing", () => {
    expect(withoutMail([piece(4), piece(9)], 4)).toEqual([piece(9)]);
    expect(withoutMail([piece(4)], 7)).toEqual([piece(4)]);
  });
});

describe("the browser's store", () => {
  const key = mailboxKey(84532, "0xaaa", "0x1");
  beforeEach(() => window.localStorage.clear());

  it("writes and reads back; an empty list removes the key", () => {
    writeMailbox(key, [piece(4)]);
    expect(readMailbox(key)).toEqual([piece(4)]);
    writeMailbox(key, []);
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(readMailbox(key)).toEqual([]);
  });

  it("a store that refuses is a store with no mail: nothing throws", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(readMailbox(key)).toEqual([]);
    expect(() => writeMailbox(key, [piece(4)])).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});
