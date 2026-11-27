/**
 * Reserved word sets from the command line (decisions.md, "Reserved word sets"): the commitment
 * hash, and the owner's root changes. The same code the console's Sets tab runs.
 *
 *   npm run sets -- status          how many sets and words, by state, and what waits for a root
 *   npm run sets -- commitment      keccak256 of the canonical JSON of every unreleased set
 *   npm run sets -- reserve         the root that holds back what the sets hold back
 *   npm run sets -- release <id>    the root that releases one revealed set (its gate FIRST)
 *   npm run sets -- confirm         mark released whatever the chain now holds
 *
 * It SENDS nothing: it prints the calls, as `cast send` commands and as one Safe batch. A root's
 * row (the words it leaves out) is stored before its call is printed, so the game can serve proofs
 * the moment the transaction lands.
 *
 * THE LISTS ARE PRIVATE. Nothing here prints a word of an unreleased set unless `--show` is given,
 * and never paste that output anywhere public. A release prints its set's words: a set is revealed
 * before it can be released, so they are public by then.
 *
 * Reads `.env.local` (the database, the network, the RPC), like the keeper.
 */
import { closeDb } from "@/lib/db/client";
import { castCommand, safeBatchJson } from "@/lib/admin/tx";
import { NETWORK } from "@/lib/onchain/network";
import { canonicalSets, commitmentOf, heldOf, reserveChange } from "@/lib/sets/rules";
import { hasGate, loadSets, planRelease, planReserve, reconcile, serving } from "@/lib/sets/server";
import type { TxIntent } from "@/lib/admin/tx";

const args = process.argv.slice(2);
const cmd = args[0] ?? "status";
const show = args.includes("--show");

function printCalls(intents: TxIntent[], name: string) {
  if (intents.length === 0) return;
  console.log(`\nThe calls, in this order (${NETWORK.name}):\n`);
  // `&&`: the root is sent only if the gate before it succeeded.
  console.log(intents.map((i) => castCommand(i)).join(" && \\\n"));
  console.log(`\nOr as ONE Safe transaction (Transaction Builder JSON):\n`);
  console.log(safeBatchJson(intents, { name }, NETWORK.id));
  console.log(`\nAfter it confirms: npm run sets -- confirm`);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (.env.local)");
  const book = await loadSets({ fresh: true });
  if (!book.known) throw new Error("the sets couldn't be read");
  if (!book.migrated) throw new Error("the set tables aren't in this database: run migration 0021 (npm run db:migrate)");

  if (cmd === "commitment") {
    console.log(commitmentOf(book.sets));
    if (show) console.log(canonicalSets(book.sets));
    return;
  }

  if (cmd === "status") {
    const s = await serving();
    for (const status of ["draft", "revealed", "released"] as const) {
      const of = book.sets.filter((x) => x.status === status);
      console.log(`${status.padEnd(9)} ${String(of.length).padStart(3)} sets, ${of.reduce((n, x) => n + x.words.length, 0)} words`);
    }
    // A draft's name is private: ids only, unless asked.
    for (const x of book.sets) console.log(`  #${x.id} ${x.status.padEnd(9)} ${String(x.words.length).padStart(4)} words${show || x.status !== "draft" ? `  ${x.name}` : ""}`);
    console.log(`commitment ${commitmentOf(book.sets)}`);
    console.log(`first-day gate on this network's Words: ${(await hasGate()) ? "yes" : "no (next redeploy)"}`);
    if (!s.ok) return void console.log(`the chain's root: ${s.error}`);
    const change = reserveChange(s.chainHeld, heldOf(book.sets));
    console.log(`the chain holds back ${s.chainHeld.size} words (root ${s.chainRoot ?? "unread"})`);
    console.log(
      change.removed.length || change.added.length
        ? `ROOT OUT OF DATE: ${change.removed.length} to hold back, ${change.added.length} to let go (npm run sets -- reserve)`
        : "the chain holds back exactly what the sets say",
    );
    return;
  }

  if (cmd === "reserve") {
    const plan = await planReserve();
    if (!plan.ok) throw new Error(`no plan: ${plan.error}`);
    if (plan.upToDate) return void console.log("Nothing to send: the chain already holds this root.");
    console.log(`current root ${plan.currentRoot}`);
    console.log(`new root     ${plan.root}`);
    console.log(`holds back ${plan.holds} words in all`);
    if (plan.chainKnown) console.log(`that is ${plan.removed.length} more than the chain holds back now, and ${plan.added.length} let go`);
    else console.log("the chain's current root isn't one built here, so what this changes can't be listed");
    if (plan.dictionaryChanged) console.log("the word list has grown since the chain's root was built: this root also takes in the new words");
    console.log(
      plan.alreadyClaimed === null
        ? "couldn't read which of the newly held-back words are already owned"
        : `${plan.alreadyClaimed.length} of the ${plan.chainKnown ? "newly " : ""}held-back words are already owned (they stay owned; the root only stops a re-claim)`,
    );
    if (show) {
      console.log(`newly held back: ${plan.removed.join(" ")}`);
      console.log(`let go: ${plan.added.join(" ")}`);
      if (plan.alreadyClaimed?.length) console.log(`already owned: ${plan.alreadyClaimed.join(" ")}`);
    }
    return void printCalls(plan.intents, "Words: reserve");
  }

  if (cmd === "release") {
    const id = Number(args[1]);
    if (!Number.isInteger(id)) throw new Error("usage: npm run sets -- release <set id>");
    const plan = await planRelease(id);
    if (!plan.ok) throw new Error(`no plan: ${plan.error}${plan.detail ? ` (${plan.detail})` : ""}`);
    const set = book.sets.find((x) => x.id === id);
    console.log(`release “${set?.name ?? id}”`);
    console.log(`current root ${plan.currentRoot}`);
    console.log(`new root     ${plan.root}`);
    console.log(`words added (${plan.added.length}): ${plan.added.join(" ")}`);
    console.log("words removed (0): a release never removes a word");
    console.log(plan.gate ? `first-day gate until ${new Date(plan.gate.until * 1000).toISOString()}, set BEFORE the root` : `no gate: ${plan.gateNote}`);
    return void printCalls(plan.intents, `Words: release ${set?.name ?? id}`);
  }

  if (cmd === "confirm") {
    const done = await reconcile();
    return void console.log(done.length ? `marked released: ${done.map((d) => `#${d}`).join(", ")}` : "nothing new: no revealed set's release root is on the chain");
  }

  throw new Error(`unknown command "${cmd}" (status, commitment, reserve, release <id>, confirm)`);
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    // Never a database error's own text: it carries the statement and its parameters (the words).
    // Those have a code; this script's own errors don't, and say what to do.
    const e = err as { code?: string; cause?: { code?: string }; message?: string } | null;
    const code = e?.code ?? e?.cause?.code;
    console.error(`sets: ${code ? `failed (${String(code).slice(0, 40)})` : String(e?.message ?? err).split("\n")[0].slice(0, 200)}`);
    await closeDb().catch(() => {});
    process.exit(1);
  });
