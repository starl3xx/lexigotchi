/**
 * Run `work` once the response has gone (Next's `after`), so a request never waits on it: a push
 * service, a mail API. Outside a request (a test, a script) there is no response to wait for, and
 * `after` throws: the work starts now, unawaited. Either way `work` must catch its own failures;
 * one that gets out is swallowed here, because nothing is listening for it.
 */
import { after } from "next/server";

export function afterResponse(work: () => Promise<void>): void {
  const safe = () => work().catch(() => {});
  try {
    after(safe);
  } catch {
    void safe();
  }
}
