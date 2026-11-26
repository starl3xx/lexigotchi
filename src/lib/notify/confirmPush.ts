/**
 * The "Reminders are on" push to a browser that just opted in (the subscribe route sends it and
 * waits for it). It is the channel's end-to-end proof, so it must not be the thing that breaks it.
 *
 * A push the service calls "gone" (404/410) normally drops the browser's row: that is how dead
 * browsers leave (lib/notify/webPush.ts). But a row made a second ago is not a dead browser, and one
 * answer is not enough to drop it: the owner's first real opt-in (2026-11-26, Brave) was stored,
 * answered 200, and was gone from the table half a minute later, while his screen said "Reminders
 * are on". Nothing was logged, so the status is not known. So here the FIRST "gone" drops nothing:
 * wait a moment, send once more, and only a second "gone" drops the row. Both answers are logged
 * (the sender logs each status and host), which is also how the next case gets diagnosed.
 *
 * Pure over its sender and its clock, so the order is tested.
 */
export interface ConfirmDeps {
  /** Send the confirmation. `prune: false` must leave the row alone whatever the service says. */
  send: (opts: { prune: boolean }) => Promise<{ ok: boolean; delivered?: number; gone?: number; failed?: number; skipped?: string }>;
  wait: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

/** How long before the second try: long enough for a push service to know a new subscription. */
export const CONFIRM_RETRY_MS = 4_000;

export type ConfirmOutcome = "delivered" | "delivered-on-retry" | "gone" | "failed" | "skipped";

export async function confirmSubscription(deps: ConfirmDeps): Promise<ConfirmOutcome> {
  const log = deps.log ?? (() => {});
  const first = await deps.send({ prune: false });
  if (first.skipped) return "skipped"; // sends are muted, or not configured: nothing was said
  if ((first.delivered ?? 0) > 0) return "delivered";
  if ((first.gone ?? 0) === 0) {
    log("the confirmation push failed (the sender logged why); the browser's row is kept");
    return "failed";
  }
  log("the push service called a brand-new subscription gone; trying once more before dropping it");
  await deps.wait(CONFIRM_RETRY_MS);
  const second = await deps.send({ prune: true });
  if ((second.delivered ?? 0) > 0) {
    log("the second confirmation push was delivered: the first answer was too early");
    return "delivered-on-retry";
  }
  if ((second.gone ?? 0) > 0) {
    log("gone on the second try too: the browser's row is dropped, though its screen may say reminders are on");
    return "gone";
  }
  log("the second confirmation push failed (the sender logged why); the browser's row is kept");
  return "failed";
}
