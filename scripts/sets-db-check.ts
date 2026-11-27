/**
 * Proof: reserved word sets against a real Postgres (lib/db/sets.ts; decisions.md, "Reserved word
 * sets"). The unit tests stand a map in for the database, so they can't show that the SQL runs,
 * that the table's key keeps a word in one set whatever two requests do at once, or that a reveal
 * landing in the middle of an edit wins. This does.
 *
 * It empties the set tables, so it refuses any database that isn't on this machine. A throwaway one:
 *
 *   createdb lexi_sets_check && for f in drizzle/0*.sql; do sed 's/--> statement-breakpoint//g' "$f" | psql -q -d lexi_sets_check; done
 *   DATABASE_URL=postgresql://localhost/lexi_sets_check npx tsx scripts/sets-db-check.ts
 *
 * Rerun it after touching lib/db/sets.ts or the set tables.
 */
import { sql } from "drizzle-orm";
import { getDb, closeDb } from "@/lib/db/client";
import {
  SetError,
  addWords,
  createSet,
  deleteSet,
  heldOfRoot,
  listSets,
  markReleased,
  moveWords,
  newestRoot,
  removeWords,
  reorderSets,
  replaceDrafts,
  revealDue,
  revealSet,
  saveRoot,
  setHeadliner,
  setReleaseRoot,
  updateSet,
} from "@/lib/db/sets";
import { GATE_HOURS_DEFAULT, PER_PLAYER_DEFAULT, type SetSettings } from "@/lib/sets/rules";
import { profileVouchers, settleVouchers, takeVoucher } from "@/lib/db/setVouchers";
import { SETTLE_AFTER_SECONDS } from "@/lib/sets/voucher";
import { WORDS } from "@/lib/dictionary";

const CHAIN = 84532;
const base = (name: string, over: Partial<SetSettings> = {}): SetSettings => ({
  name,
  revealAt: null,
  releaseAt: null,
  gateHours: GATE_HOURS_DEFAULT,
  perPlayerLimit: PER_PLAYER_DEFAULT,
  sort: 0,
  ...over,
});

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/^[a-z]+:\/\/([^@/]*@)?(localhost|127\.0\.0\.1)([:/]|$)/.test(url)) throw new Error("DATABASE_URL must be on this machine");

  let failed = 0;
  const check = (name: string, ok: boolean, got?: unknown) => {
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : " → " + JSON.stringify(got)}`);
  };
  const refused = async (fn: () => Promise<unknown>): Promise<string | null> => {
    try {
      await fn();
      return null;
    } catch (err) {
      return err instanceof SetError ? err.code : `other: ${String((err as Error).message).slice(0, 60)}`;
    }
  };
  const [A, B, C, D, E, F, G, H, I] = WORDS.slice(300, 309);
  const wordsOf = async (id: number) => (await listSets(CHAIN)).sets.find((s) => s.id === id)?.words.map((w) => w.word) ?? [];
  const statusOf = async (id: number) => (await listSets(CHAIN)).sets.find((s) => s.id === id)?.status;

  const db = getDb();
  await db.execute(sql`delete from set_vouchers`);
  await db.execute(sql`delete from set_words`);
  await db.execute(sql`delete from word_sets`);
  await db.execute(sql`delete from dictionary_roots`);

  check("no sets at first, and the tables are there", JSON.stringify(await listSets(CHAIN)) === '{"sets":[],"migrated":true}');

  // a draft is fully editable
  const one = await createSet(CHAIN, base("One"));
  const two = await createSet(CHAIN, base("Two", { sort: 1 }));
  check("words go into a draft", JSON.stringify(await addWords(CHAIN, one, [A, B, C])) === JSON.stringify({ added: [A, B, C], taken: [] }));
  check("the same word again is left as it is", JSON.stringify(await addWords(CHAIN, one, [A])) === JSON.stringify({ added: [], taken: [] }));
  const cross = await addWords(CHAIN, two, [B, D]);
  check("a word can't sit in two sets: refused and named, the rest go in", JSON.stringify(cross) === JSON.stringify({ added: [D], taken: [B] }), cross);
  check("each set holds its own", (await wordsOf(one)).join() === [A, B, C].join() && (await wordsOf(two)).join() === D);

  // two requests at once for the same word in two sets: exactly one gets it
  const race = await Promise.all([addWords(CHAIN, one, [E]), addWords(CHAIN, two, [E])]);
  check("two at once for one word: one set gets it", race.filter((r) => r.added.length === 1).length === 1 && race.filter((r) => r.taken.length === 1).length === 1, race);
  await removeWords(CHAIN, one, [E]);
  await removeWords(CHAIN, two, [E]);

  check("a word is removed", (await removeWords(CHAIN, one, [C])) === 1 && (await wordsOf(one)).join() === [A, B].join());
  check("a word moves between drafts", (await moveWords(CHAIN, [B], two)) === 1 && (await wordsOf(two)).join() === [B, D].sort().join());
  check("moving a word no set has moves nothing", (await moveWords(CHAIN, [G], two)) === 0 && (await wordsOf(two)).join() === [B, D].sort().join());
  await setHeadliner(CHAIN, two, D, true);
  check("a headliner is flagged", (await listSets(CHAIN)).sets.find((s) => s.id === two)?.words.find((w) => w.word === D)?.headliner === true);
  await updateSet(CHAIN, one, { name: "Uno", gateHours: 48, releaseAt: new Date("2027-01-02T00:00:00Z") });
  const uno = (await listSets(CHAIN)).sets.find((s) => s.id === one);
  check("a draft is renamed and rescheduled", uno?.name === "Uno" && uno.gateHours === 48 && uno.releaseAt?.toISOString() === "2027-01-02T00:00:00.000Z", uno);
  await reorderSets(CHAIN, [two, one]);
  check("the order is kept", (await listSets(CHAIN)).sets.map((s) => s.id).join() === [two, one].join());

  // revealed: words and name locked, the dates still move
  const empty = await createSet(CHAIN, base("Empty"));
  check("an empty set can't be revealed", (await refused(() => revealSet(CHAIN, empty, new Date()))) === "empty");
  await revealSet(CHAIN, two, new Date());
  check("a set is revealed", (await statusOf(two)) === "revealed");
  check("revealed: no word added", (await refused(() => addWords(CHAIN, two, [F]))) === "locked");
  check("revealed: no word removed", (await refused(() => removeWords(CHAIN, two, [D]))) === "locked");
  check("revealed: no word moved out", (await refused(() => moveWords(CHAIN, [D], one))) === "locked");
  check("revealed: no word moved in", (await refused(() => moveWords(CHAIN, [A], two))) === "locked");
  check("revealed: no headliner change", (await refused(() => setHeadliner(CHAIN, two, B, true))) === "locked");
  check("revealed: no rename", (await refused(() => updateSet(CHAIN, two, { name: "Renamed" }))) === "locked");
  check("revealed: not deleted", (await refused(() => deleteSet(CHAIN, two))) === "locked");
  check("revealed: revealing again is refused", (await refused(() => revealSet(CHAIN, two, new Date()))) === "locked");
  check("revealed: its dates still move", (await refused(() => updateSet(CHAIN, two, { releaseAt: new Date("2027-02-01T00:00:00Z"), gateHours: 12 }))) === null);
  check("its words are as they were", (await wordsOf(two)).join() === [B, D].sort().join());

  // an edit that started while the set was a draft loses to a reveal that lands first
  const racy = await createSet(CHAIN, base("Racy"));
  await addWords(CHAIN, racy, [F]);
  const both = await Promise.allSettled([revealSet(CHAIN, racy, new Date()), addWords(CHAIN, racy, [G])]);
  const after = await wordsOf(racy);
  check(
    "a reveal and an edit at once: the set ends revealed, and the word is in only if it got there first",
    (await statusOf(racy)) === "revealed" && (both[1].status === "fulfilled" ? after.includes(G) : !after.includes(G)),
    { both: both.map((b) => b.status), after },
  );

  // the scheduled reveal: once, and never an empty set
  const due = await createSet(CHAIN, base("Due", { revealAt: new Date(Date.now() - 1000) }));
  await addWords(CHAIN, due, [C]);
  const later = await createSet(CHAIN, base("Later", { revealAt: new Date(Date.now() + 3_600_000) }));
  await addWords(CHAIN, later, [E]);
  await updateSet(CHAIN, empty, { revealAt: new Date(Date.now() - 1000) });
  const twice = await Promise.all([revealDue(CHAIN, new Date()), revealDue(CHAIN, new Date())]);
  check("a due draft is revealed once, however many servers notice", twice.flat().join() === String(due), twice);
  check("a draft not due yet, and an empty one, stay drafts", (await statusOf(later)) === "draft" && (await statusOf(empty)) === "draft");

  // released: permanent, and marked once
  const marks = await Promise.all([
    markReleased(CHAIN, two, { releasedAt: new Date(), gateUntil: new Date(Date.now() + 86_400_000), releaseBlock: 123 }),
    markReleased(CHAIN, two, { releasedAt: new Date(), gateUntil: null, releaseBlock: 124 }),
  ]);
  check("a release is marked once", marks.filter(Boolean).length === 1, marks);
  check("a draft can't be marked released", (await markReleased(CHAIN, one, { releasedAt: new Date(), gateUntil: null, releaseBlock: null })) === false);
  check("released: no word change", (await refused(() => removeWords(CHAIN, two, [D]))) === "locked");
  check("released: no reschedule", (await refused(() => updateSet(CHAIN, two, { releaseAt: new Date() }))) === "locked");
  check("released: not deleted", (await refused(() => deleteSet(CHAIN, two))) === "locked");
  check("released: its place in the list can still move", (await refused(() => updateSet(CHAIN, two, { sort: 7 }))) === null);

  // an import replaces the drafts and nothing else
  const before = (await listSets(CHAIN)).sets.filter((s) => s.status !== "draft").map((s) => `${s.id}:${s.words.map((w) => w.word).join("+")}`);
  await replaceDrafts(CHAIN, [
    { ...base("Fresh"), words: [{ word: H, headliner: true }, { word: I, headliner: false }] },
    { ...base("Fresher", { sort: 1 }), words: [] },
  ]);
  const now = (await listSets(CHAIN)).sets;
  check("an import replaces every draft", now.filter((s) => s.status === "draft").map((s) => s.name).sort().join() === "Fresh,Fresher", now.map((s) => `${s.name}:${s.status}`));
  check("and leaves revealed and released sets as they were", now.filter((s) => s.status !== "draft").map((s) => `${s.id}:${s.words.map((w) => w.word).join("+")}`).join() === before.join());
  check(
    "an import that takes a locked set's word changes nothing at all",
    (await refused(() => replaceDrafts(CHAIN, [{ ...base("Thief"), words: [{ word: D, headliner: false }] }]))) === "word_taken" &&
      (await listSets(CHAIN)).sets.filter((s) => s.status === "draft").map((s) => s.name).sort().join() === "Fresh,Fresher",
  );
  const fresh = (await listSets(CHAIN)).sets.find((s) => s.name === "Fresh")!;
  check("a draft is deleted, with its words", (await refused(() => deleteSet(CHAIN, fresh.id))) === null && (await addWords(CHAIN, one, [])).added.length === 0);
  check("a set that isn't there is not_found", (await refused(() => addWords(CHAIN, 999_999, [A]))) === "not_found");
  check("a set of another chain is not_found", (await refused(() => addWords(8453, two, [A]))) === "not_found");

  // roots
  await saveRoot(CHAIN, "0xAA", [A, B], "reserve");
  await saveRoot(CHAIN, "0xaa", [C], "reserve"); // the same root again changes nothing
  await new Promise((r) => setTimeout(r, 20));
  await saveRoot(CHAIN, "0xbb", [B], `release:${two}`);
  check("a root's words are kept, by the root in lowercase", JSON.stringify(await heldOfRoot(CHAIN, "0xAA")) === JSON.stringify([A, B]));
  check("the newest root is the last built", (await newestRoot(CHAIN))?.root === "0xbb");
  await new Promise((r) => setTimeout(r, 20));
  await saveRoot(CHAIN, "0xaa", [A, B], "reserve"); // built again: it is the newest now, with its first words and note
  check("a root built again is the newest", (await newestRoot(CHAIN))?.root === "0xaa" && JSON.stringify(await heldOfRoot(CHAIN, "0xaa")) === JSON.stringify([A, B]));
  check("a root never built here is null", (await heldOfRoot(CHAIN, "0xcc")) === null);
  // the mark that a release was built: only on a revealed set
  const shown = (await listSets(CHAIN)).sets.find((s) => s.status === "revealed")!;
  check("a release root is recorded on a revealed set", (await setReleaseRoot(CHAIN, shown.id, "0xBB")) === true && (await listSets(CHAIN)).sets.find((s) => s.id === shown.id)?.releaseRoot === "0xbb");
  check("and never on a draft or a released one", (await setReleaseRoot(CHAIN, one, "0xbb")) === false && (await setReleaseRoot(CHAIN, two, "0xbb")) === false);
  check("another chain sees none of it", (await heldOfRoot(8453, "0xaa")) === null && (await listSets(8453)).sets.length === 0);

  // --- the first-day gate's vouchers (lib/db/setVouchers.ts) ---
  const P = "0x00000000000000000000000000000000000000a1"; // a profile's account
  const L = "0x00000000000000000000000000000000000000b2"; // a wallet linked into it
  const O = "0x00000000000000000000000000000000000000c3"; // another player
  const soon = () => new Date(Date.now() + 600_000);
  const take = (account: string, wallets: string[], wallet: string, word: string, limit = 1) =>
    takeVoucher({ chainId: CHAIN, setId: two, account, wallets, wallet, word, limit, deadline: soon() });
  const res = (r: Awaited<ReturnType<typeof take>>) => (r.ok ? (r.renewed ? "renewed" : "new") : `limit:${r.words.join("+")}`);

  check("a profile's first word of a set", res(await take(P, [P, L], P, B)) === "new");
  check("a second word is refused, from the same wallet", res(await take(P, [P, L], P, D)) === `limit:${B}`);
  check("and from a linked wallet", res(await take(P, [P, L], L, D)) === `limit:${B}`);
  check("the same word again renews its one row, for either wallet", res(await take(P, [P, L], L, B)) === "renewed" && (await profileVouchers(CHAIN, two, P, [P, L])).length === 1);
  check("the row names the wallet that asked last", (await profileVouchers(CHAIN, two, P, [P, L]))[0].wallet === L);
  check("another profile has its own slot", res(await take(O, [O], O, D)) === "new");

  // a wallet that took its word as a profile of its own, then joined: its row comes with it
  const J = "0x00000000000000000000000000000000000000d4";
  const Q = "0x00000000000000000000000000000000000000e5";
  check("a lone wallet takes a word", res(await take(J, [J], J, B)) === "new");
  check("then joins a profile: that profile's limit counts it", res(await take(Q, [Q, J], Q, D)) === `limit:${B}`);

  // two requests at once for two different words: exactly one gets the slot
  const R = "0x00000000000000000000000000000000000000f6";
  const both2 = await Promise.all([take(R, [R], R, B), take(R, [R], R, D)]);
  check("two at once for the last slot: one new, one refused", both2.map(res).filter((x) => x === "new").length === 1 && both2.filter((x) => !x.ok).length === 1, both2.map(res));
  check("with a limit of two, two different words go in and a third doesn't", res(await take(R, [R], R, both2[0].ok ? D : B, 2)) === "new" && !(await take(R, [R], R, A, 2)).ok);

  // settling: read from the chain only once a voucher can no longer be spent
  const nowSec = Math.floor(Date.now() / 1000);
  let asked = 0;
  await settleVouchers(CHAIN, two, P, [P, L], nowSec, async () => (asked++, false));
  check("a voucher still spendable isn't settled", asked === 0 && (await profileVouchers(CHAIN, two, P, [P, L]))[0].used === null);
  const past = nowSec + 600 + SETTLE_AFTER_SECONDS + 5;
  await settleVouchers(CHAIN, two, P, [P, L], past, async () => null);
  check("a read that couldn't tell leaves it counting", (await profileVouchers(CHAIN, two, P, [P, L]))[0].used === null && !(await take(P, [P, L], P, D)).ok);
  await settleVouchers(CHAIN, two, P, [P, L], past, async () => false);
  check("expired and unused: the slot is free again", (await profileVouchers(CHAIN, two, P, [P, L]))[0].used === false && res(await take(P, [P, L], P, D)) === "new");
  await settleVouchers(CHAIN, two, P, [P, L], past + 10_000, async (r) => r.word === D);
  check("used: the slot is spent for good", (await profileVouchers(CHAIN, two, P, [P, L])).find((r) => r.word === D)?.used === true && res(await take(P, [P, L], P, A)) === `limit:${D}`);
  check("the same word again is still only a renewal", res(await take(P, [P, L], P, D)) === "renewed" && (await profileVouchers(CHAIN, two, P, [P, L])).find((r) => r.word === D)?.used === true);

  // the same word again after its voucher expired unused: its one row is revived (the table's key
  // is the word, so a second row for it would be refused by the database every time)
  const V = "0x00000000000000000000000000000000000000a7";
  check("a first voucher", res(await take(V, [V], V, B)) === "new");
  await settleVouchers(CHAIN, two, V, [V], past, async () => false);
  check("it expired unused", (await profileVouchers(CHAIN, two, V, [V]))[0].used === false);
  check("the same word again is signed again, on the same row", res(await take(V, [V], V, B)) === "renewed" && (await profileVouchers(CHAIN, two, V, [V])).length === 1);
  check("and holds its slot again", (await profileVouchers(CHAIN, two, V, [V]))[0].used === null && !(await take(V, [V], V, D)).ok);

  // a renewal from a linked wallet: the row remembers the first wallet, and settling is asked about both
  const W1 = "0x00000000000000000000000000000000000000b8";
  const W2 = "0x00000000000000000000000000000000000000c9";
  await take(W1, [W1, W2], W1, B);
  await take(W1, [W1, W2], W2, B);
  const kept = (await profileVouchers(CHAIN, two, W1, [W1, W2]))[0];
  check("a renewal from another wallet keeps every wallet the row was signed for", kept.wallet === W2 && kept.named.slice().sort().join() === [W1, W2].sort().join(), kept);
  let seen: string[] = [];
  await settleVouchers(CHAIN, two, W1, [W1, W2], past, async (r) => ((seen = r.named), r.named.includes(W1)));
  check("settling is handed them all, so the first wallet's claim spends the slot", seen.includes(W1) && (await profileVouchers(CHAIN, two, W1, [W1, W2]))[0].used === true && !(await take(W1, [W1, W2], W2, D)).ok);

  await closeDb();
  console.log(failed === 0 ? "\nall checks passed" : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => {});
  process.exit(1);
});
