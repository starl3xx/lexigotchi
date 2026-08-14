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

export interface FarcasterProfile {
  fid: number;
  username: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  /**
   * Every wallet Farcaster links to this account (custody + verified), lowercased. The single-bag
   * signal: letters mint to whatever wallet is CONNECTED, and inside a Farcaster host that is
   * always one of these — so a web player connecting an unlinked wallet is quietly forking their
   * collection across contexts, and the UI should say so.
   */
  linkedWallets: string[];
}

/**
 * Look up a profile by FID.
 *
 * A SIWF credential proves WHICH account signed in, but carries no username or avatar — inside a
 * Farcaster host those arrive free in the SDK context, and on the web they have to be fetched. This
 * is an API-key read, so it is unaffected by the Sign In With Neynar retirement (that was the
 * user-auth product; key-based reads are a separate thing). Never throws.
 */
export async function lookupProfile(fid: number): Promise<FarcasterProfile | null> {
  const key = process.env.NEYNAR_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${NEYNAR_BASE}/v2/farcaster/user/bulk?fids=${fid}`, {
      headers: { "x-api-key": key, accept: "application/json" },
      // Profiles change rarely; a short cache keeps a page refresh from re-billing the lookup.
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const u = data?.users?.[0];
    if (!u?.fid) return null;
    return {
      fid: Number(u.fid),
      username: u.username ?? null,
      displayName: u.display_name ?? u.username ?? null,
      pfpUrl: u.pfp_url ?? null,
      linkedWallets: [
        ...(u.custody_address ? [String(u.custody_address)] : []),
        ...(u.verified_addresses?.eth_addresses ?? []).map(String),
      ].map((a) => a.toLowerCase()),
    };
  } catch (err) {
    console.error("[neynar] profile lookup failed:", err);
    return null;
  }
}

/** Neynar's `user/bulk` cap per request. */
const BULK_FIDS = 100;

/**
 * Look up many profiles at once — the notification audience's address resolution.
 *
 * The keeper speaks ADDRESSES (that's what the contracts store) and Neynar notifies FIDS, so
 * something has to bridge them. This goes FID → addresses rather than the reverse, because the
 * notifiable population is already bounded by who added the mini app: reverse-resolving every
 * on-chain owner would burn lookups on people who cannot receive a notification at all.
 *
 * Partial failure is tolerated — a chunk that fails drops those FIDs from this pass rather than
 * killing it. A missed hunger warning is recoverable; a keeper that dies mid-run is not.
 */
export async function lookupProfiles(fids: readonly number[]): Promise<FarcasterProfile[]> {
  const key = process.env.NEYNAR_API_KEY;
  if (!key || fids.length === 0) return [];
  const out: FarcasterProfile[] = [];
  for (let i = 0; i < fids.length; i += BULK_FIDS) {
    const chunk = fids.slice(i, i + BULK_FIDS);
    try {
      const res = await fetch(`${NEYNAR_BASE}/v2/farcaster/user/bulk?fids=${chunk.join(",")}`, {
        headers: { "x-api-key": key, accept: "application/json" },
      });
      if (!res.ok) {
        console.error("[neynar] bulk profile lookup failed:", res.status, `(${chunk.length} fids)`);
        continue;
      }
      const data = await res.json();
      for (const u of data?.users ?? []) {
        if (!u?.fid) continue;
        out.push({
          fid: Number(u.fid),
          username: u.username ?? null,
          displayName: u.display_name ?? u.username ?? null,
          pfpUrl: u.pfp_url ?? null,
          linkedWallets: [
            ...(u.custody_address ? [String(u.custody_address)] : []),
            ...(u.verified_addresses?.eth_addresses ?? []).map(String),
          ].map((a) => a.toLowerCase()),
        });
      }
    } catch (err) {
      console.error("[neynar] bulk profile lookup error:", err);
    }
  }
  return out;
}
