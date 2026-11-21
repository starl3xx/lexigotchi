/** Queries for stored letter draws (schema.ts → letterDraws; the rule is in onchain/stickyDraw.ts). */
import { and, eq } from "drizzle-orm";
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

/** Replace is right here: the caller writes only when the stored draw can no longer be minted. */
export async function writeDraw(chainId: number, drawKey: string, letterIndexes: number[]): Promise<void> {
  const now = new Date();
  await getDb()
    .insert(letterDraws)
    .values({ chainId, drawKey, letterIndexes, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [letterDraws.chainId, letterDraws.drawKey], set: { letterIndexes, updatedAt: now } });
}
