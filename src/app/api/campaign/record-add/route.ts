import { NextResponse } from "next/server";
import { getAuthedFid } from "@/lib/auth/quickAuth";
import { markAdded } from "@/lib/db/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // postgres-js + quick-auth need the Node runtime

/** POST — record that the (Quick-Auth-verified) caller added the mini app, with the notification
 *  token from `addMiniApp()`. Body: `{ notif?: { token, url } }`. */
export async function POST(req: Request) {
  const fid = await getAuthedFid(req);
  if (!fid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let notif: { token?: string; url?: string } | undefined;
  try {
    const body = await req.json();
    if (body?.notif && typeof body.notif === "object") {
      notif = { token: body.notif.token, url: body.notif.url };
    }
  } catch {
    /* no/invalid JSON body — still record the add */
  }

  try {
    await markAdded(fid, notif);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[campaign/record-add] error:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
