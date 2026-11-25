/**
 * The daily keeper — the operator's heartbeat, run once per UTC day (cron or by hand):
 *
 *   npm run keeper -- --resolve          reveal today's word + resolve the jackpot
 *   npm run keeper -- --yield            open today's yield epoch (epochId = UTC day)
 *   npm run keeper -- --bounty           open this week's bounty period if unopened
 *   npm run keeper -- --payout           pay every opened share still unpaid (decisions.md #16)
 *   npm run keeper -- --achievements     attest newly-earned EAS badges
 *   npm run keeper -- --notify           warn players whose staked words are about to go hungry
 *   npm run keeper -- --announce "t" "b" one-off push to everyone who added the mini app
 *   npm run keeper -- --dry [...]        compute + verify everything, send nothing
 *
 * `.env.local` loads automatically (--env-file-if-exists in the npm script). Without it the chain
 * defaults to mainnet and the run dies on a missing deployment rather than doing something wrong.
 *
 * Env: KEEPER_PRIVATE_KEY (the contracts' keeper role — Sepolia: the throwaway deployer),
 * NEXT_PUBLIC_CHAIN_ID / NEXT_PUBLIC_RPC_URL as usual. The AnswerChain schedule comes from
 * ANSWER_CHAIN_SEED (+ ANSWER_CHAIN_DAYS) when set, else ANSWER_CHAIN_FILE (default: the Sepolia
 * rehearsal file); see src/lib/keeper/answerSchedule.ts. NEVER commit or log schedule contents —
 * whoever holds future words wins every jackpot.
 *
 * Epoch trees are stored in the `reward_leaves` table (DATABASE_URL) before each openEpoch, each
 * entry carrying its proof — that table IS the claim route's data, so a run without a database
 * refuses to open an epoch. A copy also lands in keeper-output/<stream>-<epoch>-<root>.json (gitignored)
 * when the file system allows. Treat both as operational state: a tree can NOT be rebuilt later,
 * because the scan reads the latest chain state, not the state the epoch was opened at.
 */
import { createKeeper, type KeeperJob } from "../src/lib/keeper/jobs";
import { closeDb } from "../src/lib/db/client";

const args = new Set(process.argv.slice(2));
const keeper = createKeeper({ dry: args.has("--dry") });

// THUNKS, run strictly one after another. This used to push the job PROMISES, which started every
// job at once (same key, racing for one nonce) while the loop below only awaited them in order.
const jobs: { name: string; run: () => Promise<void> }[] = [];
for (const job of ["resolve", "yield", "bounty", "payout", "achievements", "repeg", "notify"] as KeeperJob[]) {
  if (args.has(`--${job}`)) jobs.push({ name: job, run: () => keeper.run(job) });
}
// --announce "<title>" "<body>" — positional, so the copy is visible in shell history.
const annIdx = process.argv.indexOf("--announce");
if (annIdx !== -1) {
  const [title, body] = [process.argv[annIdx + 1], process.argv[annIdx + 2]];
  if (!title || !body || title.startsWith("--") || body.startsWith("--")) {
    console.log('usage: npm run keeper -- --announce "<title>" "<body>" [--dry]');
    process.exit(1);
  }
  jobs.push({ name: "announce", run: () => keeper.announce(title, body) });
}
if (jobs.length === 0) {
  console.log(
    'usage: npm run keeper -- [--resolve] [--yield] [--bounty] [--payout] [--achievements] [--repeg] [--notify] ' +
      '[--announce "<title>" "<body>"] [--dry]',
  );
  process.exit(1);
}

// One job failing doesn't skip the rest (a failed bounty must not cost the day's hunger warning),
// but the exit code says something failed. Each job already redacts its own secrets.
let failed = 0;
for (const j of jobs) {
  try {
    await j.run();
  } catch (err) {
    failed++;
    console.error(`${j.name}: FAILED — ${(err as Error).message ?? err}`);
  }
}
// The pooled Postgres connection keeps Node alive after the last job; close it so the run exits.
await closeDb();
process.exit(failed ? 1 : 0);
