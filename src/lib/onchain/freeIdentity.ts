/**
 * Who a free-letter request is, for both free routes (the daily and the pack; decisions.md #21: "every
 * verified player (FC, X, or CB-verified)"). One identity, one key, in the namespaces the contract's
 * `dailyUsed` and `freePackClaimed` share (verifications.ts): a Farcaster FID (< 2^32), an X account
 * (`2^162 | xUserId`), or a Coinbase-verified wallet (`2^160 | address`). The contract never reads
 * the key; it only checks that the signer blessed it, so this check IS the Sybil gate.
 *
 * Order: the Quick Auth FID (from the verified JWT, never the body), then the profile's X account
 * (older than 90 days, while X is on), then a Coinbase-verified wallet in the profile (the connected
 * one first). The key is always the PROVING identity's, so linking wallets never adds one.
 * Rate-limited per FID or per wallet before the Coinbase check, which costs two mainnet reads.
 */
import { getAuthedFid } from "@/lib/auth/quickAuth";
import { allow } from "@/lib/ratelimit";
import { getProfile } from "@/lib/db/profiles";
import { accountWallets } from "@/lib/db/walletLinks";
import { profilesEnabled } from "@/lib/profile/session";
import { xEnabled } from "@/lib/profile/x";
import { xOldEnough } from "@/lib/profile/rules";
import { isCoinbaseVerified, verifiedDailyKey, xDailyKey } from "./verifications";

export type FreeIdentity =
  | {
      ok: true;
      key: bigint;
      source: "fid" | "x" | "coinbase";
      fid: number | null;
      xUserId: string | null;
      /** The linked X account may claim (old enough, and X switched on). */
      xCounts: boolean;
      /** The profile (lib/db/walletLinks.ts): its account id and every wallet in it. */
      account: string;
      wallets: string[];
    }
  | { ok: false; status: number; error: string };

export async function resolveFreeIdentity(req: Request, wallet: string, tag: string): Promise<FreeIdentity> {
  const fid = await getAuthedFid(req);
  // The profile, and so the X link, is the account's. A profile read that fails (or a database
  // without migration 0006 or 0008) just means no X: the other two paths still work.
  const { account, wallets } = await accountWallets(wallet);
  const xRow = profilesEnabled() ? await getProfile(account).catch(() => null) : null;
  const xUserId = xRow?.xUserId ?? null;
  const xCounts = Boolean(xUserId) && xEnabled() && xOldEnough(xRow?.xCreatedAt);
  const base = { fid, xUserId, xCounts, account, wallets };
  const limited = { ok: false as const, status: 429, error: "rate_limited" };

  if (fid) {
    if (!(await allow("record-add", fid))) return limited;
    return { ok: true, key: BigInt(fid), source: "fid", ...base };
  }
  if (!(await allow("record-add", wallet.toLowerCase()))) return limited;
  if (xCounts && xUserId) return { ok: true, key: xDailyKey(xUserId), source: "x", ...base };

  // The connected wallet first, then the account's other wallets. The key is always the PROVING
  // wallet's (never one made up for this wallet), so linking never adds a letter.
  let proving: string | null = null;
  let unchecked = false;
  for (const w of [wallet.toLowerCase(), ...wallets.filter((a) => a !== wallet.toLowerCase())]) {
    try {
      if (await isCoinbaseVerified(w as `0x${string}`)) {
        proving = w;
        break;
      }
    } catch (err) {
      // "Could not check" is not "not verified": a 403 here would tell a verified player they aren't,
      // every time the mainnet RPC hiccups.
      console.error(`[${tag}] attestation check failed:`, err);
      unchecked = true;
    }
  }
  if (!proving && unchecked) return { ok: false, status: 502, error: "verification_unavailable" };
  if (!proving) {
    // A linked X that is too young is the likeliest reason here: say so, so the client can show the
    // day it unlocks instead of asking the player to verify something else.
    return { ok: false, status: 403, error: xUserId && xEnabled() && !xCounts ? "x_too_young" : "verification_required" };
  }
  return { ok: true, key: verifiedDailyKey(proving), source: "coinbase", ...base };
}
