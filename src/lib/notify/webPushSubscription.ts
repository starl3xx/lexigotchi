/**
 * Validating a browser push subscription before we store it. Pure and side-effect free, so the
 * rules are pinned by tests rather than buried in a route.
 *
 * WHY AN ALLOWLIST OF PUSH SERVICES. A subscription's `endpoint` is a URL the BROWSER hands us, and
 * every later send is our server POSTing to it. Accept any URL and the subscribe route becomes a
 * way to make our server send requests wherever someone likes: internal addresses, cloud metadata
 * endpoints, or a third party we would be hammering on their behalf. Real endpoints only ever live
 * on a handful of push services, so anything else is refused here, before it reaches the table.
 */
import { isAddress } from "viem";

/**
 * The push services the major browsers use. Exact hosts, or a dot-anchored suffix for services that
 * shard across subdomains (Mozilla, Apple, Windows). Add a host only after seeing a real endpoint on it.
 */
const PUSH_HOSTS: readonly string[] = [
  "fcm.googleapis.com", // Chrome, Android, Brave, Opera, Samsung Internet
  "updates.push.services.mozilla.com", // Firefox
  "web.push.apple.com", // Safari, iOS home-screen apps
];
const PUSH_HOST_SUFFIXES: readonly string[] = [
  ".push.services.mozilla.com",
  ".push.apple.com",
  ".notify.windows.com", // Edge (Windows Push Notification Service)
];

export function isPushServiceHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return PUSH_HOSTS.includes(h) || PUSH_HOST_SUFFIXES.some((s) => h.endsWith(s) && h.length > s.length);
}

/** A browser can follow one wallet; one wallet can be followed from a few browsers, not hundreds. */
export const MAX_SUBSCRIPTIONS_PER_ADDRESS = 5;

/**
 * May this endpoint be stored for `address`? A browser already following this wallet may always
 * refresh its row. Anything that ADDS a browser to the wallet (a new endpoint, or one moving over from
 * another wallet) needs a free slot. A full wallet refuses; it never evicts (see saveWebPushSubscription).
 */
export function mayAddBrowser(currentAddressOfEndpoint: string | undefined, address: string, browsersForAddress: number): boolean {
  if (currentAddressOfEndpoint === address) return true;
  return browsersForAddress < MAX_SUBSCRIPTIONS_PER_ADDRESS;
}

const MAX_ENDPOINT_LENGTH = 1024;

/** Decoded byte length of a base64url string, or -1 when it isn't one. */
function base64UrlBytes(s: unknown): number {
  if (typeof s !== "string" || s.length === 0 || s.length > 256) return -1;
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(s)) return -1;
  const body = s.replace(/=+$/, "");
  if (body.length % 4 === 1) return -1;
  return Math.floor((body.length * 3) / 4);
}

/**
 * The FID to store with a subscribe call. A call without a verified Farcaster token keeps the stored
 * FID while the wallet is unchanged: the web session is tab-scoped, so "no token" only means this
 * tab hasn't signed in. A different wallet starts over, since the FID was proven beside the old one.
 */
export function fidToStore(
  existing: { address: string; fid: number | null } | undefined,
  address: string,
  verifiedFid: number | null,
): number | null {
  if (verifiedFid !== null) return verifiedFid;
  return existing?.address === address ? existing.fid : null;
}

/** iPhone, iPod, or iPad Safari in a browser tab, where iOS offers no push until Add to Home Screen. */
export function iosNeedsHomeScreen(userAgent: string, maxTouchPoints: number, standalone: boolean): boolean {
  // iPadOS Safari reports a Mac user agent; a "Mac" with a touch screen is an iPad.
  const iPadOS = /Macintosh/.test(userAgent) && maxTouchPoints > 1;
  return (/iPhone|iPad|iPod/.test(userAgent) || iPadOS) && !standalone;
}

export interface ParsedSubscription {
  address: string; // lowercase
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type ParseResult = { ok: true; sub: ParsedSubscription } | { ok: false; error: string };

/**
 * Body: `{ address, subscription: PushSubscriptionJSON }` — exactly what
 * `PushSubscription.toJSON()` produces in the browser, plus the wallet it should follow.
 */
export function parseSubscriptionBody(body: unknown): ParseResult {
  const b = body as { address?: unknown; subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } };
  // strict: false — wallets report lowercase addresses, and a checksum rejection would refuse a real one.
  if (typeof b?.address !== "string" || !isAddress(b.address, { strict: false })) return { ok: false, error: "bad_address" };

  const endpoint = b.subscription?.endpoint;
  if (typeof endpoint !== "string" || endpoint.length > MAX_ENDPOINT_LENGTH) return { ok: false, error: "bad_endpoint" };
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, error: "bad_endpoint" };
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    return { ok: false, error: "bad_endpoint" };
  }
  if (!isPushServiceHost(url.hostname)) return { ok: false, error: "unknown_push_service" };

  // p256dh is an uncompressed P-256 public key (65 bytes); auth is a 16-byte secret (RFC 8291).
  const p256dh = b.subscription?.keys?.p256dh;
  const auth = b.subscription?.keys?.auth;
  if (base64UrlBytes(p256dh) !== 65 || base64UrlBytes(auth) !== 16) return { ok: false, error: "bad_keys" };

  return {
    ok: true,
    sub: { address: b.address.toLowerCase(), endpoint, p256dh: p256dh as string, auth: auth as string },
  };
}

// ── Why turning reminders on failed ──────────────────────────────────────────────────────────────
/** The three things "Turn on reminders" does after the permission: each can fail by itself. */
export type EnableStep = "worker" | "subscribe" | "save";

/**
 * What to tell a player when "Turn on reminders" fails: the cause and what to try, and the
 * browser's own words (`detail`) so a report can name it. One sentence for every failure hid the
 * cause: the first real tap in production failed inside the browser's own subscribe step, before
 * any request to us, and the screen said only "try again in a moment" (starl3xx, 2026-11-26).
 * Pure, so the wording is tested.
 */
export function enableFailure(step: EnableStep, err: unknown): { message: string; detail: string | null } {
  const e = (err ?? {}) as { name?: unknown; message?: unknown; status?: unknown };
  const name = typeof e.name === "string" ? e.name : "";
  const text = typeof e.message === "string" ? e.message : "";
  const status = typeof e.status === "number" ? e.status : undefined;
  // The browser's words, short, and never an address: a push endpoint is a secret of the browser.
  const said = [name, text].filter(Boolean).join(": ").replace(/https?:\/\/\S+/g, "[address]").slice(0, 140);
  const detail = said || null;

  if (step === "save") {
    if (status === 409) return { message: "This wallet already gets reminders in five browsers. Turn them off in one of those first.", detail: null };
    if (status !== undefined) return { message: `Lexigotchi couldn’t save your reminders (the server answered ${status}). Try again in a moment.`, detail };
    return { message: "Couldn’t reach Lexigotchi to save your reminders. Check your connection, or a content blocker, then try again.", detail };
  }
  if (step === "worker") return { message: "This browser couldn’t set up reminders. Reload the page and try again.", detail };

  // The browser's own subscribe. Chrome words all of these "Registration failed - …".
  if (name === "NotAllowedError" || /permission denied/i.test(text)) {
    return {
      message: "This browser won’t allow notifications here. Check that they are allowed for this site, and for the browser itself in your system settings, and that this isn’t a private window.",
      detail,
    };
  }
  if (/push service|gcm|network/i.test(text)) {
    return {
      message:
        "This browser couldn’t reach its notification service. A VPN, a firewall, or a content blocker can stop it. In Brave, turn on “Use Google services for push messaging” in Settings. Then try again.",
      detail,
    };
  }
  return { message: "This browser couldn’t turn on notifications for Lexigotchi. Restart the browser and try again.", detail };
}
