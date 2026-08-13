"use client";
/**
 * The on-chain WRITE chokepoint. Every contract write the app sends MUST route through here so it
 * carries our ERC-8021 Base builder-code attribution (see ./builderCode). It prefers ERC-5792
 * `wallet_sendCalls` (atomic batch + the `dataSuffix` capability) and falls back to per-call
 * `eth_sendTransaction` with the suffix appended to calldata for wallets without 5792.
 *
 * Provider-level by design, so it works with ANY EIP-1193 provider — the Farcaster / Base mini-app
 * wallet (`sdk.wallet.getEthereumProvider()`) and injected/connected web wallets alike (decision:
 * mini-app AND general web wallet). When the on-chain layer is built, every action helper (mint, roll,
 * claim, stake, …) builds its calldata and hands it here; this is the ONLY place that talks to the
 * wallet, so attribution can never be skipped. See docs/web3-runtime-plan.md.
 */
import { builderCapabilities, appendBuilderSuffix } from "./builderCode";
import { NETWORK } from "./network";

/** The active chain (see ./network — Base mainnet unless NEXT_PUBLIC_CHAIN_ID says otherwise). */
export const CHAIN_ID = NETWORK.id;
export const CHAIN_ID_HEX = NETWORK.idHex;

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export interface Call {
  to: `0x${string}`;
  data?: `0x${string}`;
  value?: `0x${string}`;
}

export type SendResult =
  | { via: "sendCalls"; id: string }
  | { via: "sendTransaction"; hashes: string[] };

/** Thrown when the wallet is not on the game's chain and could not be moved there. */
export class WrongChainError extends Error {
  constructor() {
    super(`Your wallet is on the wrong network — switch it to ${NETWORK.name} and try again`);
    this.name = "WrongChainError";
  }
}

/**
 * Make the wallet be on the game's chain, or refuse to proceed.
 *
 * This exists because of a real transaction: reads come from OUR RPC, so the UI looks right no
 * matter what chain the wallet sits on — and the `eth_sendTransaction` fallback carries no chain
 * id at all, so a wallet parked on Ethereum mainnet happily sent a Sepolia daily commit to chain 1
 * (real gas, calldata into an address with no code, nothing minted). The 5792 path names a chainId
 * but honoring it is the wallet's choice. So: check, ask to switch (adding the chain if the wallet
 * doesn't know it), then RE-CHECK — a wallet can silently no-op a switch request, and the re-check
 * is the only part the wallet can't fake by resolving the promise.
 */
async function ensureChain(provider: Eip1193Provider): Promise<void> {
  const read = async () => parseInt(String(await provider.request({ method: "eth_chainId" })), 16);
  if ((await read()) === CHAIN_ID) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (err) {
    // 4902: the wallet has never heard of this chain — teach it, then switch again.
    if ((err as { code?: number })?.code !== 4902) throw err;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CHAIN_ID_HEX,
          chainName: NETWORK.name,
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [NETWORK.publicRpc],
          blockExplorerUrls: [NETWORK.explorer],
        },
      ],
    });
    // Some wallets switch as part of adding; others need to be asked again. The re-check below is
    // the arbiter either way.
    await provider
      .request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] })
      .catch(() => {});
  }

  if ((await read()) !== CHAIN_ID) throw new WrongChainError();
}

/**
 * Send one or more calls from `from` on Base, always carrying the builder-code attribution. Returns
 * the ERC-5792 batch id (preferred path) or the individual tx hashes (fallback). Non-"unsupported"
 * provider errors (e.g. a user rejection, code 4001) propagate unchanged.
 *
 * The chain guard runs FIRST, for both paths — no call leaves this function unless the wallet is
 * verifiably on the game's chain.
 */
export async function sendCallsAttributed(
  provider: Eip1193Provider,
  from: `0x${string}`,
  calls: Call[],
): Promise<SendResult> {
  await ensureChain(provider);
  try {
    const id = await provider.request({
      method: "wallet_sendCalls",
      params: [
        {
          version: "2.0.0",
          from,
          chainId: CHAIN_ID_HEX,
          atomicRequired: false,
          calls: calls.map((c) => ({ to: c.to, data: c.data ?? "0x", value: c.value })),
          capabilities: builderCapabilities(),
        },
      ],
    });
    return { via: "sendCalls", id: String(id) };
  } catch (err) {
    if (!isMethodUnsupported(err)) throw err;
    // Wallet lacks ERC-5792 — fall back to plain transactions, the builder suffix appended to each
    // call's calldata so attribution still rides along.
    const hashes: string[] = [];
    for (const c of calls) {
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [{ from, to: c.to, data: appendBuilderSuffix(c.data), value: c.value }],
      });
      hashes.push(String(hash));
    }
    return { via: "sendTransaction", hashes };
  }
}

/** EIP-1193 "unsupported method" (4200) / "unauthorized" (4100) / JSON-RPC "method not found"
 *  (-32601), or a message match — the signals a wallet gives when it can't do `wallet_sendCalls`. */
function isMethodUnsupported(err: unknown): boolean {
  const code = (err as { code?: number })?.code;
  if (code === 4200 || code === 4100 || code === -32601) return true;
  const msg = String((err as { message?: string })?.message ?? "");
  return /unsupported method|not support|method not found|wallet_sendcalls/i.test(msg);
}
