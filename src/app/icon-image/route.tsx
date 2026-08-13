import { readFileSync } from "fs";
import { join } from "path";

/** Square app icon / splash image for the mini-app manifest. */
export const dynamic = "force-static";

// Pre-rendered brand icon — docs/icon/ is the canonical source. A Satori re-render can't
// reproduce its masked grain or per-band gradients, so the route serves the finished pixels
// and the manifest URL stays unchanged.
const icon = readFileSync(join(process.cwd(), "public/icon.png"));

export function GET() {
  return new Response(icon, {
    headers: { "content-type": "image/png" },
  });
}
