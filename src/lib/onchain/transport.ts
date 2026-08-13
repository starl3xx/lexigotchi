import { http } from "viem";

/**
 * The RPC transport every viem client in this app uses.
 *
 * One job beyond plain `http()`: on the SERVER, stamp requests with our own `Origin`. Alchemy's
 * domain allowlist admits requests by Origin header and rejects "unspecified origin" outright —
 * which is what every server-side fetch is, because Origin is a browser concept. Without this,
 * turning on the allowlist (which we want: the browser key is public in the bundle) silently
 * breaks every API-route chain read — voucher issuance, reveal lookups, attestation checks —
 * while the browser keeps working, which is a maximally confusing way to fail.
 *
 * Claiming the origin is honest here: it is our server, identifying as our app. In the browser
 * the header is NOT attached — Origin is a forbidden header name there; the browser sets its own,
 * which is the one the allowlist actually wants.
 */
const SERVER_ORIGIN = process.env.NEXT_PUBLIC_URL || "https://lexigotchi.fun";

export function rpcTransport(url: string | undefined) {
  if (typeof window !== "undefined") return http(url);
  return http(url, { fetchOptions: { headers: { Origin: SERVER_ORIGIN } } });
}
