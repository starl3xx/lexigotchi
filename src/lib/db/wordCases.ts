/**
 * Which of a profile's words are in a case (decisions.md #42; lib/shop/cases says what a case is).
 * Stored in `word_picks` with kind "case" (migration 0016, no new table): one row per cased word,
 * its value the case's style, its time when the word went in. Taking a word out deletes its row.
 * The keeper already takes every pick off a word that leaves its profile (wordPicks.ts,
 * clearPicksOffLeftWords), so a case comes off with the scene.
 *
 * Rows are keyed by the profile (its account's first wallet), as scene picks are. A row saved
 * under a wallet's own key before it joined a profile still counts for that profile: reads and the
 * count both look under every key of the profile.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./client";
import { wordPicks } from "./schema";
import { accountsOf, walletsOfAccount } from "./walletLinks";
import { CASE_STYLE, mayCase } from "@/lib/shop/cases";

export interface CasedWord {
  /** The wallet the caller named (a profile's cases repeat for each of its wallets named). */
  wallet: string;
  word: string;
  since: Date;
}

/** Every key a profile's rows may sit under: the profile itself and each of its wallets. */
async function keysOf(profile: string): Promise<string[]> {
  const p = profile.toLowerCase();
  const wallets = await walletsOfAccount(p).catch(() => [p]);
  return [...new Set([p, ...wallets.map((w) => w.toLowerCase())])];
}

/** The cased words of these wallets' profiles, one row per wallet named. Throws on a database error. */
export async function casesFor(wallets: readonly string[]): Promise<CasedWord[]> {
  const list = [...new Set(wallets.map((w) => w.toLowerCase()))];
  if (list.length === 0) return [];
  const accounts = await accountsOf(list);
  const out: CasedWord[] = [];
  const byProfile = new Map<string, string[]>();
  for (const w of list) {
    const p = accounts.get(w) ?? w;
    byProfile.set(p, [...(byProfile.get(p) ?? []), w]);
  }
  for (const [profile, named] of byProfile) {
    const rows = await getDb()
      .select({ word: wordPicks.word, updatedAt: wordPicks.updatedAt })
      .from(wordPicks)
      .where(and(inArray(wordPicks.profile, await keysOf(profile)), eq(wordPicks.kind, "case")));
    // one entry per word (the oldest, if a word somehow sits under two keys: when it first went in)
    const first = new Map<string, Date>();
    for (const r of rows) if (!first.has(r.word) || r.updatedAt < first.get(r.word)!) first.set(r.word, r.updatedAt);
    for (const w of named) for (const [word, since] of first) out.push({ wallet: w, word, since });
  }
  return out;
}

/**
 * Put a word in a case, or take it out, for one profile. `bought` is how many cases the profile
 * has bought (the caller reads the wardrobe): a word goes in only while one is free.
 *
 * One profile's changes run one at a time (an advisory lock for the transaction), so two requests
 * at once can't both take the last case.
 */
export async function setCase(profile: string, word: string, on: boolean, bought: number): Promise<"ok" | "none_left"> {
  const p = profile.toLowerCase();
  const keys = await keysOf(p);
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`lexigotchi:word_case:${p}`}))`);
    if (!on) {
      await tx.delete(wordPicks).where(and(inArray(wordPicks.profile, keys), eq(wordPicks.kind, "case"), eq(wordPicks.word, word)));
      return "ok";
    }
    const rows = await tx
      .select({ word: wordPicks.word })
      .from(wordPicks)
      .where(and(inArray(wordPicks.profile, keys), eq(wordPicks.kind, "case")));
    const cased = new Set(rows.map((r) => r.word));
    // already in a case (under any key of the profile): its row and its date stay as they are
    if (cased.has(word)) return "ok";
    if (!mayCase(word, cased, bought)) return "none_left";
    await tx
      .insert(wordPicks)
      .values({ profile: p, word, kind: "case", value: CASE_STYLE, updatedAt: new Date() })
      .onConflictDoNothing({ target: [wordPicks.profile, wordPicks.word, wordPicks.kind] });
    return "ok";
  });
}
