/**
 * Saved scenes (schema `wordScenes`, migration 0009): each word's scene, keyed by the wallet that
 * holds it. Read by anyone (`/api/scenes?wallets=`), written only under that wallet's profile
 * session. lib/scenes.ts has the rules; this file only stores.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./client";
import { wordScenes } from "./schema";
import type { SceneId } from "@/lib/scenes";

/** Rows one wallet may hold: far more words than a player owns, and a cap on filling the table. */
export const MAX_SCENES_PER_WALLET = 400;

export interface SavedScene {
  wallet: string;
  word: string;
  scene: string;
  updatedAt: Date;
}

/** The saved scenes of these wallets (lowercase). Throws on a database error, a missing table included. */
export async function scenesOf(wallets: readonly string[]): Promise<SavedScene[]> {
  const list = [...new Set(wallets.map((w) => w.toLowerCase()))];
  if (list.length === 0) return [];
  return getDb().select().from(wordScenes).where(inArray(wordScenes.wallet, list));
}

/**
 * Save scenes for one wallet, newest pick wins: a row is replaced only by a pick made later than
 * the one it holds, so an old pick uploaded late can't undo a newer one from another device.
 * Refuses (returns "full") when the new words would take the wallet past MAX_SCENES_PER_WALLET.
 */
export async function saveScenes(
  wallet: string,
  picks: readonly { word: string; scene: SceneId; at: Date }[],
): Promise<"ok" | "full"> {
  const w = wallet.toLowerCase();
  if (picks.length === 0) return "ok";
  const db = getDb();
  const words = picks.map((p) => p.word);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(wordScenes).where(eq(wordScenes.wallet, w));
  const existing = await db
    .select({ word: wordScenes.word })
    .from(wordScenes)
    .where(and(eq(wordScenes.wallet, w), inArray(wordScenes.word, words)));
  const fresh = picks.filter((p) => !existing.some((e) => e.word === p.word)).length;
  if (n + fresh > MAX_SCENES_PER_WALLET) return "full";
  await db
    .insert(wordScenes)
    .values(picks.map((p) => ({ wallet: w, word: p.word, scene: p.scene, updatedAt: p.at })))
    .onConflictDoUpdate({
      target: [wordScenes.wallet, wordScenes.word],
      set: { scene: sql`excluded.scene`, updatedAt: sql`excluded.updated_at` },
      setWhere: sql`excluded.updated_at > ${wordScenes.updatedAt}`,
    });
  return "ok";
}
