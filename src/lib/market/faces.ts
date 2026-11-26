/**
 * The faces of the Market's sellers and buyers (lib/profile/faces.ts), kept a few minutes per server:
 * every player on the Market polls its boards, and a face changes rarely. Server-only. A failed
 * lookup answers with what is already known: faceless rows still trade.
 */
import { playerFaces } from "@/lib/profile/faces";
import type { PublicFace } from "@/lib/profile/rules";

const FACE_TTL_MS = 5 * 60_000;
const MAX_KEPT = 5_000;
const kept = new Map<string, { at: number; face: PublicFace | null }>();

export async function marketFaces(wallets: readonly string[]): Promise<Record<string, PublicFace>> {
  const now = Date.now();
  const all = [...new Set(wallets.map((w) => w.toLowerCase()))];
  const missing = all.filter((w) => (kept.get(w)?.at ?? 0) < now - FACE_TTL_MS);
  if (missing.length > 0) {
    try {
      const { profiles } = await playerFaces(missing);
      if (kept.size > MAX_KEPT) kept.clear();
      for (const w of missing) kept.set(w, { at: now, face: profiles[w] ?? null });
    } catch {
      /* answer with what is kept */
    }
  }
  const out: Record<string, PublicFace> = {};
  for (const w of all) {
    const f = kept.get(w)?.face;
    if (f) out[w] = f;
  }
  return out;
}
