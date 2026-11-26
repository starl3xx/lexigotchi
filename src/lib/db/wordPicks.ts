/**
 * Per-word picks keyed by PROFILE (schema `wordPicks`, migration 0016; decisions.md #22). A pick
 * belongs to the player's profile (its account's first wallet), not to the wallet holding the word,
 * so it follows the word between the profile's wallets and comes off when the word leaves the profile.
 *
 * `/api/scenes` still speaks in wallets (the client names the holder of each word), so this module
 * maps wallets to profiles on the way in and out. Until migration 0016 runs, it falls back to the
 * wallet-keyed `word_scenes` (lib/db/wordScenes.ts), so the code works before and after.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./client";
import { wordPicks } from "./schema";
import { isMissingTable } from "./profiles";
import { accountsOf, walletsOfAccount } from "./walletLinks";
import { saveScenes, scenesOf, type SavedScene } from "./wordScenes";
import type { SceneId } from "@/lib/scenes";

/** One stored pick, as read. */
export interface PickRow {
  profile: string;
  word: string;
  value: string;
  updatedAt: Date;
}

/**
 * The picks each named wallet sees (pure, tested): every row whose EFFECTIVE profile is the wallet's
 * profile, the newest per word, repeated per wallet named. A row's effective profile is the account
 * its key belongs to NOW (`accountOf(row.profile)`), so picks a wallet saved under its own key before
 * it joined a profile still belong to that profile. A wallet with no profile is its own.
 */
export function picksForWallets(
  wallets: readonly string[],
  accountOf: ReadonlyMap<string, string>,
  rows: readonly PickRow[],
): SavedScene[] {
  const eff = (key: string) => accountOf.get(key) ?? key;
  const out: SavedScene[] = [];
  for (const w of wallets) {
    const p = eff(w);
    const newest = new Map<string, PickRow>();
    for (const r of rows) {
      if (eff(r.profile) !== p) continue;
      const had = newest.get(r.word);
      if (!had || r.updatedAt > had.updatedAt) newest.set(r.word, r);
    }
    for (const r of newest.values()) out.push({ wallet: w, word: r.word, scene: r.value, updatedAt: r.updatedAt });
  }
  return out;
}

/**
 * The picks to take off (pure, tested): only those whose word the scan POSITIVELY shows held by a
 * profile other than the row's effective one (`accountOf(row.profile)`: a wallet that joined a profile
 * after saving under its own key keeps its picks). A word missing from the scan stays: the scan drops
 * a word whose owner read failed as well as one that was dissolved, and nothing here can tell them
 * apart, so a missing answer never deletes. (A dissolved word's pick goes once someone claims it again.)
 */
export function stalePicks(
  rows: readonly { profile: string; word: string }[],
  holderProfile: ReadonlyMap<string, string>,
  accountOf: (key: string) => string = (k) => k,
) {
  return rows.filter((r) => {
    const holder = holderProfile.get(r.word);
    return holder !== undefined && holder !== accountOf(r.profile);
  });
}

/** Rows one profile may hold per kind: far more words than a player owns, and a cap on filling the table. */
export const MAX_PICKS_PER_PROFILE = 400;

/**
 * The kinds stored: a word's scene, and whether it is in a case (lib/db/wordCases.ts; its value is
 * the case's style). "costume" is the slot the Customization Spec names. The cap above is per kind.
 */
export type PickKind = "scene" | "case";

/**
 * The scene picks of these wallets' profiles, one row per requested wallet (a profile's picks repeat
 * for each of its wallets the caller named, so a client keyed by holder finds them all). Throws on a
 * database error other than a missing table.
 */
export async function scenePicksFor(wallets: readonly string[]): Promise<SavedScene[]> {
  const list = [...new Set(wallets.map((w) => w.toLowerCase()))];
  if (list.length === 0) return [];
  const accounts = await accountsOf(list);
  const profiles = [...new Set(list.map((w) => accounts.get(w) ?? w))];
  // Rows may also sit under a profile wallet's OWN key (saved before it joined), so read those too,
  // and map each such key to its profile.
  const keyToProfile = new Map(accounts);
  for (const p of profiles) {
    keyToProfile.set(p, p);
    for (const w of await walletsOfAccount(p).catch(() => [p])) keyToProfile.set(w.toLowerCase(), p);
  }
  const keys = [...keyToProfile.keys()];
  let rows: PickRow[];
  try {
    rows = await getDb()
      .select({ profile: wordPicks.profile, word: wordPicks.word, value: wordPicks.value, updatedAt: wordPicks.updatedAt })
      .from(wordPicks)
      .where(and(inArray(wordPicks.profile, keys), eq(wordPicks.kind, "scene")));
  } catch (err) {
    if (isMissingTable(err)) return scenesOf(list); // before 0016: the wallet-keyed table
    throw err;
  }
  return picksForWallets(list, keyToProfile, rows);
}

/**
 * Save scene picks for one profile, newest pick wins (an old pick uploaded late can't undo a newer one
 * from another device). Refuses ("full") past MAX_PICKS_PER_PROFILE. `byWallet` is the same picks
 * grouped by the wallet the client named, for the pre-0016 fallback.
 */
export async function saveScenePicks(
  profile: string,
  picks: readonly { word: string; scene: SceneId; at: Date }[],
  byWallet: ReadonlyMap<string, readonly { word: string; scene: SceneId; at: Date }[]>,
): Promise<"ok" | "full"> {
  const p = profile.toLowerCase();
  if (picks.length === 0) return "ok";
  // One row per word: Postgres refuses an upsert naming a row twice. The newest pick of a word wins.
  const newest = new Map<string, { word: string; scene: SceneId; at: Date }>();
  for (const x of picks) {
    const had = newest.get(x.word);
    if (!had || x.at > had.at) newest.set(x.word, x);
  }
  const list = [...newest.values()];
  const db = getDb();
  try {
    const words = list.map((x) => x.word);
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(wordPicks)
      .where(and(eq(wordPicks.profile, p), eq(wordPicks.kind, "scene")));
    const existing = await db
      .select({ word: wordPicks.word })
      .from(wordPicks)
      .where(and(eq(wordPicks.profile, p), eq(wordPicks.kind, "scene"), inArray(wordPicks.word, words)));
    const fresh = list.filter((x) => !existing.some((e) => e.word === x.word)).length;
    if (n + fresh > MAX_PICKS_PER_PROFILE) return "full";
    await db
      .insert(wordPicks)
      .values(list.map((x) => ({ profile: p, word: x.word, kind: "scene", value: x.scene, updatedAt: x.at })))
      .onConflictDoUpdate({
        target: [wordPicks.profile, wordPicks.word, wordPicks.kind],
        set: { value: sql`excluded.value`, updatedAt: sql`excluded.updated_at` },
        setWhere: sql`excluded.updated_at > ${wordPicks.updatedAt}`,
      });
    return "ok";
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    // Before 0016: keep saving by wallet, as before.
    for (const [w, ps] of byWallet) if ((await saveScenes(w, ps)) === "full") return "full";
    return "ok";
  }
}

/**
 * Take picks off words that left their profile (the keeper, after its world scan). `holderProfile`
 * maps each held word (UPPERCASE) to the profile that holds it now; only a word it shows held by
 * ANOTHER profile loses its pick (`stalePicks`). Returns how many rows went. A missing table is 0
 * (nothing to clear yet).
 */
export async function clearPicksOffLeftWords(
  holderProfile: ReadonlyMap<string, string>,
  accountOf: (key: string) => string,
): Promise<number> {
  const db = getDb();
  let rows: { profile: string; word: string }[];
  try {
    rows = await db.select({ profile: wordPicks.profile, word: wordPicks.word }).from(wordPicks);
  } catch (err) {
    if (isMissingTable(err)) return 0;
    throw err;
  }
  const stale = stalePicks(rows, holderProfile, accountOf);
  let cleared = 0;
  // Grouped by profile, so each delete names one profile and the words it no longer holds.
  const byProfile = new Map<string, string[]>();
  for (const r of stale) byProfile.set(r.profile, [...(byProfile.get(r.profile) ?? []), r.word]);
  for (const [profile, words] of byProfile) {
    const res = await db
      .delete(wordPicks)
      .where(and(eq(wordPicks.profile, profile), inArray(wordPicks.word, words)))
      .returning({ word: wordPicks.word });
    cleared += res.length;
  }
  return cleared;
}
