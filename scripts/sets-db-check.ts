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
  clearStamp,
  createSet,
  deleteSet,
  heldOfRoot,
  listSets,
  markReleased,
  moveWords,
  newestRoot,
  onAllowlist,
  readStamp,
  readStamps,
  removeWords,
  reorderSets,
  replaceAllowlist,
  replaceDrafts,
  revealDue,
  revealSet,
  saveRoot,
  setHeadliner,
  setReleaseRoot,
  setStamp,
  updateSet,
} from "@/lib/db/sets";
import { revealProblems } from "@/lib/sets/rules";
import { placeholderStamp } from "@/lib/sets/testCollab";
import { SETTINGS_DEFAULTS, type SetSettings } from "@/lib/sets/rules";
import { profileVouchers, settleVouchers, takeVoucher } from "@/lib/db/setVouchers";
import { SETTLE_AFTER_SECONDS } from "@/lib/sets/voucher";
import { WORDS } from "@/lib/dictionary";

const CHAIN = 84532;
const base = (name: string, over: Partial<SetSettings> = {}): SetSettings => ({
  ...SETTINGS_DEFAULTS,
  name,
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

  // Has migration 0023 (what a collab set adds) run here? Everything before the collab section
  // must pass either way: a deploy never waits for a migration.
  const start = await listSets(CHAIN);
  const collab = start.collab;
  console.log(collab ? "migration 0023 has run: the collab checks run too" : "migration 0023 has NOT run: checking that plain sets work without it");
  check("no sets at first, and the tables are there", start.sets.length === 0 && start.migrated === true, start);

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

  // --- collab sets (migration 0023; decisions.md, "Collab sets") ---
  const png = Buffer.from(placeholderStamp());
  const stamp = { mime: "image/png" as const, base64: png.toString("base64"), bytes: png.length };
  const X1 = "0x00000000000000000000000000000000000000e1";
  const X2 = "0x00000000000000000000000000000000000000e2";
  const X3 = "0x00000000000000000000000000000000000000e3";
  if (!collab) {
    // Before 0023: plain sets did everything above. What a collab adds is refused with a reason, never a crash.
    const plain = await createSet(CHAIN, base("Plain"));
    check("before 0023: a collab can't be made", (await refused(() => createSet(CHAIN, base("Collab", { type: "collab" })))) === "not_migrated");
    check("before 0023: a set's look can't be saved", (await refused(() => updateSet(CHAIN, plain, { colorA: "#112233" }))) === "not_migrated");
    check("before 0023: no stamp is stored", (await refused(() => setStamp(CHAIN, plain, stamp))) === "not_migrated");
    check("before 0023: no allowlist is stored", (await refused(() => replaceAllowlist(CHAIN, plain, [X1]))) === "not_migrated");
    check("before 0023: a first-day rule can't be saved", (await refused(() => updateSet(CHAIN, plain, { gateRule: "allowlist" }))) === "not_migrated");
    check("before 0023: there is no stamp to read", (await readStamp(CHAIN, plain)) === null && (await readStamps(CHAIN)).size === 0);
    check("before 0023: every set reads as a standard one", (await listSets(CHAIN)).sets.every((s) => s.type === "standard" && s.gateRule === "verified" && s.stampAt === null));
    check("before 0023: a plain set is still renamed and rescheduled", (await refused(() => updateSet(CHAIN, plain, { name: "Plainer", gateHours: 6 }))) === null);
    // An import of a draft that keeps its name tries to carry its stamp and list over. Those
    // tables aren't there yet: the import must go through all the same (a savepoint, not a dead transaction).
    const kept = (await listSets(CHAIN)).sets.filter((s) => s.status === "draft").map((s) => ({ ...base(s.name, { sort: s.sort }), words: s.words }));
    check("before 0023: an import of drafts that keep their names still goes through, words and all",
      kept.some((s) => s.name === "Plainer") && (await refused(() => replaceDrafts(CHAIN, kept))) === null &&
        JSON.stringify((await listSets(CHAIN)).sets.filter((s) => s.status === "draft").map((s) => [s.name, s.words.map((w) => w.word)]).sort()) === JSON.stringify(kept.map((s) => [s.name, s.words.map((w) => w.word)]).sort()));
  } else {
    const [K1, K2, K3, K4, K5, K6, K7, K8, K9, K10, K11, K12, K13, K14, K15, K16, K17] = WORDS.slice(320, 337);
    const look = { type: "collab" as const, partnerName: "Partner", partnerUrl: "https://partner.example/", colorA: "#112233", colorB: "#aabbcc" };
    // The collab's own rules are checked as they will be once its card ships (`collabLive`); what
    // holds today, while it hasn't, is checked once below.
    const LIVE = { collabLive: true };
    const whyNot = async (id: number, opts: { collabLive?: boolean } = LIVE): Promise<string[] | null> => {
      try {
        await revealSet(CHAIN, id, new Date(), opts);
        return null;
      } catch (err) {
        return err instanceof SetError && err.code === "not_ready" ? err.problems : [`other: ${String((err as Error).message)}`];
      }
    };
    const get = async (id: number) => (await listSets(CHAIN)).sets.find((s) => s.id === id);

    const co = await createSet(CHAIN, base("Collab", { ...look, sort: 20 }));
    await addWords(CHAIN, co, [K1, K2, K3, K4]);
    const made = await get(co);
    check("a collab set is stored with its partner, link, and colors", made?.type === "collab" && made.partnerName === "Partner" && made.partnerUrl === "https://partner.example/" && made.colorA === "#112233" && made.colorB === "#aabbcc", made);
    check("four words and no stamp: not revealed, and it says both", JSON.stringify(await whyNot(co)) === JSON.stringify(["a collab set has exactly 5 words (this one has 4)", "a collab set needs its stamp"]));
    await setStamp(CHAIN, co, stamp);
    check("its stamp is stored, and the set says when", (await get(co))?.stampAt instanceof Date && (await readStamp(CHAIN, co))?.base64 === stamp.base64);
    check("a second stamp takes the first one's place", (await refused(() => setStamp(CHAIN, co, { ...stamp, mime: "image/jpeg" }))) === null && (await readStamp(CHAIN, co))?.mime === "image/jpeg");
    await setStamp(CHAIN, co, stamp);
    check("another chain has no such stamp", (await readStamp(8453, co)) === null);
    check("four words: still not revealed", JSON.stringify(await whyNot(co)) === JSON.stringify(["a collab set has exactly 5 words (this one has 4)"]));
    await addWords(CHAIN, co, [K5, K6]);
    check("six words: not revealed either", JSON.stringify(await whyNot(co)) === JSON.stringify(["a collab set has exactly 5 words (this one has 6)"]));
    await removeWords(CHAIN, co, [K6]);
    check("it is still a draft", (await get(co))?.status === "draft");
    const today = await whyNot(co, {});
    check("today (the collab card hasn't shipped) even a whole collab isn't revealed, by hand or on its date", today?.length === 1 && /once the collab card ships/.test(today[0]) && (await get(co))?.status === "draft", today);

    // the allowlist
    check("a list is stored whole", (await replaceAllowlist(CHAIN, co, [X1, X2])) === 2 && (await get(co))?.allowlistCount === 2);
    check("a wallet on it is found, among a profile's wallets", (await onAllowlist(co, [X3, X2])) === true && (await onAllowlist(co, [X3])) === false && (await onAllowlist(co, [])) === false);
    check("a new list takes the old one's place", (await replaceAllowlist(CHAIN, co, [X3])) === 1 && (await onAllowlist(co, [X1])) === false && (await onAllowlist(co, [X3])) === true);

    // an import keeps a draft's stamp and list when it comes back under the same name
    const other = await createSet(CHAIN, base("Other", { sort: 21 }));
    await setStamp(CHAIN, other, stamp);
    const drafts = (await listSets(CHAIN)).sets.filter((s) => s.status === "draft");
    await replaceDrafts(
      CHAIN,
      drafts.filter((s) => s.id !== other).map((s) => ({ ...base(s.name, { ...s }), words: s.words })),
    );
    const co2 = (await listSets(CHAIN)).sets.find((s) => s.name === "Collab")!;
    check("an import gives the set a new row", co2.id !== co && co2.type === "collab" && co2.words.length === 5, co2);
    check("and it keeps its stamp and its list", co2.stampAt instanceof Date && (await readStamp(CHAIN, co2.id))?.base64 === stamp.base64 && co2.allowlistCount === 1 && (await onAllowlist(co2.id, [X3])) === true);
    const orphans = await db.execute(sql`select (select count(*) from set_stamps where set_id in (${co}, ${other})) + (select count(*) from set_allowlist where set_id in (${co}, ${other})) as n`);
    check("a draft the import dropped takes its stamp and list with it", Number((orphans as unknown as { n: string }[])[0].n) === 0, orphans);

    // the scheduled reveal agrees with revealProblems, case by case
    const due = new Date(Date.now() - 1000);
    const mk = async (name: string, over: Partial<SetSettings>, words: string[], stamped: boolean) => {
      const id = await createSet(CHAIN, base(name, { revealAt: due, ...over }));
      await addWords(CHAIN, id, words);
      if (stamped) await setStamp(CHAIN, id, stamp);
      return id;
    };
    const cases = [
      await mk("whole", look, [K7, K8, K9, K10, K11], true),
      await mk("no stamp", look, [K12, K13, K14, K15, K16], false),
      await mk("no color", { ...look, colorB: null }, [K17, K6], true),
      await mk("blank partner", { ...look, partnerName: "   " }, [], true),
      await mk("standard, due", {}, [WORDS[340]], false),
    ];
    await updateSet(CHAIN, co2.id, { revealAt: due });
    const dueNow = (await listSets(CHAIN)).sets.filter((s) => s.status === "draft" && s.revealAt);
    // First as it is today: only the standard set is revealed, and every collab waits.
    const todayIds = dueNow.filter((s) => revealProblems(s).length === 0).map((s) => s.id).sort();
    const gotToday = (await revealDue(CHAIN, new Date())).sort();
    check("today the scheduled reveal passes every collab by (the SQL and the rule agree)", JSON.stringify(gotToday) === JSON.stringify(todayIds) && JSON.stringify(gotToday) === JSON.stringify([cases[4]]), { gotToday, todayIds });
    // Then as it will be once the card ships.
    const expectIds = dueNow.filter((s) => s.id !== cases[4] && revealProblems(s, true).length === 0).map((s) => s.id).sort();
    const got = (await revealDue(CHAIN, new Date(), LIVE)).sort();
    check("the scheduled reveal reveals exactly the due drafts that are whole (the SQL and the rule agree)", JSON.stringify(got) === JSON.stringify(expectIds) && got.includes(cases[0]) && got.includes(co2.id) && !got.includes(cases[1]) && !got.includes(cases[2]), { got, expectIds, cases });
    check("a late collab that isn't whole stays a draft, and a second pass changes nothing", (await revealDue(CHAIN, new Date(), LIVE)).length === 0 && (await get(cases[1]))?.status === "draft");

    // revealed: the look is locked with the name; the first day's rule still moves
    check("revealed: no new color", (await refused(() => updateSet(CHAIN, co2.id, { colorA: "#000000" }))) === "locked");
    check("revealed: no new partner, link, or type", (await refused(() => updateSet(CHAIN, co2.id, { partnerName: "Other" }))) === "locked" && (await refused(() => updateSet(CHAIN, co2.id, { partnerUrl: null }))) === "locked" && (await refused(() => updateSet(CHAIN, co2.id, { type: "standard" }))) === "locked");
    check("revealed: no new stamp, and the stamp stays", (await refused(() => setStamp(CHAIN, co2.id, stamp))) === "locked" && (await refused(() => clearStamp(CHAIN, co2.id))) === "locked" && (await readStamp(CHAIN, co2.id))?.status === "revealed");
    check("revealed: the first day's rule can still be set", (await refused(() => updateSet(CHAIN, co2.id, { gateRule: "token", gateToken: "0x" + "4".repeat(40), gateMin: "1000000000000000000", gateLabel: "holders of a test token" }))) === null);
    const ruled = await get(co2.id);
    check("and is stored", ruled?.gateRule === "token" && ruled.gateToken === "0x" + "4".repeat(40) && ruled.gateMin === "1000000000000000000" && ruled.gateLabel === "holders of a test token", ruled);
    check("revealed: its list can still be replaced", (await replaceAllowlist(CHAIN, co2.id, [X1, X2, X3])) === 3);
    await markReleased(CHAIN, co2.id, { releasedAt: new Date(), gateUntil: null, releaseBlock: 1 });
    check("released: the rule and the list are final", (await refused(() => updateSet(CHAIN, co2.id, { gateRule: "verified" }))) === "locked" && (await refused(() => replaceAllowlist(CHAIN, co2.id, []))) === "locked" && (await onAllowlist(co2.id, [X2])) === true);

    // a draft's stamp is cleared, and a deleted draft takes its stamp and list with it
    check("a draft's stamp is cleared", (await refused(() => clearStamp(CHAIN, cases[2]))) === null && (await get(cases[2]))?.stampAt === null);
    await replaceAllowlist(CHAIN, cases[3], [X1]);
    await deleteSet(CHAIN, cases[3]);
    const left = await db.execute(sql`select (select count(*) from set_stamps where set_id = ${cases[3]}) + (select count(*) from set_allowlist where set_id = ${cases[3]}) as n`);
    check("a deleted draft leaves no stamp and no list behind", Number((left as unknown as { n: string }[])[0].n) === 0);
    check("the operator's preview has every stamp of this chain, and none of another", (await readStamps(CHAIN)).size >= 2 && (await readStamps(8453)).size === 0);
  }

  await closeDb();
  console.log(failed === 0 ? "\nall checks passed" : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => {});
  process.exit(1);
});
