import { createPublicClient, http, isAddress } from "viem";
import { base } from "viem/chains";

/**
 * Coinbase Verified Account — the Sybil gate for the wallet daily.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────────────
 * Base App dropped Farcaster identity on 2026-04-09: mini apps there get SIWE + a wallet address,
 * no FID. An FID-only daily is therefore invisible to that whole channel — and the FID itself is a
 * weak gate anyway (a fresh Farcaster account costs ~$0.30 of storage rent, scriptable). Coinbase
 * publishes EAS attestations on Base mainnet for KYC'd exchange accounts; holding one is a far
 * costlier identity than an FID. Known ceiling, accepted deliberately: one Coinbase account can
 * attest up to ~3 addresses concurrently, so one KYC'd human ≈ up to 3 wallet dailies. Upgrade
 * path when granted access: Base Verify's per-consumer identityHash (one human = one claim).
 *
 * ── The synthetic key namespace ───────────────────────────────────────────────────────────────
 * The contract never interprets the daily key — `Letters._verifyDaily` only checks that our signer
 * blessed the tuple and that `dailyUsed[key]` is unspent. So verified wallets get keys in a
 * DISJOINT namespace: `2^160 + uint160(address)`, always ≥ 2^160, while real FIDs are small
 * sequential integers (< 2^32). `dailyUsed` and `freePackClaimed` share that keyspace, so a
 * synthetic key that ever came out small would silently consume a real FID's slot — which is why
 * the offset is a constant OR'd in, not a convention, and why tests pin the floor.
 *
 * These keys exceed 2^53, so they must be bigint from birth and travel as STRINGS in JSON —
 * a JS number would corrupt them before BigInt() ever saw them.
 *
 * ── Chain pinning ─────────────────────────────────────────────────────────────────────────────
 * Deliberate exception to the network.ts single-source-of-truth (like BalanceSheet's buy funnel):
 * attestations live where Coinbase writes them — Base MAINNET — regardless of which chain the game
 * runs on. A Sepolia rehearsal still checks the player's real mainnet attestation.
 */

/** Coinbase's attestation indexer on Base mainnet (coinbase/verifications). */
export const COINBASE_INDEXER = "0x2c7eE1E5f416dfF40054c27A62f7B357C4E8619C" as const;
/** The EAS predeploy — same address on every OP-stack chain. */
export const EAS = "0x4200000000000000000000000000000000000021" as const;
/** The only attester whose word counts. */
export const COINBASE_ATTESTER = "0x357458739F90461b99789350868CD7CF330Dd7EE" as const;
/** Schema: "Verified Account" — a single bool, KYC-backed. */
export const VERIFIED_ACCOUNT_SCHEMA =
  "0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9" as const;

/** Where a player goes to get attested. Shown by the UI next to the daily. */
export const VERIFY_URL = "https://www.coinbase.com/onchain-verify";

const indexerAbi = [
  {
    type: "function",
    name: "getAttestationUid",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "schemaUid", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
  },
] as const;

const easAbi = [
  {
    type: "function",
    name: "getAttestation",
    inputs: [{ name: "uid", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "uid", type: "bytes32" },
          { name: "schema", type: "bytes32" },
          { name: "time", type: "uint64" },
          { name: "expirationTime", type: "uint64" },
          { name: "revocationTime", type: "uint64" },
          { name: "refUID", type: "bytes32" },
          { name: "recipient", type: "address" },
          { name: "attester", type: "address" },
          { name: "revocable", type: "bool" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;

/** The 2^160 namespace floor. Exported so tests can pin it rather than re-derive it. */
export const VERIFIED_KEY_FLOOR = 1n << 160n;

/**
 * The daily key for a Coinbase-verified wallet: `2^160 | uint160(address)`.
 *
 * Provably disjoint from every real FID (< 2^32) and from every other address's key. The result is
 * in [2^160, 2^161), far past Number.MAX_SAFE_INTEGER — keep it bigint, serialize it as a string.
 */
export function verifiedDailyKey(address: string): bigint {
  // strict: false — wallets report lowercase addresses (the admin gate learned this the hard way),
  // and a checksum rejection here would refuse a perfectly real wallet its daily.
  if (!isAddress(address, { strict: false })) {
    throw new Error(`verifiedDailyKey: not an address: ${address}`);
  }
  return VERIFIED_KEY_FLOOR | BigInt(address.toLowerCase());
}

export interface AttestationLike {
  schema: string;
  recipient: string;
  attester: string;
  revocationTime: bigint;
  expirationTime: bigint;
}

/**
 * Does this attestation prove `wallet` is Coinbase-verified right now?
 *
 * Pure so it can be tested exhaustively — the fetch around it is two trivial reads. Checks every
 * field rather than trusting the indexer's routing: the coinbase/verifications README warns the
 * indexer can lag and return a stale uid, so the EAS record is re-validated in full.
 */
export function attestationProves(
  att: AttestationLike,
  wallet: string,
  nowSeconds: number,
): boolean {
  if (att.schema.toLowerCase() !== VERIFIED_ACCOUNT_SCHEMA.toLowerCase()) return false;
  if (att.attester.toLowerCase() !== COINBASE_ATTESTER.toLowerCase()) return false;
  if (att.recipient.toLowerCase() !== wallet.toLowerCase()) return false;
  if (att.revocationTime !== 0n) return false; // revoked — Coinbase pulled it
  if (att.expirationTime !== 0n && att.expirationTime <= BigInt(nowSeconds)) return false;
  return true;
}

// Base MAINNET, always — see "Chain pinning" above. Cached; serverless instances are reused.
// Inferred type, not `PublicClient` — annotating erases the chain parameter and the two viem
// client types stop unifying.
function makeMainnetClient() {
  return createPublicClient({
    chain: base,
    transport: http(process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org"),
  });
}
let mainnet: ReturnType<typeof makeMainnetClient> | undefined;
function getMainnetClient() {
  return (mainnet ??= makeMainnetClient());
}

/**
 * Whether `wallet` holds a live Coinbase Verified Account attestation on Base mainnet.
 *
 * Throws on RPC failure rather than returning false — the caller must be able to tell "not
 * verified" (a stable fact worth a 403) from "could not check" (a transient worth a 503). Mapping
 * both to false would tell verified players they aren't, whenever the RPC hiccups.
 */
export async function isCoinbaseVerified(wallet: `0x${string}`): Promise<boolean> {
  const client = getMainnetClient();

  const uid = await client.readContract({
    address: COINBASE_INDEXER,
    abi: indexerAbi,
    functionName: "getAttestationUid",
    args: [wallet, VERIFIED_ACCOUNT_SCHEMA],
  });
  if (!uid || /^0x0+$/.test(uid)) return false;

  const att = await client.readContract({
    address: EAS,
    abi: easAbi,
    functionName: "getAttestation",
    args: [uid],
  });
  return attestationProves(att, wallet, Math.floor(Date.now() / 1000));
}
