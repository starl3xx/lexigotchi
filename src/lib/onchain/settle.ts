/**
 * Re-read until a write shows up, or the schedule runs out.
 *
 * A send returns when the wallet accepts the transaction, not when it is mined, and the public RPC
 * is not read-after-write consistent (see useOnchain's send). So a single read right after a claim
 * or a stake routinely returns the bag as it was, and the action looks like it did nothing. This
 * reads on a short schedule and stops at the first read that shows the change.
 *
 * `offsetsMs` are times from the call: the defaults read at 0, 2, 5, 10, and 20 seconds. A read
 * that throws counts as a miss, not an answer. Returns whether the change was seen.
 */
export const SETTLE_OFFSETS_MS: readonly number[] = [0, 2_000, 5_000, 10_000, 20_000];

export async function readUntil<T>(
  read: () => Promise<T>,
  seen: (value: T) => boolean,
  offsetsMs: readonly number[] = SETTLE_OFFSETS_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<boolean> {
  let at = 0;
  for (const offset of offsetsMs) {
    if (offset > at) await sleep(offset - at);
    at = Math.max(at, offset);
    try {
      if (seen(await read())) return true;
    } catch {
      // A failed read says nothing about the write: try again at the next offset.
    }
  }
  return false;
}
