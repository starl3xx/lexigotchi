import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkUnsubscribe, codeEmail, codeMatches, hashCode, newCode, normalizeEmail, reminderEmail, unsubscribeToken, unsubscribeUrl } from "@/lib/notify/email";

const SECRET = "test-secret-that-is-at-least-32-characters-long";
const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";

beforeEach(() => {
  process.env.PROFILE_SESSION_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.PROFILE_SESSION_SECRET;
});

describe("email addresses and codes", () => {
  it("accepts a plausible address, lowercased, and refuses junk", () => {
    expect(normalizeEmail("  Player@Example.COM ")).toBe("player@example.com");
    for (const bad of ["", "nope", "a@b", "a b@example.com", "<x>@example.com", 42, null]) expect(normalizeEmail(bad)).toBeNull();
  });
  it("makes 6-digit codes", () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^\d{6}$/);
  });
  it("matches a code only for the wallet and address it was sent for", () => {
    const stored = hashCode(SECRET, A, "player@example.com", "123456");
    expect(codeMatches(SECRET, stored, A.toUpperCase().replace("0X", "0x"), "player@example.com", "123456")).toBe(true);
    expect(codeMatches(SECRET, stored, A, "player@example.com", "123457")).toBe(false);
    expect(codeMatches(SECRET, stored, B, "player@example.com", "123456")).toBe(false);
    expect(codeMatches(SECRET, stored, A, "other@example.com", "123456")).toBe(false);
    expect(codeMatches(SECRET, stored, A, "player@example.com", "12345")).toBe(false);
  });
});

describe("unsubscribe links", () => {
  it("work for their own wallet only, and can't be guessed", () => {
    const t = unsubscribeToken(SECRET, A);
    expect(checkUnsubscribe(A, t)).toBe(true);
    expect(checkUnsubscribe(B, t)).toBe(false);
    expect(checkUnsubscribe(A, "0".repeat(32))).toBe(false);
    expect(checkUnsubscribe(A, "not-a-token")).toBe(false);
    expect(unsubscribeUrl(A)).toBe(`https://lexigotchi.fun/api/email/unsubscribe?a=${A}&t=${t}`);
  });
});

describe("reminder emails", () => {
  it("carry one-click unsubscribe headers, the game link, and escaped text", () => {
    const m = reminderEmail("player@example.com", A, { title: "TEASE is getting hungry", body: "2 staked words go hungry in 6h <soon> & then nothing." })!;
    expect(m.subject).toBe("TEASE is getting hungry");
    expect(m.headers).toEqual({ "List-Unsubscribe": `<${unsubscribeUrl(A)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect(m.html).toContain("&lt;soon&gt; &amp; then");
    expect(m.html).toContain("https://lexigotchi.fun/play");
    expect(m.text).toContain(`Unsubscribe from all of them: ${unsubscribeUrl(A)}`);
  });
  it("are never built without a working way out", () => {
    delete process.env.PROFILE_SESSION_SECRET;
    expect(reminderEmail("player@example.com", A, { title: "t", body: "b" })).toBeNull();
  });
});

describe("the email’s look (decisions.md #47: minimal, in the card’s language)", () => {
  // built in each test: the unsubscribe link needs the secret that beforeEach sets
  const sold = () => reminderEmail("p@example.com", A, { title: "Your word sold", body: "CRANE found a new home, for 2.40M $WORD. Your share is in your wallet." }, [["Sold", "CRANE"], ["For", "2.40M $WORD"], ["Your share", "2.16M $WORD"]])!;

  it("is the card’s paper with its two frame lines, the wordmark, and one button", () => {
    const m = sold();
    expect(m.html).toContain("#fcf7ea"); // the card's own paper (lib/cardArt/looks CARD_PAPER)
    expect(m.html).toMatch(/border:1px solid #4a3a2c/);
    expect(m.html).toMatch(/border:1px dotted #4a3a2c/);
    expect(m.html).toContain(">LEXIGOTCHI<");
    expect(m.html.match(/<a [^>]*background:#1b1714/g)).toHaveLength(1);
  });

  it("carries no picture and no shipped font: stacks only, the card’s serif first where a device has it", () => {
    const m = sold();
    expect(m.html).not.toMatch(/<img|@font-face|url\(/i);
    expect(m.html).toContain("'Source Serif 4','Iowan Old Style','Palatino Linotype',Palatino");
    expect(m.html).toContain('content="light only"');
  });

  it("sets a receipt’s facts as a ledger, and says them in the text part too", () => {
    const m = sold();
    for (const [name, value] of [["Sold", "CRANE"], ["For", "2.40M $WORD"], ["Your share", "2.16M $WORD"]]) {
      expect(m.html).toContain(`>${name}</td>`);
      expect(m.html).toContain(`>${value}</td>`);
      expect(m.text).toContain(`${name}: ${value}`);
    }
    // a reminder with no facts has no ledger
    expect(reminderEmail("p@example.com", A, { title: "t", body: "b" })!.html).not.toContain("1px dotted #4a3a2c;height");
  });

  it("says how to choose which reminders come, and how to stop them all", () => {
    const m = sold();
    expect(m.html).toContain("What to tell me");
    expect(m.html).toContain(unsubscribeUrl(A)!);
    expect(m.text).toContain("What to tell me");
    expect(m.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("the code email shares the look, and escapes nothing it shouldn’t", () => {
    const c = codeEmail("p@example.com", "482913");
    expect(c.html).toContain("#fcf7ea");
    expect(c.html).toContain(">482913<");
    expect(c.html).not.toContain("unsubscribe");
  });
});
