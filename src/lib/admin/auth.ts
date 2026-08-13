/**
 * Admin access control for the operator dashboard.
 *
 * Phase 0 posture: the dashboard's on-chain operations are *transaction builders* — executing any
 * of them requires the owner/keeper's actual wallet signature, which is the real security boundary.
 * The metrics it shows are the same deterministic sim already published at `/economy`. So the route
 * gate here is about discoverability, not secret-keeping.
 *
 * ── Wallet-first, and why ─────────────────────────────────────────────────────────────────────
 * The gate allowlists a connected WALLET (`NEXT_PUBLIC_ADMIN_WALLETS`). That is the direct question:
 * every operation this console builds has to be signed by the owner key anyway, so gating on the key
 * that actually holds the power beats gating on a Farcaster identity that merely correlates with it.
 *
 * It is also what this file was already waiting for — the previous note said wallet allowlisting
 * "returns once the console can read a connected wallet address". The web3 runtime added wagmi, so
 * it can.
 *
 * FID allowlisting (`NEXT_PUBLIC_ADMIN_FIDS`) still works and is still honoured, because inside a
 * Farcaster client the mini-app SDK supplies an identity with no sign-in step. But it is no longer
 * the only way in: Sign In With Neynar — the web's FID source — retires 2026-08-14, and after that a
 * FID-only gate locks an operator out of a normal browser entirely.
 *
 * Either credential opens the console. Both are allowlists; neither is a secret.
 */

function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const ADMIN_FIDS: ReadonlySet<string> = new Set(parseList(process.env.NEXT_PUBLIC_ADMIN_FIDS));

/** Lower-cased so a checksummed address in the env still matches a lower-cased one from the wallet. */
export const ADMIN_WALLETS: ReadonlySet<string> = new Set(parseList(process.env.NEXT_PUBLIC_ADMIN_WALLETS));

const IS_PROD = process.env.NODE_ENV === "production";
const EXPLICIT_OPEN = process.env.NEXT_PUBLIC_ADMIN_OPEN === "1";

/** True when SOME allowlist exists — either kind counts. */
const HAS_ALLOWLIST = ADMIN_FIDS.size > 0 || ADMIN_WALLETS.size > 0;

/**
 * True when the console runs without a sign-in gate. `NEXT_PUBLIC_ADMIN_OPEN=1` is a deliberate
 * MASTER OVERRIDE — it opens the console even in production and even if an allowlist is set (the
 * escape hatch when an auth provider is unavailable). Otherwise the console is open only in dev with
 * no allowlist configured; a production build with no allowlist is fail-closed (see below).
 */
export const ADMIN_OPEN = EXPLICIT_OPEN || (!HAS_ALLOWLIST && !IS_PROD);

/** True when a production build has no allowlist and wasn't explicitly opened → locked, needs config. */
export const ADMIN_UNCONFIGURED = IS_PROD && !EXPLICIT_OPEN && !HAS_ALLOWLIST;

if (ADMIN_UNCONFIGURED && typeof window === "undefined") {
  // Build/server-side heads-up; the gate shows an actionable "not configured" screen to visitors.
  console.warn(
    "[admin] No NEXT_PUBLIC_ADMIN_WALLETS or NEXT_PUBLIC_ADMIN_FIDS set in production — the operator " +
      "console is locked (fail-closed). Set one, or NEXT_PUBLIC_ADMIN_OPEN=1 to open it deliberately.",
  );
}

/** Is this connected wallet allowlisted? */
export function isAdminWallet(address: string | null | undefined): boolean {
  if (ADMIN_OPEN) return true;
  if (!address) return false;
  return ADMIN_WALLETS.has(address.toLowerCase());
}

/** Is this Farcaster identity allowlisted? */
export function isAdminFid(fid: number | null | undefined): boolean {
  if (ADMIN_OPEN) return true;
  if (fid == null) return false;
  return ADMIN_FIDS.has(String(fid));
}

/**
 * The single question the gate asks: does this visitor hold ANY allowlisted credential?
 *
 * Deliberately OR, not AND. Requiring both would lock out an operator in a Farcaster client with no
 * wallet connected, and equally one on a laptop with a hardware wallet and no Farcaster session —
 * and the console cannot execute anything either of them could not already sign.
 */
export function isAdmin({ fid, wallet }: { fid?: number | null; wallet?: string | null }): boolean {
  return ADMIN_OPEN || isAdminWallet(wallet) || isAdminFid(fid);
}
