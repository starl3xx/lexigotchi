/**
 * A collab set's stamp as a `data:` address, for the SERVER's pictures (the share card, a card's
 * back, the token's art). The picture renderer is handed the bytes: it must never fetch this
 * site's own stamp route (a failed fetch is kept for the life of the server process, and a route
 * that answered 404 while the set was a draft would leave that server without the stamp after the
 * reveal).
 *
 * Only for a set that is REVEALED or RELEASED: a draft's stamp is as private as its name. A
 * revealed set's stamp can't change, so each is read once and kept, by the look's mark (the set
 * and its stamp's time).
 */
import type { CollabLook } from "@/lib/collabLook";
import { NETWORK } from "@/lib/onchain/network";
import { sniffStamp } from "./rules";

const kept = new Map<string, string>();

/** The stamp of this look's set, or null: it has none, the set isn't revealed, or it couldn't be read just now. */
export async function stampDataOf(look: Pick<CollabLook, "setId" | "mark" | "stamp">): Promise<string | null> {
  if (!look.stamp) return null;
  const hit = kept.get(look.mark);
  if (hit) return hit;
  try {
    const { readStamp } = await import("@/lib/db/sets");
    const stamp = await readStamp(NETWORK.id, look.setId);
    if (!stamp || stamp.status === "draft") return null;
    // What it IS comes from its own first bytes, as on the way in and on the public route.
    const mime = sniffStamp(Buffer.from(stamp.base64, "base64"));
    if (!mime) return null;
    const data = `data:${mime};base64,${stamp.base64}`;
    if (kept.size > 64) kept.clear();
    kept.set(look.mark, data);
    return data;
  } catch {
    return null; // a picture without its stamp for now, never a failed picture
  }
}
