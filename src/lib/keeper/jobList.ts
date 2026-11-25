/**
 * The keeper's job names and the KEEPER_JOBS parser, on their own.
 *
 * Split out of jobs.ts so a status page can say which jobs the cron runs without importing the
 * keeper itself: jobs.ts imports the notification sender, and `notify/send.ts` throws at import
 * when notifications are switched on without a key (on purpose, for the senders). jobs.ts
 * re-exports everything here, so the cron route, the CLI, and the tests are unchanged.
 */
export type KeeperJob = "resolve" | "yield" | "bounty" | "payout" | "achievements" | "repeg" | "notify";

/**
 * The scheduled run's jobs, from KEEPER_JOBS. Default "resolve,yield,bounty,payout,repeg,notify": the
 * bounty is ON at launch (decisions.md #11, amended 2026-11-23), and `payout` pays the shares those
 * two just opened (decisions.md #16), so it runs right after them. Achievements need the network's
 * EAS schema, so they stay opt-in. A KEEPER_JOBS that lists its jobs must name `payout` too.
 */
export const DEFAULT_JOBS: KeeperJob[] = ["resolve", "yield", "bounty", "payout", "repeg", "notify"];

export const KNOWN_JOBS: readonly KeeperJob[] = ["resolve", "yield", "bounty", "payout", "achievements", "repeg", "notify"];

export function jobsFrom(raw: string | undefined): KeeperJob[] {
  if (!raw?.trim()) return DEFAULT_JOBS;
  const asked = raw.split(",").map((j) => j.trim()).filter(Boolean);
  const unknown = asked.filter((j) => !KNOWN_JOBS.includes(j as KeeperJob));
  if (unknown.length) throw new Error(`unknown KEEPER_JOBS entries: ${unknown.join(", ")}`);
  // Always in the canonical order, whatever order the setting lists them in.
  return KNOWN_JOBS.filter((j) => asked.includes(j));
}
