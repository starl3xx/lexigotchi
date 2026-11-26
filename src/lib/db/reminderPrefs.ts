/**
 * A player's reminder choices (lib/notify/kinds.ts), stored per ACCOUNT in `reminder_prefs`
 * (migration 0018).
 *
 * Two different "couldn't read"s, and they must never be confused:
 *   - **No table** (the migration hasn't run): nobody has chosen anything, so everybody follows the
 *     defaults. That is exactly how reminders behaved before choices existed.
 *   - **A read that failed** (the database is down, a query broke): somebody may have turned a kind
 *     OFF and we can't see it. Sending then would break the one promise a choice makes, so the book
 *     says no to everything (`known: false`), and a sender skips its pass and logs why.
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "./client";
import { reminderPrefs } from "./schema";
import { isMissingTable } from "./profiles";
import { emailedNow, mergeStored, parseCadence, parseChoices, wantsKind, type EmailCadence, type KindChoices, type ReminderKind } from "@/lib/notify/kinds";

const lower = (a: string) => a.toLowerCase();

/** Every player's choices, read once for a pass. */
export interface PrefsBook {
  /** False when the choices could not be read: `wants` then refuses everything. */
  known: boolean;
  /** Does this account get this kind? Its choice, else the default; never, when not `known`. */
  wants(account: string, kind: ReminderKind): boolean;
  /** The accounts that CHOSE this value for a kind (to find an opt-out, or an opt-in, without scanning every player). */
  chose(kind: ReminderKind, on: boolean): string[];
  /** Is this kind EMAILED to this account as it happens? Not when it gets the weekly digest in its place. */
  emailsNow(account: string, kind: ReminderKind): boolean;
  /** The accounts that asked for the weekly email digest. */
  weekly(): string[];
}

/** Pure: a book from stored rows. Exported for tests and for callers that already hold the rows. */
export function prefsBookFrom(rows: readonly { account: string; kinds: unknown; emailCadence?: unknown }[], known = true): PrefsBook {
  const byAccount = new Map<string, KindChoices>();
  const cadence = new Map<string, EmailCadence>();
  for (const r of rows) {
    byAccount.set(lower(r.account), parseChoices(r.kinds) ?? {});
    cadence.set(lower(r.account), parseCadence(r.emailCadence) ?? "each");
  }
  return {
    known,
    wants: (account, kind) => known && wantsKind(byAccount.get(lower(account)), kind),
    chose: (kind, on) => (known ? [...byAccount].filter(([, c]) => c[kind] === on).map(([a]) => a) : []),
    emailsNow: (account, kind) => known && emailedNow(cadence.get(lower(account)) ?? "each", kind),
    weekly: () => (known ? [...cadence].filter(([, c]) => c === "weekly").map(([a]) => a) : []),
  };
}

/** The whole table (small: only players who changed something have a row). Never throws. */
export async function loadPrefs(): Promise<PrefsBook> {
  try {
    return prefsBookFrom(await getDb().select({ account: reminderPrefs.account, kinds: reminderPrefs.kinds, emailCadence: reminderPrefs.emailCadence }).from(reminderPrefs));
  } catch (err) {
    if (isMissingTable(err)) return prefsBookFrom([]);
    console.error("[reminders] couldn't read the players' choices, so this pass sends nothing:", String((err as Error)?.message ?? err).slice(0, 160));
    return prefsBookFrom([], false);
  }
}

/** What one account has stored. */
export interface StoredPrefs {
  choices: KindChoices;
  cadence: EmailCadence;
}

/** One account's stored choices (the defaults when it changed nothing, or before the migration). Throws on a real failure. */
export async function prefsOf(account: string): Promise<StoredPrefs> {
  try {
    const rows = await getDb()
      .select({ kinds: reminderPrefs.kinds, emailCadence: reminderPrefs.emailCadence })
      .from(reminderPrefs)
      .where(eq(reminderPrefs.account, lower(account)))
      .limit(1);
    return { choices: parseChoices(rows[0]?.kinds) ?? {}, cadence: parseCadence(rows[0]?.emailCadence) ?? "each" };
  } catch (err) {
    if (isMissingTable(err)) return { choices: {}, cadence: "each" };
    throw err;
  }
}

/**
 * Store an account's choices: `kinds` over what it had (keeping only what differs from the
 * defaults), and the email cadence when one is given. Returns what is now stored. Throws when the
 * table is missing (the route answers `not_configured`): a choice that can't be kept must not look saved.
 */
export async function savePrefs(account: string, changes: { kinds?: KindChoices; cadence?: EmailCadence }): Promise<StoredPrefs> {
  const a = lower(account);
  return getDb().transaction(async (tx) => {
    // One save at a time per account. A row lock isn't enough for the FIRST save, when there is no
    // row to lock: two boxes changed together would each read "nothing stored" and the later write
    // would drop the earlier one's change.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`lexigotchi:reminder_prefs:${a}`}))`);
    const rows = await tx.select({ kinds: reminderPrefs.kinds, emailCadence: reminderPrefs.emailCadence }).from(reminderPrefs).where(eq(reminderPrefs.account, a)).limit(1);
    // Kinds this build doesn't know stay in the row as they are (mergeStored says why).
    const next = mergeStored(rows[0]?.kinds, changes.kinds ?? {});
    const cadence = changes.cadence ?? parseCadence(rows[0]?.emailCadence) ?? "each";
    // "each" is stored as null: it is the default, and a null column is what every old row has.
    const stored = cadence === "weekly" ? "weekly" : null;
    await tx
      .insert(reminderPrefs)
      .values({ account: a, kinds: next, emailCadence: stored, updatedAt: new Date() })
      .onConflictDoUpdate({ target: reminderPrefs.account, set: { kinds: next, emailCadence: stored, updatedAt: new Date() } });
    return { choices: parseChoices(next) ?? {}, cadence };
  });
}
