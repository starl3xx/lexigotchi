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
 *     a player Farcaster reaches doesn't hear it twice. **And by email** (`emailSold`), to a seller
 *     who confirmed an address and kept email on, whatever else reached them: they asked for it
 *     (the owner, 2026-11-26, once a player could choose kinds: decisions.md #47).
 *   - **It can't hurt its caller.** Nothing is loaded while both channels are dark; the senders are
 *     imported only here, inside a try (each THROWS at import when armed without its keys, which
 *     must never take the Market's public route down); and every failure is logged, not thrown.
 */
import type { SaleRow } from "@/lib/db/market";
import { letterLabel } from "@/lib/market/deals";
import { marketSold, soldFacts, type SoldItem } from "./templates";
import { emailNotes, notifyPlayers, pushChannels, pushNotes, reachableFid, type EmailDeps, type PlayerNote, type PushDeps } from "./players";

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
export function soldItem(r: Pick<SaleRow, "kind" | "word" | "letterId" | "qty" | "priceWei" | "txHash" | "logIndex"> & { feeWei?: string }): SoldItem {
  const word = r.kind === "word";
  return {
    kind: word ? "word" : "letter",
    name: word ? (r.word ?? "").toUpperCase() : letterLabel(r.letterId ?? 0),
    qty: r.qty,
    amount: Number(BigInt(r.priceWei) / WEI),
    ...(r.feeWei !== undefined ? { share: Number((BigInt(r.priceWei) - BigInt(r.feeWei)) / WEI) } : {}),
    txHash: r.txHash,
    logIndex: r.logIndex,
  };
}

/**
 * Whom to tell, and of what: the recent rows, grouped by the seller's ACCOUNT (its first wallet;
 * linked wallets are one player), oldest first inside a group. Pure, so the rules are tested.
 */
export function soldGroups(
  rows: readonly (Pick<SaleRow, "seller" | "buyer" | "soldAt" | "kind" | "word" | "letterId" | "qty" | "priceWei" | "txHash" | "logIndex"> & { feeWei?: string })[],
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

/** The messages for these sales: one per seller's account, with the email's ledger. */
export function soldNotes(rows: Parameters<typeof soldGroups>[0], accountOf: (address: string) => string, now: number): PlayerNote[] {
  return soldGroups(rows, accountOf, now).flatMap((g) => {
    const note = marketSold(g.items);
    return note ? [{ account: g.account, wallet: g.seller, note, facts: soldFacts(g.items) }] : [];
  });
}

/** The channels a sale's message can go by. The shared reading (./players.ts). */
export const soldChannels = pushChannels;
export { reachableFid };

export type SoldDeps = PushDeps;
export type SoldEmailDeps = EmailDeps & { accountOf: (address: string) => string };

export interface SoldResult {
  sellers: number;
  farcaster: number;
  browsers: number;
  /** Sellers no push channel reaches. */
  unreached: number;
  /** Sellers told by email. */
  emailed: number;
}

/** The pushes for these sales, over audiences already loaded (./players.ts `pushNotes`). */
export async function tellSold(rows: Parameters<typeof soldGroups>[0], deps: SoldDeps, opts: { now?: number; log?: (line: string) => void } = {}): Promise<SoldResult> {
  const { players, ...rest } = await pushNotes(soldNotes(rows, deps.accountOf, opts.now ?? Date.now()), deps, opts.log);
  return { sellers: players, ...rest };
}

/** The same receipt by email (./players.ts `emailNotes`): marked before it is sent, and not without a mark. */
export async function emailSold(rows: Parameters<typeof soldGroups>[0], deps: SoldEmailDeps, opts: { now?: number } = {}): Promise<{ sent: number; skipped: number }> {
  return emailNotes(soldNotes(rows, deps.accountOf, opts.now ?? Date.now()), deps);
}

/**
 * Tell the sellers of these newly recorded sales, on every channel they keep on (./players.ts
 * `notifyPlayers`). Never throws. Null when there was nothing to do or nothing armed to do it with.
 */
export async function notifySold(rows: readonly SaleRow[], opts: { log?: (line: string) => void } = {}): Promise<SoldResult | null> {
  const now = Date.now();
  // An old sale is never worth loading an audience for.
  if (!rows.some((r) => now - r.soldAt.getTime() <= SOLD_TELL_WINDOW_MS)) return null;
  const res = await notifyPlayers("sold", (accountOf) => soldNotes(rows, accountOf, now), opts);
  if (!res) return null;
  const { players, ...rest } = res;
  return { sellers: players, ...rest };
}
