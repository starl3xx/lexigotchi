/**
 * The free-letter policy through the routes (decisions.md #21): /api/mint/free-daily, /api/mint/free-pack,
 * and /api/mint/daily-status, over an in-memory stand-in for the `free_claims` ledger that follows its
 * contract (lib/db/freeClaims.ts): one row per profile per (kind, period), first key wins, a row counts
 * until it is settled unused. Pinned:
 * - 10 free daily letters per PROFILE, whichever of its wallets asks; daily-status reports `done`.
 * - The budget counts a pack as 5 and a daily as 1, and a voucher that expired unused gives its
 *   letters back (and one the chain shows used doesn't).
 * - Free grants stop at about 95% of the dictionary claimed.
 * - The free pack signs for X- and Coinbase-keyed profiles (no Farcaster), once per profile, under the
 *   same keys the daily uses, and the signer recovers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";

const KEY = generatePrivateKey();
vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532");
vi.stubEnv("SIGNER_PRIVATE_KEY", KEY);
vi.stubEnv("SIGNER_DRAW_SECRET", "test-secret-not-a-real-one");

// Made-up wallets: P is the profile's account (its first wallet), S its second wallet, Q another profile.
const P = "0x1111111111111111111111111111111111111111";
const S = "0x2222222222222222222222222222222222222222";
const Q = "0x3333333333333333333333333333333333333333";
const DAY = 20_400;
let now = DAY * 86_400 + 3_600;

// ── who the player is ───────────────────────────────────────────────────────────────────────
let fid: number | null = null;
let xProfile: { xUserId: string; xCreatedAt: Date } | null = null;
let verified = new Set<string>();
const accountOf: Record<string, string> = { [P]: P, [S]: P, [Q]: Q };
const walletsOf: Record<string, string[]> = { [P]: [P, S], [Q]: [Q] };

vi.mock("@/lib/ratelimit", () => ({ allow: async () => true }));
vi.mock("@/lib/auth/quickAuth", () => ({ getAuthedFid: async () => fid }));
vi.mock("@/lib/db/walletLinks", () => ({
  accountWallets: async (w: string) => {
    const account = accountOf[w.toLowerCase()] ?? w.toLowerCase();
    return { account, wallets: walletsOf[account] ?? [account] };
  },
}));
vi.mock("@/lib/db/profiles", async (orig) => ({
  ...(await orig<typeof import("@/lib/db/profiles")>()),
  getProfile: async () => xProfile,
}));
vi.mock("@/lib/profile/session", async (orig) => ({ ...(await orig<typeof import("@/lib/profile/session")>()), profilesEnabled: () => true }));
vi.mock("@/lib/profile/x", async (orig) => ({ ...(await orig<typeof import("@/lib/profile/x")>()), xEnabled: () => true }));
vi.mock("@/lib/onchain/verifications", async (orig) => ({
  ...(await orig<typeof import("@/lib/onchain/verifications")>()),
  isCoinbaseVerified: async (w: string) => verified.has(w.toLowerCase()),
}));
vi.mock("@/lib/onchain/dailyIdentity", () => ({ relatedDailyKeys: async () => [] }));
vi.mock("@/lib/neynar", () => ({ fidsByAddressesDetailed: async () => ({ fids: new Map(), answered: true }) }));
vi.mock("@/lib/onchain/stickyDraw", () => ({ stickyDraw: async (a: { draw: () => number[] }) => a.draw() }));
vi.mock("@/lib/db/draws", () => ({ claimDraw: async () => true, readDraw: async () => null }));

// ── the chain ───────────────────────────────────────────────────────────────────────────────
let dailyUsed: Record<string, number> = {};
let packClaimed = new Set<string>();
let claimedWords: number | null = 10;
const read = (functionName: string, args?: readonly unknown[]) => {
  const k = args?.[0] !== undefined ? String(args[0]) : "";
  if (functionName === "dailyUsed") return dailyUsed[k] ?? 0;
  if (functionName === "freePackClaimed") return packClaimed.has(k);
  if (functionName === "freePackOpen") return true;
  if (functionName === "commitCount") return 0n;
  throw new Error(`unexpected read ${functionName}`);
};
vi.mock("@/lib/onchain/reads", async (orig) => ({
  ...(await orig<typeof import("@/lib/onchain/reads")>()),
  readChainTime: async () => now,
  readLetterSupply: async () => ({ caps: Array(26).fill(100), minted: Array(26).fill(0), available: Array(26).fill(100) }),
  getPublicClient: () => ({
    readContract: async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => read(functionName, args),
    multicall: async ({ contracts }: { contracts: { functionName: string; args?: readonly unknown[] }[] }) =>
      contracts.map((c) => read(c.functionName, c.args)),
  }),
}));
vi.mock("@/lib/onchain/claimedWords", () => ({ claimedWordCount: async () => claimedWords }));

// ── the ledger (free_claims), in memory ─────────────────────────────────────────────────────
interface Row { account: string; kind: "daily" | "pack"; period: number; key: string; letters: number; expiresAt: number; used: boolean | null }
let rows: Row[] = [];
const find = (account: string, kind: string, period: number) => rows.find((r) => r.account === account.toLowerCase() && r.kind === kind && r.period === period);
const counts = (r: Row) => r.used !== false;
vi.mock("@/lib/db/freeClaims", async (orig) => {
  const real = await orig<typeof import("@/lib/db/freeClaims")>();
  return {
    keyOwnedByProfile: real.keyOwnedByProfile,
    fidLedgerAccount: real.fidLedgerAccount,
    recordedFreeKey: async (_c: number, account: string, kind: string, period: number) => {
      const r = find(account, kind, period);
      return r ? BigInt(r.key) : null;
    },
    recordedFreeGrant: async (_c: number, account: string, kind: string, period: number) => {
      const r = find(account, kind, period);
      return r ? { key: BigInt(r.key), counts: counts(r) } : null;
    },
    claimFree: async (o: { account: string; kind: "daily" | "pack"; period: number; key: bigint; letters: number; expiresAt: Date; usedOnchain: (k: bigint) => Promise<boolean> }) => {
      const r = find(o.account, o.kind, o.period);
      const fresh = { key: o.key.toString(), letters: o.letters, expiresAt: o.expiresAt.getTime(), used: null };
      if (!r) return void rows.push({ account: o.account.toLowerCase(), kind: o.kind, period: o.period, ...fresh }), "ok";
      if (r.key === o.key.toString()) return Object.assign(r, fresh), "ok";
      if (r.expiresAt < now * 1000 && !(await o.usedOnchain(BigInt(r.key)))) return Object.assign(r, fresh), "ok";
      return "taken";
    },
    settleFreeClaims: async (o: { account?: string; check: (p: { account: string; kind: "daily" | "pack"; period: number; key: bigint }[]) => Promise<readonly boolean[]> }) => {
      // Like the real one: only vouchers expired more than SETTLE_GRACE_SECONDS (300) ago.
      const due = rows.filter((r) => r.used === null && r.expiresAt < (now - 300) * 1000 && (!o.account || r.account === o.account));
      const used = await o.check(due.map((r) => ({ account: r.account, kind: r.kind, period: r.period, key: BigInt(r.key) })));
      due.forEach((r, i) => (r.used = Boolean(used[i])));
      return due.length;
    },
    freeLettersSigned: async () => rows.filter(counts).reduce((a, r) => a + r.letters, 0),
    freeDailiesTaken: async (_c: number, account: string) => rows.filter((r) => r.account === account && r.kind === "daily" && counts(r)).length,
    freePackTaken: async (_c: number, account: string) => rows.some((r) => r.account === account && r.kind === "pack" && counts(r)),
  };
});

const post = async (path: "free-daily" | "free-pack", wallet: string) => {
  const { POST } = await import(`@/app/api/mint/${path}/route`);
  const res: Response = await POST(new Request(`http://localhost/api/mint/${path}`, { method: "POST", body: JSON.stringify({ wallet }) }));
  return { status: res.status, body: await res.json() };
};
const status = async (wallet: string, withFid?: number) => {
  const { GET } = await import("@/app/api/mint/daily-status/route");
  const res: Response = await GET(new Request(`http://localhost/api/mint/daily-status?wallet=${wallet}${withFid ? `&fid=${withFid}` : ""}`));
  return res.json();
};
const keys = async () => import("@/lib/onchain/verifications");
const daily = (account: string, key: bigint, period: number, used: boolean | null = true): Row => ({
  account,
  kind: "daily",
  period,
  key: key.toString(),
  letters: 1,
  expiresAt: (period * 86_400 + 600) * 1000,
  used,
});

beforeEach(() => {
  vi.stubEnv("FREE_LETTER_BUDGET", "");
  now = DAY * 86_400 + 3_600;
  fid = null;
  xProfile = null;
  verified = new Set([S]);
  dailyUsed = {};
  packClaimed = new Set();
  claimedWords = 10;
  rows = [];
});

describe("10 free daily letters per profile", () => {
  it("refuses the 11th from ANY of the profile's wallets, and daily-status says done", async () => {
    const { verifiedDailyKey } = await keys();
    // Ten days already taken by this profile, under both of its wallets' keys.
    for (let d = 1; d <= 10; d++) rows.push(daily(P, verifiedDailyKey(d % 2 ? P : S), DAY - d));
    const res = await post("free-daily", S);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("daily_limit_reached");
    verified.add(P);
    expect((await post("free-daily", P)).body.error).toBe("daily_limit_reached");
    const st = await status(S);
    expect(st).toMatchObject({ dailyTaken: 10, dailyLimit: 10, done: true });
  });

  it("signs the 10th, one a day, then stops the next day", async () => {
    const { verifiedDailyKey } = await keys();
    for (let d = 1; d <= 9; d++) rows.push(daily(P, verifiedDailyKey(P), DAY - d));
    const tenth = await post("free-daily", S);
    expect(tenth.status).toBe(200);
    expect(tenth.body.voucher.fid).toBe(verifiedDailyKey(S).toString());
    expect((await status(S)).done).toBe(true);
    // Asking again the same day re-issues today's voucher: it isn't an 11th.
    expect((await post("free-daily", S)).status).toBe(200);
    // The next day, after today's was used onchain: refused.
    dailyUsed[verifiedDailyKey(S).toString()] = DAY + 1;
    now += 86_400;
    expect((await post("free-daily", S)).body.error).toBe("daily_limit_reached");
  });

  it("counts a Farcaster sign-in that never verified the profile's wallets, under the FID's own ledger", async () => {
    // FID 77 signs in on the profile's wallet, but Farcaster says 77 verified none of its wallets: its
    // grants can't go ON the profile (no planting), yet they must still count (the review on this PR).
    fid = 77;
    for (let d = 1; d <= 10; d++) rows.push(daily("fid:77", 77n, DAY - d));
    const res = await post("free-daily", S);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("daily_limit_reached");
    expect((await status(S, 77)).done).toBe(true);

    rows = [];
    const first = await post("free-daily", S);
    expect(first.status).toBe(200);
    expect(first.body.voucher.fid).toBe("77");
    expect(rows).toMatchObject([{ account: "fid:77", kind: "daily", letters: 1 }]); // recorded, and counted
    expect(rows.some((r) => r.account === P)).toBe(false); // not planted on the profile
  });

  it("a daily whose voucher lapsed unused doesn't count toward the 10", async () => {
    const { verifiedDailyKey } = await keys();
    for (let d = 2; d <= 10; d++) rows.push(daily(P, verifiedDailyKey(P), DAY - d));
    rows.push(daily(P, verifiedDailyKey(S), DAY - 1, null)); // signed yesterday, never sent
    const res = await post("free-daily", S);
    expect(res.status).toBe(200); // the unused day was given back, so this is the 10th
    expect(rows.find((r) => r.period === DAY - 1)?.used).toBe(false);
  });
});

describe("the free-letter budget", () => {
  it("counts a pack as 5 and a daily as 1, and stops plainly when it's used up", async () => {
    vi.stubEnv("FREE_LETTER_BUDGET", "12");
    rows.push({ ...daily(Q, 999n, DAY - 1), letters: 1 }, { account: Q, kind: "pack", period: 0, key: "999", letters: 5, expiresAt: 0, used: true });
    rows.push(...[2, 3, 4, 5, 6].map((d) => daily(Q, 999n, DAY - d))); // 11 signed in all
    expect((await post("free-pack", S)).body.error).toBe("free_letters_gone"); // 11 + 5 > 12
    expect((await post("free-daily", S)).status).toBe(200); // 11 + 1 = 12
    verified.add(Q);
    const res = await post("free-daily", Q);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("free_letters_gone");
    expect((await status(Q)).stop).toBe("budget");
  });

  it("gives a voucher's letters back when it expires unused, and keeps them when the chain shows it used", async () => {
    vi.stubEnv("FREE_LETTER_BUDGET", "7");
    // Q's free pack: signed 5 letters, its voucher expired, never sent.
    rows.push({ account: Q, kind: "pack", period: 0, key: "999", letters: 5, expiresAt: (now - 600) * 1000, used: null });
    const pack = await post("free-pack", S);
    expect(pack.status).toBe(200); // 5 came back, so 0 + 5 ≤ 7
    expect(rows.find((r) => r.account === Q)?.used).toBe(false);

    // The same again, but the chain shows Q's pack was used: its 5 stay counted.
    rows = [{ account: Q, kind: "pack", period: 0, key: "999", letters: 5, expiresAt: (now - 600) * 1000, used: null }];
    packClaimed.add("999");
    expect((await post("free-pack", S)).body.error).toBe("free_letters_gone"); // 5 + 5 > 7
    expect(rows.find((r) => r.account === Q)?.used).toBe(true);
  });
});

describe("the dictionary stop", () => {
  it("stops free grants at about 95% claimed, and daily-status flags the dictionary as nearly full", async () => {
    claimedWords = 4355; // 95.0% of 4,584
    expect((await post("free-daily", S)).body.error).toBe("free_letters_closed");
    expect((await post("free-pack", S)).body.error).toBe("free_letters_closed");
    const st = await status(S);
    expect(st).toMatchObject({ stop: "dictionary", packStop: "dictionary", dictionaryFull: true });
    claimedWords = 4354; // 94.98%
    expect((await post("free-daily", S)).status).toBe(200);
    expect((await status(S)).dictionaryFull).toBe(false);
  });
});

describe("the free pack for every verified player", () => {
  const recovers = async (body: { voucher: { fid: string; nonce: string; deadline: string; signature: `0x${string}` } }, buyer: string) => {
    const { freePackDigest } = await import("@/lib/onchain/digests");
    const { addressOf } = await import("@/lib/onchain/addresses");
    const digest = freePackDigest({
      letters: addressOf("letters"),
      buyer: buyer as `0x${string}`,
      fid: BigInt(body.voucher.fid),
      nonce: BigInt(body.voucher.nonce),
      deadline: BigInt(body.voucher.deadline),
    });
    return recoverMessageAddress({ message: { raw: digest }, signature: body.voucher.signature });
  };

  it("signs for an X-keyed profile (no Farcaster), under the daily's X key", async () => {
    const { xDailyKey } = await keys();
    verified = new Set();
    xProfile = { xUserId: "1234567", xCreatedAt: new Date(Date.UTC(2020, 0, 1)) };
    const res = await post("free-pack", P);
    expect(res.status).toBe(200);
    expect(res.body.voucher.fid).toBe(xDailyKey("1234567").toString());
    expect(BigInt(res.body.voucher.fid) >= 1n << 162n).toBe(true);
    expect(await recovers(res.body, P)).toBe(privateKeyToAccount(KEY).address);
    expect(rows).toMatchObject([{ account: P, kind: "pack", letters: 5, used: null }]);
  });

  it("signs for a Coinbase-keyed profile, under the verified wallet's key, once per profile", async () => {
    const { verifiedDailyKey } = await keys();
    const res = await post("free-pack", S);
    expect(res.status).toBe(200);
    expect(res.body.voucher.fid).toBe(verifiedDailyKey(S).toString());
    expect(await recovers(res.body, S)).toBe(privateKeyToAccount(KEY).address);
    expect((await status(P)).packTaken).toBe(true);

    // The profile's other wallet, with a key of its own, is refused while the first voucher is live…
    verified.add(P);
    expect((await post("free-pack", P)).body.error).toBe("already_claimed");
    // …and for good once the chain shows the pack opened.
    packClaimed.add(verifiedDailyKey(S).toString());
    now += 3_600;
    expect((await post("free-pack", P)).body.error).toBe("already_claimed");
  });

  it("refuses a player with nothing verified, with the reason the client can show", async () => {
    verified = new Set();
    const res = await post("free-pack", P);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("verification_required");
    expect(rows).toEqual([]);
  });
});
