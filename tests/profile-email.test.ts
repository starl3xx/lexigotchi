import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkUnsubscribe, codeMatches, hashCode, newCode, normalizeEmail, reminderEmail, unsubscribeToken, unsubscribeUrl } from "@/lib/notify/email";

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
    expect(m.text).toContain(`Unsubscribe: ${unsubscribeUrl(A)}`);
  });
  it("are never built without a working way out", () => {
    delete process.env.PROFILE_SESSION_SECRET;
    expect(reminderEmail("player@example.com", A, { title: "t", body: "b" })).toBeNull();
  });
});
