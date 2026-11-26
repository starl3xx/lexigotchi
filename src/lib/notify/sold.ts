/**
 * Tell a seller that something of theirs sold on the Market (decisions.md #30 left it "not done":
 * the template existed, unwired). A RECEIPT: one per fill, soon after it happens.
 *
 * It hangs on the sales recorder (lib/db/market `recordNewSales`), which hands back a row only to
 * the one caller that inserted it. So however many servers read the same sale, its seller is told
 * once. Two callers have new rows to tell of: the Market's own sales route, which a buyer's browser
 * asks right after buying, and the keeper's daily pass, for a day nobody opened the Market (a dry
 * keeper run reads no sales at all: recording one is what uses up its seller's message).
 *
 * Five rules:
 *   - **Recent sales only** (`SOLD_TELL_WINDOW_MS`). The recorder also runs as a backfill (a new
 *     deployment's first read, a reset cursor), and a seller must never be told today about a sale
 *     from last week, let alone hundreds of them at once.
 *   - **One message per seller for the sales handed over together** (one transaction's, as the
 *     reader records it: a buyer who took three of a seller's listings in one send is one message;
 *     templates `marketSold`). A sale between two wallets of one account is no sale to tell of.
 *   - **Told as it is recorded.** A row is new only once, so the callers start the send the moment
 *     the reader hands the row over, never at the end of a pass that could be stopped first.
 *     What is left: a server stopped in the second between recording and sending loses that one
 *     message. Closing that needs a stored "told" mark per sale (a small table), not done here.
 *   - **Farcaster first, else the browsers,** as a jackpot win does (triggers `webPushWinnerSubs`):
 *     a player Farcaster reaches doesn't hear it twice. NOT by email: an email goes to players who
 *     agreed to three named reminders, and this would be a fourth (it waits for the owner's word).
 *   - **It can't hurt its caller.** Nothing is loaded while both channels are dark; the senders are
 *     imported only here, inside a try (each THROWS at import when armed without its keys, which
 *     must never take the Market's public route down); and every failure is logged, not thrown.
 */
import type { SaleRow } from "@/lib/db/market";
import { letterLabel } from "@/lib/market/deals";
import { marketSold, type Notification, type SoldItem } from "./templates";
import { webPushWinnerSubs, type FidLookup, type PushSub } from "./triggers";

/**
 * A sale older than this when it is first recorded is history, not news. WIDER than the longest gap
 * between passes, on purpose (the rule triggers.ts states for hunger, HUNGER_WARN_HOURS): the keeper
 * runs once a day, and a sale only it finds, on a day nobody opened the Market, is up to a day old
 * by then. A window under a day would record that sale and tell nobody, which is the one case the
 * keeper's pass exists for. Thirty hours leaves six for a late or slow run.
 */
export const SOLD_TELL_WINDOW_MS = 30 * 3_600_000;

const WEI = 10n ** 18n;
const lower = (a: string) => a.toLowerCase();

/** A recorded fill as the template reads it. */
export function soldItem(r: Pick<SaleRow, "kind" | "word" | "letterId" | "qty" | "priceWei" | "txHash" | "logIndex">): SoldItem {
  const word = r.kind === "word";
  return {
    kind: word ? "word" : "letter",
    name: word ? (r.word ?? "").toUpperCase() : letterLabel(r.letterId ?? 0),
    qty: r.qty,
    amount: Number(BigInt(r.priceWei) / WEI),
    txHash: r.txHash,
    logIndex: r.logIndex,
  };
}

/**
 * Whom to tell, and of what: the recent rows, grouped by the seller's ACCOUNT (its first wallet;
 * linked wallets are one player), oldest first inside a group. Pure, so the rules are tested.
 */
export function soldGroups(
  rows: readonly Pick<SaleRow, "seller" | "buyer" | "soldAt" | "kind" | "word" | "letterId" | "qty" | "priceWei" | "txHash" | "logIndex">[],
  accountOf: (address: string) => string,
  now: number,
): { seller: string; account: string; items: SoldItem[] }[] {
  const groups = new Map<string, { seller: string; account: string; items: SoldItem[] }>();
  const sorted = [...rows].sort((a, b) => a.soldAt.getTime() - b.soldAt.getTime() || a.logIndex - b.logIndex);
  for (const r of sorted) {
    if (now - r.soldAt.getTime() > SOLD_TELL_WINDOW_MS) continue;
    const account = lower(accountOf(r.seller));
    if (account === lower(accountOf(r.buyer))) continue; // the player moved it between their own wallets
    const g = groups.get(account) ?? { seller: lower(r.seller), account, items: [] };
    g.items.push(soldItem(r));
    groups.set(account, g);
  }
  return [...groups.values()];
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

/** Is either channel armed? Read here, never from the senders: importing those is what can throw. */
export function soldChannels(env: NodeJS.ProcessEnv = process.env): { farcaster: boolean; browser: boolean } {
  const prod = env.NODE_ENV === "production";
  return { farcaster: prod && env.NOTIFICATIONS_ENABLED === "true", browser: prod && env.WEB_PUSH_ENABLED === "true" };
}

export interface SoldDeps {
  /** Wallet → account. */
  accountOf: (address: string) => string;
  /** Wallet → a Farcaster id notifications reach, across the account. */
  fidOf: FidLookup;
  /** Does this account want to hear of a sale (lib/notify/kinds.ts)? Absent: everybody does. */
  wants?: (account: string) => boolean;
  /** Every stored browser. */
  subs: readonly (PushSub & { endpoint: string; p256dh: string; auth: string })[];
  toFarcaster: (fid: number, note: Notification) => Promise<{ ok: boolean; skipped?: string }>;
  toBrowsers: (subs: readonly { endpoint: string; p256dh: string; auth: string }[], note: Notification) => Promise<{ ok: boolean; skipped?: string }>;
}

export interface SoldResult {
  sellers: number;
  farcaster: number;
  browsers: number;
  /** Sellers no channel reaches. */
  unreached: number;
}

/** The sends, over audiences already loaded. Each seller's failure is its own. */
export async function tellSold(
  rows: Parameters<typeof soldGroups>[0],
  deps: SoldDeps,
  opts: { now?: number; log?: (line: string) => void } = {},
): Promise<SoldResult> {
  const log = opts.log ?? (() => {});
  const out: SoldResult = { sellers: 0, farcaster: 0, browsers: 0, unreached: 0 };
  for (const g of soldGroups(rows, deps.accountOf, opts.now ?? Date.now())) {
    if (deps.wants && !deps.wants(g.account)) continue; // the seller turned this kind off
    const note = marketSold(g.items);
    if (!note) continue;
    out.sellers++;
    try {
      const fid = deps.fidOf(g.seller);
      if (fid !== undefined) {
        if ((await deps.toFarcaster(fid, note)).ok) out.farcaster++;
        continue;
      }
      const subs = webPushWinnerSubs(g.seller, deps.subs, deps.fidOf, deps.accountOf);
      if (subs.length === 0) {
        out.unreached++;
        continue;
      }
      if ((await deps.toBrowsers(subs, note)).ok) out.browsers++;
    } catch (err) {
      log(`sold: telling one seller failed: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
    }
  }
  return out;
}

/**
 * Tell the sellers of these newly recorded sales. Never throws. Returns null when there was nothing
 * to do or nothing armed to do it with.
 */
export async function notifySold(rows: readonly SaleRow[], opts: { log?: (line: string) => void } = {}): Promise<SoldResult | null> {
  const log = opts.log ?? ((line: string) => console.log(line));
  try {
    const now = Date.now();
    if (!rows.some((r) => now - r.soldAt.getTime() <= SOLD_TELL_WINDOW_MS)) return null;
    const on = soldChannels();
    if (!on.farcaster && !on.browser) return null;

    const [{ loadLinkMap }, { notifiableFids }, { fidsByAddresses }, { allWebPushSubscriptions }, { loadPrefs }] = await Promise.all([
      import("@/lib/db/walletLinks"),
      import("@/lib/db/queries"),
      import("@/lib/neynar"),
      import("@/lib/db/webPush"),
      import("@/lib/db/reminderPrefs"),
    ]);
    const [links, prefs] = await Promise.all([loadLinkMap(), loadPrefs()]);
    // Choices that couldn't be read send nothing (loadPrefs has logged why): a seller may have turned this off.
    if (!prefs.known) return null;
    // Each audience is read only for a channel that is armed.
    // Farcaster reaches a seller through any wallet of their account. Only THESE sellers' wallets
    // are asked about (one cached request), never every player who added the app: this runs from
    // a public route, on any pass that finds a sale.
    const sellers = soldGroups(rows, links.accountOf, now).flatMap((g) => links.walletsOf(g.account));
    const [added, fidsOf] = on.farcaster
      ? await Promise.all([notifiableFids().then((f) => new Set(f)).catch(() => new Set<number>()), fidsByAddresses(sellers)])
      : [new Set<number>(), new Map<string, number[]>()];
    const subs = on.browser ? await allWebPushSubscriptions().catch(() => []) : [];
    const deps: SoldDeps = {
      accountOf: links.accountOf,
      wants: (account) => prefs.wants(account, "sold"),
      fidOf: reachableFid(links, fidsOf, added),
      subs,
      toFarcaster: async (fid, note) => (await import("./send")).sendNotification({ ...note, targetFids: [fid] }),
      toBrowsers: async (to, note) => (await import("./webPush")).sendWebPush(to, note),
    };
    const res = await tellSold(rows, deps, { now, log });
    log(`sold: ${res.sellers} seller(s): ${res.farcaster} told in Farcaster, ${res.browsers} in a browser, ${res.unreached} with no channel`);
    return res;
  } catch (err) {
    console.error("sold: telling sellers failed (the sales are recorded):", String((err as Error)?.message ?? err).slice(0, 200));
    return null;
  }
}
