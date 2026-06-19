/**
 * Per-FID rate limiting for the campaign routes (Upstash sliding window). Applied AFTER Quick Auth,
 * so the key is the verified FID — the abuse vector is a valid-token holder hammering an endpoint
 * (esp. `verify-cast`, which calls out to Neynar). Anonymous floods never reach here (they 401 at
 * auth, before any Neynar call).
 *
 * FAILS OPEN: if Upstash isn't configured or errors, requests are allowed — infra trouble must never
 * lock real players out of the campaign.
 */
import { Ratelimit } from "@upstash/ratelimit";
import type { Redis } from "@upstash/redis";
import { getRedis } from "./redis";

export type RateKind = "verify-cast" | "record-add" | "onboarded" | "status";

// Limits are generous: the splash retries verify-cast a few times per share, and players re-tap.
// `verify-cast` is the Neynar-bound one, so it gets a wider window; the rest just deter abuse.
function makeLimiter(kind: RateKind, redis: Redis): Ratelimit {
  switch (kind) {
    case "verify-cast":
      return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(15, "5 m"), prefix: "rl:campaign:verify-cast" });
    case "record-add":
      return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m"), prefix: "rl:campaign:record-add" });
    case "onboarded":
      return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m"), prefix: "rl:campaign:onboarded" });
    case "status":
      return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30, "1 m"), prefix: "rl:campaign:status" });
  }
}

const cache = new Map<RateKind, Ratelimit>();

/** True if the request is allowed. Fails open when Upstash is unconfigured/unreachable. */
export async function allow(kind: RateKind, fid: number): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;
  let limiter = cache.get(kind);
  if (!limiter) {
    limiter = makeLimiter(kind, redis);
    cache.set(kind, limiter);
  }
  try {
    const { success } = await limiter.limit(String(fid));
    return success;
  } catch (err) {
    console.error("[ratelimit] error (failing open):", err);
    return true;
  }
}
