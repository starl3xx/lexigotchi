/**
 * Browser push (the Web Push protocol, VAPID-signed) — the reminder channel for players who have
 * no Farcaster account. Farcaster players keep the Neynar channel in `send.ts`; the senders skip
 * anyone that channel already reaches (`triggers.ts`), so nobody hears the same thing twice.
 *
 * SAFETY mirrors `send.ts`, three deep, with its OWN switch so this channel ships dark:
 *   1. NODE_ENV !== "production"  → hard stop. Dev, preview, and tests can never send.
 *   2. WEB_PUSH_ENABLED !== "true" → muted. Separate from NOTIFICATIONS_ENABLED on purpose: arming
 *      browser push must not depend on, or disturb, the Farcaster channel.
 *   3. WEB_PUSH_ENABLED=true in production without the VAPID keys → THROWS AT IMPORT, because a
 *      notifier that fails quietly looks exactly like one with nothing to say.
 *
 * Gone subscriptions (the push service answers 404 or 410: the player revoked permission, cleared
 * site data, or the browser rotated its endpoint) are deleted after each send. Other failures are
 * counted and left alone; a push service having a bad minute is not a reason to forget a player.
 */
import webpush from "web-push";
import { SITE_URL } from "@/lib/site";
import { LIMITS, clamp } from "./limits";
import type { Notification } from "./templates";
import { deleteWebPushEndpoints } from "@/lib/db/webPush";

if (process.env.NODE_ENV === "production" && process.env.WEB_PUSH_ENABLED === "true") {
  if (!process.env.VAPID_PRIVATE_KEY || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
    throw new Error(
      "[web-push] FATAL: VAPID_PRIVATE_KEY and NEXT_PUBLIC_VAPID_PUBLIC_KEY are required when WEB_PUSH_ENABLED=true in production",
    );
  }
}

export interface WebPushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface WebPushResult {
  ok: boolean;
  delivered?: number;
  /** Subscriptions the push service reported gone, now deleted. */
  gone?: number;
  failed?: number;
  /** Set when we declined to send — "dev", "muted", "unconfigured", "no-recipients". */
  skipped?: string;
}

type Sender = (
  sub: webpush.PushSubscription,
  payload: string,
  options: webpush.RequestOptions,
) => Promise<unknown>;

/** True only when a real send may happen. The NODE_ENV check is first and unconditional. */
export function webPushIsActive(): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  if (process.env.WEB_PUSH_ENABLED !== "true") return false;
  return Boolean(process.env.VAPID_PRIVATE_KEY && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
}

/** What the service worker (public/sw.js) receives. Same copy and limits as the Farcaster channel. */
export function buildWebPushPayload(n: Notification): string {
  return JSON.stringify({
    title: clamp(n.title, LIMITS.title),
    body: clamp(n.body, LIMITS.body),
    url: n.targetUrl ?? `${SITE_URL}/play`,
    // The notification's tag: a retried send REPLACES the shown notification instead of stacking.
    tag: n.notificationId,
  });
}

/** The push service's host, for a log line: an endpoint's path is the browser's secret. */
function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "an unreadable address";
  }
}

const CONCURRENCY = 50;
/** A reminder that arrives a day late is worse than none: hunger warnings are about the next ~30h. */
const TTL_SECONDS = 12 * 3600;

export async function sendWebPush(
  targets: readonly WebPushTarget[],
  note: Notification,
  deps: { send?: Sender; onGone?: (endpoints: string[]) => Promise<void> } = {},
): Promise<WebPushResult> {
  if (process.env.NODE_ENV !== "production") return { ok: false, skipped: "dev" };
  if (process.env.WEB_PUSH_ENABLED !== "true") return { ok: false, skipped: "muted" };
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return { ok: false, skipped: "unconfigured" };
  if (targets.length === 0) return { ok: false, skipped: "no-recipients" };
  // web-push throws on any other subject, which would fail every send one by one; say it once.
  const subject = process.env.VAPID_SUBJECT || SITE_URL;
  if (!/^(https:|mailto:)/.test(subject)) {
    console.error(`[web-push] VAPID subject must be https: or mailto: (got "${subject}"); set VAPID_SUBJECT`);
    return { ok: false, skipped: "unconfigured" };
  }

  const send = deps.send ?? webpush.sendNotification;
  const options: webpush.RequestOptions = {
    vapidDetails: { subject, publicKey, privateKey },
    TTL: TTL_SECONDS,
    urgency: "normal",
  };
  const payload = buildWebPushPayload(note);

  let delivered = 0;
  let failed = 0;
  const gone: string[] = [];
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const chunk = targets.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((t) => send({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payload, options)),
    );
    results.forEach((r, j) => {
      if (r.status === "fulfilled") return void delivered++;
      const status = (r.reason as { statusCode?: number } | undefined)?.statusCode;
      // Every push that didn't go out is logged with the service's answer and its HOST, never the
      // endpoint (the browser's secret address). "Gone" used to be silent, and the first real
      // opt-in vanished that way with nothing to read afterwards (lib/notify/confirmPush.ts).
      const host = hostOf(chunk[j].endpoint);
      if (status === 404 || status === 410) {
        gone.push(chunk[j].endpoint);
        console.warn(`[web-push] the push service says a subscription is gone: ${status} from ${host}`);
      } else {
        failed++;
        console.error(`[web-push] send failed: ${status ?? (r.reason instanceof Error ? r.reason.message : "unknown")} from ${host}`);
      }
    });
  }

  if (gone.length > 0) {
    try {
      await (deps.onGone ?? deleteWebPushEndpoints)(gone);
    } catch (err) {
      console.error("[web-push] pruning gone subscriptions failed:", err);
    }
  }
  return { ok: failed === 0, delivered, gone: gone.length, failed };
}
