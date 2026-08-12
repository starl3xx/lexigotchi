/**
 * The six signer-voucher digests, as pure encoders.
 *
 * Every commit→reveal step in the game is gated by an ECDSA signature from the backend `signer` key
 * over one of these preimages. If an encoder disagrees with its Solidity counterpart by a single
 * field — wrong order, wrong width, wrong chain id — `ECDSA.recover` yields a different address and
 * the contract reverts `BadSignature()`. There is no partial failure and no diagnostic: it fails
 * 100% of the time, identically, whatever the real mistake was. So these live in one file, with no
 * network access, and are tested as byte-for-byte vectors against Foundry's own encoder.
 *
 * Two traps worth naming, both live in the ordering:
 *   - `rollsReveal` carries `letterIndex` and NO tokenId; `prestigeReveal` carries `tokenId` BEFORE
 *     `owner` and no letterIndex. They are not variations of one shape.
 *   - The paid-daily preimage has NO kind byte; the two free vouchers do (that is what stops a free
 *     voucher being replayed against the paid path). Do not "normalise" them.
 *
 * Chain id comes from NETWORK, never a literal — a signer that hardcodes mainnet's 8453 while the
 * contracts are on Sepolia produces BadSignature on every call.
 *
 * Sources: contracts/src/Letters.sol:181,224,235,254 · Rolls.sol:135 · Prestige.sol:99
 */
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { NETWORK } from "./network";

/** contracts/src/Letters.sol:43-44 — `internal`, so not readable on-chain; pinned here. */
export const KIND_FREE_DAILY = 0;
export const KIND_FREE_PACK = 1;

/** Seconds per UTC day — the chain's day boundary, which is NOT the player's local midnight. */
const DAY = 86_400;

/** `uint32(block.timestamp / 1 days)` — the contract's notion of "today". */
export function chainDay(unixSeconds: number | bigint): number {
  return Number(BigInt(unixSeconds) / BigInt(DAY));
}

const chainId = () => BigInt(NETWORK.id);

/** Letters.commitDaily — the PAID daily. No kind byte. (Letters.sol:181) */
export function paidDailyDigest(a: {
  letters: Hex;
  buyer: Hex;
  fid: bigint;
  today: number;
  deadline: bigint;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "uint32" }, { type: "uint256" }],
      [a.letters, chainId(), a.buyer, a.fid, a.today, a.deadline],
    ),
  );
}

/** Letters.commitDailyFree — the FREE FID-gated daily. (Letters.sol:224) */
export function freeDailyDigest(a: {
  letters: Hex;
  buyer: Hex;
  fid: bigint;
  today: number;
  deadline: bigint;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint8" }, { type: "address" }, { type: "uint256" }, { type: "uint32" }, { type: "uint256" }],
      [a.letters, chainId(), KIND_FREE_DAILY, a.buyer, a.fid, a.today, a.deadline],
    ),
  );
}

/** Letters.commitPackFree — the campaign free pack. Nonce-scoped, not day-scoped. (Letters.sol:235) */
export function freePackDigest(a: {
  letters: Hex;
  buyer: Hex;
  fid: bigint;
  nonce: bigint;
  deadline: bigint;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint8" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
      [a.letters, chainId(), KIND_FREE_PACK, a.buyer, a.fid, a.nonce, a.deadline],
    ),
  );
}

/** Letters.reveal — the draw outcome. `buyer` is the STORED committer, not msg.sender. (Letters.sol:254) */
export function lettersRevealDigest(a: {
  letters: Hex;
  commitId: bigint;
  buyer: Hex;
  letterIndexes: readonly number[];
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "uint8[]" }],
      [a.letters, chainId(), a.commitId, a.buyer, a.letterIndexes as number[]],
    ),
  );
}

/** Rolls.reveal — letterIndex, no tokenId. (Rolls.sol:135) */
export function rollsRevealDigest(a: {
  rolls: Hex;
  commitId: bigint;
  owner: Hex;
  letterIndex: number;
  success: boolean;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "uint8" }, { type: "bool" }],
      [a.rolls, chainId(), a.commitId, a.owner, a.letterIndex, a.success],
    ),
  );
}

/** Prestige.reveal — tokenId BEFORE owner, no letterIndex. (Prestige.sol:99) */
export function prestigeRevealDigest(a: {
  prestige: Hex;
  commitId: bigint;
  tokenId: bigint;
  owner: Hex;
  success: boolean;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "bool" }],
      [a.prestige, chainId(), a.commitId, a.tokenId, a.owner, a.success],
    ),
  );
}

/**
 * `MessageHashUtils.toEthSignedMessageHash` — the EIP-191 wrapper every one of the above passes
 * through before `ECDSA.recover`. viem's `signMessage({ message: { raw } })` applies this same
 * prefix, so a signer signs the RAW inner digest and must NOT pre-wrap it.
 */
export function ethSignedMessageHash(innerDigest: Hex): Hex {
  return keccak256(
    ("0x19457468657265756d205369676e6564204d6573736167653a0a3332" + innerDigest.slice(2)) as Hex,
  );
}
