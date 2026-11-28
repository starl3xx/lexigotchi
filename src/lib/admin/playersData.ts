/**
 * Everything the Players tab shows, gathered on the server: every wallet the game has seen, from
 * the chain (each game action's event), the shared world (what each wallet holds now), and the
 * database (sightings, profiles, reminders, listings). Server-only; the route serves it behind the
 * admin gate (lib/admin/serverAuth.ts). The rows themselves are built by the pure playerRows.ts, and
 * the per-player "Reminders and accounts" by the pure playerReach.ts (each read there has its own
 * known-or-not state: a failed read is "?" in the tab, never "no").
 *
 * Like the world scan (lib/world.ts) this reads every event since deploy, so the route caches it for
 * a minute. Times come from the chain: each block's time is interpolated between the deploy block's
 * and the latest block's real timestamps, which is exact while Base keeps a constant block time and
 * costs two block reads instead of one per wallet.
 */
import { parseAbiItem } from "viem";
import { getPublicClient } from "@/lib/onchain/reads";
import { addressOf, allAddresses, deployBlock, isSuiteDeployed, roleAddresses, wordTokenAddress } from "@/lib/onchain/addresses";
import { NETWORK } from "@/lib/onchain/network";
import { scanWorld } from "@/lib/world";
import { isCampaignConfigured } from "@/lib/db/client";
import { allSightings } from "@/lib/db/sightings";
import { isMissingTable } from "@/lib/db/profiles";
import { addedMiniAppFids, farcasterUserCounts, listingCounts, profileFlags, pushBrowserCounts, reminderPrefRows } from "@/lib/db/adminReads";
import { linkMapFrom, loadLinkMapStrict, type LinkMap } from "@/lib/db/walletLinks";
import { fidsByAddressesDetailed } from "@/lib/neynar";
import { coinbaseVerifiedMany } from "@/lib/onchain/verifications";
import { playerFaces } from "@/lib/profile/faces";
import { chatMemberCount } from "@/lib/telegram";
import { allTelegramLinks } from "@/lib/db/telegramLinks";
import { serverKeys } from "./serverKeys";
import { emailSwitch, farcasterNotifySwitch, telegramRemindersSwitch, webPushSwitch } from "./switches";
import { buildReachRows, reachSummary, type ReachRow, type ReachSummary } from "./playerReach";
import {
  buildPlayerRows,
  emptyActivity,
  funnelOf,
  groupPlayers,
  newSince,
  type ChainActivity,
  type Funnel,
  type Holdings,
  type PlayerGroup,
  type ProfileFlags,
  type SightingInput,
} from "./playerRows";

const ZERO = "0x0000000000000000000000000000000000000000";
const DAY_MS = 86_400_000;

const EV = {
  committed: parseAbiItem("event Committed(uint256 indexed commitId, address indexed buyer, uint8 count)"),
  revealed: parseAbiItem("event Revealed(uint256 indexed commitId, address indexed buyer, uint256[] letterIds)"),
  claimed: parseAbiItem("event Claimed(uint256 indexed tokenId, address indexed owner, string word, bool uppercase)"),
  rollCommitted: parseAbiItem(
    "event RollCommitted(uint256 indexed commitId, address indexed owner, uint8 letterIndex, uint8 kind, uint32 pity)",
  ),
  rollSucceeded: parseAbiItem("event RollSucceeded(uint256 indexed commitId, address indexed owner, uint8 letterIndex)"),
  staked: parseAbiItem("event Staked(uint256 indexed tokenId, address indexed staker)"),
  fed: parseAbiItem("event Fed(uint256 indexed tokenId, address indexed staker, uint64 at)"),
  transfer: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"),
};

export type SourceState = "ok" | "not_migrated" | "no_database" | "no_deployment" | "error";

export interface PlayersPayload {
  ok: true;
  at: number;
  network: { id: number; name: string; isTestnet: boolean };
  sources: { chain: SourceState; sightings: SourceState; database: SourceState; names: SourceState };
  /** Members of the beta Telegram group (bots and the operator included), or null. */
  telegram: { members: number | null };
  farcaster: { users: number; added: number } | null;
  /** Counted by player: linked wallets are one player. */
  funnel: Funnel;
  newPlayers: { day: number; week: number };
  /** Wallets seen, the team's left out. */
  wallets: number;
  /** One per player (lib/admin/playerRows.ts groupPlayers), the most recent first. */
  players: PlayerGroup[];
  /** Per player: linked accounts, reminder channels, and reminder choices (lib/admin/playerReach.ts). */
  reach: {
    rows: ReachRow[];
    summary: ReachSummary;
    /** What couldn't be read, in words, for the tab's banner: those facts show "?". */
    unread: string[];
    /** Whether each channel is switched on for everyone (lib/admin/switches.ts). */
    channelsOn: { farcaster: boolean; browser: boolean; email: boolean; telegram: boolean };
  };
}

/** A slow outside read (Neynar, a mainnet RPC) must not hold the tab: past `ms` it counts as unread. */
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}
const OUTSIDE_READ_MS = 8_000;

/** Each wallet's game actions since deploy, from the contracts' events. */
async function scanActivity(): Promise<Map<string, ChainActivity>> {
  const client = getPublicClient();
  const fromBlock = deployBlock();
  const toBlock = await client.getBlockNumber();
  const [first, last, letters, words, rolls, staking, faucet] = await Promise.all([
    client.getBlock({ blockNumber: fromBlock }),
    client.getBlock({ blockNumber: toBlock }),
    client.getLogs({ address: addressOf("letters"), events: [EV.committed, EV.revealed], fromBlock, toBlock }),
    client.getLogs({ address: addressOf("words"), event: EV.claimed, fromBlock, toBlock }),
    client.getLogs({ address: addressOf("rolls"), events: [EV.rollCommitted, EV.rollSucceeded], fromBlock, toBlock }),
    client.getLogs({ address: addressOf("staking"), events: [EV.staked, EV.fed], fromBlock, toBlock }),
    // The faucet exists only on testnet ($WORD there is a mock anyone can mint). On mainnet the token
    // is the real one, and scanning its every transfer since deploy would time out.
    NETWORK.isTestnet
      ? client.getLogs({ address: wordTokenAddress(), event: EV.transfer, args: { from: ZERO }, fromBlock, toBlock })
      : Promise.resolve([]),
  ]);

  const b0 = Number(fromBlock);
  const t0 = Number(first.timestamp) * 1000;
  const span = Number(toBlock) > b0 ? (Number(last.timestamp) * 1000 - t0) / (Number(toBlock) - b0) : 0;
  const timeOf = (bn: bigint | null) => Math.round(t0 + (Number(bn ?? fromBlock) - b0) * span);

  const out = new Map<string, ChainActivity>();
  const touch = (who: unknown, bn: bigint | null): ChainActivity | null => {
    if (typeof who !== "string") return null;
    const a = who.toLowerCase();
    const t = timeOf(bn);
    const cur = out.get(a) ?? emptyActivity(t);
    cur.first = Math.min(cur.first, t);
    cur.last = Math.max(cur.last, t);
    out.set(a, cur);
    return cur;
  };

  for (const l of letters) {
    if (l.eventName === "Committed") {
      const c = touch(l.args.buyer, l.blockNumber);
      if (c) {
        if (Number(l.args.count ?? 0) > 1) c.packs += 1;
        else c.dailies += 1;
      }
    } else {
      const c = touch(l.args.buyer, l.blockNumber);
      if (c) c.reveals += 1;
    }
  }
  for (const l of words) {
    const c = touch(l.args.owner, l.blockNumber);
    if (c) c.claims += 1;
  }
  for (const l of rolls) {
    const c = touch(l.args.owner, l.blockNumber);
    if (!c) continue;
    if (l.eventName === "RollCommitted") c.rolls += 1;
    else c.rollWins += 1;
  }
  for (const l of staking) {
    const c = touch(l.args.staker, l.blockNumber);
    if (!c) continue;
    if (l.eventName === "Staked") c.stakes += 1;
    else c.feeds += 1;
  }
  for (const l of faucet) {
    const c = touch(l.args.to, l.blockNumber);
    if (c) c.faucet += 1;
  }
  return out;
}

/**
 * The team's own wallets: the console's allowlist, TEAM_WALLETS (the team's other wallets, marked
 * without being let in), the registry's roles, and the server's keys.
 */
function operatorWallets(): Set<string> {
  const out = new Set<string>();
  for (const list of [process.env.NEXT_PUBLIC_ADMIN_WALLETS, process.env.TEAM_WALLETS])
    for (const a of (list ?? "").split(",")) if (a.trim()) out.add(a.trim().toLowerCase());
  for (const a of Object.values(roleAddresses())) out.add(a);
  for (const k of serverKeys()) if (k.address) out.add(k.address);
  return out;
}

export async function loadPlayers(): Promise<PlayersPayload> {
  const live = isSuiteDeployed();
  const db = isCampaignConfigured();
  const sources: PlayersPayload["sources"] = {
    chain: live ? "ok" : "no_deployment",
    sightings: db ? "ok" : "no_database",
    database: db ? "ok" : "no_database",
    names: "ok",
  };

  const chainP: Promise<[Map<string, ChainActivity>, Holdings]> = live
    ? Promise.all([scanActivity(), scanWorld()]).then(([a, w]) => [a, { letters: w.letters, words: w.words }] as [Map<string, ChainActivity>, Holdings])
    : Promise.resolve([new Map(), { letters: {}, words: [] }]);
  const chain = await chainP.catch((err) => {
    console.error("[admin/players] chain scan failed:", (err as Error).message?.slice(0, 200));
    sources.chain = "error";
    return [new Map(), { letters: {}, words: [] }] as [Map<string, ChainActivity>, Holdings];
  });

  let sightings: SightingInput[] = [];
  let profiles: ProfileFlags[] = [];
  let pushBrowsers = new Map<string, number>();
  let listings = new Map<string, number>();
  let farcaster: PlayersPayload["farcaster"] = null;
  let telegram = new Set<string>();
  // For the per-player section: which of these reads came back whole (a missing table counts: it's empty).
  let telegramKnown = false;
  let profilesKnown = false;
  let pushKnown = false;
  let links: LinkMap | null = null;
  let prefs: { account: string; kinds: unknown; emailCadence: unknown }[] | null = null;
  let addedFids: Set<number> | null = null;
  if (db) {
    // Who linked Telegram for reminders: whether, never which account. Empty before migration 0020.
    try {
      telegram = new Set((await allTelegramLinks()).map((l) => l.account.toLowerCase()));
      telegramKnown = true;
    } catch (err) {
      console.error("[admin/players] Telegram links unread:", (err as Error).message?.slice(0, 200));
    }
    // Linked wallets, reminder choices, and who added the mini app: each its own read, each may fail alone.
    const [l, pr, ad] = await Promise.allSettled([
      (async () => {
        try {
          return await loadLinkMapStrict();
        } catch (err) {
          if (isMissingTable(err)) return linkMapFrom([]); // before migration 0008: nobody linked a wallet
          throw err;
        }
      })(),
      reminderPrefRows(),
      addedMiniAppFids(),
    ]);
    if (l.status === "fulfilled") links = l.value;
    if (pr.status === "fulfilled") prefs = pr.value.value;
    if (ad.status === "fulfilled") addedFids = new Set(ad.value.value);
    for (const [what, r] of [["wallet links", l], ["reminder choices", pr], ["mini app adds", ad]] as const)
      if (r.status === "rejected") console.error(`[admin/players] ${what} unread:`, String((r.reason as Error)?.message ?? r.reason).slice(0, 200));
    try {
      sightings = (await allSightings()).map((s) => ({
        address: s.address,
        firstSeenAt: s.firstSeenAt.getTime(),
        lastSeenAt: s.lastSeenAt.getTime(),
        daysSeen: s.daysSeen,
        firstVia: s.firstVia,
        lastVia: s.lastVia,
        fid: s.fid,
      }));
    } catch (err) {
      sources.sightings = isMissingTable(err) ? "not_migrated" : "error";
    }
    try {
      const [p, push, lst, fc] = await Promise.all([profileFlags(), pushBrowserCounts(), listingCounts(), farcasterUserCounts()]);
      profiles = p.value;
      pushBrowsers = push.value;
      profilesKnown = true;
      pushKnown = true;
      listings = lst.value;
      farcaster = fc.missing ? null : fc.value;
      if (p.missing || push.missing || lst.missing) sources.database = "not_migrated";
    } catch (err) {
      console.error("[admin/players] database read failed:", (err as Error).message?.slice(0, 200));
      sources.database = "error";
    }
  }

  const [activity, holdings] = chain;
  const contracts = new Set<string>(live ? [...Object.values(allAddresses()), wordTokenAddress()].map((a) => a.toLowerCase()) : []);
  contracts.add(ZERO);

  // Everyone who might be a row, for the account and name lookups.
  const addresses = [
    ...new Set([
      ...sightings.map((s) => s.address),
      ...activity.keys(),
      ...profiles.map((p) => p.address),
      ...pushBrowsers.keys(),
      ...listings.keys(),
      ...Object.keys(holdings.letters),
      ...holdings.words.map((w) => w.owner),
    ].map((a) => a.toLowerCase())),
  ].filter((a) => !contracts.has(a));

  // Linked wallets (migration 0008) and public names, resolved the way the game resolves them
  // (lib/profile/faces.ts). Neither may fail the tab.
  let accountFor = new Map<string, string>();
  let faces: Record<string, { username: string; pfpUrl: string | null; source?: string }> = {};
  // Every wallet of every player (their linked wallets too), for Farcaster ids and Coinbase checks.
  const everyWallet = [...new Set(addresses.flatMap((a) => (links ? links.walletsOf(links.accountOf(a)) : [a])).map((a) => a.toLowerCase()))].filter(
    (a) => !contracts.has(a),
  );
  const [facesRead, fidsRead, coinbaseRead] = await Promise.allSettled([
    playerFaces(addresses),
    within(fidsByAddressesDetailed(everyWallet), OUTSIDE_READ_MS),
    within(coinbaseVerifiedMany(everyWallet), OUTSIDE_READ_MS),
  ]);
  if (facesRead.status === "fulfilled") {
    accountFor = facesRead.value.accountFor;
    faces = facesRead.value.profiles;
  } else {
    sources.names = "error";
  }
  const fids = fidsRead.status === "fulfilled" ? fidsRead.value : { fids: new Map<string, number[]>(), answered: false };
  if (coinbaseRead.status === "rejected") console.error("[admin/players] Coinbase checks unread:", String((coinbaseRead.reason as Error)?.message ?? coinbaseRead.reason).slice(0, 200));

  const rows = buildPlayerRows({
    operators: operatorWallets(),
    contracts,
    sightings,
    chain: activity,
    holdings,
    profiles,
    pushBrowsers,
    listings,
    telegram,
    // The link table read strictly, when it could be read: the same answer groupPlayers lists wallets
    // by. The names' lookup is only the fallback, since it reads a failure as "no links" silently.
    accountOf: (a) => (links ? links.accountOf(a) : (accountFor.get(a.toLowerCase()) ?? a.toLowerCase())),
    faces,
  });
  // One grouping for both tables (lib/admin/playerRows.ts groupPlayers): the reminders are built from it.
  const players = groupPlayers(rows, links ? (account) => links!.walletsOf(account) : undefined);
  const reachRows = buildReachRows({
    players,
    profiles: profilesKnown ? profiles : null,
    pushBrowsers: pushKnown ? pushBrowsers : null,
    telegram: telegramKnown ? telegram : null,
    prefs,
    farcaster: { fidsOf: fids.fids, answered: fids.answered },
    addedFids,
    coinbase: coinbaseRead.status === "fulfilled" ? coinbaseRead.value : null,
  });
  const unread = [
    !db && "the database (DATABASE_URL unset)",
    db && !profilesKnown && "X and email",
    db && !pushKnown && "browser push",
    db && !telegramKnown && "Telegram",
    db && !links && "linked wallets",
    db && !prefs && "reminder choices",
    db && !addedFids && "who added the mini app",
    !fids.answered && "Farcaster ids (Neynar)",
    coinbaseRead.status === "rejected" && "Coinbase verification",
  ].filter((x): x is string => typeof x === "string");

  const now = Date.now();
  return {
    ok: true,
    at: now,
    network: { id: NETWORK.id, name: NETWORK.name, isTestnet: NETWORK.isTestnet },
    sources,
    telegram: { members: await chatMemberCount() },
    farcaster,
    funnel: funnelOf(players),
    newPlayers: { day: newSince(players, now, DAY_MS), week: newSince(players, now, 7 * DAY_MS) },
    wallets: rows.filter((r) => !r.operator).length,
    players,
    reach: {
      rows: reachRows,
      summary: reachSummary(reachRows),
      unread,
      channelsOn: {
        farcaster: farcasterNotifySwitch().on,
        browser: webPushSwitch().on,
        email: emailSwitch().on,
        telegram: telegramRemindersSwitch().on,
      },
    },
  };
}
