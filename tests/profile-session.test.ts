import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  checkChallenge,
  checkNonce,
  challengeMessage,
  issueSession,
  makeNonce,
  readSession,
  verifyWalletSignature,
} from "@/lib/profile/session";
import { X_MIN_AGE_DAYS, xEligibleOn, xOldEnough } from "@/lib/profile/rules";

const SECRET = "test-secret-that-is-at-least-32-characters-long";
const OTHER = "another-secret-that-is-at-least-32-characters!!";
const account = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const DOMAIN = "lexigotchi.fun";
const NOW = Date.UTC(2026, 10, 23, 12);

describe("challenge nonces", () => {
  it("round-trip for the wallet they were made for, case-insensitively", () => {
    const n = makeNonce(SECRET, account.address, NOW);
    expect(n).toMatch(/^[0-9a-z]{49}$/); // SIWE nonces must be alphanumeric
    expect(checkNonce(SECRET, n, account.address.toLowerCase(), NOW + 1000)).toBe(true);
  });
  it("refuse another wallet, another secret, an edited nonce, or an old one", () => {
    const n = makeNonce(SECRET, account.address, NOW);
    expect(checkNonce(SECRET, n, stranger.address, NOW)).toBe(false);
    expect(checkNonce(OTHER, n, account.address, NOW)).toBe(false);
    expect(checkNonce(SECRET, n.slice(0, -1) + (n.endsWith("0") ? "1" : "0"), account.address, NOW)).toBe(false);
    expect(checkNonce(SECRET, n, account.address, NOW + 11 * 60_000)).toBe(false);
    expect(checkNonce(SECRET, n, account.address, NOW - 2 * 60_000)).toBe(false); // issued "in the future"
  });
});

describe("the sign-in challenge", () => {
  const message = challengeMessage({ secret: SECRET, address: account.address, domain: DOMAIN, chainId: 8453, now: NOW });
  it("is accepted for our domain while fresh, and names the wallet", () => {
    expect(checkChallenge(SECRET, message, DOMAIN, NOW + 5000)).toEqual({ ok: true, address: account.address });
  });
  it("is refused on another domain, after ten minutes, or when edited", () => {
    expect(checkChallenge(SECRET, message, "evil.example", NOW)).toMatchObject({ ok: false, reason: "wrong_domain" });
    expect(checkChallenge(SECRET, message, DOMAIN, NOW + 11 * 60_000)).toMatchObject({ ok: false });
    const swapped = message.replace(account.address, stranger.address);
    expect(checkChallenge(SECRET, swapped, DOMAIN, NOW)).toMatchObject({ ok: false, reason: "stale_or_forged" });
    expect(checkChallenge(SECRET, "hello", DOMAIN, NOW)).toMatchObject({ ok: false });
  });
  it("is signed by an ordinary wallet without asking any chain", async () => {
    const signature = await account.signMessage({ message });
    const noChain = [{ verifyMessage: async () => { throw new Error("no RPC in this test"); } }];
    expect(await verifyWalletSignature(account.address, message, signature, noChain)).toBe(true);
    const forged = await stranger.signMessage({ message });
    expect(await verifyWalletSignature(account.address, message, forged, noChain)).toBe(false);
  });
  it("falls back to the chain for a contract wallet's signature", async () => {
    const chain = [{ verifyMessage: async () => false }, { verifyMessage: async () => true }];
    expect(await verifyWalletSignature(account.address, message, "0x1234", chain)).toBe(true);
  });
});

describe("session tokens", () => {
  it("prove the wallet until they expire", () => {
    const { token, expiresAt } = issueSession(SECRET, account.address, NOW);
    expect(readSession(SECRET, token, NOW + 1000)).toBe(account.address.toLowerCase());
    expect(readSession(SECRET, token, expiresAt * 1000 + 1)).toBeNull();
  });
  it("can't be forged, edited, or read under another secret", () => {
    const { token } = issueSession(SECRET, account.address, NOW);
    const [payload, mac] = token.split(".");
    const other = Buffer.from(JSON.stringify({ a: stranger.address.toLowerCase(), e: 9_999_999_999 })).toString("base64url");
    expect(readSession(SECRET, `${other}.${mac}`, NOW)).toBeNull();
    expect(readSession(OTHER, token, NOW)).toBeNull();
    expect(readSession(SECRET, payload, NOW)).toBeNull();
    expect(readSession(SECRET, null, NOW)).toBeNull();
  });
});

describe("the X age rule for the daily letter", () => {
  it(`needs an account at least ${X_MIN_AGE_DAYS} days old`, () => {
    const day = 86_400_000;
    expect(xOldEnough(new Date(NOW - 90 * day), NOW)).toBe(true);
    expect(xOldEnough(new Date(NOW - 89 * day), NOW)).toBe(false);
    expect(xOldEnough(null, NOW)).toBe(false);
    expect(xOldEnough("not a date", NOW)).toBe(false);
    expect(xEligibleOn(new Date(NOW - 10 * day)).getTime()).toBe(NOW + 80 * day);
  });
});

describe("the public profile", () => {
  it("never carries the email", async () => {
    const { toPublicView, toView } = await import("@/lib/db/profiles");
    const row = {
      address: "0xabc", xUserId: "1", xUsername: "example_player", xName: null, xPfpUrl: null, xCreatedAt: null, xLinkedAt: null,
      nameSource: "x", email: "player@example.com", emailVerifiedAt: new Date(), emailReminders: true, emailDailyDay: null, emailHungerDay: null, createdAt: new Date(), updatedAt: new Date(),
    };
    expect(toView("0xABC", row).email).toEqual({ address: "player@example.com", reminders: true });
    const pub = toPublicView("0xABC", row);
    expect(JSON.stringify(pub)).not.toContain("example.com");
    expect(pub).toEqual({ address: "0xabc", nameSource: "x", x: { id: "1", username: "example_player", name: null, pfpUrl: null, createdAt: null, linkedAt: null } });
  });
});
