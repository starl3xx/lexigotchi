import { NextResponse } from "next/server";
import { notifiableFids } from "@/lib/db/queries";
import { sendNotification } from "@/lib/notify/send";
import { sendWebPush } from "@/lib/notify/webPush";
import { allWebPushSubscriptions } from "@/lib/db/webPush";
import { emailRecipients } from "@/lib/db/profiles";
import { loadLinkMap } from "@/lib/db/walletLinks";
import { loadPrefs } from "@/lib/db/reminderPrefs";
import { claimMark, releaseMark } from "@/lib/db/reminderMarks";
import { fidsByAddressesDetailed } from "@/lib/neynar";
import { emailEnabled, reminderEmail, sendEmails } from "@/lib/notify/email";
import { tellByTelegram, telegramRemindersOn } from "@/lib/notify/telegram";
import { allTelegramLinks } from "@/lib/db/telegramLinks";
import type { Notification } from "@/lib/notify/templates";
import { setEvents, setRemindersOn, tellSetEvents } from "@/lib/notify/sets";
import { loadSets, reconcile } from "@/lib/sets/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Hourly: keep reserved word sets up to date, and tell players of a set's three moments
 * (decisions.md, "Reserved word sets"; lib/notify/sets.ts).
 *
 * 1. A draft whose reveal time has come is revealed (the read does it; one statement, once).
 * 2. A set whose release root is on the chain is marked released (`reconcile`; also done by the
 *    next claim's read, so this is the backstop for a quiet hour).
 * 3. Each moment (revealed, unlocked, first day over) is announced once, to players who keep "A
 *    new set of words" on. Muted by `SET_REMINDERS=off`.
 *
 * Its own route, not a keeper job: a job name that isn't in `KEEPER_JOBS` never runs, and the
 * keeper is daily. Auth mirrors the other crons: Vercel's `Authorization: Bearer ${CRON_SECRET}`,
 * failing CLOSED in production when the secret is absent.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  } else if (process.env.NODE_ENV === "production") {
    console.error("[cron/sets] CRON_SECRET not set: refusing in production");
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 401 });
  }

  try {
    await loadSets({ fresh: true }); // reveals what is due
    const released = await reconcile().catch(() => [] as number[]);
    const book = await loadSets({ fresh: true });
    if (!book.known || !book.migrated) return NextResponse.json({ ok: true, sets: 0, released, told: [] });
    const events = setRemindersOn() ? setEvents(book.sets, Date.now()) : [];
    if (events.length === 0) return NextResponse.json({ ok: true, sets: book.sets.length, released, told: [] });

    const told = await tellSetEvents(events, {
      claim: (mark) => claimMark("all", "sets", mark),
      release: (mark) => releaseMark("all", "sets", mark),
      send: tellEveryone,
    });
    // Ids and counts only: a set's name is public by the time it has a moment, but nothing needs it here.
    console.log(`[cron/sets] ${told.map((t) => `set ${t.setId} ${t.moment}: ${t.outcome}${t.reached ? ` (${t.reached})` : ""}`).join("; ")}`);
    return NextResponse.json({ ok: true, sets: book.sets.length, released, told });
  } catch (err) {
    const e = err as { code?: string; name?: string } | null;
    console.error("[cron/sets] failed:", String(e?.code ?? e?.name ?? "error").slice(0, 40));
    return NextResponse.json({ ok: false, error: "failed" }, { status: 500 });
  }
}

/**
 * One note to every player the game can reach who keeps "A new set of words" on. Farcaster, else
 * the player's browsers; email and Telegram to those who asked for them. Returns how many it
 * reached (0 when the choices can't be read: no licence to send).
 */
async function tellEveryone(note: Notification): Promise<number> {
  const [prefs, links] = await Promise.all([loadPrefs(), loadLinkMap()]);
  if (!prefs.known) return 0;
  const wants = (address: string) => prefs.wants(links.accountOf(address), "sets");
  let reached = 0;

  // ── Farcaster ── reached by FID, a choice is kept by account: look up the FIDs of the accounts
  // that turned it off. If Farcaster can't say who they are, nobody is told there this run.
  const fids = await notifiableFids().catch(() => [] as number[]);
  const offWallets = prefs.chose("sets", false).flatMap((account) => links.walletsOf(account));
  const off = offWallets.length > 0 ? await fidsByAddressesDetailed(offWallets) : { fids: new Map<string, number[]>(), answered: true };
  const offFids = new Set([...off.fids.values()].flat());
  const targets = off.answered ? fids.filter((f) => !offFids.has(f)) : [];
  let farcasterFids = new Set<number>();
  if (targets.length > 0) {
    const res = await sendNotification({ ...note, targetFids: targets });
    if (res.ok) {
      reached += targets.length;
      farcasterFids = new Set(targets);
    }
  }

  // ── Browsers ── a player Farcaster reminded this run isn't told twice.
  const subs = (await allWebPushSubscriptions().catch(() => [])).filter((sub) => wants(sub.address) && !(sub.fid !== null && farcasterFids.has(sub.fid)));
  if (subs.length > 0) {
    const res = await sendWebPush(subs, note);
    reached += res.delivered ?? 0;
  }

  // ── Email ── to players who confirmed one and kept reminders on (it never waits for a weekly digest: a set's moments are timed).
  if (emailEnabled()) {
    try {
      const recips = (await emailRecipients()).filter((r) => wants(r.address));
      const messages = recips.flatMap((r) => reminderEmail(r.email, r.address, note) ?? []);
      if (messages.length > 0) reached += (await sendEmails(messages, { idempotency: note.notificationId })).sent;
    } catch (err) {
      console.error("[cron/sets] email pass failed:", String((err as { code?: string })?.code ?? "error").slice(0, 40));
    }
  }

  // ── Telegram ── to linked players, under its own send-once mark per player.
  if (telegramRemindersOn()) {
    try {
      const linked = (await allTelegramLinks())
        .map((l) => l.account.toLowerCase())
        .filter((account) => links.accountOf(account).toLowerCase() === account && wants(account));
      const res = await tellByTelegram("sets", linked.map((account) => ({ account, note, mark: note.notificationId ?? "set" })));
      reached += res?.sent ?? 0;
    } catch (err) {
      console.error("[cron/sets] telegram pass failed:", String((err as { code?: string })?.code ?? "error").slice(0, 40));
    }
  }
  return reached;
}
