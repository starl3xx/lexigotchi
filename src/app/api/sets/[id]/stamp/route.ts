/**
 * GET /api/sets/{id}/stamp: a collab set's stamp picture (decisions.md, "Collab sets").
 *
 * Public, but only for a set that is REVEALED or RELEASED: a draft's stamp is as private as its
 * name (a partner's logo would announce the partner), so a draft answers exactly as a set that
 * doesn't exist does. The status is read from the database on every miss, never from a kept copy.
 *
 * The picture is one the operator uploaded, so it is served as what its own first bytes say it is
 * (a PNG or a JPEG: never an SVG or HTML, whatever was stored), with `nosniff`, as an
 * attachment-safe image and nothing a browser would run. The address carries the stamp's time
 * (`?v=`), and a revealed set's stamp can't change, so it is kept for good.
 */
import { NextResponse } from "next/server";
import { readStamp } from "@/lib/db/sets";
import { NETWORK } from "@/lib/onchain/network";
import { sniffStamp } from "@/lib/sets/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const gone = () => new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: raw } = await ctx.params;
  if (!/^\d{1,9}$/.test(raw) || !process.env.DATABASE_URL) return gone();
  let stamp: Awaited<ReturnType<typeof readStamp>>;
  try {
    stamp = await readStamp(NETWORK.id, Number(raw));
  } catch {
    return new NextResponse(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!stamp || stamp.status === "draft") return gone();
  const bytes = Buffer.from(stamp.base64, "base64");
  const mime = sniffStamp(bytes);
  if (!mime) return gone();
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.length),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
