/**
 * `getLogs` over a span an RPC may refuse as too wide (the public Base RPCs allow 200 blocks; the app's
 * Alchemy RPC allows far more). It asks for the whole span first and halves it while the RPC refuses,
 * down to 100 blocks, so the same code works on both. Server and client safe.
 */
import type { AbiEvent, Log, PublicClient } from "viem";

/** An RPC's "too many blocks / results" answer to eth_getLogs. */
export function isRangeLimit(err: unknown): boolean {
  const m = `${(err as { details?: string })?.details ?? ""} ${(err as Error)?.message ?? ""}`;
  return /limited to|block range|range|too many|exceed/i.test(m);
}

/** The most ranges one read takes, so a read can't run for minutes on a narrow RPC. */
export const MAX_LOG_RANGES = 400;

export async function getLogsAdaptive<E extends AbiEvent>(
  client: PublicClient,
  /** `args` filters on the event's indexed arguments, as viem's `getLogs` does (a list is "any of"). */
  a: { address: `0x${string}`; event: E; fromBlock: bigint; toBlock?: bigint; args?: Record<string, unknown> },
): Promise<Log<bigint, number, false, E>[]> {
  const latest = a.toBlock ?? (await client.getBlockNumber());
  const out: Log<bigint, number, false, E>[] = [];
  let from = a.fromBlock;
  let span = latest - from + 1n;
  for (let i = 0; i < MAX_LOG_RANGES && from <= latest; i++) {
    const to = from + span - 1n > latest ? latest : from + span - 1n;
    try {
      const logs = await client.getLogs({ address: a.address, event: a.event, fromBlock: from, toBlock: to, ...(a.args ? { args: a.args } : {}) } as never);
      out.push(...(logs as unknown as Log<bigint, number, false, E>[]));
      from = to + 1n;
    } catch (err) {
      if (!isRangeLimit(err) || span <= 100n) throw err;
      span = span / 2n < 100n ? 100n : span / 2n;
    }
  }
  if (from <= latest) throw new Error(`getLogs: more than ${MAX_LOG_RANGES} ranges to read`);
  return out;
}
