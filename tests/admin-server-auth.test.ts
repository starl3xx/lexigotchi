/**
 * The server gate on the admin routes that list players or name this deployment's keys
 * (lib/admin/serverAuth.ts, /api/admin/players, /api/admin/system). Pinned here: only a PROVEN
 * allowlisted credential passes; the console's "open" flag never opens them in production; a refusal
 * names its fix and never the allowlist; and the routes check before they read anything.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { adminDecision, refusalBody } from "@/lib/admin/serverAuth";
import { issueSession } from "@/lib/profile/session";

const OP = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const STRANGER = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const wallets = new Set([OP]);
const fids = new Set(["6500"]);
const none = new Set<string>();

describe("adminDecision", () => {
  it("is open in development with no allowlist, and closed in production with none", () => {
    expect(adminDecision({ isProd: false, wallets: none, fids: none, sessionWallet: null, fid: null })).toMatchObject({ ok: true, via: "dev" });
    expect(adminDecision({ isProd: true, wallets: none, fids: none, sessionWallet: null, fid: null })).toMatchObject({
      ok: false,
      status: 503,
      error: "not_configured",
    });
  });

  it("asks for a sign-in when nothing was proven, in any environment that has a list", () => {
    for (const isProd of [true, false]) {
      expect(adminDecision({ isProd, wallets, fids, sessionWallet: null, fid: null })).toMatchObject({ ok: false, status: 401 });
    }
  });

  it("lets in an allowlisted wallet session or FID, case-insensitively", () => {
    expect(adminDecision({ isProd: true, wallets, fids, sessionWallet: OP.toUpperCase().replace("0X", "0x"), fid: null })).toMatchObject({
      ok: true,
      via: "wallet",
    });
    expect(adminDecision({ isProd: true, wallets, fids, sessionWallet: null, fid: 6500 })).toMatchObject({ ok: true, via: "fid" });
  });

  it("refuses a proven wallet session that isn't on the list, with 403", () => {
    expect(adminDecision({ isProd: true, wallets, fids, sessionWallet: STRANGER, fid: null })).toMatchObject({ status: 403, who: STRANGER });
    expect(adminDecision({ isProd: true, wallets, fids, sessionWallet: STRANGER, fid: 42 })).toMatchObject({ status: 403, who: STRANGER });
  });

  it("still offers the wallet sign-in when only a FID off the list came along", () => {
    // Inside a Farcaster host every request carries a FID; a wallet-only operator must still get in.
    expect(adminDecision({ isProd: true, wallets, fids, sessionWallet: null, fid: 42 })).toMatchObject({ status: 401, error: "sign_in" });
    expect(adminDecision({ isProd: true, wallets, fids: none, sessionWallet: OP, fid: 42 })).toMatchObject({ ok: true, via: "wallet" });
  });

  it("names the fix, never an allowlisted wallet", () => {
    const body = refusalBody({ ok: false, status: 403, error: "not_allowed", who: STRANGER });
    expect(JSON.stringify(body)).not.toContain(OP);
    expect(body.hint).toMatch(/NEXT_PUBLIC_ADMIN_WALLETS/);
  });
});

// ── the routes ────────────────────────────────────────────────────────────────────────────────
const SECRET = "test-secret-that-is-at-least-32-characters-long";
const loadPlayers = vi.fn(async () => ({ ok: true, rows: [] }));
const loadSystem = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/admin/playersData", () => ({ loadPlayers: () => loadPlayers() }));
vi.mock("@/lib/admin/systemStatus", () => ({ loadSystem: () => loadSystem() }));
vi.mock("@/lib/auth/quickAuth", () => ({ getAuthedFid: async () => null }));

const get = (path: string, token?: string) =>
  new Request(`http://localhost${path}`, { headers: token ? { "x-lexigotchi-session": token } : {} });

describe("the gated admin routes", () => {
  beforeEach(() => {
    vi.stubEnv("PROFILE_SESSION_SECRET", SECRET);
    vi.stubEnv("NEXT_PUBLIC_ADMIN_WALLETS", OP);
    vi.stubEnv("NEXT_PUBLIC_ADMIN_FIDS", "");
    vi.stubEnv("NEXT_PUBLIC_ADMIN_OPEN", "1"); // the console's master override: must NOT open these in production
    loadPlayers.mockClear();
    loadSystem.mockClear();
  });

  it("refuse without a credential and read nothing", async () => {
    const players = await import("@/app/api/admin/players/route");
    const system = await import("@/app/api/admin/system/route");
    const a = await players.GET(get("/api/admin/players"));
    const b = await system.GET(get("/api/admin/system"));
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.headers.get("cache-control")).toBe("no-store");
    expect(loadPlayers).not.toHaveBeenCalled();
    expect(loadSystem).not.toHaveBeenCalled();
  });

  it("refuse a stranger's real session with 403", async () => {
    const { GET } = await import("@/app/api/admin/players/route");
    const res = await GET(get("/api/admin/players", issueSession(SECRET, STRANGER).token));
    expect(res.status).toBe(403);
    expect(loadPlayers).not.toHaveBeenCalled();
  });

  it("refuse a forged session", async () => {
    const { GET } = await import("@/app/api/admin/system/route");
    const forged = issueSession("a-different-secret-that-is-also-32-chars!!", OP).token;
    expect((await GET(get("/api/admin/system", forged))).status).toBe(401);
  });

  it("serve the operator's session, never into a shared cache", async () => {
    const { GET } = await import("@/app/api/admin/players/route");
    const res = await GET(get("/api/admin/players?fresh=1", issueSession(SECRET, OP).token));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(loadPlayers).toHaveBeenCalledTimes(1);
  });

  it("stay closed in production with no allowlist, even with the open flag", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_WALLETS", "");
    vi.stubEnv("NODE_ENV", "production");
    const { GET } = await import("@/app/api/admin/system/route");
    const res = await GET(get("/api/admin/system", issueSession(SECRET, OP).token));
    expect(res.status).toBe(503);
    expect(loadSystem).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
