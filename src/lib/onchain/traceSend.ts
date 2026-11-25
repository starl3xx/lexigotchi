/**
 * What became of a send whose effect never showed up.
 *
 * A send "succeeds" when the wallet accepts it: `eth_sendTransaction` hands back a hash and
 * `wallet_sendCalls` a batch id, before anything is mined. On 2026-11-24 a tester's faucet request
 * came back accepted (the game said "Faucet sent"), the wallet held Base Sepolia ETH for gas, and no
 * mint ever reached Base Sepolia. The game could only shrug. This asks the game's chain (and, for a
 * batch, the wallet) what happened, so the player and we can see the actual failure.
 *
 * Pure apart from `deps`, so it is tested without a chain or a wallet.
 */
import type { SendResult } from "./sendCalls";

export type SendTrace =
  /** Mined and succeeded on the game's chain. */
  | { kind: "landed"; hash: string }
  /** Mined on the game's chain, and reverted. */
  | { kind: "reverted"; hash: string }
  /** The game's chain knows the transaction but hasn't mined it yet. */
  | { kind: "pending"; hash: string }
  /**
   * The game's chain has never seen this transaction: sent elsewhere, never broadcast, or still
   * queued in the wallet (behind a stuck earlier one). Base's mempool is private, so a transaction
   * that is waiting usually looks like this too, not like "pending".
   */
  | { kind: "unseen"; hash: string }
  /** The wallet says it ran the batch on another chain. */
  | { kind: "other_chain"; chainId: number }
  /** The wallet says the batch failed, with no transaction to look at. */
  | { kind: "wallet_failed" }
  /** The wallet says the batch is still pending. */
  | { kind: "wallet_pending" }
  /** Nothing to check, or nobody could say. */
  | { kind: "unknown" };

export interface TraceDeps {
  /** The game's chain id. */
  chainId: number;
  /** How long to wait for the wallet's answer (default 8 s). */
  walletTimeoutMs?: number;
  /** The receipt on the game's chain, or null when there is none yet. Throws only on a failed read. */
  receipt: (hash: `0x${string}`) => Promise<{ status: "success" | "reverted" } | null>;
  /** Whether the game's chain knows the transaction at all (mined or pending). Throws only on a failed read. */
  known: (hash: `0x${string}`) => Promise<boolean>;
  /** `wallet_getCallsStatus` for a batch id, raw. Throws when the wallet can't answer. */
  callsStatus: (id: string) => Promise<unknown>;
}

async function traceHash(hash: string, deps: TraceDeps): Promise<SendTrace> {
  const h = hash as `0x${string}`;
  const receipt = await deps.receipt(h);
  if (receipt) return { kind: receipt.status === "success" ? "landed" : "reverted", hash };
  return (await deps.known(h)) ? { kind: "pending", hash } : { kind: "unseen", hash };
}

/** The first hash that did NOT land tells the story; if every one landed, the last one. */
async function traceHashes(hashes: string[], deps: TraceDeps): Promise<SendTrace> {
  let last: SendTrace = { kind: "unknown" };
  for (const hash of hashes) {
    last = await traceHash(hash, deps);
    if (last.kind !== "landed") return last;
  }
  return last;
}

/** A chain id as a wallet may write it: a number, "0x…" hex (the standard), or a decimal string. */
function readChainId(v: unknown): number | undefined {
  const n =
    typeof v === "number" ? v
    : typeof v === "string" && /^0x[0-9a-f]+$/i.test(v) ? parseInt(v, 16)
    : typeof v === "string" && /^\d+$/.test(v) ? parseInt(v, 10)
    : undefined;
  return n !== undefined && Number.isFinite(n) ? n : undefined;
}

/**
 * `wallet_getCallsStatus` answers in two shapes: ERC-5792 v2 (`status` a number: 1xx pending, 200
 * confirmed, 4xx/5xx/6xx failed, plus `chainId`) and the older draft (`status` "PENDING" or
 * "CONFIRMED"). Either may carry `receipts` with transaction hashes and a per-receipt `status`
 * ("0x1" success, "0x0" reverted).
 */
function readCallsStatus(raw: unknown): {
  pending: boolean;
  failed: boolean;
  chainId?: number;
  hashes: string[];
} {
  const s = (raw ?? {}) as { status?: unknown; chainId?: unknown; receipts?: unknown };
  const code = typeof s.status === "string" ? s.status.toUpperCase() : s.status;
  const receipts = (Array.isArray(s.receipts) ? s.receipts : []) as { transactionHash?: unknown; status?: unknown }[];
  const receiptFailed = receipts.some((r) => r?.status === "0x0" || r?.status === 0 || r?.status === "reverted");
  return {
    pending: code === "PENDING" || (typeof code === "number" && code >= 100 && code < 200),
    failed: (typeof code === "number" && code >= 400) || code === "FAILED" || receiptFailed,
    chainId: readChainId(s.chainId),
    hashes: receipts
      .map((r) => r?.transactionHash)
      .filter((h): h is string => typeof h === "string" && /^0x[0-9a-fA-F]{64}$/.test(h)),
  };
}

/** Resolves to `fallback` if `p` hasn't settled in `ms`. A wallet relayed over WalletConnect can
 *  leave a request unanswered for minutes, and the action gate waits on this. */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((resolve) => (timer = setTimeout(() => resolve(fallback), ms))),
  ]);
}

const NO_ANSWER = Symbol("no answer");

export async function traceSend(sent: SendResult | undefined, deps: TraceDeps): Promise<SendTrace> {
  if (!sent) return { kind: "unknown" };
  try {
    if (sent.via === "sendTransaction") return await traceHashes(sent.hashes, deps);
    if (!sent.id) return { kind: "unknown" };

    const raw = await withTimeout(deps.callsStatus(sent.id), deps.walletTimeoutMs ?? 8_000, NO_ANSWER);
    if (raw === NO_ANSWER) return { kind: "unknown" };
    const status = readCallsStatus(raw);
    const elsewhere = status.chainId !== undefined && status.chainId !== deps.chainId;

    if (status.hashes.length > 0) {
      // Receipts are checked on OUR chain even when the wallet says "confirmed": a wallet that ran
      // the batch somewhere else and names no chainId shows up here as "unseen".
      const onChain = await traceHashes(status.hashes, deps);
      if (onChain.kind === "unseen") {
        if (elsewhere) return { kind: "other_chain", chainId: status.chainId! };
        return status.failed ? { kind: "wallet_failed" } : onChain;
      }
      // The wallet's verdict beats the receipt: a smart wallet's hash is the bundler's handleOps
      // transaction, which SUCCEEDS onchain when the operation inside it reverts.
      if (status.failed && "hash" in onChain) return { kind: "reverted", hash: onChain.hash };
      return onChain;
    }
    if (elsewhere) return { kind: "other_chain", chainId: status.chainId! };
    if (status.failed) return { kind: "wallet_failed" };
    if (status.pending) return { kind: "wallet_pending" };
    return { kind: "unknown" };
  } catch {
    // A failed read or a wallet without wallet_getCallsStatus says nothing about the send.
    return { kind: "unknown" };
  }
}

/** A hash short enough for a toast, long enough to match against an explorer. */
export const shortHash = (hash: string) => `${hash.slice(0, 8)}…${hash.slice(-6)}`;
