/**
 * Best-effort client IP, for rate-limiting routes that run BEFORE authentication.
 *
 * Only ever a bucketing key, never an identity or an authorization input: `x-forwarded-for` is
 * client-supplied and trivially spoofed. On Vercel the leftmost entry is the real client because the
 * platform appends, but nothing here depends on that being true — a spoofed value costs an attacker
 * their own rate-limit bucket and nothing else.
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
