/**
 * The SERVER-side gate for the admin routes that return player data or deployment internals
 * (`/api/admin/players`, `/api/admin/system`).
 *
 * The older admin routes are deliberately open (lib/admin/auth.ts): they serve the economy sim and
 * transaction plans, and a plan does nothing until the owner key signs it. These two are different.
 * Players lists which wallets visited and when, and whether each one gave an email or turned on
 * reminders; System says which keys and switches this deployment holds. Neither has a signature
 * behind it, so the route itself has to be the boundary.
 *
 * Who passes: a caller who PROVES an allowlisted credential.
 * - A wallet session (lib/profile/session.ts: a signed Sign-In-With-Ethereum message, then a 30-day
 *   HMAC token in the `x-lexigotchi-session` header) for a wallet in NEXT_PUBLIC_ADMIN_WALLETS.
 * - A verified Farcaster Quick Auth token for a FID in NEXT_PUBLIC_ADMIN_FIDS.
 *
 * `NEXT_PUBLIC_ADMIN_OPEN=1` does NOT open these in production. That flag exists so the operator
 * can reach the transaction builders when an auth provider is down; it was never meant to publish
 * who the players are. In development with no allowlist the routes are open, like the console.
 */
import { getAuthedFid } from "@/lib/auth/quickAuth";
import { sessionAddress } from "@/lib/profile/session";

function parseList(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export type AdminDecision =
  | { ok: true; via: "wallet" | "fid" | "dev"; who: string }
  /** No wallet session (a FID off the list counts as none): the console should offer the sign-in. */
  | { ok: false; status: 401; error: "sign_in" }
  /** A wallet session was proven, but neither it nor any FID is on the allowlist. */
  | { ok: false; status: 403; error: "not_allowed"; who: string }
  /** Production with no allowlist: nobody can pass until one is set. */
  | { ok: false; status: 503; error: "not_configured" };

/**
 * The decision, from what the request proved. Pure, so the tests can cover every branch.
 * `sessionWallet` and `fid` must already be VERIFIED (a checked token), never a client claim.
 */
export function adminDecision(opts: {
  isProd: boolean;
  wallets: ReadonlySet<string>;
  fids: ReadonlySet<string>;
  sessionWallet: string | null;
  fid: number | null;
}): AdminDecision {
  const { isProd, wallets, fids } = opts;
  const wallet = opts.sessionWallet?.toLowerCase() ?? null;
  if (wallets.size === 0 && fids.size === 0) {
    return isProd ? { ok: false, status: 503, error: "not_configured" } : { ok: true, via: "dev", who: "dev" };
  }
  if (wallet && wallets.has(wallet)) return { ok: true, via: "wallet", who: wallet };
  if (opts.fid != null && fids.has(String(opts.fid))) return { ok: true, via: "fid", who: `fid ${opts.fid}` };
  if (wallet) return { ok: false, status: 403, error: "not_allowed", who: wallet };
  // A FID that isn't on the list refuses NOTHING by itself. Inside a Farcaster host (or after a web
  // Farcaster sign-in) every request carries one, and an operator allowlisted only by wallet must
  // still be offered the wallet sign-in, which the console offers on 401 alone (Bugbot on #166).
  return { ok: false, status: 401, error: "sign_in" };
}

/** Check the request. Reads the allowlists at call time, so a test can set them. */
export async function checkAdmin(req: Request): Promise<AdminDecision> {
  const wallets = parseList(process.env.NEXT_PUBLIC_ADMIN_WALLETS);
  const fids = parseList(process.env.NEXT_PUBLIC_ADMIN_FIDS);
  const sessionWallet = sessionAddress(req);
  // Quick Auth only when a token is present: verifying costs a JWKS fetch.
  const fid = req.headers.get("authorization") ? await getAuthedFid(req) : null;
  return adminDecision({ isProd: process.env.NODE_ENV === "production", wallets, fids, sessionWallet, fid });
}

/** The JSON body for a refusal. Says what to do, never which wallets are allowed. */
export function refusalBody(d: Exclude<AdminDecision, { ok: true }>) {
  const hint =
    d.error === "sign_in"
      ? "Sign in with an operator wallet."
      : d.error === "not_allowed"
        ? "This wallet isn’t on NEXT_PUBLIC_ADMIN_WALLETS (or this FID on NEXT_PUBLIC_ADMIN_FIDS)."
        : "Set NEXT_PUBLIC_ADMIN_WALLETS (or NEXT_PUBLIC_ADMIN_FIDS) in this deployment’s environment.";
  return { ok: false as const, error: d.error, hint, ...("who" in d ? { who: d.who } : {}) };
}
