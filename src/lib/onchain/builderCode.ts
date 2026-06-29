/**
 * Base Builder Code attribution (ERC-8021).
 *
 * Every on-chain action this app originates MUST carry our builder-code suffix so the transaction is
 * credited to us on Base (builder rewards + analytics). Per ERC-8021 the suffix is appended to the
 * END of the transaction calldata; contracts ignore the extra bytes, so it never changes execution.
 *
 * This module is the single source of truth. Two transports, depending on the wallet:
 *   - ERC-5792 `wallet_sendCalls` (preferred): pass `builderCapabilities()` as the call's
 *     `capabilities`. Works with wagmi's `useSendCalls` and with a raw EIP-1193 provider — including
 *     the Farcaster / Base mini-app wallet from `sdk.wallet.getEthereumProvider()`.
 *   - Raw `eth_sendTransaction` (wallets without ERC-5792): append the suffix to the calldata with
 *     `appendBuilderSuffix(data)`.
 *
 * RULE: no contract write anywhere in the app may skip this. When the on-chain write layer is built,
 * route every send through ONE helper and let that helper be the only reader of this module.
 */
import { Attribution } from "ox/erc8021";

/**
 * Our Base builder code (base.dev -> Settings -> Builder Codes). PUBLIC — it travels in calldata.
 * Passed to ox VERBATIM, `bc_` prefix included: `toDataSuffix` encodes the literal string and base.dev
 * issues + indexes the prefixed form (verified — `Attribution.fromData` round-trips it back). Override
 * per environment with NEXT_PUBLIC_BASE_BUILDER_CODE.
 */
export const BUILDER_CODE = process.env.NEXT_PUBLIC_BASE_BUILDER_CODE ?? "bc_bu1cyzms";

/** ERC-8021 attribution suffix for {@link BUILDER_CODE}, computed once. Hex bytes appended to calldata. */
export const BUILDER_DATA_SUFFIX = Attribution.toDataSuffix({ codes: [BUILDER_CODE] });

/**
 * The ERC-5792 `capabilities.dataSuffix` entry for `wallet_sendCalls`. `optional: true` so a wallet
 * lacking the capability still sends the call (we forgo attribution rather than fail the user's tx).
 * Spread alongside any other capabilities the call needs.
 */
export function builderCapabilities(extra?: Record<string, unknown>) {
  return { ...extra, dataSuffix: { value: BUILDER_DATA_SUFFIX, optional: true as const } };
}

/**
 * Fallback for raw `eth_sendTransaction`: append our attribution suffix to a tx's calldata. Pass the
 * existing `data` (or omit / "0x" for a bare value transfer). Returns calldata + suffix.
 */
export function appendBuilderSuffix(data?: string): `0x${string}` {
  const base = data && data !== "0x" ? data.replace(/^0x/, "") : "";
  return `0x${base}${BUILDER_DATA_SUFFIX.slice(2)}`;
}
