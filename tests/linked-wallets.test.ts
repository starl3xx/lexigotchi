import { describe, expect, it } from "vitest";
import { challengeMessage, checkChallenge, checkLinkMessage, linkMessage, linkStatement } from "@/lib/profile/session";
import { MAX_ACCOUNT_WALLETS, linkRefusal } from "@/lib/db/walletLinks";

// Made-up wallets: never anyone's real address.
const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";
const DOMAIN = "lexigotchi.example";
const SECRET = "s".repeat(40);
const CODE = "0123456789abcdef01234567";
const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);

describe("the link message", () => {
  const msg = linkMessage({ address: B, account: A, code: CODE, domain: DOMAIN, chainId: 84532, now: NOW });

  it("names the account, carries the code, and checks out", () => {
    const r = checkLinkMessage(msg, DOMAIN, NOW + 1000);
    expect(r).toMatchObject({ ok: true, code: CODE, statement: linkStatement(A) });
    expect(r.ok && r.address.toLowerCase()).toBe(B);
  });

  it("is never a sign-in, and a sign-in is never a link (a captured signature can't be reused)", () => {
    expect(checkChallenge(SECRET, msg, DOMAIN, NOW + 1000)).toMatchObject({ ok: false });
    const signIn = challengeMessage({ secret: SECRET, address: B, domain: DOMAIN, chainId: 84532, now: NOW });
    expect(checkLinkMessage(signIn, DOMAIN, NOW + 1000)).toMatchObject({ ok: false, reason: "bad_message" });
  });

  it("refuses another domain, an expired message, and a malformed code", () => {
    expect(checkLinkMessage(msg, "evil.example", NOW)).toMatchObject({ ok: false, reason: "wrong_domain" });
    expect(checkLinkMessage(msg, DOMAIN, NOW + 11 * 60_000)).toMatchObject({ ok: false, reason: "stale_or_forged" });
    const badCode = linkMessage({ address: B, account: A, code: "notacode1", domain: DOMAIN, chainId: 84532, now: NOW });
    expect(checkLinkMessage(badCode, DOMAIN, NOW)).toMatchObject({ ok: false, reason: "bad_message" });
  });

  it("binds the account in the statement: a message for one account isn't one for another", () => {
    expect(linkStatement(A)).not.toBe(linkStatement(C));
    expect(linkStatement(A)).toMatch(/^[\x20-\x7e]+$/); // ASCII only, for strict wallets
  });
});

describe("who can join an account", () => {
  const base = { account: A, address: B, addressAccount: B, addressAccountSize: 1, accountSize: 1 };

  it("lets a lone wallet join", () => {
    expect(linkRefusal(base)).toBeNull();
  });

  it("treats a wallet already in the account as a no-op", () => {
    expect(linkRefusal({ ...base, addressAccount: A })).toBe("already");
  });

  it("refuses the account's own wallet, a wallet in another account, a wallet heading its own, and a full account", () => {
    expect(linkRefusal({ ...base, address: A, addressAccount: A })).toBe("same_wallet");
    expect(linkRefusal({ ...base, addressAccount: C })).toBe("linked_elsewhere");
    expect(linkRefusal({ ...base, addressAccountSize: 2 })).toBe("has_wallets");
    expect(linkRefusal({ ...base, accountSize: MAX_ACCOUNT_WALLETS })).toBe("too_many");
  });

  it("compares addresses case-insensitively", () => {
    expect(linkRefusal({ ...base, account: A.toUpperCase().replace("0X", "0x"), addressAccount: A })).toBe("already");
  });
});
