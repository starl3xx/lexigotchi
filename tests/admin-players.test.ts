/**
 * The Players tab's rows and funnel (lib/admin/playerRows.ts), the wallet-sighting beacon's rules
 * (lib/sightings.ts), and the two helpers that must never leak a secret: the server-key addresses
 * (lib/admin/serverKeys.ts) and the feature switches (lib/admin/switches.ts).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildPlayerRows, emptyActivity, funnelOf, groupPlayers, newSince, type PlayerInputs } from "@/lib/admin/playerRows";
import { parseSighting, utcDay } from "@/lib/sightings";
import { serverKey } from "@/lib/admin/serverKeys";

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const TEAM = "0x00000000000000000000000000000000000000c3";
const LETTERS = "0x00000000000000000000000000000000000000d4";
const T0 = Date.UTC(2026, 10, 24, 19, 0);

function inputs(over: Partial<PlayerInputs> = {}): PlayerInputs {
  const chain = new Map([
    [A, { ...emptyActivity(T0 + 60_000), faucet: 1, packs: 1, dailies: 1, reveals: 1, claims: 1 }],
    [TEAM, { ...emptyActivity(T0), faucet: 2, packs: 3, reveals: 3 }],
  ]);
  return {
    operators: new Set([TEAM]),
    contracts: new Set([LETTERS]),
    sightings: [
      { address: A, firstSeenAt: T0, lastSeenAt: T0 + 120_000, daysSeen: 1, firstVia: "web", lastVia: "web", fid: null },
      { address: B, firstSeenAt: T0 + 5_000, lastSeenAt: T0 + 5_000, daysSeen: 1, firstVia: "farcaster", lastVia: "farcaster", fid: 1017205 },
    ],
    chain,
    holdings: { letters: { [A]: { lower: 4, upper: 1 }, [LETTERS]: { lower: 99, upper: 0 } }, words: [{ owner: A, staked: true }] },
    profiles: [{ address: A, xUsername: "tester", emailConfirmed: true, emailReminders: true }],
    pushBrowsers: new Map([[A, 2]]),
    listings: new Map(),
    accountOf: (a) => a,
    faces: { [B]: { username: "coolhat", pfpUrl: null, source: "farcaster" } },
    ...over,
  };
}

describe("buildPlayerRows", () => {
  it("makes one row per wallet from any source, never one for a game contract", () => {
    const rows = buildPlayerRows(inputs());
    expect(rows.map((r) => r.address).sort()).toEqual([A, B, TEAM].sort());
  });

  it("merges a wallet's sources: earliest and latest trace, actions, holdings, profile flags", () => {
    const a = buildPlayerRows(inputs()).find((r) => r.address === A)!;
    expect(a.firstSeen).toBe(new Date(T0).toISOString()); // the sighting came first
    expect(a.lastSeen).toBe(new Date(T0 + 120_000).toISOString());
    expect(a.waiting).toBe(1); // a pack and a daily committed, one revealed
    expect(a.holds).toEqual({ letters: 5, upper: 1, words: 1, staked: 1 });
    expect([a.xUsername, a.emailConfirmed, a.emailReminders, a.pushBrowsers]).toEqual(["tester", true, true, 2]);
  });

  it("carries a verified FID and a public name, and marks the team", () => {
    const rows = buildPlayerRows(inputs());
    expect(rows.find((r) => r.address === B)).toMatchObject({ fid: 1017205, name: "coolhat" });
    expect(rows.find((r) => r.address === TEAM)?.operator).toBe(true);
  });

  it("carries no email address or push endpoint, whatever the inputs hold", () => {
    const leaky = inputs({
      profiles: [{ address: A, xUsername: null, emailConfirmed: true, emailReminders: false, email: "a@b.co" } as never],
    });
    const json = JSON.stringify(buildPlayerRows(leaky));
    expect(json).not.toContain("a@b.co");
    expect(json).not.toMatch(/endpoint|p256dh/);
  });

  it("names the account a linked wallet belongs to", () => {
    const rows = buildPlayerRows(inputs({ accountOf: (a) => (a === B ? A : a) }));
    expect(rows.find((r) => r.address === B)?.account).toBe(A);
    expect(rows.find((r) => r.address === A)?.account).toBeNull();
  });
});

describe("funnelOf and newSince", () => {
  it("count testers only, each wallet once", () => {
    const rows = buildPlayerRows(inputs());
    const f = funnelOf(rows);
    expect(f).toMatchObject({ any: 2, seen: 2, faucet: 1, letters: 1, words: 1, staked: 1, linkedX: 1, email: 1, reminders: 1 });
    expect(newSince(rows, T0 + 10 * 60_000, 60 * 60_000)).toBe(2);
    expect(newSince(rows, T0 + 2 * 86_400_000, 86_400_000)).toBe(0);
  });
});

describe("parseSighting", () => {
  it("takes a wallet and where the game runs, lowercased", () => {
    expect(parseSighting({ address: "0xAbC0000000000000000000000000000000000001", via: "farcaster" })).toEqual({
      address: "0xabc0000000000000000000000000000000000001",
      via: "farcaster",
    });
  });
  it("refuses anything else", () => {
    for (const body of [null, "x", {}, { address: "0x123", via: "web" }, { address: A, via: "telegram" }, { address: A }]) {
      expect(parseSighting(body)).toBeNull();
    }
  });
  it("uses the game's UTC day", () => {
    expect(utcDay(Date.UTC(2026, 10, 24, 23, 59))).toBe(20781);
    expect(utcDay(Date.UTC(2026, 10, 25, 0, 1))).toBe(20782);
  });
});

describe("serverKey", () => {
  it("gives the public address and never the key", () => {
    const key = generatePrivateKey();
    const k = serverKey("relayer", { RELAYER_PRIVATE_KEY: key });
    expect(k.address).toBe(privateKeyToAccount(key).address.toLowerCase());
    expect(JSON.stringify(k)).not.toContain(key.slice(2));
  });
  it("accepts a key without 0x, and says 'not set' or 'malformed' plainly", () => {
    const key = generatePrivateKey();
    expect(serverKey("signer", { SIGNER_PRIVATE_KEY: key.slice(2) }).address).toBe(
      privateKeyToAccount(key).address.toLowerCase(),
    );
    expect(serverKey("keeper", {})).toMatchObject({ configured: false, address: null, error: null });
    const bad = serverKey("keeper", { KEEPER_PRIVATE_KEY: "0xnot-a-key-secretish" });
    expect(bad).toMatchObject({ configured: true, address: null, error: "invalid_key" });
    expect(JSON.stringify(bad)).not.toContain("secretish");
  });
});

describe("featureSwitches", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("reports setting names, never their values", async () => {
    vi.stubEnv("X_CLIENT_SECRET", "x-secret-value-123");
    vi.stubEnv("RESEND_API_KEY", "re_secret_value_456");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "999:bot-token-value");
    const { featureSwitches } = await import("@/lib/admin/switches");
    const json = JSON.stringify(featureSwitches());
    for (const v of ["x-secret-value-123", "re_secret_value_456", "999:bot-token-value"]) expect(json).not.toContain(v);
    expect(json).toContain("PROFILES_ENABLED=true");
  });
});

describe("team wallets", () => {
  it("count a wallet linked into a team account as the team's, and leave it out of the funnel", () => {
    const rows = buildPlayerRows(inputs({ accountOf: (a) => (a === B ? TEAM : a) }));
    expect(rows.find((r) => r.address === B)?.operator).toBe(true);
    expect(funnelOf(rows).any).toBe(1);
  });
});

describe("groupPlayers: one row per player", () => {
  // B is linked into A's account: one player with two wallets (starl3xx, 2026-11-27: "this is one player").
  const linked = () => buildPlayerRows(inputs({ accountOf: (a) => (a === B ? A : a), chain: new Map([[A, { ...emptyActivity(T0 + 60_000), packs: 1, reveals: 1 }], [B, { ...emptyActivity(T0 + 90_000), packs: 2, claims: 1, reveals: 2 }]]) }));

  it("puts linked wallets in their account's row, the account first, and adds them up", () => {
    const players = groupPlayers(linked());
    expect(players.map((p) => p.address)).toEqual([A]);
    const a = players[0];
    expect(a.wallets.map((w) => w.address)).toEqual([A, B]);
    expect([a.packs, a.claims, a.waiting]).toEqual([3, 1, 0]);
    expect(a.holds).toEqual({ letters: 5, upper: 1, words: 1, staked: 1 });
    expect(a.fids).toEqual([1017205]); // B's verified sign-in
    expect(a.name).toBe("coolhat"); // the account has no name: a wallet's that has one
    expect(a.firstSeen).toBe(new Date(T0).toISOString());
    expect(a.lastSeen).toBe(new Date(T0 + 120_000).toISOString());
  });

  it("takes the busiest wallet's days as a floor, never a sum", () => {
    const a = groupPlayers(linked())[0];
    expect(a.sighting).toMatchObject({ days: 1, firstVia: "web", lastVia: "web" });
    expect(a.seenWallets).toBe(2);
  });

  it("counts the funnel and new players by player", () => {
    const players = groupPlayers(linked());
    expect(funnelOf(players).any).toBe(1);
    expect(newSince(players, T0 + 10 * 60_000, 60 * 60_000)).toBe(1);
  });

  it("marks a player the team's when any wallet is", () => {
    const players = groupPlayers(buildPlayerRows(inputs({ accountOf: (a) => (a === B ? TEAM : a) })));
    expect(players.find((p) => p.address === TEAM)).toMatchObject({ operator: true, wallets: [{ address: TEAM }, { address: B }] });
    expect(funnelOf(players).any).toBe(1);
  });

  it("carries no email address or push endpoint", () => {
    const json = JSON.stringify(
      groupPlayers(buildPlayerRows(inputs({ profiles: [{ address: A, xUsername: null, emailConfirmed: true, emailReminders: false, email: "a@b.co" } as never] }))),
    );
    expect(json).not.toContain("a@b.co");
    expect(json).not.toMatch(/endpoint|p256dh/);
  });
});

describe("groupPlayers never lists a wallet twice", () => {
  it("leaves a linked wallet with a row of its own in that row, whatever the link table says (Bugbot on #332)", () => {
    // The rows didn't group B under A (a link read that failed quietly), but the link table lists B under A.
    const players = groupPlayers(buildPlayerRows(inputs()), (account) => (account === A ? [A, B] : [account]));
    const listed = players.flatMap((p) => p.wallets.map((w) => w.address));
    expect(listed.filter((w) => w === B)).toHaveLength(1);
    expect(players.find((p) => p.address === A)?.wallets.map((w) => w.address)).toEqual([A]);
  });
});
