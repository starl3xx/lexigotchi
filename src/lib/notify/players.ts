/**
 * Tell players something that happened to them: one message each, on every channel they keep on,
 * of a kind they haven't turned off. The shared sender behind a sale (./sold.ts), a payout, and a
 * bounty (./paid.ts): each of those says WHO and WHAT (a `PlayerNote` per account), and this file
 * does the rest the same way every time.
 *
 *   - **The kind is asked first** (lib/notify/kinds.ts, lib/db/reminderPrefs.ts). Choices that
 *     couldn't be read send nothing.
 *   - **Farcaster first, else the account's browsers,** so a player Farcaster reaches doesn't hear a
 *     thing twice (triggers `webPushWinnerSubs`).
 *   - **And by email,** to an account with a confirmed address and email on, whatever else reached
 *     it: it asked for email. The message's send-once mark (lib/db/reminderMarks.ts) is taken
 *     BEFORE the send and given back if the send fails; with no mark table nothing is emailed.
 *   - **It can't hurt its caller.** Nothing is loaded while every channel is dark; the push senders
 *     are imported only here, at the moment of use (each THROWS at import when armed without its
 *     keys, which must never take a public route or a keeper job down); and it never throws.
 *   - **Only these players are looked up** for Farcaster (one cached request for their wallets),
 *     never every player who added the app.
 */
import type { ReminderKind } from "./kinds";
import type { Notification } from "./templates";
import { webPushWinnerSubs, type FidLookup, type PushSub } from "./triggers";

/** One message for one player. */
export interface PlayerNote {
  /** The player: their account (its first wallet), lowercase. */
  account: string;
  /** The wallet the thing happened to (the seller, the paid wallet): Farcaster is found through it. */
  wallet: string;
  /** What to say. Its `notificationId` is also the email's send-once mark, so it must name the EVENT. */
  note: Notification;
  /** The email's ledger (lib/notify/email.ts): a receipt's facts. */
  facts?: readonly (readonly [string, string])[];
}

export interface TellResult {
  players: number;
  farcaster: number;
  browsers: number;
  /** Players no push channel reaches. */
  unreached: number;
  emailed: number;
}

export interface PushDeps {
  /** Wallet → account. */
  accountOf: (address: string) => string;
  /** Does this account want this kind? Absent: everybody does. */
  wants?: (account: string) => boolean;
  /** Wallet → a Farcaster id notifications reach, across the account. */
  fidOf: FidLookup;
  /** Every stored browser. */
  subs: readonly (PushSub & { endpoint: string; p256dh: string; auth: string })[];
  toFarcaster: (fid: number, note: Notification) => Promise<{ ok: boolean; skipped?: string }>;
  toBrowsers: (subs: readonly { endpoint: string; p256dh: string; auth: string }[], note: Notification) => Promise<{ ok: boolean; skipped?: string }>;
}

/** The pushes, over audiences already loaded. Each player's failure is its own. */
export async function pushNotes(notes: readonly PlayerNote[], deps: PushDeps, log: (line: string) => void = () => {}): Promise<TellResult> {
  const out: TellResult = { players: 0, farcaster: 0, browsers: 0, unreached: 0, emailed: 0 };
  for (const n of notes) {
    if (deps.wants && !deps.wants(n.account)) continue; // the player turned this kind off
    out.players++;
    try {
      const fid = deps.fidOf(n.wallet);
      if (fid !== undefined) {
        if ((await deps.toFarcaster(fid, n.note)).ok) out.farcaster++;
        continue;
      }
      const subs = webPushWinnerSubs(n.wallet, deps.subs, deps.fidOf, deps.accountOf);
      if (subs.length === 0) {
        out.unreached++;
        continue;
      }
      if ((await deps.toBrowsers(subs, n.note)).ok) out.browsers++;
    } catch (err) {
      log(`telling one player failed: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
    }
  }
  return out;
}

export interface EmailDeps {
  wants?: (account: string) => boolean;
  /** The confirmed, opted-in address of each of these accounts (lib/db/profiles `emailRecipients`). */
  recipients: (accounts: readonly string[]) => Promise<{ address: string; email: string }[]>;
  /** Take the send-once mark for this account's message (lib/db/reminderMarks). */
  claim: (account: string, mark: string) => Promise<"claimed" | "taken" | "unavailable">;
  release: (account: string, mark: string) => Promise<void>;
  /** Send one message; true when the mail service took it. */
  send: (to: string, account: string, note: Notification, facts: [string, string][], id: string) => Promise<boolean>;
}

/** The emails. Marked before each send, unmarked when a send fails; nothing without a mark. */
export async function emailNotes(notes: readonly PlayerNote[], deps: EmailDeps): Promise<{ sent: number; skipped: number }> {
  const wanted = notes.filter((n) => !deps.wants || deps.wants(n.account));
  const out = { sent: 0, skipped: 0 };
  if (wanted.length === 0) return out;
  const emailOf = new Map((await deps.recipients(wanted.map((n) => n.account))).map((r) => [r.address.toLowerCase(), r.email]));
  for (const n of wanted) {
    const to = emailOf.get(n.account);
    const mark = n.note.notificationId;
    if (!to || !mark) continue;
    if ((await deps.claim(n.account, mark)) !== "claimed") {
      out.skipped++;
      continue;
    }
    let ok = false;
    try {
      ok = await deps.send(to, n.account, n.note, (n.facts ?? []).map(([a, b]) => [a, b]), mark);
    } catch {
      ok = false;
    }
    if (ok) out.sent++;
    else await deps.release(n.account, mark);
  }
  return out;
}

/** Is a push channel armed? Read here, never from the senders: importing those is what can throw. */
export function pushChannels(env: NodeJS.ProcessEnv = process.env): { farcaster: boolean; browser: boolean } {
  const prod = env.NODE_ENV === "production";
  return { farcaster: prod && env.NOTIFICATIONS_ENABLED === "true", browser: prod && env.WEB_PUSH_ENABLED === "true" };
}

/**
 * Wallet → the Farcaster id that reaches its player: the first id any wallet of the account has
 * (`fidsOf`, from Neynar) that also ADDED the mini app (`added`), since only those can be notified.
 */
export function reachableFid(
  links: { accountOf: (address: string) => string; walletsOf: (account: string) => string[] },
  fidsOf: ReadonlyMap<string, readonly number[]>,
  added: ReadonlySet<number>,
): FidLookup {
  return (address) => {
    for (const wallet of links.walletsOf(links.accountOf(address))) {
      const fid = (fidsOf.get(wallet.toLowerCase()) ?? []).find((f) => added.has(f));
      if (fid !== undefined) return fid;
    }
    return undefined;
  };
}

/**
 * Tell these players, on whatever is armed. `build` gets the wallet → account lookup and answers
 * the notes (one per account), so a caller groups by player with the same links this uses. Never
 * throws. Null when there was nothing to say, nothing armed, or the choices couldn't be read.
 */
export async function notifyPlayers(
  kind: ReminderKind,
  build: (accountOf: (address: string) => string) => readonly PlayerNote[],
  opts: { log?: (line: string) => void } = {},
): Promise<TellResult | null> {
  const log = opts.log ?? ((line: string) => console.log(line));
  try {
    const on = pushChannels();
    // Email has its own switch, and its module is safe to load (it throws at nothing).
    const mail = await import("./email");
    const email = mail.emailEnabled();
    if (!on.farcaster && !on.browser && !email) return null;

    const [{ loadLinkMap }, { notifiableFids }, { fidsByAddresses }, { allWebPushSubscriptions }, { loadPrefs }] = await Promise.all([
      import("@/lib/db/walletLinks"),
      import("@/lib/db/queries"),
      import("@/lib/neynar"),
      import("@/lib/db/webPush"),
      import("@/lib/db/reminderPrefs"),
    ]);
    const [links, prefs] = await Promise.all([loadLinkMap(), loadPrefs()]);
    // Choices that couldn't be read send nothing (loadPrefs has logged why): a player may have turned this off.
    if (!prefs.known) return null;
    const wants = (account: string) => prefs.wants(account, kind);
    const notes = build(links.accountOf).filter((n) => wants(n.account));
    if (notes.length === 0) return null;

    let res: TellResult = { players: 0, farcaster: 0, browsers: 0, unreached: 0, emailed: 0 };
    if (on.farcaster || on.browser) {
      // Each audience is read only for a channel that is armed.
      const wallets = notes.flatMap((n) => links.walletsOf(n.account));
      const [added, fidsOf] = on.farcaster
        ? await Promise.all([notifiableFids().then((f) => new Set(f)).catch(() => new Set<number>()), fidsByAddresses(wallets)])
        : [new Set<number>(), new Map<string, number[]>()];
      const subs = on.browser ? await allWebPushSubscriptions().catch(() => []) : [];
      res = await pushNotes(
        notes,
        {
          accountOf: links.accountOf,
          fidOf: reachableFid(links, fidsOf, added),
          subs,
          toFarcaster: async (fid, note) => (await import("./send")).sendNotification({ ...note, targetFids: [fid] }),
          toBrowsers: async (to, note) => (await import("./webPush")).sendWebPush(to, note),
        },
        (line) => log(`${kind}: ${line}`),
      );
    }
    // By email too, for a player who asked for email: its own pass, and its failure is its own.
    if (email) {
      try {
        const [{ emailRecipients }, marks] = await Promise.all([import("@/lib/db/profiles"), import("@/lib/db/reminderMarks")]);
        // A player who takes the weekly digest gets the daily kinds there, not one by one.
        const mailed = await emailNotes(notes.filter((n) => prefs.emailsNow(n.account, kind)), {
          recipients: (accounts) => emailRecipients(accounts),
          claim: (account, mark) => marks.claimMark(account, kind, mark),
          release: (account, mark) => marks.releaseMark(account, kind, mark),
          send: async (to, account, note, facts, id) => {
            const message = mail.reminderEmail(to, account, note, facts);
            return !!message && (await mail.sendEmails([message], { idempotency: id })).sent === 1;
          },
        });
        res.emailed = mailed.sent;
        res.players = Math.max(res.players, notes.length);
      } catch (err) {
        console.error(`${kind}: the email pass failed:`, String((err as Error)?.message ?? err).slice(0, 160));
      }
    }
    log(`${kind}: ${res.players} player(s): ${res.farcaster} told in Farcaster, ${res.browsers} in a browser, ${res.emailed} by email, ${res.unreached} with no push channel`);
    return res;
  } catch (err) {
    console.error(`${kind}: telling players failed:`, String((err as Error)?.message ?? err).slice(0, 200));
    return null;
  }
}
