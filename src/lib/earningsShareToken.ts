/**
 * The signed half of an earnings share (lib/earningsShare.ts says why): the server signs a snapshot
 * of what it computed (lib/rewards/share.ts builds it), and a card is drawn only from a token whose
 * signature holds. Server only (node:crypto and the secret), and light: the card route imports
 * nothing else, because X's crawler meets it cold.
 *
 * token = <payload>.<mac>: the snapshot (base64url) and the first 16 bytes of its HMAC-SHA256.
 *
 * **The key.** `EARNINGS_SHARE_SECRET` (32+ characters) signs when set. Otherwise a key DERIVED from
 * `PROFILE_SESSION_SECRET` under its own label does, so the share works wherever profiles are
 * configured without another setting, and a share token can never stand in for a session token
 * (another key, another message shape). A read accepts either. The signer's draw secret is never
 * used here. With neither, nothing is signed and the game offers no Share: dark, like every switch.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { NETWORK } from "./onchain/network";
import { decodeSnapshot, encodeSnapshot, type EarningsSnapshot } from "./earningsShare";

const LABEL = "lexigotchi:earnings-share:v1";
const MAC_BYTES = 16;
/** A real token is about 200 characters; anything much longer isn't one, and isn't hashed. */
const MAX_TOKEN = 600;

/**
 * Every key this server holds, the one that SIGNS first. A read tries each: a posted link is kept
 * for good, so giving the share its own secret later must not end the links signed under the
 * derived key (lib/scenes LINK_DEFAULT_SCENE keeps old links alive for the same reason). Rotating
 * `PROFILE_SESSION_SECRET` itself does end the links signed under it.
 */
function keys(): Buffer[] {
  const out: Buffer[] = [];
  const own = process.env.EARNINGS_SHARE_SECRET ?? "";
  if (own.length >= 32) out.push(Buffer.from(own, "utf8"));
  const root = process.env.PROFILE_SESSION_SECRET ?? "";
  if (root.length >= 32) out.push(createHmac("sha256", root).update(LABEL).digest());
  return out;
}

const mac = (k: Buffer, payload: string) => createHmac("sha256", k).update(`${LABEL}|${payload}`).digest().subarray(0, MAC_BYTES);

/** Can this server sign (and so read) a share? */
export const earningsShareOn = (): boolean => keys().length > 0;

/** The token for a snapshot, or null when no key is configured. */
export function signEarningsShare(s: EarningsSnapshot): string | null {
  const k = keys()[0];
  if (!k) return null;
  const payload = encodeSnapshot(s);
  return `${payload}.${mac(k, payload).toString("base64url")}`;
}

/**
 * The snapshot a token carries, or null: no key, not a token, a signature that doesn't hold (checked
 * on the exact bytes from the link, in constant time), or a snapshot of another network (a testnet
 * token must never draw on the mainnet site, where the card would call its amounts real).
 */
export function readEarningsShare(token: string, chainId: number = NETWORK.id): EarningsSnapshot | null {
  const ks = keys();
  if (ks.length === 0 || token.length > MAX_TOKEN) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  let given: Buffer;
  try {
    given = Buffer.from(token.slice(dot + 1), "base64url");
  } catch {
    return null;
  }
  // every key is tried, with no early way out: which key signed a token is nobody's business
  let held = false;
  for (const k of ks) {
    const want = mac(k, payload);
    if (given.length === want.length && timingSafeEqual(given, want)) held = true;
  }
  if (!held) return null;
  const s = decodeSnapshot(payload);
  return s && s.chainId === chainId ? s : null;
}
