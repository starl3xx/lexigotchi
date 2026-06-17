/**
 * Server-side Neynar calls (raw REST — `@neynar/nodejs-sdk` isn't installed; only the React client).
 * Auth via `NEYNAR_API_KEY` in the `x-api-key` header. Server-only (reads the secret key).
 */
import { SITE_URL } from "@/lib/site";

const NEYNAR_BASE = "https://api.neynar.com";
const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000; // 30-day campaign window
// Bare host (e.g. "lexigotchi.fun") — matches both "…fun" in cast text and "https://…fun/play" in embeds.
const HOST = new URL(SITE_URL).hostname.toLowerCase();

interface NeynarCast {
  hash: string;
  text?: string;
  timestamp?: string;
  author?: { fid?: number };
  embeds?: { url?: string }[];
}

/**
 * Confirm `fid` has recently cast something embedding/mentioning our domain — the trustworthy
 * "shared" signal (the client can't assert this). Ports LHAW's logic: filter the FID's recent feed,
 * re-check the author FID (defense in depth), enforce a lookback window, match the host in text or
 * embeds. Returns the matching cast, or null. Never throws.
 */
export async function verifyShareCast(fid: number): Promise<{ castHash: string; castUrl: string } | null> {
  const key = process.env.NEYNAR_API_KEY;
  if (!key) {
    console.error("[neynar] NEYNAR_API_KEY not set");
    return null;
  }
  const url = `${NEYNAR_BASE}/v2/farcaster/feed?feed_type=filter&filter_type=fids&fids=${fid}&limit=25`;
  let casts: NeynarCast[];
  try {
    const res = await fetch(url, { headers: { "x-api-key": key, accept: "application/json" } });
    if (!res.ok) {
      console.error("[neynar] feed fetch failed:", res.status);
      return null;
    }
    const data = (await res.json()) as { casts?: NeynarCast[] };
    casts = data.casts ?? [];
  } catch (err) {
    console.error("[neynar] feed fetch error:", err);
    return null;
  }

  const cutoff = Date.now() - LOOKBACK_MS;
  for (const cast of casts) {
    if (cast.author?.fid !== fid) continue; // defense in depth (already filtered server-side)
    if (cast.timestamp && new Date(cast.timestamp).getTime() < cutoff) continue;
    const inText = (cast.text ?? "").toLowerCase().includes(HOST);
    const inEmbed = (cast.embeds ?? []).some((e) => e.url?.toLowerCase().includes(HOST));
    if (inText || inEmbed) {
      return { castHash: cast.hash, castUrl: `https://warpcast.com/~/conversations/${cast.hash}` };
    }
  }
  return null;
}
