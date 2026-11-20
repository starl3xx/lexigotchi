/**
 * Queries for the browser push subscriptions table (schema.ts → webPushSubscriptions).
 *
 * Every write takes a subscription that `parseSubscriptionBody` already validated; nothing here
 * re-checks the endpoint, so never call `saveWebPushSubscription` with raw client input.
 */
import { count, eq, inArray } from "drizzle-orm";
import { getDb } from "./client";
import { webPushSubscriptions, type WebPushSubscription } from "./schema";
import { fidToStore, mayAddBrowser, type ParsedSubscription } from "@/lib/notify/webPushSubscription";

/**
 * Store a browser's subscription, or move it to a new wallet. One row per endpoint: the same browser
 * subscribing again (rotated keys, a fresh Farcaster link) updates its row in place.
 *
 * A wallet holds at most MAX_SUBSCRIPTIONS_PER_ADDRESS browsers, and a full wallet REFUSES a new one
 * rather than evicting its oldest. Eviction would let anyone push a player's real browsers out:
 * subscribing needs no wallet signature (see the route), so five made-up endpoints for someone
 * else's address would silently end their reminders. Refusing costs an attacker the same five
 * requests and takes nothing away from the player; a stale row frees itself when a send to it comes
 * back 404/410.
 */
export async function saveWebPushSubscription(
  sub: ParsedSubscription,
  fid: number | null,
): Promise<"saved" | "full"> {
  const db = getDb();
  const now = new Date();

  const [existing] = await db
    .select({ address: webPushSubscriptions.address, fid: webPushSubscriptions.fid })
    .from(webPushSubscriptions)
    .where(eq(webPushSubscriptions.endpoint, sub.endpoint))
    .limit(1);
  if (existing?.address !== sub.address) {
    const [{ n }] = await db
      .select({ n: count() })
      .from(webPushSubscriptions)
      .where(eq(webPushSubscriptions.address, sub.address));
    if (!mayAddBrowser(existing?.address, sub.address, n)) return "full";
  }

  const keptFid = fidToStore(existing, sub.address, fid);
  await db
    .insert(webPushSubscriptions)
    .values({ ...sub, fid: keptFid, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: webPushSubscriptions.endpoint,
      set: { address: sub.address, p256dh: sub.p256dh, auth: sub.auth, fid: keptFid, updatedAt: now },
    });
  return "saved";
}

/** Forget a browser. Knowing the endpoint is the proof: it is the push service's secret URL for it. */
export async function deleteWebPushSubscription(endpoint: string): Promise<void> {
  await getDb().delete(webPushSubscriptions).where(eq(webPushSubscriptions.endpoint, endpoint));
}

/** Drop endpoints the push service says are gone (404/410). */
export async function deleteWebPushEndpoints(endpoints: readonly string[]): Promise<void> {
  if (endpoints.length === 0) return;
  await getDb().delete(webPushSubscriptions).where(inArray(webPushSubscriptions.endpoint, [...endpoints]));
}

/** Every subscription (the daily reminder reads each one's daily slot). */
export async function allWebPushSubscriptions(): Promise<WebPushSubscription[]> {
  return getDb().select().from(webPushSubscriptions);
}
