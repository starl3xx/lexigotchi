/**
 * Reserved word sets in the database (tables `word_sets`, `set_words`, `dictionary_roots`; migration
 * 0021), and what a collab set adds (columns on `word_sets`, tables `set_stamps` and
 * `set_allowlist`; migration 0023). The rules are lib/sets/rules.ts; this file makes them hold
 * under two requests at once.
 *
 * Every change to a set's words happens in a transaction that LOCKS the set's row and reads its
 * status there, so "a revealed set's words are locked" can't be raced by an edit that started while
 * the set was still a draft. "A word is in one set at most" is the words table's key.
 *
 * Nothing here logs a word, and a caller must not log what these functions throw without thinking:
 * a driver error carries the statement's parameters, which are the words. `SetError` is safe (it
 * carries a code, and words only where the operator's own request named them).
 */
import { and, asc, count, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "./client";
import { dictionaryRoots, setAllowlist, setStamps, setWords, wordSets } from "./schema";
import { isMissingColumn, isMissingTable } from "./profiles";
import {
  COLLAB_LIVE,
  COLLAB_WORDS,
  IDENTITY_KEYS,
  SCHEDULE_KEYS,
  STANDARD_FIELDS,
  editable,
  revealProblems,
  type GateRule,
  type ImportSet,
  type SetSettings,
  type SetStatus,
  type SetType,
  type SetWord,
  type StampType,
  type WordSet,
} from "@/lib/sets/rules";

export type SetErrorCode = "not_found" | "locked" | "word_taken" | "empty" | "not_migrated" | "not_ready" | "not_reserved" | "not_due";

/**
 * The words the chain's dictionary root leaves out right now (lib/sets/server `heldOnChain`), which
 * every reveal is checked against. "unchecked" is for the proofs on a throwaway database
 * (scripts/sets-db-check.ts), where there is no chain: never pass it from the app.
 */
export type HeldOnChain = ReadonlySet<string> | "unchecked";

export class SetError extends Error {
  constructor(
    public code: SetErrorCode,
    /** Words the refusal is about (only ever ones the caller sent). */
    public words: string[] = [],
    /** For `not_ready`: what the set still needs, in the operator's words. */
    public problems: string[] = [],
  ) {
    super(code);
  }
}

/** Migration 0023 (what a collab adds) hasn't run: a column or a table of it is missing. */
function lacksCollab(err: unknown): boolean {
  return isMissingColumn(err) || isMissingTable(err);
}

/** Postgres's "unique violation": here, a word that is already in a set. */
function isUnique(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

type Row = typeof wordSets.$inferSelect;

/** The columns of migration 0021: what a database that hasn't run 0023 can be asked for. */
const BASE_COLUMNS = {
  id: wordSets.id,
  name: wordSets.name,
  status: wordSets.status,
  revealAt: wordSets.revealAt,
  releaseAt: wordSets.releaseAt,
  gateHours: wordSets.gateHours,
  perPlayerLimit: wordSets.perPlayerLimit,
  sort: wordSets.sort,
  revealedAt: wordSets.revealedAt,
  releasedAt: wordSets.releasedAt,
  gateUntil: wordSets.gateUntil,
  releaseBlock: wordSets.releaseBlock,
  releaseRoot: wordSets.releaseRoot,
};
type BaseRow = Pick<Row, keyof typeof BASE_COLUMNS>;

function shape(row: BaseRow & Partial<Row>, words: SetWord[], more: { stampAt: Date | null; allowlistCount: number } = { stampAt: null, allowlistCount: 0 }): WordSet {
  // A row read before migration 0023 has none of a collab's columns: it is a standard set.
  const collab =
    row.type === undefined
      ? STANDARD_FIELDS
      : {
          type: (row.type === "collab" ? "collab" : "standard") as SetType,
          partnerName: row.partnerName ?? null,
          partnerUrl: row.partnerUrl ?? null,
          colorA: row.colorA ?? null,
          colorB: row.colorB ?? null,
          stampAt: more.stampAt,
          gateRule: (row.gateRule === "allowlist" || row.gateRule === "token" ? row.gateRule : "verified") as GateRule,
          gateToken: row.gateToken ?? null,
          gateMin: row.gateMin ?? null,
          gateLabel: row.gateLabel ?? null,
          allowlistCount: more.allowlistCount,
        };
  return {
    ...collab,
    id: row.id,
    name: row.name,
    status: row.status as SetStatus,
    revealAt: row.revealAt,
    releaseAt: row.releaseAt,
    gateHours: row.gateHours,
    perPlayerLimit: row.perPlayerLimit,
    sort: row.sort,
    revealedAt: row.revealedAt,
    releasedAt: row.releasedAt,
    gateUntil: row.gateUntil,
    releaseBlock: row.releaseBlock,
    releaseRoot: row.releaseRoot,
    words,
  };
}

/**
 * Every set on this chain, with its words. `migrated: false` when the tables aren't there yet
 * (migration 0021 hasn't run): no sets, and the game behaves as it did before sets existed. Any
 * other failure throws: the caller decides what an unreadable list means.
 *
 * `collab: false` when migration 0023 hasn't run: the sets are read from 0021's columns alone, and
 * every one of them is a standard set. A deploy never waits for a migration here (the owner runs
 * them by hand), so the sets must keep working in between.
 */
export async function listSets(chainId: number, db: DbOrTx = getDb()): Promise<{ sets: WordSet[]; migrated: boolean; collab: boolean }> {
  try {
    const order = [asc(wordSets.sort), asc(wordSets.id)];
    let collab = true;
    let rows: (BaseRow & Partial<Row>)[];
    const stampAt = new Map<number, Date>();
    const listed = new Map<number, number>();
    try {
      rows = await db.select().from(wordSets).where(eq(wordSets.chainId, chainId)).orderBy(...order);
      if (rows.length > 0) {
        const stamps = await db
          .select({ setId: setStamps.setId, at: setStamps.updatedAt })
          .from(setStamps)
          .innerJoin(wordSets, eq(wordSets.id, setStamps.setId))
          .where(eq(wordSets.chainId, chainId));
        for (const st of stamps) stampAt.set(st.setId, st.at);
        const counts = await db
          .select({ setId: setAllowlist.setId, n: count() })
          .from(setAllowlist)
          .innerJoin(wordSets, eq(wordSets.id, setAllowlist.setId))
          .where(eq(wordSets.chainId, chainId))
          .groupBy(setAllowlist.setId);
        for (const c of counts) listed.set(c.setId, Number(c.n));
      }
    } catch (err) {
      if (!lacksCollab(err)) throw err;
      // 0023 hasn't run (or 0021 hasn't: then this read throws "missing table" to the catch below).
      collab = false;
      rows = await db.select(BASE_COLUMNS).from(wordSets).where(eq(wordSets.chainId, chainId)).orderBy(...order);
    }
    if (rows.length === 0) return { sets: [], migrated: true, collab };
    const words = await db
      .select({ setId: setWords.setId, word: setWords.word, headliner: setWords.headliner })
      .from(setWords)
      .where(eq(setWords.chainId, chainId))
      .orderBy(asc(setWords.word));
    const bySet = new Map<number, SetWord[]>();
    for (const w of words) bySet.set(w.setId, [...(bySet.get(w.setId) ?? []), { word: w.word, headliner: w.headliner }]);
    return {
      sets: rows.map((r) => shape(r, bySet.get(r.id) ?? [], { stampAt: stampAt.get(r.id) ?? null, allowlistCount: listed.get(r.id) ?? 0 })),
      migrated: true,
      collab,
    };
  } catch (err) {
    if (isMissingTable(err)) return { sets: [], migrated: false, collab: false };
    throw err;
  }
}

/** Lock a set's row for this transaction and give its status, or throw `not_found`. */
async function lockSet(tx: DbOrTx, chainId: number, id: number): Promise<SetStatus> {
  const rows = await tx
    .select({ status: wordSets.status })
    .from(wordSets)
    .where(and(eq(wordSets.chainId, chainId), eq(wordSets.id, id)))
    .for("update");
  if (!rows[0]) throw new SetError("not_found");
  return rows[0].status as SetStatus;
}

const touch = { updatedAt: sql`now()` };

/**
 * Insert a set's row and give its id.
 *
 * A PLAIN set (a standard set with the default first day) is written with a statement that names
 * only migration 0021's columns, so making and importing plain sets works before migration 0023
 * has run. That needs raw SQL: Drizzle's insert names EVERY column of the table (with `default`
 * for the ones left out), and a column the database doesn't have yet fails the whole statement.
 * The dates go as ISO text with a cast: a JS Date as a raw parameter shifts by the local offset.
 *
 * Anything a collab adds goes through Drizzle's insert, and before 0023 that is `not_migrated`.
 */
async function insertSet(db: DbOrTx, chainId: number, s: SetSettings): Promise<number> {
  const plain = s.type === "standard" && !s.partnerName && !s.partnerUrl && !s.colorA && !s.colorB && s.gateRule === "verified" && !s.gateToken && !s.gateMin && !s.gateLabel;
  if (plain) {
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    const rows = (await db.execute(sql`
      insert into word_sets (chain_id, name, reveal_at, release_at, gate_hours, per_player_limit, sort)
      values (${chainId}, ${s.name}, ${iso(s.revealAt)}::timestamptz, ${iso(s.releaseAt)}::timestamptz, ${s.gateHours}, ${s.perPlayerLimit}, ${s.sort})
      returning id
    `)) as unknown as { id: number }[];
    return Number(rows[0].id);
  }
  const rows = await db
    .insert(wordSets)
    .values({
      chainId,
      name: s.name,
      revealAt: s.revealAt,
      releaseAt: s.releaseAt,
      gateHours: s.gateHours,
      perPlayerLimit: s.perPlayerLimit,
      sort: s.sort,
      type: s.type,
      partnerName: s.partnerName,
      partnerUrl: s.partnerUrl,
      colorA: s.colorA,
      colorB: s.colorB,
      gateRule: s.gateRule,
      gateToken: s.gateToken,
      gateMin: s.gateMin,
      gateLabel: s.gateLabel,
    })
    .returning({ id: wordSets.id });
  return rows[0].id;
}

/** Run a write that may name a collab column or table; before migration 0023 that is `not_migrated`. */
async function collabWrite<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (lacksCollab(err)) throw new SetError("not_migrated");
    throw err;
  }
}

export async function createSet(chainId: number, s: SetSettings): Promise<number> {
  return collabWrite(() => insertSet(getDb(), chainId, s));
}

/**
 * Change a set's settings. What may change follows the status read under the lock: its identity
 * (name, type, partner, colors) only on a draft, the dates and the first day's settings until
 * release, the display order always.
 */
export async function updateSet(chainId: number, id: number, patch: Partial<SetSettings>): Promise<void> {
  await collabWrite(() =>
    getDb().transaction(async (tx) => {
      const can = editable(await lockSet(tx, chainId, id));
      if (IDENTITY_KEYS.some((k) => patch[k] !== undefined) && !can.name) throw new SetError("locked");
      if (SCHEDULE_KEYS.some((k) => patch[k] !== undefined) && !can.schedule) throw new SetError("locked");
      await tx
        .update(wordSets)
        .set({ ...patch, ...touch })
        .where(and(eq(wordSets.chainId, chainId), eq(wordSets.id, id)));
    }),
  );
}

// --- a collab's stamp and a first day's allowlist ----------------------------------------------

/** Store a DRAFT set's stamp (one per set; a new one takes the old one's place). */
export async function setStamp(chainId: number, id: number, stamp: { mime: StampType; base64: string; bytes: number }): Promise<void> {
  await collabWrite(() =>
    getDb().transaction(async (tx) => {
      if (!editable(await lockSet(tx, chainId, id)).name) throw new SetError("locked");
      const row = { mime: stamp.mime, data: stamp.base64, bytes: stamp.bytes, updatedAt: sql`now()` };
      await tx
        .insert(setStamps)
        .values({ setId: id, ...row })
        .onConflictDoUpdate({ target: setStamps.setId, set: row });
      await tx.update(wordSets).set(touch).where(eq(wordSets.id, id));
    }),
  );
}

export async function clearStamp(chainId: number, id: number): Promise<void> {
  await collabWrite(() =>
    getDb().transaction(async (tx) => {
      if (!editable(await lockSet(tx, chainId, id)).name) throw new SetError("locked");
      await tx.delete(setStamps).where(eq(setStamps.setId, id));
    }),
  );
}

/**
 * A set's stamp, with the set's status: the caller decides who may see it (a draft's stamp is as
 * private as its name). Null when the set has none, isn't on this chain, or 0023 hasn't run.
 */
export async function readStamp(chainId: number, id: number): Promise<{ status: SetStatus; mime: string; base64: string } | null> {
  try {
    const rows = await getDb()
      .select({ status: wordSets.status, mime: setStamps.mime, data: setStamps.data })
      .from(setStamps)
      .innerJoin(wordSets, eq(wordSets.id, setStamps.setId))
      .where(and(eq(wordSets.chainId, chainId), eq(setStamps.setId, id)))
      .limit(1);
    return rows[0] ? { status: rows[0].status as SetStatus, mime: rows[0].mime, base64: rows[0].data } : null;
  } catch (err) {
    if (lacksCollab(err)) return null;
    throw err;
  }
}

/**
 * Every stamp on this chain as a `data:` address, by set. For the OPERATOR's preview only (a
 * draft's stamp is private): the admin route is the one caller. Empty before migration 0023.
 */
export async function readStamps(chainId: number): Promise<Map<number, string>> {
  try {
    const rows = await getDb()
      .select({ setId: setStamps.setId, mime: setStamps.mime, data: setStamps.data })
      .from(setStamps)
      .innerJoin(wordSets, eq(wordSets.id, setStamps.setId))
      .where(eq(wordSets.chainId, chainId));
    return new Map(rows.map((r) => [r.setId, `data:${r.mime};base64,${r.data}`]));
  } catch (err) {
    if (lacksCollab(err)) return new Map();
    throw err;
  }
}

/** Replace a set's allowlist with these wallets (lowercase, each once). Allowed until the set is released. */
export async function replaceAllowlist(chainId: number, id: number, wallets: readonly string[]): Promise<number> {
  return collabWrite(() =>
    getDb().transaction(async (tx) => {
      if (!editable(await lockSet(tx, chainId, id)).schedule) throw new SetError("locked");
      await tx.delete(setAllowlist).where(eq(setAllowlist.setId, id));
      for (let i = 0; i < wallets.length; i += 1000) {
        await tx.insert(setAllowlist).values(wallets.slice(i, i + 1000).map((wallet) => ({ setId: id, wallet }))).onConflictDoNothing();
      }
      await tx.update(wordSets).set(touch).where(eq(wordSets.id, id));
      return wallets.length;
    }),
  );
}

/** Whether any of these wallets (lowercase) is on the set's allowlist. Throws when it can't be read: the caller fails closed. */
export async function onAllowlist(id: number, wallets: readonly string[]): Promise<boolean> {
  if (wallets.length === 0) return false;
  const rows = await getDb()
    .select({ wallet: setAllowlist.wallet })
    .from(setAllowlist)
    .where(and(eq(setAllowlist.setId, id), inArray(setAllowlist.wallet, [...wallets])))
    .limit(1);
  return rows.length > 0;
}

/** Delete a DRAFT set and its words. A revealed or released set stays. */
export async function deleteSet(chainId: number, id: number): Promise<void> {
  await getDb().transaction(async (tx) => {
    if (!editable(await lockSet(tx, chainId, id)).remove) throw new SetError("locked");
    await tx.delete(wordSets).where(and(eq(wordSets.chainId, chainId), eq(wordSets.id, id)));
  });
}

/**
 * Add words to a draft set. A word already in THIS set is left as it is; a word in another set is
 * refused and named, and the rest still go in.
 */
export async function addWords(chainId: number, id: number, words: readonly string[]): Promise<{ added: string[]; taken: string[] }> {
  if (words.length === 0) return { added: [], taken: [] };
  return getDb().transaction(async (tx) => {
    if (!editable(await lockSet(tx, chainId, id)).words) throw new SetError("locked");
    const inserted = await tx
      .insert(setWords)
      .values(words.map((word) => ({ chainId, word, setId: id })))
      .onConflictDoNothing()
      .returning({ word: setWords.word });
    const added = inserted.map((r) => r.word);
    const left = words.filter((w) => !added.includes(w));
    if (left.length === 0) return { added, taken: [] };
    const elsewhere = await tx
      .select({ word: setWords.word, setId: setWords.setId })
      .from(setWords)
      .where(and(eq(setWords.chainId, chainId), inArray(setWords.word, left)));
    return { added, taken: elsewhere.filter((r) => r.setId !== id).map((r) => r.word) };
  });
}

export async function removeWords(chainId: number, id: number, words: readonly string[]): Promise<number> {
  if (words.length === 0) return 0;
  return getDb().transaction(async (tx) => {
    if (!editable(await lockSet(tx, chainId, id)).words) throw new SetError("locked");
    const gone = await tx
      .delete(setWords)
      .where(and(eq(setWords.chainId, chainId), eq(setWords.setId, id), inArray(setWords.word, [...words])))
      .returning({ word: setWords.word });
    return gone.length;
  });
}

/** Move words between DRAFT sets. Every set a word leaves, and the one it joins, must be a draft. */
export async function moveWords(chainId: number, words: readonly string[], toId: number): Promise<number> {
  if (words.length === 0) return 0;
  return getDb().transaction(async (tx) => {
    const from = await tx
      .select({ setId: setWords.setId })
      .from(setWords)
      .where(and(eq(setWords.chainId, chainId), inArray(setWords.word, [...words])));
    // Lock in id order, so two moves crossing each other can't deadlock.
    const sources = [...new Set(from.map((r) => r.setId))];
    const ids = [...new Set([toId, ...sources])].sort((a, b) => a - b);
    for (const id of ids) if (!editable(await lockSet(tx, chainId, id)).words) throw new SetError("locked");
    if (sources.length === 0) return 0;
    // Only out of the sets that were just locked and checked. The read above came before the
    // locks, so a word may have gone to another set since (one this move never looked at, which may
    // be revealed by now): that word stays where it is.
    const moved = await tx
      .update(setWords)
      .set({ setId: toId })
      .where(and(eq(setWords.chainId, chainId), inArray(setWords.word, [...words]), inArray(setWords.setId, sources)))
      .returning({ word: setWords.word });
    return moved.length;
  });
}

export async function setHeadliner(chainId: number, id: number, word: string, on: boolean): Promise<void> {
  await getDb().transaction(async (tx) => {
    if (!editable(await lockSet(tx, chainId, id)).words) throw new SetError("locked");
    const rows = await tx
      .update(setWords)
      .set({ headliner: on })
      .where(and(eq(setWords.chainId, chainId), eq(setWords.setId, id), eq(setWords.word, word)))
      .returning({ word: setWords.word });
    if (!rows[0]) throw new SetError("not_found");
  });
}

/** The display order: each listed set takes its place in the list. */
export async function reorderSets(chainId: number, ids: readonly number[]): Promise<void> {
  await getDb().transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx
        .update(wordSets)
        .set({ sort: i, ...touch })
        .where(and(eq(wordSets.chainId, chainId), eq(wordSets.id, ids[i])));
    }
  });
}

/**
 * An import: every DRAFT set is replaced by the file's sets, in one transaction. Revealed and
 * released sets are untouched, and a file word one of them holds stops the whole import
 * (`word_taken`): half an import would leave words in the wrong sets.
 */
export async function replaceDrafts(chainId: number, sets: readonly ImportSet[]): Promise<number[]> {
  return collabWrite(() => replaceDraftsTx(chainId, sets));
}

async function replaceDraftsTx(chainId: number, sets: readonly ImportSet[]): Promise<number[]> {
  return getDb().transaction(async (tx) => {
    // Lock the drafts being replaced, so an edit in flight finishes first or fails on a gone row.
    const old = await tx
      .select({ id: wordSets.id, name: wordSets.name })
      .from(wordSets)
      .where(and(eq(wordSets.chainId, chainId), eq(wordSets.status, "draft")))
      .for("update");
    // A file carries no stamp and no allowlist (they are their own imports), so a draft that comes
    // back under the same name keeps the ones it had. Only when the name is one draft's alone, on
    // both sides: with two of a name, which one is meant can't be known.
    const once = <T,>(list: readonly T[], key: (t: T) => string) => {
      const n = new Map<string, number>();
      for (const t of list) n.set(key(t), (n.get(key(t)) ?? 0) + 1);
      return (t: T) => n.get(key(t)) === 1;
    };
    const oldOnce = once(old, (o) => o.name);
    const newOnce = once(sets, (s) => s.name);
    const keptFrom = new Map(old.filter(oldOnce).map((o) => [o.name, o.id]));
    // The new rows first (a stamp must have a set to move to), then the old drafts go, and only
    // then the words: a word is in one set at most, and the old drafts still hold theirs.
    const ids: number[] = [];
    for (const s of sets) {
      const row = { id: await insertSet(tx, chainId, s) };
      ids.push(row.id);
      const from = newOnce(s) ? keptFrom.get(s.name) : undefined;
      if (from === undefined) continue;
      // Before migration 0023 there is nothing to carry; a savepoint keeps the import alive.
      try {
        await tx.transaction(async (sp) => {
          await sp.update(setStamps).set({ setId: row.id }).where(eq(setStamps.setId, from));
          await sp.update(setAllowlist).set({ setId: row.id }).where(eq(setAllowlist.setId, from));
        });
      } catch (err) {
        if (!lacksCollab(err)) throw err;
      }
    }
    if (old.length > 0) await tx.delete(wordSets).where(and(eq(wordSets.chainId, chainId), inArray(wordSets.id, old.map((o) => o.id))));
    for (let i = 0; i < sets.length; i++) {
      const s = sets[i];
      const row = { id: ids[i] };
      if (s.words.length === 0) continue;
      try {
        await tx.insert(setWords).values(s.words.map((w) => ({ chainId, word: w.word, setId: row.id, headliner: w.headliner })));
      } catch (err) {
        // Never rethrow the driver's error: its text lists every word of the statement.
        if (isUnique(err)) throw new SetError("word_taken");
        throw new Error("import failed while writing a set's words");
      }
    }
    return ids;
  });
}

/**
 * Reveal a draft now. A set with no words can't be revealed (there would be nothing to show), and a
 * collab set only when it is whole: exactly five words, its partner's name, its two colors, and its
 * stamp (`not_ready`, with what is missing). Checked under the set's lock, so an edit can't slip in
 * between the check and the reveal.
 */
export async function revealSet(
  chainId: number,
  id: number,
  now: Date,
  held: HeldOnChain,
  opts: { collabLive?: boolean; /** the scheduled reveal: only a set whose `revealAt` has come by then */ dueBy?: Date } = {},
): Promise<void> {
  await getDb().transaction(async (tx) => {
    if ((await lockSet(tx, chainId, id)) !== "draft") throw new SetError("locked");
    // Read AFTER the lock: every edit of a draft takes the same lock, so these are the words and
    // the date the set is revealed with.
    const words = await tx.select({ word: setWords.word, headliner: setWords.headliner }).from(setWords).where(eq(setWords.setId, id));
    if (words.length === 0) throw new SetError("empty");
    if (opts.dueBy) {
      const [row] = await tx.select({ revealAt: wordSets.revealAt }).from(wordSets).where(eq(wordSets.id, id));
      if (!row?.revealAt || row.revealAt > opts.dueBy) throw new SetError("not_due");
    }
    // A reveal names these words to everyone, and a word the chain's root still has can be claimed
    // straight from the contract: so every one of them must be held back on the chain already.
    if (held !== "unchecked") {
      const missing = words.filter((w) => !held.has(w.word)).length;
      if (missing > 0) {
        throw new SetError("not_reserved", [], [`${missing} of this set’s ${words.length} words are not held back on the chain yet: send the reserve root first, then reveal`]);
      }
    }
    // Before migration 0023 every set is a standard one. A savepoint, because a failed statement
    // would otherwise end this transaction.
    let look: Pick<WordSet, "type" | "partnerName" | "colorA" | "colorB" | "stampAt"> = STANDARD_FIELDS;
    try {
      look = await tx.transaction(async (sp) => {
        const [row] = await sp
          .select({ type: wordSets.type, partnerName: wordSets.partnerName, colorA: wordSets.colorA, colorB: wordSets.colorB })
          .from(wordSets)
          .where(eq(wordSets.id, id));
        const [stamp] = await sp.select({ at: setStamps.updatedAt }).from(setStamps).where(eq(setStamps.setId, id));
        return { type: row?.type === "collab" ? "collab" : "standard", partnerName: row?.partnerName ?? null, colorA: row?.colorA ?? null, colorB: row?.colorB ?? null, stampAt: stamp?.at ?? null };
      });
    } catch (err) {
      if (!lacksCollab(err)) throw err;
    }
    const problems = revealProblems({ ...look, words }, opts.collabLive ?? COLLAB_LIVE);
    if (problems.length > 0) throw new SetError("not_ready", [], problems);
    await tx
      .update(wordSets)
      .set({ status: "revealed", revealedAt: now, ...touch })
      .where(and(eq(wordSets.chainId, chainId), eq(wordSets.id, id)));
  });
}

/**
 * Reveal every draft whose time has come, and say which. The due sets are found in one read, and
 * each is then revealed by `revealSet`, under its own row lock: the one function that reveals a
 * set, so what it checks (still a draft, still due, whole, every word held back on the chain) is
 * true of the set as it is at that moment. A word added while this ran can't ride along, and two
 * servers that notice at once reveal a set once: the second finds it locked and leaves it.
 *
 * A collab set that isn't whole (the same four things `revealSet` asks for) is left a draft, however
 * late it is: the admin shows what it is missing. The rule is written twice, here in SQL and in
 * rules.ts `revealProblems`; scripts/sets-db-check.ts holds the two together.
 */
export async function revealDue(chainId: number, now: Date, held: HeldOnChain, opts: { collabLive?: boolean } = {}): Promise<number[]> {
  const due = [
    eq(wordSets.chainId, chainId),
    eq(wordSets.status, "draft"),
    lte(wordSets.revealAt, now),
    sql`exists (select 1 from ${setWords} where ${setWords.setId} = ${wordSets.id})`,
  ];
  // While collab reveals are switched off no collab set is revealed at all (rules.ts COLLAB_LIVE).
  const whole = !(opts.collabLive ?? COLLAB_LIVE)
    ? sql`${wordSets.type} <> 'collab'`
    : sql`(${wordSets.type} <> 'collab' or (
    (select count(*) from ${setWords} where ${setWords.setId} = ${wordSets.id}) = ${COLLAB_WORDS}
    and coalesce(btrim(${wordSets.partnerName}), '') <> ''
    and ${wordSets.colorA} is not null and ${wordSets.colorB} is not null
    and exists (select 1 from ${setStamps} where ${setStamps.setId} = ${wordSets.id})
  ))`;
  const find = (conditions: typeof due) =>
    getDb()
      .select({ id: wordSets.id })
      .from(wordSets)
      .where(and(...conditions))
      .orderBy(asc(wordSets.id));
  try {
    let rows: { id: number }[];
    try {
      rows = await find([...due, whole]);
    } catch (err) {
      if (!lacksCollab(err)) throw err;
      // Before migration 0023 every set is a standard one. (Before 0021 this throws "missing
      // table" again, to the catch below.)
      rows = await find(due);
    }
    const revealed: number[] = [];
    for (const { id } of rows) {
      try {
        await revealSet(chainId, id, now, held, { collabLive: opts.collabLive, dueBy: now });
        revealed.push(id);
      } catch (err) {
        // Another server revealed it first, or it changed since the read above (a word the chain
        // doesn't hold back, a later date, a part taken away): it stays as it is.
        if (!(err instanceof SetError)) throw err;
      }
    }
    return revealed;
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/**
 * Mark a revealed set released: the chain was seen holding its words. Only the first caller gets
 * `true` (one statement), so whatever follows a release (a reminder) happens once.
 */
export async function markReleased(
  chainId: number,
  id: number,
  at: { releasedAt: Date; gateUntil: Date | null; releaseBlock: number | null },
): Promise<boolean> {
  const rows = await getDb()
    .update(wordSets)
    .set({ status: "released", releasedAt: at.releasedAt, gateUntil: at.gateUntil, releaseBlock: at.releaseBlock, ...touch })
    .where(and(eq(wordSets.chainId, chainId), eq(wordSets.id, id), eq(wordSets.status, "revealed")))
    .returning({ id: wordSets.id });
  return rows.length > 0;
}

// --- roots ------------------------------------------------------------------------------------

/**
 * Keep a root this server built, with the words it leaves out. Called BEFORE the root's transaction
 * is shown to anyone. The same root again is the same row (a root is its words: they can't differ),
 * with its time moved to now: `newestRoot` is "the root most recently BUILT", and a reserve that
 * returns to an earlier root has just built that one.
 */
export async function saveRoot(chainId: number, root: string, held: readonly string[], note: string): Promise<void> {
  await getDb()
    .insert(dictionaryRoots)
    .values({ chainId, root: root.toLowerCase(), held: [...held], note })
    .onConflictDoUpdate({ target: [dictionaryRoots.chainId, dictionaryRoots.root], set: { createdAt: sql`now()` } });
}

/** The words a root leaves out, or null when this server never built that root. Missing table: null. */
export async function heldOfRoot(chainId: number, root: string): Promise<string[] | null> {
  try {
    const rows = await getDb()
      .select({ held: dictionaryRoots.held })
      .from(dictionaryRoots)
      .where(and(eq(dictionaryRoots.chainId, chainId), eq(dictionaryRoots.root, root.toLowerCase())))
      .limit(1);
    return rows[0]?.held ?? null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/** The root most recently built: the best guess at what the chain holds while it can't be asked. */
export async function newestRoot(chainId: number): Promise<{ root: string; held: string[] } | null> {
  try {
    const rows = await getDb()
      .select({ root: dictionaryRoots.root, held: dictionaryRoots.held })
      .from(dictionaryRoots)
      .where(eq(dictionaryRoots.chainId, chainId))
      .orderBy(sql`${dictionaryRoots.createdAt} desc`)
      .limit(1);
    return rows[0] ?? null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/**
 * Record the root built to release a revealed set. False when the set is no longer revealed (it was
 * released meanwhile, or never was): the caller then has no plan to show.
 */
export async function setReleaseRoot(chainId: number, id: number, root: string): Promise<boolean> {
  const rows = await getDb()
    .update(wordSets)
    .set({ releaseRoot: root.toLowerCase(), ...touch })
    .where(and(eq(wordSets.chainId, chainId), eq(wordSets.id, id), eq(wordSets.status, "revealed")))
    .returning({ id: wordSets.id });
  return rows.length > 0;
}
