/**
 * The reveal-signer — SERVER ONLY. Never import this from a client component.
 *
 * This key is the game's mint authority. It can issue unlimited free packs and force every roll to
 * succeed, so it lives in `SIGNER_PRIVATE_KEY` (no NEXT_PUBLIC prefix, so Next will not inline it
 * into a client bundle) and every route that uses it must derive the FID from a verified Quick Auth
 * JWT rather than the request body.
 *
 * ── Why the outcomes are DERIVED, not stored ──────────────────────────────────────────────────
 * The reveal endpoints must be idempotent. A signer that samples fresh on every request lets a
 * player call it repeatedly until they like the letters, or until a roll comes back `success: true`
 * — the reveal is permissionless and the signer decides the outcome, so non-idempotency is not a
 * caching inefficiency, it's an exploit.
 *
 * The obvious fix is a cache keyed by commitId. We derive instead: every outcome is an HMAC of
 * (chainId, namespace, commitId) under a server secret. That is idempotent BY CONSTRUCTION —
 * identical inputs always produce identical letters — with no storage to be unavailable, no cache to
 * miss, and nothing to fail open. The player can't predict a draw without the secret, and can't
 * change one by asking again. A Redis outage degrades availability, never fairness.
 *
 * The commit fields the outcome depends on (pityAtCommit, letterIndex, count) are snapshots taken
 * on-chain at commit time, so they can't shift under a re-request either.
 */
import { createHmac } from "node:crypto";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "viem";
import { NETWORK } from "./network";
import { LETTER_ODDS, ALPHABET } from "@/lib/economy";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set — the signer service cannot operate without it.`);
  return v;
}

let account: PrivateKeyAccount | undefined;

/** The signer account. Throws if the key is absent — never silently degrade to an unsigned path. */
export function signerAccount(): PrivateKeyAccount {
  if (!account) {
    const key = requireEnv("SIGNER_PRIVATE_KEY");
    account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
  }
  return account;
}

/**
 * Sign an inner digest the way the contracts verify it.
 *
 * Every one of the six preimages is checked with
 * `ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(inner), sig)`, and viem's
 * `signMessage({ message: { raw } })` applies exactly that EIP-191 prefix. So we pass the RAW inner
 * hash and must NOT pre-wrap it — wrapping twice yields a valid signature over the wrong digest,
 * which fails as BadSignature() with no hint that double-hashing was the cause.
 *
 * Never `signTypedData`: none of these contracts define an EIP-712 domain.
 */
export async function signDigest(innerDigest: Hex): Promise<Hex> {
  return signerAccount().signMessage({ message: { raw: innerDigest } });
}

/** Deterministic bytes for an outcome. Distinct namespaces so one commitId can't collide across games. */
function outcomeBytes(namespace: string, commitId: bigint, extra = ""): Buffer {
  const secret = requireEnv("SIGNER_DRAW_SECRET");
  return createHmac("sha256", secret).update(`${NETWORK.id}:${namespace}:${commitId}:${extra}`).digest();
}

/**
 * A deterministic float in [0,1) for one draw step. Each step gets its OWN hmac keyed by its index
 * rather than slicing offsets out of a shared digest — same determinism, but no offset arithmetic to
 * get quietly wrong, and no chance two steps read overlapping bytes.
 */
function unitFloat(namespace: string, commitId: bigint, step: number): number {
  // 6 bytes = 48 bits, comfortably inside Number's exact-integer range.
  const n = outcomeBytes(namespace, commitId, String(step)).readUIntBE(0, 6);
  return n / 2 ** 48;
}

/**
 * Draw `count` letters, mirroring real word demand (LETTER_SLOTS → LETTER_ODDS) and skipping any
 * letter that has hit its supply cap.
 *
 * The cap check is not optional: `Letters.reveal` reverts CapExceeded if the signer draws a letter
 * whose mintedEver has reached cap, which would strand a paid commit.
 *
 * @param available - per-letter remaining supply, indexed 0..25 (cap - mintedEver)
 */
export function drawLetters(
  commitId: bigint,
  count: number,
  available: readonly number[],
  ns: "letters" | "daily" = "letters",
): number[] {
  const total = ALPHABET.reduce((a, ch, i) => a + ((available[i] ?? 0) > 0 ? (LETTER_ODDS[ch] ?? 0) : 0), 0);
  if (total <= 0) throw new Error("No uncapped letters remain — cannot draw.");

  // Local copy so a multi-letter draw can't exceed a nearly-exhausted letter's remaining supply.
  const remaining = [...available];
  const out: number[] = [];
  for (let k = 0; k < count; k++) {
    const live = ALPHABET.map((ch, i) => ((remaining[i] ?? 0) > 0 ? (LETTER_ODDS[ch] ?? 0) : 0));
    const sum = live.reduce((a, b) => a + b, 0);
    if (sum <= 0) throw new Error("Ran out of uncapped letters mid-draw.");
    let r = unitFloat(ns, commitId, k) * sum;
    let idx = 0;
    for (let i = 0; i < live.length; i++) {
      r -= live[i];
      if (r <= 0) {
        idx = i;
        break;
      }
      idx = i;
    }
    out.push(idx);
    remaining[idx] = (remaining[idx] ?? 0) - 1;
  }
  return out;
}

/**
 * The DAILY's draw seed — deterministic per (identity, day), NOT per commitId.
 *
 * This is the property that makes the single-prompt daily safe. The reveal signature is issued
 * BEFORE the commit mines (for a predicted commitId), so a player can see their letter in the API
 * response and decide not to send. Keyed by commitId that would be a re-roll machine: let traffic
 * shift the commit counter, ask again, new letter. Keyed by (identity, day) there is nothing to
 * shop — the same identity gets the same letter all day no matter how many times it asks, which is
 * exactly the "one draw per identity-day" the two-phase flow produced anyway.
 *
 * The seed folds day into the identity key (key << 32 | day). Uniqueness per (key, day) is what
 * matters; the "daily" namespace already separates it from every commitId-keyed draw.
 */
export function dailySeed(key: bigint, day: number): bigint {
  return (key << 32n) | BigInt(day >>> 0);
}

/**
 * Decide a roll/prestige outcome from the pity SNAPSHOT taken at commit.
 *
 * Uses commits(commitId).pityAtCommit, never live pity — the snapshot is what the contract's own
 * accounting is based on, and it cannot move between the commit and the reveal.
 */
export function drawSuccess(namespace: "roll" | "prestige", commitId: bigint, probability: number): boolean {
  return unitFloat(namespace, commitId, 0) < probability;
}
