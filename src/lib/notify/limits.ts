/**
 * Notification limits and the clamp, deliberately in their own SIDE-EFFECT-FREE module.
 *
 * Why this isn't just part of send.ts: that module throws at import when notifications are armed in
 * production without an API key — fail-fast, so a misconfigured deploy stops rather than going
 * quietly silent. But the admin status route and the Notifications tab need these constants to
 * REPORT that exact state, and importing send.ts to get them would trip the throw and take down
 * /admin along with the status endpoint. The one blocker the tab most needs to surface would be
 * the one blocker that makes the tab unreachable.
 *
 * So: constants and pure functions live here, the throw lives in send.ts, and anything that only
 * needs to describe a notification imports from this file.
 */

/** Farcaster's published limits. Exceeding one is a rejected or silently truncated send. */
export const LIMITS = {
  title: 32,
  body: 128,
  targetUrl: 1024,
  notificationId: 128,
  /** Max FIDs per request; larger audiences are chunked. */
  fidsPerRequest: 100,
} as const;

/**
 * Truncate to `max` characters without splitting an emoji.
 *
 * Measured in UTF-16 code units (`String.length`) because that is what a JS validator on the
 * receiving end measures, and it is the STRICTER reading — "🔵" is one glyph but two units. Cutting
 * happens on code-point boundaries so a truncated string can never end in half a surrogate pair,
 * which renders as a replacement character.
 *
 * This guard is the one thing our sender has that LHAW's does not, and it is not hypothetical:
 * LHAW's `🔵 ${jackpot} up for grabs` title measures exactly 32 units at today's jackpot size and
 * overflows the moment the pot gains a digit.
 */
export function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const points = [...text];
  let out = "";
  // Reserve one unit for the ellipsis so the result still fits after we append it.
  for (const ch of points) {
    if (out.length + ch.length > max - 1) break;
    out += ch;
  }
  return `${out}…`;
}
