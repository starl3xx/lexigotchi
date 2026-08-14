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
 *   2. NOTIFICATIONS_ENABLED !== "true" → muted. Lets production be silenced without a deploy.
 *   3. Missing NEYNAR_API_KEY in production with the flag on → THROWS AT IMPORT. A misconfigured
 *      notifier that fails quietly looks exactly like a notifier with nothing to say.
 *
 * Env is read at call time (not captured in module consts) so the guards are testable and so a
 * mid-session env change in the admin console takes effect without a restart.
 */

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
  /** Set when we declined to send — "dev", "muted", "unconfigured", "no-recipients". */
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
   * Idempotency key. The same id for the same FID inside 24h is dropped by the client, which makes
   * a retried cron safe. Omit and the service assigns one (retries then duplicate — avoid).
   */
  notificationId?: string;
}

/** True only when a real send may happen. The NODE_ENV check is first and unconditional. */
export function notificationsAreActive(): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  if (process.env.NOTIFICATIONS_ENABLED !== "true") return false;
  return Boolean(process.env.NEYNAR_API_KEY);
}

/** Split into ≤100-FID chunks. A broadcast (empty list) stays a single unchunked request. */
function chunkFids(fids: number[] | undefined): (number[] | undefined)[] {
  if (!fids || fids.length === 0) return [undefined];
  const out: number[][] = [];
  for (let i = 0; i < fids.length; i += LIMITS.fidsPerRequest) {
    out.push(fids.slice(i, i + LIMITS.fidsPerRequest));
  }
  return out;
}

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
      ...(input.notificationId
        ? { uuid: clamp(input.notificationId, LIMITS.notificationId) }
        : {}),
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
  for (const chunk of chunkFids(input.targetFids)) {
    try {
      const res = await fetch(NEYNAR_NOTIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify(buildPayload(input, chunk)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("[notify] send failed:", data?.message ?? `HTTP ${res.status}`);
        return { ok: false, delivered, error: data?.message ?? `HTTP ${res.status}` };
      }
      delivered += Number(data?.notification_deliveries?.length ?? chunk?.length ?? 0);
    } catch (err) {
      console.error("[notify] send threw:", err);
      return { ok: false, delivered, error: err instanceof Error ? err.message : "unknown" };
    }
  }
  return { ok: true, delivered };
}
