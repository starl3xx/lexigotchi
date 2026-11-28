/**
 * The Players tab's rows and funnel, from inputs already read (lib/admin/playersData.ts reads them).
 * Pure: no chain, no database, so the tests can pin what a row may carry.
 *
 * A row may say WHETHER a wallet confirmed an email or subscribed a browser, never the address or
 * the endpoint: the inputs carry only booleans and counts for those, and the tests hold that.
 */

/** One wallet's game actions, from the contracts' events. Times are ms since the epoch. */
export interface ChainActivity {
  first: number;
  last: number;
  /** Test $WORD faucet mints (testnet only; always 0 on mainnet). */
  faucet: number;
  /** Letter commits of 5 (paid or free packs) and of 1 (daily letters). */
  packs: number;
  dailies: number;
  /** Commits revealed. Commits minus reveals = letters still waiting to open. */
  reveals: number;
  claims: number;
  rolls: number;
  rollWins: number;
  stakes: number;
  feeds: number;
}

export const emptyActivity = (t: number): ChainActivity => ({
  first: t,
  last: t,
  faucet: 0,
  packs: 0,
  dailies: 0,
  reveals: 0,
  claims: 0,
  rolls: 0,
  rollWins: 0,
  stakes: 0,
  feeds: 0,
});

export interface SightingInput {
  address: string;
  firstSeenAt: number;
  lastSeenAt: number;
  daysSeen: number;
  firstVia: string;
  lastVia: string;
  fid: number | null;
}

/** What a profile row may tell the console. Booleans only for email: never the address. */
export interface ProfileFlags {
  address: string;
  xUsername: string | null;
  emailConfirmed: boolean;
  emailReminders: boolean;
}

export interface Holdings {
  /** Loose letters: lowercase and UPPERCASE. */
  letters: Record<string, { lower: number; upper: number }>;
  /** Claimed words with their beneficial owner. */
  words: readonly { owner: string; staked: boolean }[];
}

export interface PlayerInputs {
  /**
   * Lowercase addresses of the team's own wallets: allowlist, TEAM_WALLETS, registry roles, server
   * keys. A wallet linked into a team wallet's account counts as the team's too.
   */
  operators: ReadonlySet<string>;
  /** Addresses that are the game's contracts: never a row. */
  contracts: ReadonlySet<string>;
  sightings: readonly SightingInput[];
  chain: ReadonlyMap<string, ChainActivity>;
  holdings: Holdings;
  profiles: readonly ProfileFlags[];
  /** Browsers subscribed to reminders, per wallet. */
  pushBrowsers: ReadonlyMap<string, number>;
  /** Market listings made (words and letters for sale), per wallet. */
  listings: ReadonlyMap<string, number>;
  /** The accounts (lowercase) that linked a Telegram account for reminders. Absent: none. */
  telegram?: ReadonlySet<string>;
  /** The account (first wallet) a linked wallet belongs to, when it isn't its own. */
  accountOf: (address: string) => string;
  /** Public names and pictures (Farcaster or X), by address. */
  faces: Readonly<Record<string, { username: string; pfpUrl: string | null; source?: string }>>;
}

export interface PlayerRow {
  address: string;
  /** The account this wallet is linked into, when that's another wallet. */
  account: string | null;
  name: string | null;
  pfpUrl: string | null;
  nameSource: string | null;
  operator: boolean;
  fid: number | null;
  /** Earliest and latest trace of any kind (ISO). */
  firstSeen: string | null;
  lastSeen: string | null;
  sighting: { first: string; last: string; days: number; firstVia: string; lastVia: string } | null;
  onchain: { first: string; last: string } | null;
  faucet: number;
  packs: number;
  dailies: number;
  /** Commits not yet revealed. */
  waiting: number;
  claims: number;
  rolls: number;
  rollWins: number;
  stakes: number;
  feeds: number;
  listings: number;
  holds: { letters: number; upper: number; words: number; staked: number };
  xUsername: string | null;
  emailConfirmed: boolean;
  emailReminders: boolean;
  pushBrowsers: number;
  /** The wallet's account linked a Telegram account for reminders (whether, never which). */
  telegram: boolean;
}

export interface Funnel {
  /** Players (or wallets, when given wallet rows) with any trace at all (a sighting, an onchain action, a profile, a reminder). */
  any: number;
  /** Players the game saw connected (the unverified count; needs migration 0012). */
  seen: number;
  faucet: number;
  letters: number;
  words: number;
  rolls: number;
  staked: number;
  linkedX: number;
  email: number;
  reminders: number;
  /** Wallets whose account linked Telegram for reminders. */
  telegram: number;
  listings: number;
}

const iso = (ms: number) => new Date(ms).toISOString();

export function buildPlayerRows(input: PlayerInputs): PlayerRow[] {
  const lower = (a: string) => a.toLowerCase();
  const sightingBy = new Map(input.sightings.map((s) => [lower(s.address), s]));
  const profileBy = new Map(input.profiles.map((p) => [lower(p.address), p]));
  const held = new Map<string, { letters: number; upper: number; words: number; staked: number }>();
  const hold = (a: string) => {
    const k = lower(a);
    const cur = held.get(k) ?? { letters: 0, upper: 0, words: 0, staked: 0 };
    held.set(k, cur);
    return cur;
  };
  for (const [a, l] of Object.entries(input.holdings.letters)) {
    const h = hold(a);
    h.letters += l.lower + l.upper;
    h.upper += l.upper;
  }
  for (const w of input.holdings.words) {
    const h = hold(w.owner);
    h.words += 1;
    if (w.staked) h.staked += 1;
  }

  const everyone = new Set<string>([
    ...sightingBy.keys(),
    ...[...input.chain.keys()].map(lower),
    ...profileBy.keys(),
    ...[...input.pushBrowsers.keys()].map(lower),
    ...[...input.listings.keys()].map(lower),
    ...held.keys(),
  ]);

  const rows: PlayerRow[] = [];
  for (const address of everyone) {
    if (input.contracts.has(address)) continue;
    const s = sightingBy.get(address) ?? null;
    const c = input.chain.get(address) ?? null;
    const p = profileBy.get(address) ?? null;
    const h = held.get(address) ?? { letters: 0, upper: 0, words: 0, staked: 0 };
    const firsts = [s?.firstSeenAt, c?.first].filter((n): n is number => typeof n === "number");
    const lasts = [s?.lastSeenAt, c?.last].filter((n): n is number => typeof n === "number");
    const account = input.accountOf(address);
    const face = input.faces[address] ?? null;
    rows.push({
      address,
      account: account && lower(account) !== address ? lower(account) : null,
      name: face?.username ?? null,
      pfpUrl: face?.pfpUrl ?? null,
      nameSource: face?.source ?? null,
      operator: input.operators.has(address) || (account ? input.operators.has(lower(account)) : false),
      fid: s?.fid ?? null,
      firstSeen: firsts.length ? iso(Math.min(...firsts)) : null,
      lastSeen: lasts.length ? iso(Math.max(...lasts)) : null,
      sighting: s
        ? { first: iso(s.firstSeenAt), last: iso(s.lastSeenAt), days: s.daysSeen, firstVia: s.firstVia, lastVia: s.lastVia }
        : null,
      onchain: c ? { first: iso(c.first), last: iso(c.last) } : null,
      faucet: c?.faucet ?? 0,
      packs: c?.packs ?? 0,
      dailies: c?.dailies ?? 0,
      waiting: Math.max(0, (c?.packs ?? 0) + (c?.dailies ?? 0) - (c?.reveals ?? 0)),
      claims: c?.claims ?? 0,
      rolls: c?.rolls ?? 0,
      rollWins: c?.rollWins ?? 0,
      stakes: c?.stakes ?? 0,
      feeds: c?.feeds ?? 0,
      listings: input.listings.get(address) ?? 0,
      holds: h,
      xUsername: p?.xUsername ?? null,
      emailConfirmed: p?.emailConfirmed ?? false,
      emailReminders: p?.emailReminders ?? false,
      pushBrowsers: input.pushBrowsers.get(address) ?? 0,
      telegram: input.telegram?.has(lower(account || address)) ?? false,
    });
  }
  // Most recent first; wallets with no time at all last.
  return rows.sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "") || a.address.localeCompare(b.address));
}

/**
 * One PLAYER: an account and every wallet of it the console saw (starl3xx, 2026-11-27: "players in
 * admin should also be grouped... like this is one player"). Its fields are the wallets' added up,
 * so the funnel and the "new" counts read players, never wallets.
 */
export interface PlayerGroup extends Omit<PlayerRow, "account" | "fid"> {
  /** The account (its first wallet), lowercase. */
  address: string;
  /**
   * Its wallets: the account first, then the most recently seen, then linked wallets the console
   * never saw (a Farcaster-verified wallet joins without connecting), whose `lastSeen` is null.
   */
  wallets: { address: string; lastSeen: string | null }[];
  /** Farcaster ids the game saw at a verified sign-in, on any of its wallets. */
  fids: number[];
  /** How many of its wallets the game saw connect: past one, `sighting.days` is a floor (the busiest wallet's days). */
  seenWallets: number;
}

/** Rows that count in the funnel: a wallet row or a player. */
type Counted = Omit<PlayerRow, "account" | "fid">;

/**
 * `walletsOf` is the link table's answer (lib/db/walletLinks.ts), when it could be read: it adds the
 * account's wallets that left no trace. This is the ONE grouping: the "Reminders and accounts"
 * section is built from its output (lib/admin/playerReach.ts), so the two tables can't disagree.
 */
export function groupPlayers(rows: readonly PlayerRow[], walletsOf?: (account: string) => string[]): PlayerGroup[] {
  // A wallet with a row of its own belongs where its row says: never listed under a second player.
  const rowAccount = new Map(rows.map((r) => [r.address, r.account ?? r.address]));
  const byAccount = new Map<string, PlayerRow[]>();
  for (const r of rows) {
    const account = r.account ?? r.address;
    byAccount.set(account, [...(byAccount.get(account) ?? []), r]);
  }
  const out: PlayerGroup[] = [];
  for (const [account, list] of byAccount) {
    const sorted = [...list].sort(
      (a, b) => Number(b.address === account) - Number(a.address === account) || (b.lastSeen ?? "").localeCompare(a.lastSeen ?? ""),
    );
    const head = sorted[0];
    const named = sorted.find((r) => r.name) ?? head;
    const sum = (f: (r: PlayerRow) => number) => list.reduce((n, r) => n + f(r), 0);
    const min = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x).sort()[0] ?? null;
    const max = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x).sort().at(-1) ?? null;
    const seen = list.filter((r) => r.sighting);
    const firstSighting = [...seen].sort((a, b) => a.sighting!.first.localeCompare(b.sighting!.first))[0];
    const lastSighting = [...seen].sort((a, b) => b.sighting!.last.localeCompare(a.sighting!.last))[0];
    const onchain = list.filter((r) => r.onchain);
    out.push({
      address: account,
      wallets: [
        ...(sorted[0].address === account ? [] : [{ address: account, lastSeen: null }]),
        ...sorted.map((r) => ({ address: r.address, lastSeen: r.lastSeen })),
        ...(walletsOf?.(account) ?? [])
          .map((w) => w.toLowerCase())
          .filter((w) => w !== account && !list.some((r) => r.address === w) && !rowAccount.has(w))
          .map((w) => ({ address: w, lastSeen: null })),
      ],
      name: named.name,
      pfpUrl: named.pfpUrl,
      nameSource: named.nameSource,
      operator: list.some((r) => r.operator),
      fids: [...new Set(list.map((r) => r.fid).filter((f): f is number => f != null))].sort((a, b) => a - b),
      seenWallets: seen.length,
      firstSeen: min(list.map((r) => r.firstSeen)),
      lastSeen: max(list.map((r) => r.lastSeen)),
      // Days are counted per wallet: the player's busiest wallet is a floor, never a sum (one day, two wallets).
      sighting: firstSighting
        ? {
            first: firstSighting.sighting!.first,
            last: lastSighting.sighting!.last,
            days: Math.max(...seen.map((r) => r.sighting!.days)),
            firstVia: firstSighting.sighting!.firstVia,
            lastVia: lastSighting.sighting!.lastVia,
          }
        : null,
      onchain: onchain.length ? { first: min(onchain.map((r) => r.onchain!.first))!, last: max(onchain.map((r) => r.onchain!.last))! } : null,
      faucet: sum((r) => r.faucet),
      packs: sum((r) => r.packs),
      dailies: sum((r) => r.dailies),
      waiting: sum((r) => r.waiting),
      claims: sum((r) => r.claims),
      rolls: sum((r) => r.rolls),
      rollWins: sum((r) => r.rollWins),
      stakes: sum((r) => r.stakes),
      feeds: sum((r) => r.feeds),
      listings: sum((r) => r.listings),
      holds: {
        letters: sum((r) => r.holds.letters),
        upper: sum((r) => r.holds.upper),
        words: sum((r) => r.holds.words),
        staked: sum((r) => r.holds.staked),
      },
      xUsername: named.xUsername ?? list.find((r) => r.xUsername)?.xUsername ?? null,
      emailConfirmed: list.some((r) => r.emailConfirmed),
      emailReminders: list.some((r) => r.emailReminders),
      pushBrowsers: sum((r) => r.pushBrowsers),
      telegram: list.some((r) => r.telegram),
    });
  }
  return out.sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "") || a.address.localeCompare(b.address));
}

/** How far players got, counting each row once (pass players, so linked wallets count once) and leaving the team out. */
export function funnelOf(rows: readonly Counted[]): Funnel {
  const t = rows.filter((r) => !r.operator);
  const n = (f: (r: Counted) => boolean) => t.filter(f).length;
  return {
    any: t.length,
    seen: n((r) => r.sighting !== null),
    faucet: n((r) => r.faucet > 0),
    letters: n((r) => r.packs + r.dailies > 0 || r.holds.letters > 0),
    words: n((r) => r.claims > 0 || r.holds.words > 0),
    rolls: n((r) => r.rolls > 0),
    staked: n((r) => r.stakes > 0 || r.holds.staked > 0),
    linkedX: n((r) => r.xUsername !== null),
    email: n((r) => r.emailConfirmed),
    reminders: n((r) => r.emailReminders || r.pushBrowsers > 0 || r.telegram),
    telegram: n((r) => r.telegram),
    listings: n((r) => r.listings > 0),
  };
}

/** New non-team rows (players, when given players) whose first trace falls in the last `ms` milliseconds. */
export function newSince(rows: readonly Counted[], now: number, ms: number): number {
  const from = now - ms;
  return rows.filter((r) => !r.operator && r.firstSeen && Date.parse(r.firstSeen) >= from).length;
}
