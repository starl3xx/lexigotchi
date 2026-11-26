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
import { changedFromDefaults, parseChoices, wantsKind, type KindChoices, type ReminderKind } from "@/lib/notify/kinds";

const lower = (a: string) => a.toLowerCase();

/** Every player's choices, read once for a pass. */
export interface PrefsBook {
  /** False when the choices could not be read: `wants` then refuses everything. */
  known: boolean;
  /** Does this account get this kind? Its choice, else the default; never, when not `known`. */
  wants(account: string, kind: ReminderKind): boolean;
  /** The accounts that CHOSE this value for a kind (to find an opt-out, or an opt-in, without scanning every player). */
  chose(kind: ReminderKind, on: boolean): string[];
}

/** Pure: a book from stored rows. Exported for tests and for callers that already hold the rows. */
export function prefsBookFrom(rows: readonly { account: string; kinds: unknown }[], known = true): PrefsBook {
  const byAccount = new Map<string, KindChoices>();
  for (const r of rows) byAccount.set(lower(r.account), parseChoices(r.kinds) ?? {});
  return {
    known,
    wants: (account, kind) => known && wantsKind(byAccount.get(lower(account)), kind),
    chose: (kind, on) => (known ? [...byAccount].filter(([, c]) => c[kind] === on).map(([a]) => a) : []),
  };
}

/** The whole table (small: only players who changed something have a row). Never throws. */
export async function loadPrefs(): Promise<PrefsBook> {
  try {
    return prefsBookFrom(await getDb().select({ account: reminderPrefs.account, kinds: reminderPrefs.kinds }).from(reminderPrefs));
  } catch (err) {
    if (isMissingTable(err)) return prefsBookFrom([]);
    console.error("[reminders] couldn't read the players' choices, so this pass sends nothing:", String((err as Error)?.message ?? err).slice(0, 160));
    return prefsBookFrom([], false);
  }
}

/** One account's stored choices ({} when it changed nothing, or before the migration). Throws on a real failure. */
export async function prefsOf(account: string): Promise<KindChoices> {
  try {
    const rows = await getDb().select({ kinds: reminderPrefs.kinds }).from(reminderPrefs).where(eq(reminderPrefs.account, lower(account))).limit(1);
    return parseChoices(rows[0]?.kinds) ?? {};
  } catch (err) {
    if (isMissingTable(err)) return {};
    throw err;
  }
}

/**
 * Store an account's choices: `changes` over what it had, keeping only what differs from the
 * defaults. Returns what is now stored. Throws when the table is missing (the route answers
 * `not_configured`): a choice that can't be kept must not look saved.
 */
export async function savePrefs(account: string, changes: KindChoices): Promise<KindChoices> {
  const a = lower(account);
  return getDb().transaction(async (tx) => {
    // One save at a time per account. A row lock isn't enough for the FIRST save, when there is no
    // row to lock: two boxes changed together would each read "nothing stored" and the later write
    // would drop the earlier one's change.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`lexigotchi:reminder_prefs:${a}`}))`);
    const rows = await tx.select({ kinds: reminderPrefs.kinds }).from(reminderPrefs).where(eq(reminderPrefs.account, a)).limit(1);
    const next = changedFromDefaults({ ...(parseChoices(rows[0]?.kinds) ?? {}), ...changes });
    await tx
      .insert(reminderPrefs)
      .values({ account: a, kinds: next, updatedAt: new Date() })
      .onConflictDoUpdate({ target: reminderPrefs.account, set: { kinds: next, updatedAt: new Date() } });
    return next;
  });
}
