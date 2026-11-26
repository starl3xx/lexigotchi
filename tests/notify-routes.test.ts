/**
 * The two routes that now send a notification after they answer:
 *   - GET /api/market/sales tells the sellers of the sales its catch-up found (lib/notify/sold.ts);
 *   - POST /api/push/subscribe sends a browser one push when it first opts in ("Reminders are on").
 * Both are public routes the game depends on, so the rule under test is that the notification can
 * never break or repeat: it is imported at the moment of use, inside a catch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const NOW = Date.now();
const row = (i: number) => ({
  chainId: 84532, txHash: `0x${String(i).padStart(64, "0")}`, logIndex: i, blockNumber: 100 + i, soldAt: new Date(NOW - 60_000),
  kind: "letter", orderHash: `0x${"e".repeat(64)}`, seller: "0x00000000000000000000000000000000000000aa", buyer: "0x00000000000000000000000000000000000000cc",
  word: null, tier: null, letterId: 22, qty: 1, priceWei: "1300000000000000000000000", feeWei: "130000000000000000000000",
});
/** Long enough for work started after the answer (a lazy import, then the send) to have run. */
const settle = () => new Promise((r) => setTimeout(r, 400));

beforeEach(() => {
  vi.resetModules();
  vi.doMock("@/lib/ratelimit", () => ({ allow: async () => true }));
});
afterEach(() => {
  for (const m of ["@/lib/ratelimit", "@/lib/onchain/addresses", "@/lib/db/market", "@/lib/market/sales", "@/lib/market/faces", "@/lib/notify/sold", "@/lib/db/client", "@/lib/db/webPush", "@/lib/notify/webPush", "@/lib/auth/quickAuth"]) vi.doUnmock(m);
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
});

describe("GET /api/market/sales", () => {
  function mockSales(fresh: unknown[][]) {
    let call = 0;
    vi.doMock("@/lib/onchain/addresses", () => ({ isSuiteDeployed: () => true }));
    vi.doMock("@/lib/db/market", () => ({
      marketTables: async () => ({ letters: true, sales: true }),
      recentSales: async () => [],
      letterSaleStats: async () => [],
      tierSaleStats: async () => [],
    }));
    vi.doMock("@/lib/market/faces", () => ({ marketFaces: async () => ({}) }));
    vi.doMock("@/lib/market/sales", () => ({
      catchUpSales: async (opts: { onNew?: (rows: unknown[]) => void } = {}) => {
        const rows = fresh[call++] ?? [];
        if (rows.length) opts.onNew?.(rows);
        if (failAfter) throw new Error("the RPC refused a receipt");
        return { recorded: rows.length, through: 1 };
      },
    }));
  }
  let failAfter = false;
  beforeEach(() => {
    failAfter = false;
  });
  const get = async (q = "") => (await import("@/app/api/market/sales/route")).GET(new Request(`https://lexigotchi.test/api/market/sales${q}`));

  it("tells the sellers of the sales its catch-up was first to record, once", async () => {
    mockSales([[row(1), row(2)], []]);
    const told: unknown[][] = [];
    vi.doMock("@/lib/notify/sold", () => ({ notifySold: async (rows: unknown[]) => void told.push(rows) }));
    expect((await get()).status).toBe(200);
    await vi.waitFor(() => expect(told).toHaveLength(1), { timeout: 3000 });
    expect(told[0]).toHaveLength(2);
    // a second request finds nothing new, and tells nobody again
    expect((await get("?fresh=1")).status).toBe(200);
    await settle();
    expect(told).toHaveLength(1);
  });

  it("still tells of the sales a catch-up recorded before it failed (a row is only new once)", async () => {
    mockSales([[row(1)]]);
    failAfter = true;
    const told: unknown[][] = [];
    vi.doMock("@/lib/notify/sold", () => ({ notifySold: async (rows: unknown[]) => void told.push(rows) }));
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await get()).status).toBe(200);
    await vi.waitFor(() => expect(told).toHaveLength(1), { timeout: 3000 });
    quiet.mockRestore();
  });

  it("tells nobody when the catch-up found nothing new", async () => {
    mockSales([[]]);
    const told = vi.fn();
    vi.doMock("@/lib/notify/sold", () => ({ notifySold: told }));
    expect((await get()).status).toBe(200);
    await settle();
    expect(told).not.toHaveBeenCalled();
  });

  it("still answers when the notifier can’t even be loaded (a sender armed without its keys throws at import)", async () => {
    mockSales([[row(1)]]);
    vi.doMock("@/lib/notify/sold", () => {
      throw new Error("[notify] FATAL: NEYNAR_API_KEY is required when NOTIFICATIONS_ENABLED=true in production");
    });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    await settle();
    quiet.mockRestore();
  });
});

describe("POST /api/push/subscribe", () => {
  const SUB = {
    address: "0x00000000000000000000000000000000000000aa",
    subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/abc123", keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } },
  };
  function mockSubscribe(saved: "new" | "saved" | "full") {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-public-key";
    vi.doMock("@/lib/db/client", () => ({ isCampaignConfigured: () => true }));
    vi.doMock("@/lib/db/webPush", () => ({ saveWebPushSubscription: async () => saved }));
    vi.doMock("@/lib/auth/quickAuth", () => ({ getAuthedFid: async () => null }));
  }
  const post = async () =>
    (await import("@/app/api/push/subscribe/route")).POST(
      new Request("https://lexigotchi.test/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(SUB) }),
    );

  it("sends a browser ONE push when it first opts in, to that browser only", async () => {
    mockSubscribe("new");
    const sent: { to: { endpoint: string }[]; title: string }[] = [];
    vi.doMock("@/lib/notify/webPush", () => ({ sendWebPush: async (to: { endpoint: string }[], note: { title: string }) => (sent.push({ to, title: note.title }), { ok: true }) }));
    const res = await post();
    expect(await res.json()).toEqual({ ok: true });
    // after the answer: the sender and the template load at the moment of use
    await vi.waitFor(() => expect(sent).toHaveLength(1), { timeout: 3000 });
    expect(sent[0].to.map((t) => t.endpoint)).toEqual([SUB.subscription.endpoint]);
    expect(sent[0].title).toBe("Reminders are on");
  });

  it("sends nothing when the browser was already subscribed (the hook re-sends on a wallet change)", async () => {
    mockSubscribe("saved");
    const send = vi.fn();
    vi.doMock("@/lib/notify/webPush", () => ({ sendWebPush: send }));
    expect(await (await post()).json()).toEqual({ ok: true });
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing to a browser it refused", async () => {
    mockSubscribe("full");
    const send = vi.fn();
    vi.doMock("@/lib/notify/webPush", () => ({ sendWebPush: send }));
    expect((await post()).status).toBe(409);
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it("still subscribes when the sender can’t be loaded", async () => {
    mockSubscribe("new");
    vi.doMock("@/lib/notify/webPush", () => {
      throw new Error("[web-push] FATAL: VAPID_PRIVATE_KEY and NEXT_PUBLIC_VAPID_PUBLIC_KEY are required");
    });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await (await post()).json()).toEqual({ ok: true });
    await settle();
    quiet.mockRestore();
  });
});
