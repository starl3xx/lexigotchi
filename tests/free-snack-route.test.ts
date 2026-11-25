/**
 * POST /api/care/free-snack: one free snack per PROFILE per UTC day (Staking.feedWithSnack; starl3xx:
 * "only one wallet per profile should get a free anything"). Pinned: the voucher names the staker's
 * profile and verifies against the signer; a profile that used today's snack under ANY of its
 * wallets' keys is refused; the deadline never passes the day the voucher names; a database error
 * refuses rather than read the staker as a profile of its own.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";

const KEY = generatePrivateKey();
vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532");
vi.stubEnv("SIGNER_PRIVATE_KEY", KEY);
vi.stubEnv("SIGNER_DRAW_SECRET", "test-secret-not-a-real-one");

vi.mock("@/lib/ratelimit", () => ({ allow: async () => true }));

// Made-up wallets: P is the profile's account (its first wallet), S a second wallet that stakes,
// C a caretaker in a profile of its own.
const P = "0x1111111111111111111111111111111111111111";
const S = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";
const DAY = 20_400;
let now = DAY * 86_400 + 3_600;
let toggle = true;
let used: Record<string, number> = {};
let links: (() => Promise<{ account: string; wallets: string[] }>) | null = null;

vi.mock("@/lib/onchain/reads", async (orig) => ({
  ...(await orig<typeof import("@/lib/onchain/reads")>()),
  readChainTime: async () => now,
  getPublicClient: () => ({
    readContract: async ({ functionName, args }: { functionName: string; args?: readonly string[] }) =>
      functionName === "freeDailySnack" ? toggle : (used[String(args?.[0]).toLowerCase()] ?? 0),
  }),
}));
vi.mock("@/lib/db/walletLinks", () => ({
  accountWalletsStrict: async (a: string) => (links ? links() : { account: a.toLowerCase(), wallets: [a.toLowerCase()] }),
}));

const call = async (body: unknown) => {
  const { POST } = await import("@/app/api/care/free-snack/route");
  const res = await POST(new Request("http://localhost/api/care/free-snack", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  now = DAY * 86_400 + 3_600;
  toggle = true;
  used = {};
  links = async () => ({ account: P, wallets: [P, S] });
});

describe("/api/care/free-snack", () => {
  it("signs a voucher for the STAKER's profile, whoever feeds, that the signer recovers", async () => {
    const { status, body } = await call({ wallet: C, staker: S });
    expect(status).toBe(200);
    expect(body.voucher.staker.toLowerCase()).toBe(S);
    expect(body.voucher.profile.toLowerCase()).toBe(P);
    expect(body.voucher.deadline).toBe(String(now + 600));

    const { freeSnackDigest } = await import("@/lib/onchain/digests");
    const { addressOf } = await import("@/lib/onchain/addresses");
    const digest = freeSnackDigest({
      staking: addressOf("staking"),
      caller: C,
      staker: S,
      profile: P,
      today: DAY,
      deadline: BigInt(body.voucher.deadline),
    });
    const signer = await recoverMessageAddress({ message: { raw: digest }, signature: body.voucher.sig });
    expect(signer).toBe(privateKeyToAccount(KEY).address);
  });

  it("refuses once the profile used today's snack", async () => {
    used[P] = DAY + 1;
    expect(await call({ wallet: S, staker: S })).toMatchObject({ status: 409, body: { error: "used_today" } });
  });

  it("refuses when a wallet used it as a profile of its own earlier today, then joined", async () => {
    used[S] = DAY + 1;
    expect(await call({ wallet: P, staker: P })).toMatchObject({ status: 409, body: { error: "used_today" } });
  });

  it("yesterday's snack doesn't count", async () => {
    used[P] = DAY;
    expect((await call({ wallet: P, staker: P })).status).toBe(200);
  });

  it("never lets the deadline pass the day it names", async () => {
    now = (DAY + 1) * 86_400 - 60;
    const { body } = await call({ wallet: P, staker: P });
    expect(body.voucher.deadline).toBe(String((DAY + 1) * 86_400 - 1));
  });

  it("refuses on a database error instead of reading the staker as its own profile", async () => {
    links = async () => {
      throw new Error("connection reset");
    };
    expect(await call({ wallet: S, staker: S })).toMatchObject({ status: 503, body: { error: "try_again" } });
  });

  it("says so when the free snack is switched off, and checks its input", async () => {
    toggle = false;
    expect(await call({ wallet: P, staker: P })).toMatchObject({ status: 409, body: { error: "no_free_snack" } });
    expect((await call({ wallet: "nope", staker: P })).status).toBe(400);
    expect((await call({ wallet: P })).status).toBe(400);
  });
});
