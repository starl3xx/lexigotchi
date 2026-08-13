/**
 * The PRODUCT's bounty theme rotation — the single source both the keeper and the UI read.
 *
 * The keeper picks a period's theme as `period % THEMES.length` and bakes the index into the
 * epoch's on-chain `meta`; the screens render the same index. Before this module existed the
 * keeper rotated over the SIM's theme list, which carries extra experiment themes (7 vs 5) — the
 * indices silently diverged, so the screen would eventually display a different theme than the
 * one the keeper actually paid. One list, imported by both, ends that class of bug.
 *
 * The sim keeps its own longer list on purpose (it sweeps experimental themes); this one is what
 * ships. Order is API: appending is safe, reordering renumbers every future period's meta.
 */
export const THEMES: { name: string; short: string; test: (w: string) => boolean }[] = [
  { name: "Contains a rare letter (Q / Z / X / J)", short: "rare letters", test: (w) => /[QZXJ]/.test(w) },
  { name: "Has a repeated letter", short: "double letters", test: (w) => new Set(w).size < w.length },
  { name: "Ends in -ING", short: "-ING", test: (w) => w.endsWith("ING") },
  { name: "Starts with a vowel", short: "vowel-start", test: (w) => "AEIOU".includes(w[0]) },
  { name: "Ends in Y", short: "-Y", test: (w) => w.endsWith("Y") },
];

/** The theme index for a weekly period (period = floor(utcDay / 7)). */
export function themeForPeriod(period: number): number {
  return period % THEMES.length;
}
