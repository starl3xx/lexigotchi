/**
 * Queries for the browser push subscriptions table (schema.ts → webPushSubscriptions).
 *
 * Every write takes a subscription that `parseSubscriptionBody` already validated; nothing here
 * re-checks the endpoint, so never call `saveWebPushSubscription` with raw client input.
 */
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { getDb } from "./client";
import { webPushSubscriptions, type WebPushSubscription } from "./schema";
import { MAX_SUBSCRIPTIONS_PER_ADDRESS, type ParsedSubscription } from "@/lib/notify/webPushSubscription";

/**
 * Store a browser's subscription, or move it to a new wallet. One row per endpoint: the same browser
 * subscribing again (new wallet, rotated keys, a fresh Farcaster link) updates its row in place.
 * Then the wallet's oldest rows beyond the cap are dropped, so one address can't grow without bound.
 */
export async function saveWebPushSubscription(sub: ParsedSubscription, fid: number | null): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .insert(webPushSubscriptions)
    .values({ ...sub, fid, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: webPushSubscriptions.endpoint,
      set: { address: sub.address, p256dh: sub.p256dh, auth: sub.auth, fid, updatedAt: now },
    });

  const keep = await db
    .select({ id: webPushSubscriptions.id })
    .from(webPushSubscriptions)
    .where(eq(webPushSubscriptions.address, sub.address))
    .orderBy(desc(webPushSubscriptions.updatedAt), desc(webPushSubscriptions.id))
    .limit(MAX_SUBSCRIPTIONS_PER_ADDRESS);
  if (keep.length === MAX_SUBSCRIPTIONS_PER_ADDRESS) {
    await db.delete(webPushSubscriptions).where(
      and(
        eq(webPushSubscriptions.address, sub.address),
        notInArray(webPushSubscriptions.id, keep.map((k) => k.id)),
      ),
    );
  }
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
