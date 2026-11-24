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
  /** Open letter-swap listings made, per wallet. */
  listings: ReadonlyMap<string, number>;
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
}

export interface Funnel {
  /** Wallets with any trace at all (a sighting, an onchain action, a profile, a reminder). */
  any: number;
  /** Wallets the game saw connected (the unverified count; needs migration 0011). */
  seen: number;
  faucet: number;
  letters: number;
  words: number;
  rolls: number;
  staked: number;
  linkedX: number;
  email: number;
  reminders: number;
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
    });
  }
  // Most recent first; wallets with no time at all last.
  return rows.sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "") || a.address.localeCompare(b.address));
}

/** How far players got, counting each wallet once and leaving the team's own wallets out. */
export function funnelOf(rows: readonly PlayerRow[]): Funnel {
  const t = rows.filter((r) => !r.operator);
  const n = (f: (r: PlayerRow) => boolean) => t.filter(f).length;
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
    reminders: n((r) => r.emailReminders || r.pushBrowsers > 0),
    listings: n((r) => r.listings > 0),
  };
}

/** New non-team wallets whose first trace falls in the last `ms` milliseconds. */
export function newSince(rows: readonly PlayerRow[], now: number, ms: number): number {
  const from = now - ms;
  return rows.filter((r) => !r.operator && r.firstSeen && Date.parse(r.firstSeen) >= from).length;
}
