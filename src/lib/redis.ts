/**
 * Upstash Redis (REST) client for rate limiting. Server-only.
 *
 * Resolves credentials from whichever env names exist: Vercel's connected integration injects them
 * prefixed (`lexigotchi_KV_REST_API_*`), while the standard `KV_REST_API_*` / `UPSTASH_REDIS_REST_*`
 * names also work. Returns null when unconfigured (local dev, or Redis down) — callers FAIL OPEN so a
 * missing/unreachable Redis never blocks real players.
 */
import { Redis } from "@upstash/redis";

let _redis: Redis | null | undefined;

function resolve(): { url: string; token: string } | null {
  const url =
    process.env.KV_REST_API_URL ??
    process.env.UPSTASH_REDIS_REST_URL ??
    process.env.lexigotchi_KV_REST_API_URL;
  const token =
    process.env.KV_REST_API_TOKEN ??
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    process.env.lexigotchi_KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

/** Lazily-built Upstash Redis client, or null if not configured. */
export function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const creds = resolve();
  if (!creds) {
    console.warn("[redis] Upstash not configured — rate limiting disabled (failing open)");
    _redis = null;
  } else {
    _redis = new Redis(creds);
  }
  return _redis;
}
