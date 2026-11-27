/**
 * The first-day gate's vouchers (decisions.md, "Reserved word sets"): the counting rule
 * (lib/sets/voucher.ts), the digest the contract checks, and POST /api/sets/voucher.
 *
 * Pinned: a voucher only for a verified profile that proves the wallet is its own; one word of a
 * set per PROFILE across its linked wallets, counted from vouchers issued; a slot given back only
 * when the chain says the voucher expired unused; the chain decides whether the gate is up.
 * scripts/sets-db-check.ts proves the SQL (and two requests at once) against a real Postgres.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import { STANDARD_FIELDS, type WordSet } from "@/lib/sets/rules";
import { decideVoucher, dueToSettle, holdsSlot, walletsToAsk, SETTLE_AFTER_SECONDS, VOUCHER_TTL_SECONDS, type VoucherRow } from "@/lib/sets/voucher";

const KEY = generatePrivateKey();
vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532");
vi.stubEnv("DATABASE_URL", "postgresql://stand-in");
vi.stubEnv("SIGNER_PRIVATE_KEY", KEY);
vi.stubEnv("SIGNER_DRAW_SECRET", "test-secret-not-a-real-one");

// Made-up wallets: P heads a profile, L is linked into it, O is another player.
const P = "0x1111111111111111111111111111111111111111";
const L = "0x2222222222222222222222222222222222222222";
const O = "0x3333333333333333333333333333333333333333";

const world = vi.hoisted(() => ({
  sets: [] as WordSet[],
  rows: [] as VoucherRow[],
  nextId: 1,
  now: 1_800_000_000,
  gate: true,
  gatedUntil: 1_800_050_000,
  owned: new Set<string>(),
  claimedLogs: [] as { wallet: string; word: string }[],
  chainDown: false,
  dbDown: false,
  linksDown: false,
  links: {} as Record<string, { account: string; wallets: string[] }>,
  identity: { ok: true } as { ok: true } | { ok: false; status: number; error: string },
  session: null as string | null,
  fid: null as number | null,
  fidWallets: new Map<string, number[]>(),
  limited: new Set<string>(),
  ids: new Map<string, string>(),
  block: 5_000_000n,
  logReads: [] as { from: bigint; to: bigint }[],
  logRangeLimit: null as bigint | null,
  allowlist: new Set<string>(),
  allowlistDown: false,
  balances: new Map<string, bigint>(), // a wallet's balance of the rule's token, on Base mainnet
  balanceDown: new Set<string>(),
  balanceReads: [] as { token: string; wallet: string }[],
}));

vi.mock("@/lib/ratelimit", () => ({ allow: async (kind: string) => !world.limited.has(kind) }));
// Whether this network's Words has the gate is the registry's fact (config/deployments*.json).
vi.mock("@/lib/onchain/addresses", async (orig) => ({ ...(await orig<typeof import("@/lib/onchain/addresses")>()), wordsHaveGate: () => world.gate }));
vi.mock("@/lib/db/sets", () => ({
  SetError: class extends Error {},
  listSets: async () => ({ sets: world.sets, migrated: true }),
  revealDue: async () => [],
  saveRoot: async () => {},
  heldOfRoot: async () => null,
  newestRoot: async () => null,
  setReleaseRoot: async () => true,
  markReleased: async () => false,
  onAllowlist: async (_id: number, wallets: string[]) => {
    if (world.allowlistDown) throw new Error("db down");
    return wallets.some((w) => world.allowlist.has(w));
  },
}));
// A token rule reads Base MAINNET, whatever network the game is on.
vi.mock("@/lib/onchain/mainnet", () => ({
  getMainnetClient: () => ({
    readContract: async ({ address, args }: { address: string; args: [string] }) => {
      const wallet = args[0].toLowerCase();
      world.balanceReads.push({ token: address.toLowerCase(), wallet });
      if (world.balanceDown.has(wallet)) throw new Error("rpc down");
      return world.balances.get(wallet) ?? 0n;
    },
  }),
}));
// The storage, standing on the REAL rule: what is tested here is the route and the rule together.
vi.mock("@/lib/db/setVouchers", async () => {
  const { decideVoucher: decide, dueToSettle: due } = await import("@/lib/sets/voucher");
  const mine = (account: string, wallets: readonly string[]) => (r: VoucherRow) => r.account === account || wallets.includes(r.account) || wallets.includes(r.wallet);
  return {
    profileVouchers: async (_c: number, _s: number, account: string, wallets: string[]) => world.rows.filter(mine(account, wallets)),
    takeVoucher: async (a: { account: string; wallets: string[]; wallet: string; word: string; limit: number; deadline: Date }) => {
      if (world.dbDown) throw Object.assign(new Error("down"), { code: "08006" });
      const d = decide(world.rows.filter(mine(a.account, a.wallets)), a.word, a.limit);
      if (d.kind === "limit") return { ok: false, error: "limit_reached", words: d.words };
      if (d.kind === "renew") {
        // As lib/db/setVouchers.ts does it: the row remembers every wallet it was signed for.
        const row = world.rows.find((r) => r.id === d.id)!;
        Object.assign(row, { named: [...new Set([...row.named, row.wallet, a.wallet])], wallet: a.wallet, deadline: a.deadline, used: row.used === true ? true : null });
        return { ok: true, renewed: true };
      }
      world.rows.push({ id: world.nextId++, account: a.account, wallet: a.wallet, named: [a.wallet], word: a.word, deadline: a.deadline, createdAt: new Date(world.now * 1000), used: null });
      return { ok: true, renewed: false };
    },
    settleVouchers: async (_c: number, _s: number, account: string, wallets: string[], nowSec: number, check: (r: VoucherRow) => Promise<boolean | null>) => {
      if (world.dbDown) throw Object.assign(new Error("down"), { code: "08006" });
      for (const r of world.rows.filter(mine(account, wallets)).filter((x) => due(x, nowSec))) {
        const used = await check(r);
        if (used !== null) r.used = used;
      }
    },
  };
});
vi.mock("@/lib/db/walletLinks", () => ({
  accountWalletsStrict: async (a: string) => {
    if (world.linksDown) throw new Error("connection reset");
    return world.links[a.toLowerCase()] ?? { account: a.toLowerCase(), wallets: [a.toLowerCase()] };
  },
}));
vi.mock("@/lib/onchain/freeIdentity", () => ({
  resolveFreeIdentity: async () => (world.identity.ok ? { ok: true, key: 1n, source: "x", fid: null, xUserId: "1", xCounts: true, account: P, wallets: [P] } : world.identity),
}));
vi.mock("@/lib/profile/session", async (orig) => ({ ...(await orig<typeof import("@/lib/profile/session")>()), sessionAddress: () => world.session }));
vi.mock("@/lib/auth/quickAuth", () => ({ getAuthedFid: async () => world.fid }));
vi.mock("@/lib/neynar", async (orig) => ({
  ...(await orig<typeof import("@/lib/neynar")>()),
  fidsByAddressesDetailed: async (addresses: string[]) => ({
    fids: new Map(addresses.filter((a) => world.fidWallets.has(a)).map((a) => [a, world.fidWallets.get(a)!])),
    answered: true,
  }),
}));
vi.mock("@/lib/onchain/reads", async (orig) => ({
  ...(await orig<typeof import("@/lib/onchain/reads")>()),
  readChainTime: async () => {
    if (world.chainDown) throw new Error("rpc down");
    return world.now;
  },
  getPublicClient: () => ({
    readContract: async ({ functionName, args }: { functionName: string; args?: readonly bigint[] }) => {
      if (functionName === "dictionaryRoot") return "0x" + "00".repeat(32);
      if (functionName === "gatedUntil") return BigInt(world.gatedUntil);
      if (functionName === "exists") return world.owned.has(world.ids.get(String(args?.[0])) ?? "");
      throw new Error(`unexpected read ${functionName}`);
    },
    getBlock: async () => ({ number: world.block, timestamp: BigInt(world.now) }),
    // `owner` is a list: every wallet the row's vouchers named, and the profile's wallets.
    getLogs: async ({ args, fromBlock, toBlock }: { args: { tokenId: bigint; owner: string[] }; fromBlock: bigint; toBlock: bigint }) => {
      world.logReads.push({ from: fromBlock, to: toBlock });
      if (world.logRangeLimit !== null && toBlock - fromBlock + 1n > world.logRangeLimit) throw new Error("query exceeds max block range");
      return world.claimedLogs.filter((l) => world.ids.get(String(args.tokenId)) === l.word && args.owner.map((o) => o.toLowerCase()).includes(l.wallet));
    },
  }),
}));

const WORDS = ["CRANE", "MOTEL", "GRAPE"];
function released(id: number, words: string[], perPlayerLimit = 1): WordSet {
  return {
    id, name: `set ${id}`, status: "released", revealAt: null, releaseAt: null, gateHours: 24, perPlayerLimit, sort: id,
    revealedAt: new Date(0), releasedAt: new Date((world.now - 3600) * 1000), gateUntil: new Date(world.gatedUntil * 1000), releaseBlock: 100, releaseRoot: "0x01",
    words: words.map((word) => ({ word, headliner: false })), ...STANDARD_FIELDS,
  };
}

const call = async (body: unknown) => {
  const { POST } = await import("@/app/api/sets/voucher/route");
  const res = await POST(new Request("http://localhost/api/sets/voucher", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json(), cache: res.headers.get("cache-control") };
};

beforeEach(async () => {
  vi.resetModules();
  const { tokenIdOf } = await import("@/lib/onchain/tokenId");
  Object.assign(world, {
    rows: [], nextId: 1, now: 1_800_000_000, gate: true, gatedUntil: 1_800_050_000, owned: new Set(), claimedLogs: [],
    chainDown: false, dbDown: false, linksDown: false, identity: { ok: true }, session: P, fid: null, fidWallets: new Map(), limited: new Set(),
    block: 5_000_000n, logReads: [], logRangeLimit: null,
    allowlist: new Set(), allowlistDown: false, balances: new Map(), balanceDown: new Set(), balanceReads: [],
    links: { [P]: { account: P, wallets: [P, L] }, [L]: { account: P, wallets: [P, L] } },
    ids: new Map([...WORDS, "ABOUT"].map((w) => [tokenIdOf(w).toString(), w])),
  });
  world.sets = [released(1, WORDS)];
});

describe("the counting rule", () => {
  const row = (id: number, word: string, used: boolean | null, wallet = P): VoucherRow => ({ id, account: P, wallet, named: [wallet], word, deadline: new Date(1_800_000_600_000), createdAt: new Date(1_800_000_000_000), used });
  it("a first word is new; the same word again is a renewal; a second word is the limit", () => {
    expect(decideVoucher([], "CRANE", 1)).toEqual({ kind: "new" });
    expect(decideVoucher([row(1, "CRANE", null)], "CRANE", 1)).toEqual({ kind: "renew", id: 1, revive: false });
    expect(decideVoucher([row(1, "CRANE", null)], "MOTEL", 1)).toEqual({ kind: "limit", words: ["CRANE"] });
  });
  it("a used voucher holds its slot for good, and the same word is still only a renewal", () => {
    expect(decideVoucher([row(1, "CRANE", true)], "MOTEL", 1)).toEqual({ kind: "limit", words: ["CRANE"] });
    expect(decideVoucher([row(1, "CRANE", true)], "CRANE", 1)).toEqual({ kind: "renew", id: 1, revive: false });
  });
  it("one that expired unused gives its slot back", () => {
    expect(holdsSlot(row(1, "CRANE", false))).toBe(false);
    expect(decideVoucher([row(1, "CRANE", false)], "MOTEL", 1)).toEqual({ kind: "new" });
  });
  it("the same word again after it expired unused revives its ONE row (the table keeps one per word)", () => {
    expect(decideVoucher([row(1, "CRANE", false)], "CRANE", 1)).toEqual({ kind: "renew", id: 1, revive: true });
  });
  it("but a freed word can't come back once another word took the slot", () => {
    expect(decideVoucher([row(1, "CRANE", false), row(2, "MOTEL", null)], "CRANE", 1)).toEqual({ kind: "limit", words: ["MOTEL"] });
    expect(decideVoucher([row(1, "CRANE", false), row(2, "MOTEL", null)], "CRANE", 2)).toEqual({ kind: "renew", id: 1, revive: true });
  });
  it("settling asks about every wallet a row was signed for, and the profile's wallets now", () => {
    expect(walletsToAsk({ wallet: L, named: [P, L] }, [P, O]).sort()).toEqual([L, O, P].sort());
  });
  it("a higher limit counts different words", () => {
    const rows = [row(1, "CRANE", true), row(2, "MOTEL", null)];
    expect(decideVoucher(rows, "GRAPE", 3)).toEqual({ kind: "new" });
    expect(decideVoucher(rows, "GRAPE", 2)).toEqual({ kind: "limit", words: ["CRANE", "MOTEL"] });
  });
  it("is settled only once the voucher can no longer be spent", () => {
    const r = row(1, "CRANE", null);
    const dl = Math.floor(r.deadline.getTime() / 1000);
    expect(dueToSettle(r, dl)).toBe(false);
    expect(dueToSettle(r, dl + SETTLE_AFTER_SECONDS)).toBe(false);
    expect(dueToSettle(r, dl + SETTLE_AFTER_SECONDS + 1)).toBe(true);
    expect(dueToSettle({ ...r, used: true }, dl + 9999)).toBe(false);
  });
});

describe("the digest the contract checks", () => {
  it("is Words.sol's, to the byte (a vector computed with `cast abi-encode` and `cast keccak`)", async () => {
    const { gatedClaimDigest, GATED_CLAIM_KIND } = await import("@/lib/onchain/digests");
    const { tokenIdOf } = await import("@/lib/onchain/tokenId");
    expect(GATED_CLAIM_KIND).toBe("0xf854ceb5114ccb2e03c74a76c4e7893adc21c1aa4fa859fbb91963203321ca87");
    expect(tokenIdOf("CRANE")).toBe(BigInt("0x053a04303a8853e6e41c7292210e5152aa36137238899a88dd3b25f2f7eee6d9"));
    // abi.encode(words, 84532, kind, caller, tokenId, 1800000000)
    expect(
      gatedClaimDigest({
        words: "0x00000000000000000000000000000000000000aa",
        caller: "0x00000000000000000000000000000000000000b1",
        tokenId: tokenIdOf("CRANE"),
        deadline: 1_800_000_000n,
      }),
    ).toBe("0x46d4977dd913ab45015bb3e2c695ed928941663130f3ee2cfc308af2c88f4d14");
  });
});

describe("POST /api/sets/voucher", () => {
  it("signs a voucher for the caller and the word, with a short deadline, that the signer recovers", async () => {
    const { status, body, cache } = await call({ wallet: P, word: "crane" });
    expect(status).toBe(200);
    expect(cache).toBe("no-store");
    expect(body.voucher.deadline).toBe(String(world.now + VOUCHER_TTL_SECONDS));
    expect(body.until).toBe(world.gatedUntil);
    const { gatedClaimDigest } = await import("@/lib/onchain/digests");
    const { addressOf } = await import("@/lib/onchain/addresses");
    const { tokenIdOf } = await import("@/lib/onchain/tokenId");
    const digest = gatedClaimDigest({ words: addressOf("words"), caller: P, tokenId: tokenIdOf("CRANE"), deadline: BigInt(body.voucher.deadline) });
    expect(await recoverMessageAddress({ message: { raw: digest }, signature: body.voucher.sig })).toBe(privateKeyToAccount(KEY).address);
    // recorded when issued
    expect(world.rows).toHaveLength(1);
    expect(world.rows[0]).toMatchObject({ account: P, wallet: P, word: "CRANE", used: null });
  });

  it("one word of a set per PROFILE: a second word is refused, from the same wallet or a linked one", async () => {
    expect((await call({ wallet: P, word: "CRANE" })).status).toBe(200);
    expect(await call({ wallet: P, word: "MOTEL" })).toMatchObject({ status: 409, body: { error: "limit_reached", words: ["CRANE"], limit: 1 } });
    world.session = L; // the linked wallet, signed in as itself
    expect(await call({ wallet: L, word: "MOTEL" })).toMatchObject({ status: 409, body: { error: "limit_reached", words: ["CRANE"] } });
    expect(world.rows).toHaveLength(1);
  });

  it("a wallet that took its word as a profile of its own, then joined, brings that word with it", async () => {
    world.links = {}; // L is unlinked: a profile of its own
    world.session = L;
    expect((await call({ wallet: L, word: "MOTEL" })).status).toBe(200);
    world.links = { [P]: { account: P, wallets: [P, L] }, [L]: { account: P, wallets: [P, L] } }; // L joins P
    world.session = P;
    expect(await call({ wallet: P, word: "CRANE" })).toMatchObject({ status: 409, body: { error: "limit_reached", words: ["MOTEL"] } });
  });

  it("the same word again is the same slot: from the same wallet, or the profile's other wallet", async () => {
    expect((await call({ wallet: P, word: "CRANE" })).status).toBe(200);
    world.now += 30;
    const again = await call({ wallet: P, word: "CRANE" });
    expect(again.status).toBe(200);
    expect(again.body.voucher.deadline).toBe(String(world.now + VOUCHER_TTL_SECONDS));
    world.session = L;
    expect((await call({ wallet: L, word: "CRANE" })).status).toBe(200);
    expect(world.rows).toHaveLength(1);
    expect(world.rows[0].wallet).toBe(L);
  });

  it("another profile has its own slot", async () => {
    expect((await call({ wallet: P, word: "CRANE" })).status).toBe(200);
    world.session = O;
    expect((await call({ wallet: O, word: "MOTEL" })).status).toBe(200);
  });

  it("a voucher that expired unused gives the slot back; one that was used never does", async () => {
    expect((await call({ wallet: P, word: "CRANE" })).status).toBe(200);
    // still spendable: the slot is held
    world.now += VOUCHER_TTL_SECONDS - 1;
    expect((await call({ wallet: P, word: "MOTEL" })).status).toBe(409);
    // past its deadline and the settle wait, and the chain shows no claim: free again
    world.now += SETTLE_AFTER_SECONDS + 5;
    expect((await call({ wallet: P, word: "MOTEL" })).status).toBe(200);
    expect(world.rows.find((r) => r.word === "CRANE")?.used).toBe(false);

    // MOTEL is claimed with its voucher, then dissolved (or sold on): nobody holds it under P now.
    world.claimedLogs.push({ wallet: P, word: "MOTEL" });
    world.now += VOUCHER_TTL_SECONDS + SETTLE_AFTER_SECONDS + 5;
    expect(await call({ wallet: P, word: "GRAPE" })).toMatchObject({ status: 409, body: { error: "limit_reached", words: ["MOTEL"] } });
    expect(world.rows.find((r) => r.word === "MOTEL")?.used).toBe(true);
  });

  it("the same word again after its voucher expired unused: signed again, never refused", async () => {
    // The common case: the player closed the wallet's prompt, and came back a quarter of an hour later.
    expect((await call({ wallet: P, word: "CRANE" })).status).toBe(200);
    world.now += VOUCHER_TTL_SECONDS + SETTLE_AFTER_SECONDS + 5;
    const again = await call({ wallet: P, word: "CRANE" });
    expect(again.status).toBe(200);
    expect(again.body.voucher.deadline).toBe(String(world.now + VOUCHER_TTL_SECONDS));
    expect(world.rows).toHaveLength(1); // its one row, holding a slot again
    expect(world.rows[0].used).toBeNull();
    expect((await call({ wallet: P, word: "MOTEL" })).status).toBe(409);
  });

  it("a renewal from a linked wallet doesn't hide the first wallet's claim", async () => {
    // P takes a voucher for CRANE. L (the same profile) asks for CRANE too, so the row names L now.
    // P claims with its own voucher, which was valid all along.
    expect((await call({ wallet: P, word: "CRANE" })).status).toBe(200);
    world.session = L;
    expect((await call({ wallet: L, word: "CRANE" })).status).toBe(200);
    expect(world.rows[0]).toMatchObject({ wallet: L, named: [P, L] });
    world.claimedLogs.push({ wallet: P, word: "CRANE" });
    // Past every deadline: the row is settled. The chain is asked about P too, so the slot is spent.
    world.now += VOUCHER_TTL_SECONDS + SETTLE_AFTER_SECONDS + 5;
    expect(await call({ wallet: L, word: "MOTEL" })).toMatchObject({ status: 409, body: { error: "limit_reached", words: ["CRANE"] } });
    expect(world.rows[0].used).toBe(true);
    world.session = P;
    expect((await call({ wallet: P, word: "GRAPE" })).status).toBe(409);
  });

  it("settling reads the chain from about when the voucher was made, never from the set's release", async () => {
    // The set was released at block 100; the chain is at 5,000,000. A read of all of that is
    // refused by a public RPC, and a read that always fails would hold an unused slot all day.
    expect((await call({ wallet: P, word: "CRANE" })).status).toBe(200);
    world.now += VOUCHER_TTL_SECONDS + SETTLE_AFTER_SECONDS + 5; // 725 s later
    expect((await call({ wallet: P, word: "MOTEL" })).status).toBe(200); // settled as unused: the slot is free
    expect(world.logReads).toHaveLength(1);
    const span = world.logReads[0].to - world.logReads[0].from;
    expect(world.logReads[0].to).toBe(5_000_000n);
    expect(span).toBeGreaterThanOrEqual(363n); // at least the 725 s since the voucher, at a block every 2 s
    expect(span).toBeLessThan(2_000n); // and nowhere near the 4,999,900 blocks since the release
  });

  it("and halves its span when an RPC still refuses it", async () => {
    world.logRangeLimit = 200n;
    expect((await call({ wallet: P, word: "CRANE" })).status).toBe(200);
    world.now += VOUCHER_TTL_SECONDS + SETTLE_AFTER_SECONDS + 5;
    expect((await call({ wallet: P, word: "MOTEL" })).status).toBe(200);
    expect(world.logReads.length).toBeGreaterThan(2);
    expect(world.rows.find((r) => r.word === "CRANE")?.used).toBe(false);
  });

  it("a higher per-player limit is that many different words", async () => {
    world.sets = [released(1, WORDS, 2)];
    expect((await call({ wallet: P, word: "CRANE" })).status).toBe(200);
    expect((await call({ wallet: P, word: "MOTEL" })).status).toBe(200);
    expect(await call({ wallet: P, word: "GRAPE" })).toMatchObject({ status: 409, body: { error: "limit_reached", limit: 2 } });
  });

  it("only a verified profile: the free letters' own answer is passed on", async () => {
    world.identity = { ok: false, status: 403, error: "verification_required" };
    expect(await call({ wallet: P, word: "CRANE" })).toMatchObject({ status: 403, body: { error: "verification_required", until: world.gatedUntil } });
    world.identity = { ok: false, status: 403, error: "x_too_young" };
    expect((await call({ wallet: P, word: "CRANE" })).body.error).toBe("x_too_young");
    expect(world.rows).toHaveLength(0);
  });

  it("only the wallet's own caller: no session and no Farcaster tie is a sign-in, and nothing is recorded", async () => {
    world.session = null;
    expect(await call({ wallet: P, word: "CRANE" })).toMatchObject({ status: 401, body: { error: "sign_in" } });
    world.session = O; // somebody else's session can't spend P's slot on a word P doesn't want
    expect((await call({ wallet: P, word: "CRANE" })).status).toBe(401);
    expect(world.rows).toHaveLength(0);
  });

  it("a session for any wallet of the profile will do, and so will a Farcaster sign-in Farcaster ties to it", async () => {
    world.session = L;
    expect((await call({ wallet: P, word: "CRANE" })).status).toBe(200);
    world.rows = [];
    world.session = null;
    world.fid = 77;
    expect((await call({ wallet: P, word: "CRANE" })).status).toBe(401); // a Farcaster sign-in nothing ties to this profile
    world.fidWallets = new Map([[L, [77]]]);
    expect((await call({ wallet: P, word: "CRANE" })).status).toBe(200);
  });

  it("only for a word of a released set, while the CHAIN says its gate is up, and only while nobody holds it", async () => {
    expect(await call({ wallet: P, word: "ABOUT" })).toMatchObject({ status: 409, body: { error: "not_gated" } }); // in no set
    world.gatedUntil = world.now; // lifted, whatever the set's stored time says
    expect((await call({ wallet: P, word: "CRANE" })).body.error).toBe("not_gated");
    world.gatedUntil = world.now + 100;
    world.owned = new Set(["CRANE"]);
    expect(await call({ wallet: P, word: "CRANE" })).toMatchObject({ status: 409, body: { error: "taken" } });
    expect(world.rows).toHaveLength(0);
  });

  it("an allowlist first day refuses a verified player who isn't on the list, and opens to everyone after it", async () => {
    world.sets = [{ ...released(1, WORDS), gateRule: "allowlist", gateLabel: "friends of the partner", allowlistCount: 1 }];
    world.links[O] = { account: O, wallets: [O] };
    world.allowlist = new Set([L]); // P's LINKED wallet is on the list; O is on no list
    world.session = O;
    // O is verified and proved the wallet, and still gets nothing: the list is one more rule.
    const refused = await call({ wallet: O, word: "CRANE" });
    expect(refused).toMatchObject({ status: 403, body: { error: "not_on_list", rule: "allowlist", label: "friends of the partner", until: world.gatedUntil } });
    expect(world.rows).toHaveLength(0);
    // The wallet that CLAIMS must be the listed one. P's own wallet isn't, so it is refused, and
    // told that a wallet of theirs qualifies; claiming with that wallet works.
    world.session = P;
    expect(await call({ wallet: P, word: "CRANE" })).toMatchObject({ status: 403, body: { error: "not_on_list", linked: true } });
    expect(world.rows).toHaveLength(0);
    expect((await call({ wallet: L, word: "CRANE" })).status).toBe(200);
    expect(world.rows[0]).toMatchObject({ account: P, wallet: L });
    // Not verified is still refused FIRST, list or no list: the list never stands in for it.
    world.identity = { ok: false, status: 403, error: "verification_required" };
    expect((await call({ wallet: L, word: "MOTEL" })).body.error).toBe("verification_required");
    world.identity = { ok: true };
    // A listed wallet lets ONE profile in: unlinked from P and linked into O's profile, it brings
    // its word with it, so O (verified, and now holding a listed wallet) is at the limit.
    world.links = { [P]: { account: P, wallets: [P] }, [O]: { account: O, wallets: [O, L] }, [L]: { account: O, wallets: [O, L] } };
    world.session = O;
    expect(await call({ wallet: L, word: "MOTEL" })).toMatchObject({ status: 409, body: { error: "limit_reached", words: ["CRANE"] } });
    // After the gate, nobody needs a voucher: the plain claim is the claim, for O too.
    world.gatedUntil = world.now;
    world.session = O;
    expect((await call({ wallet: O, word: "MOTEL" })).body.error).toBe("not_gated");
  });

  it("a list that can't be read issues nothing (never read as 'on it', never as 'not on it')", async () => {
    world.sets = [{ ...released(1, WORDS), gateRule: "allowlist", allowlistCount: 1 }];
    world.allowlist = new Set([P]);
    world.allowlistDown = true;
    expect(await call({ wallet: P, word: "CRANE" })).toMatchObject({ status: 503, body: { error: "try_again" } });
    expect(world.rows).toHaveLength(0);
  });

  it("a token first day asks Base for the balance when the voucher is asked for", async () => {
    const TOKEN = "0x4444444444444444444444444444444444444444";
    world.sets = [{ ...released(1, WORDS), gateRule: "token", gateToken: TOKEN, gateMin: "5" }];
    world.balances = new Map([[P, 4n], [L, 0n]]);
    expect(await call({ wallet: P, word: "CRANE" })).toMatchObject({ status: 403, body: { error: "not_on_list", rule: "token", linked: false } });
    // The claiming wallet first; the profile's other wallet only to say whether IT would do.
    expect(world.balanceReads).toEqual([{ token: TOKEN, wallet: P }, { token: TOKEN, wallet: L }]);
    world.balances.set(L, 5n); // the linked wallet holds enough: the claim must come from it
    expect(await call({ wallet: P, word: "CRANE" })).toMatchObject({ status: 403, body: { error: "not_on_list", linked: true } });
    expect((await call({ wallet: L, word: "CRANE" })).status).toBe(200);
    // The claiming wallet's balance can't be read: ask again, and nothing is issued.
    world.rows = [];
    world.balanceDown = new Set([L]);
    expect(await call({ wallet: L, word: "CRANE" })).toMatchObject({ status: 503, body: { error: "try_again" } });
    expect(world.rows).toHaveLength(0);
  });

  it("says nothing of a word in a set that isn't released: the same answer as any ungated word", async () => {
    world.sets = [{ ...released(1, WORDS), status: "revealed" }];
    expect(await call({ wallet: P, word: "CRANE" })).toMatchObject({ status: 409, body: { error: "not_gated" } });
    world.sets = [{ ...released(1, WORDS), status: "draft" }];
    expect((await call({ wallet: P, word: "MOTEL" })).body).toEqual({ ok: false, error: "not_gated" });
    expect(world.rows).toHaveLength(0);
  });

  it("signs nothing on a network whose Words has no gate", async () => {
    world.gate = false; // a Words deployed before the gate
    expect(await call({ wallet: P, word: "CRANE" })).toMatchObject({ status: 409, body: { error: "not_gated" } });
    expect(world.rows).toHaveLength(0);
  });

  it("refuses when anything it counts on can't be read", async () => {
    world.linksDown = true;
    expect(await call({ wallet: P, word: "CRANE" })).toMatchObject({ status: 503, body: { error: "try_again" } });
    world.linksDown = false;
    world.chainDown = true;
    expect((await call({ wallet: P, word: "CRANE" })).status).toBe(503);
    world.chainDown = false;
    world.dbDown = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call({ wallet: P, word: "CRANE" })).status).toBe(503);
    log.mockRestore();
  });

  it("bad input and rate limits", async () => {
    expect((await call({ wallet: "nope", word: "CRANE" })).status).toBe(400);
    expect((await call({ wallet: P, word: "QQQQQ" })).status).toBe(400);
    expect((await call({ wallet: P })).status).toBe(400);
    world.limited.add("set-voucher-ip");
    expect((await call({ wallet: P, word: "CRANE" })).status).toBe(429);
  });
});
