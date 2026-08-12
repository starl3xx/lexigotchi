/**
 * Word ↔ tokenId.
 *
 * `tokenId = keccak256(bytes(WORD))` with the word UPPERCASE (v0.2 §2, Words.sol:98). The UI keys
 * everything by the word string — unique by construction, readable in React keys, and the argument
 * `claim`/`dissolve` already take — and derives the numeric id only where calldata needs it.
 *
 * The casing is not cosmetic: `keccak256("crane") !== keccak256("CRANE")`, so a lowercased word
 * produces a different token id AND a merkle proof that will not verify, failing as
 * NotInDictionary with nothing pointing at the case.
 */
import { keccak256, toBytes } from "viem";

export function tokenIdOf(word: string): bigint {
  return BigInt(keccak256(toBytes(word.trim().toUpperCase())));
}

/** Hex form, for explorer links and ERC-721 URIs. */
export function tokenIdHexOf(word: string): `0x${string}` {
  return keccak256(toBytes(word.trim().toUpperCase()));
}
