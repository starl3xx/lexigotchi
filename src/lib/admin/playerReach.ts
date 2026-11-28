/**
 * The Players tab's "Reminders and accounts" section: for each PLAYER (an account: its linked
 * wallets are one player), which accounts they linked, which reminder channels they connected, and
 * which kinds of reminder they chose (starl3xx, 2026-11-27: "I wanna see on here /admin which
 * notifications/reminders/accounts players have connected"). Pure: lib/admin/playersData.ts reads
 * the inputs, and the tests pin what a row may carry.
 *
 * **Whether, never which.** A row says WHETHER a player confirmed an email, linked Telegram, or
 * subscribed browsers, never the address, the Telegram account, or an endpoint. The inputs carry
 * only booleans and counts for those (the X name and Farcaster ids are public).
 *
 * **Unknown is not "no".** Every read here can fail on its own (the database, Neynar, a mainnet
 * RPC), and a failed read must never look like a player who turned something off. So each fact is
 * `null` when its read failed, and the tab shows "?" for it. A missing table is different: it means
 * nobody has done that yet (before migration 0018, nobody chose a reminder kind, so everyone gets
 * the defaults), and the loader passes it as an empty list.
 *
 * **What the senders do, not a copy of it.** Farcaster reach is `reachableFid` (lib/notify/players):
 * a Farcaster id of one of the player's wallets, by Neynar, that added the mini app. Reminder choices
 * are `effectiveKinds`. Email reaches the account's own profile row, as `emailRecipients` reads it.
 */
import { effectiveKinds, parseCadence, parseChoices, REMINDER_KINDS, type EmailCadence, type ReminderKind } from "@/lib/notify/kinds";
import { reachableFid } from "@/lib/notify/players";
import type { PlayerGroup, ProfileFlags } from "./playerRows";

export interface ReachInputs {
  /**
   * The players, as the main table groups them (`groupPlayers`): the same accounts, wallets, names,
   * and team marks, so the two tables can never disagree about who a player is.
   */
  players: readonly Pick<PlayerGroup, "address" | "wallets" | "operator" | "lastSeen" | "name" | "pfpUrl" | "fids">[];
  /** Profile rows (X, email). Null: unread. */
  profiles: readonly ProfileFlags[] | null;
  /** Browsers subscribed to reminders, per wallet. Null: unread. */
  pushBrowsers: ReadonlyMap<string, number> | null;
  /** Accounts that linked Telegram. Null: unread. */
  telegram: ReadonlySet<string> | null;
  /** Reminder choices as stored (only players who changed something have a row). Null: unread. */
  prefs: readonly { account: string; kinds: unknown; emailCadence: unknown }[] | null;
  /** Neynar's Farcaster ids per wallet; `answered` false when any part of the lookup failed. */
  farcaster: { fidsOf: ReadonlyMap<string, readonly number[]>; answered: boolean };
  /** Farcaster ids that added the mini app. Null: unread. */
  addedFids: ReadonlySet<number> | null;
  /** Coinbase-verified wallets (Base mainnet attestations), per wallet. Null: unread. */
  coinbase: ReadonlyMap<string, boolean> | null;
}

export interface ReachRow {
  /** The account (its first wallet), lowercase. */
  account: string;
  /** Every wallet of the player, the account first. */
  wallets: string[];
  name: string | null;
  pfpUrl: string | null;
  /** Any of the player's wallets is the team's. */
  operator: boolean;
  lastSeen: string | null;
  /** Linked accounts. Null: couldn't be read. */
  accounts: {
    /** Farcaster ids for any of the player's wallets (Neynar, or a verified sign-in). Null when none is known and Neynar didn't answer. */
    farcaster: number[] | null;
    /** The X handle; false: none linked. */
    x: string | false | null;
    email: boolean | null;
    telegram: boolean | null;
    coinbase: boolean | null;
  };
  /** Reminder channels the player connected. Null: couldn't be read. */
  channels: {
    /** One of the player's Farcaster ids added the mini app: the Farcaster pass can reach them. */
    farcasterApp: boolean | null;
    browsers: number | null;
    /** A confirmed email with reminders on. */
    email: boolean | null;
    telegram: boolean | null;
  };
  /** How email comes; null when the choices couldn't be read. */
  emailCadence: EmailCadence | null;
  /** Every kind, on or off, for this player; null when the choices couldn't be read. */
  kinds: Record<ReminderKind, boolean> | null;
  /** The kinds this player changed from the defaults (empty: all defaults). */
  changed: ReminderKind[];
  /** Any account or channel at all, or a "?" that might be one (`hasAnything`): the tab's filter. */
  connected: boolean;
}

export interface ReachSummary {
  /** Players counted: the team's own left out. */
  players: number;
  /** Players with any account or channel at all. */
  connected: number;
  /** Each a count of players; null when that fact couldn't be read. */
  accounts: { farcaster: number | null; x: number | null; email: number | null; telegram: number | null; coinbase: number | null; wallets: number | null };
  channels: { farcasterApp: number | null; browsers: number | null; email: number | null; telegram: number | null; any: number | null; weekly: number | null };
  /** Per kind: how many players get it, and how many changed it from its default. Null: the choices couldn't be read. */
  kinds: Record<ReminderKind, { getting: number; changed: number }> | null;
}

const lower = (a: string) => a.toLowerCase();

export function buildReachRows(input: ReachInputs): ReachRow[] {
  const profileBy = new Map((input.profiles ?? []).map((p) => [lower(p.address), p]));
  const prefsBy = new Map((input.prefs ?? []).map((p) => [lower(p.account), p]));
  const walletsBy = new Map(input.players.map((p) => [lower(p.address), p.wallets.map((w) => lower(w.address))]));
  const walletsOf = (account: string) => walletsBy.get(lower(account)) ?? [lower(account)];
  // The sender's own lookup, over the same wallets this row lists.
  const accountOfWallet = new Map<string, string>();
  for (const [account, wallets] of walletsBy) for (const w of wallets) accountOfWallet.set(w, account);
  const fidOf = input.addedFids
    ? reachableFid(
        { accountOf: (a) => accountOfWallet.get(lower(a)) ?? lower(a), walletsOf },
        new Map([...input.farcaster.fidsOf].map(([w, f]) => [lower(w), f])),
        input.addedFids,
      )
    : null;

  const out: ReachRow[] = [];
  for (const p of input.players) {
    const account = lower(p.address);
    const wallets = walletsOf(account);

    // Farcaster ids: Neynar's for every wallet, and any the game saw at a verified sign-in.
    const fids = new Set<number>();
    for (const w of wallets) for (const f of input.farcaster.fidsOf.get(w) ?? []) fids.add(f);
    for (const f of p.fids) fids.add(f);
    const farcaster = fids.size > 0 ? [...fids].sort((a, b) => a - b) : input.farcaster.answered ? [] : null;
    const reached = fidOf ? fidOf(account) !== undefined : null;
    // A reachable id is a yes whatever else failed; a no needs both reads whole.
    const farcasterApp = reached === true ? true : reached === false && input.farcaster.answered ? false : null;

    // X and email live on the account's own profile row (a wallet with its own can't be linked in).
    const read = input.profiles !== null;
    const profile = profileBy.get(account) ?? null;
    const x = read ? (profile?.xUsername ?? false) : null;
    const emailConfirmed = read ? !!profile?.emailConfirmed : null;
    const emailReminders = read ? !!(profile?.emailConfirmed && profile.emailReminders) : null;

    const browsers = input.pushBrowsers ? wallets.reduce((n, w) => n + (input.pushBrowsers!.get(w) ?? 0), 0) : null;
    const telegram = input.telegram ? input.telegram.has(account) : null;
    const coinbase = input.coinbase ? wallets.some((w) => input.coinbase!.get(w) === true) : null;

    const stored = prefsBy.get(account);
    const choices = input.prefs ? (parseChoices(stored?.kinds) ?? {}) : null;
    const kinds = choices ? effectiveKinds(choices) : null;

    out.push({
      account,
      wallets,
      name: p.name,
      pfpUrl: p.pfpUrl,
      operator: p.operator,
      lastSeen: p.lastSeen,
      accounts: {
        farcaster,
        x,
        email: emailConfirmed,
        telegram,
        coinbase,
      },
      channels: { farcasterApp, browsers, email: emailReminders, telegram },
      emailCadence: input.prefs ? (parseCadence(stored?.emailCadence) ?? "each") : null,
      kinds,
      changed: choices ? REMINDER_KINDS.filter((k) => k in choices) : [],
      connected: false,
    });
    out[out.length - 1].connected = hasAnything(out[out.length - 1]);
  }
  return out.sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "") || a.account.localeCompare(b.account));
}

/** Does this player have any account or channel at all (a "?" counts: it might)? */
export function hasAnything(r: ReachRow): boolean {
  const a = r.accounts;
  const c = r.channels;
  return (
    (a.farcaster?.length ?? 1) > 0 ||
    a.x !== false ||
    a.email !== false ||
    a.telegram !== false ||
    a.coinbase !== false ||
    c.farcasterApp !== false ||
    (c.browsers ?? 1) > 0 ||
    r.wallets.length > 1 ||
    r.changed.length > 0
  );
}

/** Counts over the players, the team's own left out. A count whose fact couldn't be read is null. */
export function reachSummary(rows: readonly ReachRow[]): ReachSummary {
  const t = rows.filter((r) => !r.operator);
  /** Players for whom `f` is true; null when any player's answer is unknown. */
  const count = (f: (r: ReachRow) => boolean | null | undefined) => {
    let n = 0;
    for (const r of t) {
      const v = f(r);
      if (v === null || v === undefined) return null;
      if (v) n += 1;
    }
    return n;
  };
  const known = t.every((r) => r.kinds !== null);
  return {
    players: t.length,
    connected: t.filter((r) => r.connected).length,
    accounts: {
      farcaster: count((r) => (r.accounts.farcaster === null ? null : r.accounts.farcaster.length > 0)),
      x: count((r) => (r.accounts.x === null ? null : r.accounts.x !== false)),
      email: count((r) => r.accounts.email),
      telegram: count((r) => r.accounts.telegram),
      coinbase: count((r) => r.accounts.coinbase),
      wallets: count((r) => r.wallets.length > 1),
    },
    channels: {
      farcasterApp: count((r) => r.channels.farcasterApp),
      browsers: count((r) => (r.channels.browsers === null ? null : r.channels.browsers > 0)),
      email: count((r) => r.channels.email),
      telegram: count((r) => r.channels.telegram),
      any: count((r) => {
        const c = r.channels;
        if (c.farcasterApp || (c.browsers ?? 0) > 0 || c.email || c.telegram) return true;
        return c.farcasterApp === null || c.browsers === null || c.email === null || c.telegram === null ? null : false;
      }),
      weekly: count((r) => (r.emailCadence === null ? null : r.emailCadence === "weekly")),
    },
    kinds: known
      ? (Object.fromEntries(
          REMINDER_KINDS.map((k) => [k, { getting: t.filter((r) => r.kinds![k]).length, changed: t.filter((r) => r.changed.includes(k)).length }]),
        ) as ReachSummary["kinds"])
      : null,
  };
}
