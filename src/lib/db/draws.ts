/** Queries for stored letter draws (schema.ts → letterDraws; the rule is in onchain/stickyDraw.ts). */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./client";
import { letterDraws } from "./schema";

export async function readDraw(chainId: number, drawKey: string): Promise<number[] | null> {
  const [row] = await getDb()
    .select({ letterIndexes: letterDraws.letterIndexes })
    .from(letterDraws)
    .where(and(eq(letterDraws.chainId, chainId), eq(letterDraws.drawKey, drawKey)))
    .limit(1);
  return row?.letterIndexes ?? null;
}

/**
 * First write wins: store `letterIndexes` unless a draw is already there, and return whichever
 * draw the row holds afterwards. Two first requests racing therefore agree on one draw.
 */
export async function claimDraw(chainId: number, drawKey: string, letterIndexes: number[]): Promise<number[]> {
  const now = new Date();
  const [inserted] = await getDb()
    .insert(letterDraws)
    .values({ chainId, drawKey, letterIndexes, createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .returning({ letterIndexes: letterDraws.letterIndexes });
  return inserted?.letterIndexes ?? (await readDraw(chainId, drawKey)) ?? letterIndexes;
}

/**
 * Compare-and-set: replace the stored draw with `next` ONLY if the row still holds `expected` (the
 * stale draw the caller saw). False means another request replaced it first; the caller re-reads.
 * This is what keeps two overlapping requests from each storing, and signing, their own draw.
 */
export async function replaceDrawIf(
  chainId: number,
  drawKey: string,
  expected: number[],
  next: number[],
): Promise<boolean> {
  const rows = await getDb()
    .update(letterDraws)
    .set({ letterIndexes: next, updatedAt: new Date() })
    .where(
      and(
        eq(letterDraws.chainId, chainId),
        eq(letterDraws.drawKey, drawKey),
        sql`${letterDraws.letterIndexes} = ${JSON.stringify(expected)}::jsonb`,
      ),
    )
    .returning({ id: letterDraws.id });
  return rows.length > 0;
}
