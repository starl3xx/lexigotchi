/**
 * Admin access control for the operator dashboard.
 *
 * Phase 0 posture: the dashboard's on-chain operations are *transaction builders* — executing any
 * of them requires the owner/keeper's actual wallet signature (a multisig, ideally), which is the
 * real security boundary. The metrics it shows are the same deterministic sim already published at
 * `/economy`. So the route gate here is about discoverability, not secret-keeping: it checks the
 * connected Farcaster identity against an allowlist.
 *
 * Allowlist source: `NEXT_PUBLIC_ADMIN_FIDS` (comma-separated FIDs). The dashboard is **dev-open**
 * (no sign-in required) only in development, or when `NEXT_PUBLIC_ADMIN_OPEN=1` is set explicitly.
 * In a production build with no allowlist it is **fail-closed** — a missing/misconfigured env can
 * never silently expose a public operator console. A server-side session gate replaces this when
 * the backend lands (the Griddle `requireAdminWallet` model); wallet-based allowlisting returns
 * once the console can read a connected wallet address (the viewer currently surfaces only a FID).
 */

function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const ADMIN_FIDS: ReadonlySet<string> = new Set(parseList(process.env.NEXT_PUBLIC_ADMIN_FIDS));

const IS_PROD = process.env.NODE_ENV === "production";
const EXPLICIT_OPEN = process.env.NEXT_PUBLIC_ADMIN_OPEN === "1";

/**
 * True when the console runs without a sign-in gate. `NEXT_PUBLIC_ADMIN_OPEN=1` is a deliberate
 * MASTER OVERRIDE — it opens the console even in production and even if an allowlist is set (the
 * escape hatch when SIWN / Neynar is unavailable). Otherwise the console is open only in dev when
 * no allowlist is configured; a production build with no allowlist is fail-closed (see below).
 */
export const ADMIN_OPEN = EXPLICIT_OPEN || (ADMIN_FIDS.size === 0 && !IS_PROD);

/** True when a production build has no allowlist and wasn't explicitly opened → locked, needs config. */
export const ADMIN_UNCONFIGURED = IS_PROD && !EXPLICIT_OPEN && ADMIN_FIDS.size === 0;

if (ADMIN_UNCONFIGURED && typeof window === "undefined") {
  // Build/server-side heads-up; the gate shows an actionable "not configured" screen to visitors.
  console.warn(
    "[admin] No NEXT_PUBLIC_ADMIN_FIDS set in production — the operator console is locked (fail-closed). " +
      "Set NEXT_PUBLIC_ADMIN_FIDS, or NEXT_PUBLIC_ADMIN_OPEN=1 to open it deliberately.",
  );
}

export function isAdminFid(fid: number | null | undefined): boolean {
  if (ADMIN_OPEN) return true;
  if (fid == null) return false;
  return ADMIN_FIDS.has(String(fid));
}
