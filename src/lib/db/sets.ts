/**
 * Reserved word sets in the database (tables `word_sets`, `set_words`, `dictionary_roots`; migration
 * 0021). The rules are lib/sets/rules.ts; this file makes them hold under two requests at once.
 *
 * Every change to a set's words happens in a transaction that LOCKS the set's row and reads its
 * status there, so "a revealed set's words are locked" can't be raced by an edit that started while
 * the set was still a draft. "A word is in one set at most" is the words table's key.
 *
 * Nothing here logs a word, and a caller must not log what these functions throw without thinking:
 * a driver error carries the statement's parameters, which are the words. `SetError` is safe (it
 * carries a code, and words only where the operator's own request named them).
 */
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "./client";
import { dictionaryRoots, setWords, wordSets } from "./schema";
import { isMissingTable } from "./profiles";
import { editable, type ImportSet, type SetSettings, type SetStatus, type SetWord, type WordSet } from "@/lib/sets/rules";

export type SetErrorCode = "not_found" | "locked" | "word_taken" | "empty" | "not_migrated";

export class SetError extends Error {
  constructor(
    public code: SetErrorCode,
    /** Words the refusal is about (only ever ones the caller sent). */
    public words: string[] = [],
  ) {
    super(code);
  }
}

/** Postgres's "unique violation": here, a word that is already in a set. */
function isUnique(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

type Row = typeof wordSets.$inferSelect;

function shape(row: Row, words: SetWord[]): WordSet {
  return {
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
 */
export async function listSets(chainId: number, db: DbOrTx = getDb()): Promise<{ sets: WordSet[]; migrated: boolean }> {
  try {
    const rows = await db.select().from(wordSets).where(eq(wordSets.chainId, chainId)).orderBy(asc(wordSets.sort), asc(wordSets.id));
    if (rows.length === 0) return { sets: [], migrated: true };
    const words = await db
      .select({ setId: setWords.setId, word: setWords.word, headliner: setWords.headliner })
      .from(setWords)
      .where(eq(setWords.chainId, chainId))
      .orderBy(asc(setWords.word));
    const bySet = new Map<number, SetWord[]>();
    for (const w of words) bySet.set(w.setId, [...(bySet.get(w.setId) ?? []), { word: w.word, headliner: w.headliner }]);
    return { sets: rows.map((r) => shape(r, bySet.get(r.id) ?? [])), migrated: true };
  } catch (err) {
    if (isMissingTable(err)) return { sets: [], migrated: false };
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

export async function createSet(chainId: number, s: SetSettings): Promise<number> {
  const rows = await getDb()
    .insert(wordSets)
    .values({ chainId, name: s.name, revealAt: s.revealAt, releaseAt: s.releaseAt, gateHours: s.gateHours, perPlayerLimit: s.perPlayerLimit, sort: s.sort })
    .returning({ id: wordSets.id });
  return rows[0].id;
}

/**
 * Change a set's settings. What may change follows the status read under the lock: a name only on
 * a draft, the dates and the gate's settings until release, the display order always.
 */
export async function updateSet(chainId: number, id: number, patch: Partial<SetSettings>): Promise<void> {
  await getDb().transaction(async (tx) => {
    const can = editable(await lockSet(tx, chainId, id));
    if (patch.name !== undefined && !can.name) throw new SetError("locked");
    const schedule = patch.revealAt !== undefined || patch.releaseAt !== undefined || patch.gateHours !== undefined || patch.perPlayerLimit !== undefined;
    if (schedule && !can.schedule) throw new SetError("locked");
    await tx
      .update(wordSets)
      .set({ ...patch, ...touch })
      .where(and(eq(wordSets.chainId, chainId), eq(wordSets.id, id)));
  });
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
  return getDb().transaction(async (tx) => {
    // Lock the drafts being replaced, so an edit in flight finishes first or fails on a gone row.
    await tx
      .select({ id: wordSets.id })
      .from(wordSets)
      .where(and(eq(wordSets.chainId, chainId), eq(wordSets.status, "draft")))
      .for("update");
    await tx.delete(wordSets).where(and(eq(wordSets.chainId, chainId), eq(wordSets.status, "draft")));
    const ids: number[] = [];
    for (const s of sets) {
      const [row] = await tx
        .insert(wordSets)
        .values({ chainId, name: s.name, revealAt: s.revealAt, releaseAt: s.releaseAt, gateHours: s.gateHours, perPlayerLimit: s.perPlayerLimit, sort: s.sort })
        .returning({ id: wordSets.id });
      ids.push(row.id);
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

/** Reveal a draft now. A set with no words can't be revealed: there would be nothing to show. */
export async function revealSet(chainId: number, id: number, now: Date): Promise<void> {
  await getDb().transaction(async (tx) => {
    if ((await lockSet(tx, chainId, id)) !== "draft") throw new SetError("locked");
    const any = await tx.select({ word: setWords.word }).from(setWords).where(eq(setWords.setId, id)).limit(1);
    if (!any[0]) throw new SetError("empty");
    await tx
      .update(wordSets)
      .set({ status: "revealed", revealedAt: now, ...touch })
      .where(and(eq(wordSets.chainId, chainId), eq(wordSets.id, id)));
  });
}

/**
 * Reveal every draft whose time has come, and say which. One statement, so two servers that notice
 * at once reveal a set once: only the first gets its id back.
 */
export async function revealDue(chainId: number, now: Date): Promise<number[]> {
  try {
    const rows = await getDb()
      .update(wordSets)
      .set({ status: "revealed", revealedAt: now, ...touch })
      .where(
        and(
          eq(wordSets.chainId, chainId),
          eq(wordSets.status, "draft"),
          lte(wordSets.revealAt, now),
          sql`exists (select 1 from ${setWords} where ${setWords.setId} = ${wordSets.id})`,
        ),
      )
      .returning({ id: wordSets.id });
    return rows.map((r) => r.id);
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
