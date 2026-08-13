/**
 * Server-side Farcaster identity: verify a Quick Auth JWT and return the authenticated FID.
 *
 * This is the security boundary for the campaign API. Unlike LHAW's OG-Hunter routes (which trust
 * a client-supplied `{ fid }` and are therefore spoofable), every campaign route derives the FID
 * from a cryptographically verified Quick Auth token. The client attaches it via
 * `sdk.quickAuth.fetch` → `Authorization: Bearer <jwt>`.
 *
 * `verifyJwt({ token, domain })` checks the JWKS signature AND that the token's audience matches our
 * domain — so a JWT minted for another mini app can't be replayed here. FID is the verified `sub`.
 */
import { createClient, Errors } from "@farcaster/quick-auth";
import { SITE_URL } from "@/lib/site";

const client = createClient();

/**
 * Shared Quick Auth client. Exported so the web sign-in routes can reuse it for `generateNonce` and
 * `verifySiwf` — the SAME client that verifies host-minted JWTs, so both provenances are handled by
 * one configuration rather than two that can drift.
 */
export const quickAuthClient = client;
// Quick Auth's `domain` / JWT `aud` is the host only (no scheme/port). Must match the mini-app
// manifest domain — i.e. NEXT_PUBLIC_URL's host in production (e.g. "lexigotchi.fun").
const DOMAIN = new URL(SITE_URL).hostname;

/** The JWT audience. Exported so /api/auth/verify mints tokens `getAuthedFid` will accept. */
export const QUICK_AUTH_DOMAIN = DOMAIN;

/** Verify the request's `Authorization: Bearer` Quick Auth token → FID, or null if missing/invalid. */
export async function getAuthedFid(req: Request): Promise<number | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  try {
    const payload = await client.verifyJwt({ token, domain: DOMAIN });
    return typeof payload.sub === "number" ? payload.sub : null;
  } catch (err) {
    if (err instanceof Errors.InvalidTokenError) return null; // bad/expired/wrong-audience token
    console.error("[quickAuth] verification error:", err); // network/JWKS failure → treat as unauthed
    return null;
  }
}
