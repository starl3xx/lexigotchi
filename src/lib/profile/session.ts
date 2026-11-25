/**
 * Wallet sessions for the profile: proof that the player controls a wallet, so only they can link
 * an X account to it, choose its name and picture, or give it an email.
 *
 * ── The flow ─────────────────────────────────────────────────────────────────────────────────────
 * 1. The client asks for a challenge: a Sign-In-With-Ethereum (EIP-4361) message for its wallet.
 * 2. The wallet signs it (free, no transaction).
 * 3. The server checks the message (our domain, that wallet, a nonce we issued in the last ten
 *    minutes) and the signature, then issues a session token good for 30 days.
 *
 * Nothing is stored: the nonce and the token both carry an HMAC under PROFILE_SESSION_SECRET, so
 * the server can tell its own from a forgery without a table. The token travels in a header
 * (`x-lexigotchi-session`), not a cookie: inside a Farcaster host the game runs in a frame, where a
 * cookie is third-party and Safari drops it.
 *
 * ── Signatures from contract wallets ─────────────────────────────────────────────────────────────
 * A Base Account (Coinbase Smart Wallet) is a contract, so its signature isn't an ECDSA signature
 * of its address, and plain address recovery fails. `verifyWalletSignature` tries recovery first
 * (an ordinary wallet, no RPC), then asks the chain (ERC-1271 for a deployed contract wallet,
 * ERC-6492 for one not deployed yet), on the game's network and then on Base mainnet.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getAddress, isAddress, verifyMessage, type Hex } from "viem";
import { createSiweMessage, parseSiweMessage } from "viem/siwe";

export const SESSION_HEADER = "x-lexigotchi-session";
const SESSION_TTL_S = 30 * 24 * 60 * 60;
const CHALLENGE_TTL_MS = 10 * 60_000;
const CLOCK_SKEW_MS = 60_000;

/** The HMAC key, or null when unset or too short to trust. */
export function profileSecret(): string | null {
  const s = process.env.PROFILE_SESSION_SECRET ?? "";
  return s.length >= 32 ? s : null;
}

/** Dark until configured: the flag, the secret, and a database. */
export function profilesEnabled(): boolean {
  return process.env.PROFILES_ENABLED === "true" && profileSecret() !== null && Boolean(process.env.DATABASE_URL);
}

function mac(secret: string, ...parts: string[]): string {
  return createHmac("sha256", secret).update(parts.join("|")).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ── nonces ─────────────────────────────────────────────────────────────────────────────────────
// SIWE nonces must be alphanumeric, so the parts are fixed-width and simply concatenated:
// issued-at (ms, base36, 9 chars) + random (16 hex) + HMAC over (address, issued-at, random) (24 hex).
const T_LEN = 9, R_LEN = 16, M_LEN = 24;

export function makeNonce(secret: string, address: string, now = Date.now()): string {
  const t = now.toString(36).padStart(T_LEN, "0");
  const r = randomBytes(R_LEN / 2).toString("hex");
  return t + r + mac(secret, "nonce", address.toLowerCase(), t, r).slice(0, M_LEN);
}

/** Was this nonce issued by us, for this wallet, in the last ten minutes? */
export function checkNonce(secret: string, nonce: string, address: string, now = Date.now()): boolean {
  if (nonce.length !== T_LEN + R_LEN + M_LEN || !/^[0-9a-z]+$/.test(nonce)) return false;
  const t = nonce.slice(0, T_LEN), r = nonce.slice(T_LEN, T_LEN + R_LEN), m = nonce.slice(T_LEN + R_LEN);
  if (!safeEqual(m, mac(secret, "nonce", address.toLowerCase(), t, r).slice(0, M_LEN))) return false;
  const issued = parseInt(t, 36);
  return issued <= now + CLOCK_SKEW_MS && now - issued <= CHALLENGE_TTL_MS;
}

// ── the challenge ──────────────────────────────────────────────────────────────────────────────
export const CHALLENGE_STATEMENT =
  "Sign in to your Lexigotchi profile. This proves the wallet is yours. It is free and sends no transaction.";

export function challengeMessage(opts: { secret: string; address: string; domain: string; chainId: number; now?: number }): string {
  const now = opts.now ?? Date.now();
  return createSiweMessage({
    address: getAddress(opts.address),
    chainId: opts.chainId,
    domain: opts.domain,
    nonce: makeNonce(opts.secret, opts.address, now),
    uri: `https://${opts.domain}`,
    version: "1",
    statement: CHALLENGE_STATEMENT,
    issuedAt: new Date(now),
    expirationTime: new Date(now + CHALLENGE_TTL_MS),
  });
}

/**
 * Is this a challenge we issued, for our domain, still fresh? Returns the wallet it names (checksum
 * form), or a reason. The SIGNATURE is checked separately (verifyWalletSignature).
 */
export function checkChallenge(
  secret: string,
  message: string,
  domain: string,
  now = Date.now(),
): { ok: true; address: `0x${string}` } | { ok: false; reason: string } {
  let parsed: ReturnType<typeof parseSiweMessage>;
  try {
    parsed = parseSiweMessage(message);
  } catch {
    return { ok: false, reason: "bad_message" };
  }
  if (!parsed.address || !isAddress(parsed.address)) return { ok: false, reason: "bad_message" };
  if (parsed.domain !== domain) return { ok: false, reason: "wrong_domain" };
  if (parsed.statement !== CHALLENGE_STATEMENT) return { ok: false, reason: "bad_message" };
  if (!parsed.nonce || !checkNonce(secret, parsed.nonce, parsed.address, now)) return { ok: false, reason: "stale_or_forged" };
  if (parsed.expirationTime && parsed.expirationTime.getTime() < now) return { ok: false, reason: "stale_or_forged" };
  return { ok: true, address: getAddress(parsed.address) };
}

// ── the link message (Link another wallet) ─────────────────────────────────────────────────────
/**
 * What the joining wallet signs. Its own statement (never the sign-in one, so neither message passes
 * for the other: a captured sign-in signature can't pull a wallet into someone's account), naming the
 * account it joins, with the single-use link code as the nonce. ASCII only: some wallets reject
 * anything else in a Sign-In with Ethereum statement.
 */
export function linkStatement(account: string): string {
  return `Link this wallet to the Lexigotchi account ${getAddress(account)}: one bag, one profile, one set of free letters. It is free and sends no transaction.`;
}

export function linkMessage(opts: { address: string; account: string; code: string; domain: string; chainId: number; now?: number }): string {
  const now = opts.now ?? Date.now();
  return createSiweMessage({
    address: getAddress(opts.address),
    chainId: opts.chainId,
    domain: opts.domain,
    nonce: opts.code,
    uri: `https://${opts.domain}`,
    version: "1",
    statement: linkStatement(opts.account),
    issuedAt: new Date(now),
    expirationTime: new Date(now + CHALLENGE_TTL_MS),
  });
}

/**
 * Is this a link message for our domain, fresh, and for `account`? Returns the joining wallet and the
 * code. The code's account must be the statement's (the route looks it up), and the signature is
 * checked separately (verifyWalletSignature).
 */
export function checkLinkMessage(
  message: string,
  domain: string,
  now = Date.now(),
): { ok: true; address: `0x${string}`; code: string; statement: string } | { ok: false; reason: string } {
  let parsed: ReturnType<typeof parseSiweMessage>;
  try {
    parsed = parseSiweMessage(message);
  } catch {
    return { ok: false, reason: "bad_message" };
  }
  if (!parsed.address || !isAddress(parsed.address)) return { ok: false, reason: "bad_message" };
  if (parsed.domain !== domain) return { ok: false, reason: "wrong_domain" };
  if (!parsed.statement || parsed.statement === CHALLENGE_STATEMENT || !parsed.statement.startsWith("Link this wallet to the Lexigotchi account ")) {
    return { ok: false, reason: "bad_message" };
  }
  if (!parsed.nonce || !/^[0-9a-f]{24}$/.test(parsed.nonce)) return { ok: false, reason: "bad_message" };
  if (parsed.expirationTime && parsed.expirationTime.getTime() < now) return { ok: false, reason: "stale_or_forged" };
  if (parsed.issuedAt && parsed.issuedAt.getTime() > now + CLOCK_SKEW_MS) return { ok: false, reason: "stale_or_forged" };
  return { ok: true, address: getAddress(parsed.address), code: parsed.nonce, statement: parsed.statement };
}

/** Clients that can check a contract wallet's signature: the game's network, then Base mainnet. */
export type SignatureClient = { verifyMessage: (a: { address: `0x${string}`; message: string; signature: Hex }) => Promise<boolean> };

export async function verifyWalletSignature(
  address: `0x${string}`,
  message: string,
  signature: Hex,
  clients: readonly SignatureClient[],
): Promise<boolean> {
  try {
    if (await verifyMessage({ address, message, signature })) return true; // an ordinary wallet
  } catch {
    /* not a plain ECDSA signature: a contract wallet's, checked below */
  }
  for (const c of clients) {
    try {
      if (await c.verifyMessage({ address, message, signature })) return true;
    } catch {
      /* this chain couldn't say; try the next */
    }
  }
  return false;
}

// ── the session token ──────────────────────────────────────────────────────────────────────────
const b64 = (s: string) => Buffer.from(s).toString("base64url");

export function issueSession(secret: string, address: string, now = Date.now()): { token: string; expiresAt: number } {
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_S;
  const payload = b64(JSON.stringify({ a: address.toLowerCase(), e: expiresAt }));
  return { token: `${payload}.${mac(secret, "session", payload)}`, expiresAt };
}

/** The lowercase wallet a token proves, or null if it's forged, malformed, or expired. */
export function readSession(secret: string, token: string | null | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const [payload, m] = token.split(".");
  if (!payload || !m || !safeEqual(m, mac(secret, "session", payload))) return null;
  try {
    const { a, e } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { a?: string; e?: number };
    if (typeof a !== "string" || !isAddress(a) || typeof e !== "number" || e * 1000 < now) return null;
    return a.toLowerCase();
  } catch {
    return null;
  }
}

export function sessionAddress(req: Request): string | null {
  const secret = profileSecret();
  return secret ? readSession(secret, req.headers.get(SESSION_HEADER)) : null;
}
