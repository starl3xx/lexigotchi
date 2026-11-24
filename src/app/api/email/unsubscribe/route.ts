import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { setEmailReminders } from "@/lib/db/profiles";
import { checkUnsubscribe } from "@/lib/notify/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The unsubscribe link in every reminder: `?a=<wallet>&t=<HMAC of the wallet>`, no sign-in.
 *
 * POST is RFC 8058 one-click (what Gmail's and Yahoo's Unsubscribe button sends, from the
 * List-Unsubscribe-Post header): it turns reminders off and answers a blank 200. GET shows a page
 * with a button that POSTs, rather than unsubscribing on sight, because mail scanners open links.
 */
function params(req: Request): { address: string; ok: boolean } {
  const u = new URL(req.url);
  const address = (u.searchParams.get("a") ?? "").toLowerCase();
  return { address, ok: isAddress(address) && checkUnsubscribe(address, u.searchParams.get("t") ?? "") };
}

const page = (title: string, body: string, form = "") =>
  new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} · Lexigotchi</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4ead2;color:#1b1714;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:16px}
main{max-width:380px;background:#fbf4e3;border:3px solid #1b1714;border-radius:20px;box-shadow:4px 4px 0 #1b1714;padding:24px;text-align:center}h1{margin:0 0 6px;font-size:22px}p{margin:0 0 16px;color:#1b1714b3}
button,a{display:inline-block;background:#bd3d35;color:#fbf4e3;font:800 16px inherit;text-decoration:none;border:3px solid #1b1714;border-radius:14px;padding:10px 18px;cursor:pointer}</style></head>
<body><main><h1>${title}</h1><p>${body}</p>${form}</main></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

export async function GET(req: Request) {
  const { ok } = params(req);
  if (!ok) return page("Link not recognized", "This unsubscribe link isn’t valid. You can turn email reminders off in your Lexigotchi profile.", `<a href="/play">Open the game</a>`);
  const u = new URL(req.url);
  return page(
    "Stop email reminders?",
    "You’ll stop getting Lexigotchi reminders by email. You can turn them back on in your profile.",
    `<form method="post" action="${u.pathname}${u.search}"><button type="submit">Turn off email reminders</button></form>`,
  );
}

export async function POST(req: Request) {
  const { address, ok } = params(req);
  if (!ok) return new NextResponse(null, { status: 400 });
  try {
    await setEmailReminders(address, false);
  } catch (err) {
    console.error("[email] unsubscribe failed:", String((err as Error)?.message ?? err).slice(0, 120));
    return new NextResponse(null, { status: 503 });
  }
  // One-click clients want a blank 200; a person who pressed the button wants to see it worked.
  const accept = req.headers.get("accept") ?? "";
  if (!accept.includes("text/html")) return new NextResponse(null, { status: 200 });
  return page("Email reminders are off", "You won’t get Lexigotchi reminders by email anymore.", `<a href="/play">Open the game</a>`);
}
