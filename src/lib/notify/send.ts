/**
 * Farcaster Mini App push notifications, sent through Neynar's managed service.
 *
 * WHY NEYNAR AND NOT OUR OWN WEBHOOK: a notification token is unique per
 * (client, mini app, FID) tuple — Warpcast and the Base App issue DIFFERENT tokens for the same
 * player. Owning that means a token table keyed `(fid, url)`, a JFS-verifying webhook route for
 * `miniapp_added` / `miniapp_removed` / `notifications_enabled` / `notifications_disabled`,
 * ≤100-token batching, and pruning on `invalidTokens`. Neynar absorbs every piece of that: we point
 * `webhookUrl` at their hosted endpoint (see `src/lib/site.ts`) and send by FID. Targeting — the part
 * that is actually ours, because it reads on-chain game state — stays here.
 *
 * SAFETY. Sending is guarded three deep, because the failure mode is unrecoverable: you cannot
 * un-push a notification to every player.
 *   1. NODE_ENV !== "production"  → hard stop. Dev and preview can NEVER send. Not a flag, not
 *      overridable; the first check in the function.
 *   2. NOTIFICATIONS_ENABLED !== "true" → muted. Lets production be silenced by a setting (which
 *      takes effect in the next build, so by a merge or a rollback: CLAUDE.md, redeploying).
 *   3. Missing NEYNAR_API_KEY in production with the flag on → THROWS AT IMPORT. A misconfigured
 *      notifier that fails quietly looks exactly like a notifier with nothing to say.
 *
 * Env is read at call time (not captured in module consts) so the guards are testable and so a
 * mid-session env change in the admin console takes effect without a restart.
 */

import { createHash } from "node:crypto";
import { SITE_URL } from "@/lib/site";
import { LIMITS, clamp } from "./limits";

// Re-exported so existing importers keep working; the definitions live in the side-effect-free
// module so importing them cannot trip the fail-fast throw below.
export { LIMITS, clamp };

const NEYNAR_NOTIFY_URL = "https://api.neynar.com/v2/farcaster/frame/notifications";

/**
 * Fail fast at boot rather than at 3am on the first real send. Deliberately module-scope: in
 * production with notifications armed, a missing key should stop the deploy, not degrade to
 * silence. Never fires under test (NODE_ENV === "test").
 */
if (process.env.NODE_ENV === "production" && process.env.NOTIFICATIONS_ENABLED === "true") {
  if (!process.env.NEYNAR_API_KEY) {
    throw new Error(
      "[notify] FATAL: NEYNAR_API_KEY is required when NOTIFICATIONS_ENABLED=true in production",
    );
  }
}

export interface NotifyResult {
  ok: boolean;
  /** How many FIDs the service accepted across all chunks. */
  delivered?: number;
  /** Set when nothing was sent: "dev", "muted", "unconfigured", "no-recipients", or "no-tokens" (the service knows no way to notify these FIDs). */
  skipped?: string;
  error?: string;
}

export interface NotifyInput {
  title: string;
  body: string;
  /** Must be same-origin with the manifest domain; defaults to the game. */
  targetUrl?: string;
  /**
   * Who to notify. `undefined` or `[]` means EVERY player with notifications enabled — a broadcast.
   * Pass explicit FIDs for anything personal.
   */
  targetFids?: number[];
  /**
   * Idempotency key. A retried send of the same id to the same people is one notification, which
   * makes a retried cron safe. Omit and the service assigns one (retries then duplicate: avoid).
   * It travels as a UUID made from this id and the audience (`notificationUuid`).
   */
  notificationId?: string;
}

/**
 * The service's `uuid` for a send: a real UUID, made from our own id and the people it goes to.
 *
 * It has to be a UUID. Neynar validates the field's FORMAT and refuses the whole request otherwise
 * ("Invalid body parameters"), and our ids are words ("paid-20784", "hunger-20784"). So every
 * Farcaster notification failed from the day the channel was armed until the first armed keeper run
 * showed it in the log (2026-11-27). No test caught it: none spoke to the service.
 *
 * The key is the id AND the player. Our ids name a DAY or an EVENT, not a player ("paid-20784" is
 * every player's payday that day): with the id alone, the service could read the second player's
 * request as a repeat of the first. And it must not be the id and the whole AUDIENCE, or a retried
 * send to a slightly different audience (someone took their letter meanwhile) would be a new key
 * and tell the others twice (Bugbot on #261). So a send with an id goes out ONE PLAYER A REQUEST
 * (`requests`, below), each with the key of that id and that player: a retry is the same key for
 * every player it reaches again, whoever else is in it.
 */
export function notificationUuid(id: string, fids?: readonly number[]): string {
  const audience = fids && fids.length > 0 ? [...fids].sort((a, b) => a - b).join(",") : "everyone";
  const bytes = Buffer.from(createHash("sha256").update(`lexigotchi:notification:${id}|${audience}`).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5: an id made from a name
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // the RFC 4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** True only when a real send may happen. The NODE_ENV check is first and unconditional. */
export function notificationsAreActive(): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  if (process.env.NOTIFICATIONS_ENABLED !== "true") return false;
  return Boolean(process.env.NEYNAR_API_KEY);
}

/**
 * The requests one send makes. A broadcast (no list) is one request. A send WITH an id is one
 * request a player, so each carries that player's own key (`notificationUuid` says why). A send
 * with no id has no key to keep, and goes in chunks of up to 100 FIDs.
 *
 * One request a player is right for a game this size and wrong for a big one: at some thousands of
 * players the daily reminder would outrun the service's rate limit and the cron's time. Before
 * then, learn from the service whether its key is kept per player, and batch again if it is.
 */
function requests(fids: number[] | undefined, keyed: boolean): (number[] | undefined)[] {
  if (!fids || fids.length === 0) return [undefined];
  if (keyed) return [...new Set(fids)].map((fid) => [fid]);
  const out: number[][] = [];
  for (let i = 0; i < fids.length; i += LIMITS.fidsPerRequest) {
    out.push(fids.slice(i, i + LIMITS.fidsPerRequest));
  }
  return out;
}

/** How many requests are in flight at once. */
const CONCURRENCY = 5;

/**
 * Build the exact request body we'd POST, with every field clamped. Exported so the admin console
 * and tests can inspect a send WITHOUT performing one — a dry run is the only safe way to preview
 * copy, since there is no way to recall a push.
 */
export function buildPayload(input: NotifyInput, fids?: number[]) {
  const targetUrl = input.targetUrl ?? `${SITE_URL}/play`;
  return {
    notification: {
      title: clamp(input.title, LIMITS.title),
      body: clamp(input.body, LIMITS.body),
      target_url: clamp(targetUrl, LIMITS.targetUrl),
      ...(input.notificationId ? { uuid: notificationUuid(input.notificationId, fids) } : {}),
    },
    target_fids: fids ?? [],
  };
}

/**
 * Send a push. Returns a result rather than throwing — a failed notification must never take down
 * the keeper pass or cron that triggered it. The game state is the source of truth; the push is a
 * courtesy on top of it.
 */
export async function sendNotification(input: NotifyInput): Promise<NotifyResult> {
  if (process.env.NODE_ENV !== "production") {
    return { ok: false, skipped: "dev" };
  }
  if (process.env.NOTIFICATIONS_ENABLED !== "true") {
    return { ok: false, skipped: "muted" };
  }
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) {
    console.error("[notify] missing NEYNAR_API_KEY");
    return { ok: false, skipped: "unconfigured" };
  }
  // An empty-after-filtering audience must NOT fall through to a broadcast. This is the difference
  // between "nobody's words are hungry today" and "tell all 10,000 players their words are hungry".
  if (input.targetFids && input.targetFids.length === 0) {
    return { ok: false, skipped: "no-recipients" };
  }

  let delivered = 0;
  let noTokens = 0;
  let failed = 0;
  let error: string | undefined;
  /** One request. A failure is its own: it doesn't stop the other players' requests. */
  const post = async (chunk: number[] | undefined): Promise<void> => {
    try {
      const res = await fetch(NEYNAR_NOTIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify(buildPayload(input, chunk)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Nobody in this request can be notified any more (they removed the app, or turned
        // notifications off since the audience was read): nothing to send, and not a failure.
        if (data?.code === "NoNotificationTokens") return void noTokens++;
        // The service's own reason, and which field it refused: "Invalid body parameters" alone
        // said nothing about the uuid.
        const why = [data?.message ?? `HTTP ${res.status}`, typeof data?.errors === "string" ? data.errors.slice(0, 200) : ""].filter(Boolean).join(" ");
        console.error("[notify] send failed:", why);
        failed++;
        error ??= data?.message ?? `HTTP ${res.status}`;
        return;
      }
      delivered += Number(data?.notification_deliveries?.length ?? chunk?.length ?? 0);
    } catch (err) {
      console.error("[notify] send threw:", err);
      failed++;
      error ??= err instanceof Error ? err.message : "unknown";
    }
  };
  const all = requests(input.targetFids, Boolean(input.notificationId));
  for (let i = 0; i < all.length; i += CONCURRENCY) {
    await Promise.all(all.slice(i, i + CONCURRENCY).map(post));
  }
  if (failed > 0) return { ok: false, delivered, error };
  // Nothing went out because nobody asked for could be notified: not "ok" (a caller that counts
  // who was told must not count them), and not an error either.
  if (delivered === 0 && noTokens > 0) return { ok: false, delivered: 0, skipped: "no-tokens" };
  return { ok: true, delivered };
}
