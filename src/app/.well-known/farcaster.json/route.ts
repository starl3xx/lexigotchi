import { farcasterManifest } from "@/lib/site";

/**
 * Farcaster Mini App manifest. Served at /.well-known/farcaster.json so Farcaster clients can
 * discover and install Lexigotchi. Fill the accountAssociation via env (see src/lib/site.ts).
 */
export const dynamic = "force-static";

export function GET() {
  return Response.json(farcasterManifest());
}
