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
import { accountsOf } from "./walletLinks";
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
 * The picks each named wallet sees: its PROFILE's, repeated per wallet named (pure, tested). Two
 * wallets of one profile see the same picks; a wallet with no profile is its own.
 */
export function picksForWallets(wallets: readonly string[], accountOf: ReadonlyMap<string, string>, rows: readonly PickRow[]): SavedScene[] {
  const out: SavedScene[] = [];
  for (const w of wallets) {
    const p = accountOf.get(w) ?? w;
    for (const r of rows) if (r.profile === p) out.push({ wallet: w, word: r.word, scene: r.value, updatedAt: r.updatedAt });
  }
  return out;
}

/**
 * The picks to take off (pure, tested): every pick whose own profile doesn't hold its word now.
 * `holderProfile` maps each held word to the profile holding it; a word missing from it is held by
 * nobody (dissolved).
 */
export function stalePicks(rows: readonly { profile: string; word: string }[], holderProfile: ReadonlyMap<string, string>) {
  return rows.filter((r) => holderProfile.get(r.word) !== r.profile);
}

/** Rows one profile may hold per kind: far more words than a player owns, and a cap on filling the table. */
export const MAX_PICKS_PER_PROFILE = 400;

/** The kinds stored. Only scenes exist in play; "costume" is the slot the Customization Spec names. */
export type PickKind = "scene";

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
  let rows: PickRow[];
  try {
    rows = await getDb()
      .select({ profile: wordPicks.profile, word: wordPicks.word, value: wordPicks.value, updatedAt: wordPicks.updatedAt })
      .from(wordPicks)
      .where(and(inArray(wordPicks.profile, profiles), eq(wordPicks.kind, "scene")));
  } catch (err) {
    if (isMissingTable(err)) return scenesOf(list); // before 0016: the wallet-keyed table
    throw err;
  }
  return picksForWallets(list, accounts, rows);
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
 * maps each held word (UPPERCASE) to the profile that holds it now; a word missing from it is held by
 * nobody (dissolved). A pick stays only while its own profile holds the word, so a word that comes
 * back to a profile later starts on the default scene. Returns how many rows went. A missing table is
 * 0 (nothing to clear yet).
 */
export async function clearPicksOffLeftWords(holderProfile: ReadonlyMap<string, string>): Promise<number> {
  const db = getDb();
  let rows: { profile: string; word: string }[];
  try {
    rows = await db.select({ profile: wordPicks.profile, word: wordPicks.word }).from(wordPicks);
  } catch (err) {
    if (isMissingTable(err)) return 0;
    throw err;
  }
  const stale = stalePicks(rows, holderProfile);
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
