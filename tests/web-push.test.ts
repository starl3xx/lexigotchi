import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseSubscriptionBody,
  isPushServiceHost,
  mayAddBrowser,
  MAX_SUBSCRIPTIONS_PER_ADDRESS,
  fidToStore,
  iosNeedsHomeScreen,
} from "@/lib/notify/webPushSubscription";
import { sendWebPush, buildWebPushPayload, webPushIsActive } from "@/lib/notify/webPush";
import {
  hungerTargetsByAddress,
  webPushHungerTargets,
  webPushDailyKey,
  webPushWinnerSubs,
  isDailyDue,
  dailyTargets,
  fidLookupFrom,
} from "@/lib/notify/triggers";
import { verifiedDailyKey } from "@/lib/onchain/verifications";
import { hungerWarning } from "@/lib/notify/templates";
import type { KeeperWord } from "@/lib/keeper/shares";
import { DEFAULT_PARAMS } from "@/lib/params";

/**
 * Browser push, the reminder channel for players with no Farcaster account. Three things are
 * pinned: the subscribe route can't be turned into a way to make our server call arbitrary URLs,
 * the sender can't fire outside an armed production, and nobody hears the same message twice.
 */

const KEY65 = Buffer.alloc(65, 4).toString("base64url"); // 87 chars, an uncompressed P-256 point's length
const KEY16 = Buffer.alloc(16, 7).toString("base64url"); // 22 chars
const A = "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const body = (endpoint: string, over: Record<string, unknown> = {}) => ({
  address: A,
  subscription: { endpoint, keys: { p256dh: KEY65, auth: KEY16 } },
  ...over,
});

afterEach(() => vi.unstubAllEnvs());

describe("subscription validation", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc:APA91b",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
    "https://web.push.apple.com/QGuQyavXutnMH6aE",
    "https://wns2-par02p.notify.windows.com/w/?token=BQYAAA",
  ])("accepts a real push service: %s", (endpoint) => {
    const r = parseSubscriptionBody(body(endpoint));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sub.address).toBe(A.toLowerCase());
  });

  it.each([
    ["http://fcm.googleapis.com/fcm/send/x", "bad_endpoint"], // not https
    ["https://169.254.169.254/latest/meta-data", "unknown_push_service"], // cloud metadata
    ["https://localhost/x", "unknown_push_service"],
    ["https://fcm.googleapis.com.evil.example/x", "unknown_push_service"], // suffix trick
    ["https://evilpush.apple.com/x", "unknown_push_service"], // not a dot-anchored subdomain
    ["https://user:pw@fcm.googleapis.com/x", "bad_endpoint"],
    ["https://fcm.googleapis.com:8443/x", "bad_endpoint"],
    ["not a url", "bad_endpoint"],
  ])("refuses %s", (endpoint, error) => {
    expect(parseSubscriptionBody(body(endpoint))).toEqual({ ok: false, error });
  });

  it("refuses keys of the wrong size and a non-address", () => {
    const ep = "https://fcm.googleapis.com/fcm/send/x";
    expect(parseSubscriptionBody({ ...body(ep), subscription: { endpoint: ep, keys: { p256dh: KEY16, auth: KEY16 } } })).toEqual({ ok: false, error: "bad_keys" });
    expect(parseSubscriptionBody({ ...body(ep), subscription: { endpoint: ep, keys: { p256dh: KEY65, auth: "!!" } } })).toEqual({ ok: false, error: "bad_keys" });
    expect(parseSubscriptionBody(body(ep, { address: "0x123" }))).toEqual({ ok: false, error: "bad_address" });
  });

  it("refuses a sixth browser for a wallet instead of evicting one, and always lets a known one refresh", () => {
    const a = A.toLowerCase();
    const full = MAX_SUBSCRIPTIONS_PER_ADDRESS;
    expect(mayAddBrowser(undefined, a, full - 1)).toBe(true); // room left
    expect(mayAddBrowser(undefined, a, full)).toBe(false); // new endpoint, wallet full → refused
    expect(mayAddBrowser(B, a, full)).toBe(false); // moving in from another wallet counts as new
    expect(mayAddBrowser(a, a, full)).toBe(true); // a browser already on this wallet refreshes
  });

  it("keeps a proven FID through tabs that haven't signed in, and drops it when the wallet changes", () => {
    const a = A.toLowerCase();
    expect(fidToStore({ address: a, fid: 42 }, a, null)).toBe(42); // new tab, no token: keep
    expect(fidToStore({ address: a, fid: 42 }, a, 7)).toBe(7); // a verified token always wins
    expect(fidToStore({ address: B, fid: 42 }, a, null)).toBeNull(); // moved to another wallet
    expect(fidToStore(undefined, a, null)).toBeNull();
  });

  it("sends iPhone and iPad tabs (including iPadOS's Mac user agent) to the Home Screen first", () => {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15";
    const ipadOS = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
    expect(iosNeedsHomeScreen(iphone, 5, false)).toBe(true);
    expect(iosNeedsHomeScreen(ipadOS, 5, false)).toBe(true);
    expect(iosNeedsHomeScreen(ipadOS, 0, false)).toBe(false); // a real Mac
    expect(iosNeedsHomeScreen(iphone, 5, true)).toBe(false); // already the Home Screen app
  });

  it("matches hosts exactly or on a dot boundary", () => {
    expect(isPushServiceHost("FCM.googleapis.com")).toBe(true);
    expect(isPushServiceHost("push.apple.com")).toBe(false);
    expect(isPushServiceHost("a.push.apple.com")).toBe(true);
  });
});

describe("sendWebPush guards", () => {
  const target = { endpoint: "https://fcm.googleapis.com/fcm/send/1", p256dh: KEY65, auth: KEY16 };
  const note = hungerWarning(1, 5, 20000);
  const arm = () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WEB_PUSH_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
  };

  it("never sends outside production, when muted, or unconfigured", async () => {
    const send = vi.fn();
    vi.stubEnv("NODE_ENV", "test");
    expect(await sendWebPush([target], note, { send })).toEqual({ ok: false, skipped: "dev" });
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WEB_PUSH_ENABLED", "");
    expect(await sendWebPush([target], note, { send })).toEqual({ ok: false, skipped: "muted" });
    vi.stubEnv("WEB_PUSH_ENABLED", "true");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    expect(await sendWebPush([target], note, { send })).toEqual({ ok: false, skipped: "unconfigured" });
    expect(send).not.toHaveBeenCalled();
    expect(webPushIsActive()).toBe(false);
  });

  it("refuses a contact URL web-push would reject, once, instead of failing every send", async () => {
    arm();
    vi.stubEnv("VAPID_SUBJECT", "http://localhost:3000");
    const send = vi.fn();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendWebPush([target], note, { send })).toEqual({ ok: false, skipped: "unconfigured" });
    errSpy.mockRestore();
    expect(send).not.toHaveBeenCalled();
  });

  it("builds a real encrypted request with the exact options it sends (web-push, no network)", async () => {
    arm();
    const { generateVAPIDKeys, generateRequestDetails } = (await import("web-push")).default;
    const vapid = generateVAPIDKeys();
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", vapid.publicKey);
    vi.stubEnv("VAPID_PRIVATE_KEY", vapid.privateKey);
    vi.stubEnv("VAPID_SUBJECT", "https://lexigotchi.example");
    const { createECDH, randomBytes } = await import("node:crypto");
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const real = { ...target, p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
    let built: ReturnType<typeof generateRequestDetails> | undefined;
    const res = await sendWebPush([real], note, {
      send: async (sub, payload, options) => {
        built = generateRequestDetails(sub, payload, options); // the library's own validation + encryption
      },
    });
    expect(res).toEqual({ ok: true, delivered: 1, gone: 0, failed: 0 });
    expect(built?.headers.TTL).toBe(43200);
    expect(built?.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(String(built?.headers.Authorization)).toMatch(/^vapid t=/);
  });

  it("is not armed by the Farcaster switch", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NOTIFICATIONS_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
    expect((await sendWebPush([target], note, { send: vi.fn() })).skipped).toBe("muted");
  });

  it("refuses an empty audience", async () => {
    arm();
    expect(await sendWebPush([], note, { send: vi.fn() })).toEqual({ ok: false, skipped: "no-recipients" });
  });

  it("deletes subscriptions the push service calls gone, and only those", async () => {
    arm();
    const targets = [1, 2, 3, 4].map((i) => ({ ...target, endpoint: `https://fcm.googleapis.com/fcm/send/${i}` }));
    const send = vi.fn(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith("/2")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      if (sub.endpoint.endsWith("/3")) throw Object.assign(new Error("not found"), { statusCode: 404 });
      if (sub.endpoint.endsWith("/4")) throw Object.assign(new Error("busy"), { statusCode: 503 });
    });
    const onGone = vi.fn(async () => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await sendWebPush(targets, note, { send, onGone });
    errSpy.mockRestore();
    expect(res).toEqual({ ok: false, delivered: 1, gone: 2, failed: 1 });
    expect(onGone).toHaveBeenCalledWith([targets[1].endpoint, targets[2].endpoint]);
  });

  it("sends the service worker's payload shape, tagged so a retry replaces rather than stacks", () => {
    const p = JSON.parse(buildWebPushPayload(note));
    expect(p).toMatchObject({ title: note.title, body: note.body, tag: note.notificationId });
    expect(p.url).toMatch(/\/play$/);
  });
});

describe("browser push audiences", () => {
  const DAY = 86_400;
  const HUNGRY_AT = DEFAULT_PARAMS.care.hungryAfterDays * DAY;
  const word = (owner: string, secondsLeft: number, staked = true): KeeperWord =>
    ({ tokenId: 1n, word: "ABOUT", owner: owner as `0x${string}`, staked, daysUnfed: 0, prestigeLevel: 0, upperAll: true, secondsUnfed: HUNGRY_AT - secondsLeft }) as KeeperWord;

  it("groups by wallet with the FID path's rules (staked, approaching, soonest wins)", () => {
    const t = hungerTargetsByAddress([word(A, 10 * 3600), word(A, 4 * 3600), word(B, 5 * 3600, false), word(B, -1)]);
    expect(t).toEqual([{ address: A.toLowerCase(), words: 2, hoursLeft: 4 }]);
  });

  it("warns only subscribed wallets that Farcaster doesn't already reach", () => {
    const byAddress = hungerTargetsByAddress([word(A, 3600), word(B, 3600)]);
    const subs = [{ address: A.toLowerCase(), fid: null }, { address: B, fid: null }];
    const fidOf = fidLookupFrom([{ fid: 9, linkedWallets: [B] }]); // B is a Farcaster player's wallet
    expect(webPushHungerTargets(byAddress, subs, fidOf).map((t) => t.address)).toEqual([A.toLowerCase()]);
  });

  it("reads the FID's daily slot when linked, the verified wallet's otherwise, and skips Farcaster's", () => {
    const farcaster = new Set([7]);
    expect(webPushDailyKey({ address: A.toLowerCase(), fid: 7 }, farcaster, verifiedDailyKey)).toBeNull();
    expect(webPushDailyKey({ address: A.toLowerCase(), fid: 8 }, farcaster, verifiedDailyKey)).toBe(8n);
    expect(webPushDailyKey({ address: A.toLowerCase(), fid: null }, farcaster, verifiedDailyKey)).toBe(verifiedDailyKey(A));
  });

  it("uses exactly the Farcaster daily rule", () => {
    const day = 20_000;
    for (const last of [0, day + 1, day, day - 6, day - 7]) {
      expect(isDailyDue(last, day)).toBe(dailyTargets([{ fid: 1, lastDailyDayPlusOne: last }], day).length === 1);
    }
  });

  it("tells the winner's browsers only when Farcaster can't reach the winner", () => {
    const subs = [{ address: A.toLowerCase(), fid: null }, { address: B, fid: null }];
    expect(webPushWinnerSubs(A, subs, fidLookupFrom([]))).toEqual([subs[0]]);
    expect(webPushWinnerSubs(A, subs, fidLookupFrom([{ fid: 1, linkedWallets: [A.toLowerCase()] }]))).toEqual([]);
    expect(webPushWinnerSubs(undefined, subs, fidLookupFrom([]))).toEqual([]);
  });
});

describe("arming without keys", () => {
  it("throws at import in production, so a misconfigured deploy fails loudly", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WEB_PUSH_ENABLED", "true");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    await expect(import("@/lib/notify/webPush")).rejects.toThrow(/VAPID/);
  });
});
