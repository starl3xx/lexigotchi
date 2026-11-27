/**
 * Sharing "Your earnings" (starl3xx, 2026-11-25: "this 'Your earnings' thing should be sharable in
 * the same way words are... share to X, FC, download image"): a link with its own card, like a
 * word's (lib/showcase), at `/e/<token>`.
 *
 * **The numbers on the card are the server's, never the link's.** A word's card can be drawn from
 * its URL because the dictionary is the guard; an amount has no such guard, and a link that could
 * carry one would put any number on the game's card. So the earnings route signs a SNAPSHOT of what
 * it computed (lib/earningsShareToken.ts), and the token is all of the link that is trusted: the
 * card draws its amounts from the token alone, reads no chain and no database (X's crawler won't
 * wait), and stays the same picture for good, which is right for a post made on a given day.
 *
 * The rest of the link is cosmetic, as on `/s/`: which word's card lies beside the tag (`w`, any
 * dictionary word, in its case), its scene, and the sharer's clock offset for the payout's date.
 * An amount is printed beside that word only when the token itself names the word.
 *
 * No wallet, name, or handle is in the link or on the card. This file is pure (no secret), so the
 * game's screens build links and post text with it; the copy-rules test reads it.
 */
import type { SceneId } from "./scenes";
import { CARD_LOOK } from "./showcase";
import { SITE_URL, X_HANDLE } from "./site";
import { fmtUsdShort, fmtWord } from "./wordAmount";

/**
 * Raise when this picture's own look changes (the tag, the table's layout). lib/showcase CARD_LOOK says why.
 *
 * 2: the pictured word wears its gilding, the tag's figures are in the card's serif, and the tag
 *    says about what the total is worth (starl3xx, 2026-11-26; decisions.md #38, amended).
 */
export const EARNINGS_CARD_LOOK = 2;
/**
 * The `v` in the picture's address: this picture's look AND the word card's, which it draws too, so
 * a redrawn card starts these caches again as well.
 */
export const earningsCardV = () => `${EARNINGS_CARD_LOOK}.${CARD_LOOK}`;
/** A snapshot names this many of the player's top earning words. */
export const SNAPSHOT_WORDS = 5;
/**
 * 2 adds each named word's ascension stage and what the total was worth. A version 1 token still
 * reads: links are posted for good.
 */
const VERSION = 2;
/** The keeper pays at about 00:05 UTC on its day (vercel.json cron; components/game/earnings.ts). */
const PAYOUT_MINUTE_MS = 5 * 60_000;

/** What the server computed, in whole $WORD. */
export interface EarningsSnapshot {
  chainId: number;
  /** The latest UTC day a payout opened, or null when there hasn't been one. */
  latestDay: number | null;
  /** Everything earned, both streams (the sheet's big number). */
  total: number;
  /** What the latest payout brought. */
  latest: number;
  /** The top earning words, biggest first: the word (UPPERCASE) and all it has earned. */
  words: [word: string, total: number][];
  /**
   * Each named word's ascension stage when the snapshot was signed (0 to 5), in the words' order;
   * null where the chain didn't say in time. Absent on a version 1 token. The picture's gilding is
   * this and nothing else: the link can't claim one, and the picture reads no chain.
   */
  stages?: (number | null)[];
  /**
   * What `total` was worth when the snapshot was signed, in US cents, at a LIVE price
   * (lib/rewards/share `usdCentsOf`). Absent on a test network, without a live price, under one
   * cent, and on a version 1 token.
   */
  usdCents?: number;
}

const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));
const whole = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/** The snapshot as the token's payload: a compact array, base64url (ASCII only, so `btoa` is enough). */
export function encodeSnapshot(s: EarningsSnapshot): string {
  const words = s.words.slice(0, SNAPSHOT_WORDS);
  // A stage not known is -1 and no dollar figure is 0: the array stays numbers only.
  const stages = words.map((_, i) => s.stages?.[i] ?? -1);
  return b64url(JSON.stringify([VERSION, s.chainId, s.latestDay ?? 0, s.total, s.latest, words, stages, s.usdCents ?? 0]));
}

/** The payload back as a snapshot, or null for anything that isn't exactly one. Proves nothing: the signature does. */
export function decodeSnapshot(payload: string): EarningsSnapshot | null {
  let raw: unknown;
  try {
    raw = JSON.parse(unb64url(payload));
  } catch {
    return null;
  }
  // Version 1: six parts. Version 2: eight (the stages, the dollar figure). Nothing else.
  if (!Array.isArray(raw) || !((raw[0] === 1 && raw.length === 6) || (raw[0] === 2 && raw.length === 8))) return null;
  const [v, chainId, day, total, latest, words, stages, usdCents] = raw as unknown[];
  if (!whole(chainId) || !whole(day) || !whole(total) || !whole(latest)) return null;
  if (!Array.isArray(words) || words.length > SNAPSHOT_WORDS) return null;
  const list: [string, number][] = [];
  for (const w of words) {
    if (!Array.isArray(w) || w.length !== 2 || typeof w[0] !== "string" || !/^[A-Z]{5}$/.test(w[0]) || !whole(w[1])) return null;
    list.push([w[0], w[1]]);
  }
  const snapshot: EarningsSnapshot = { chainId, latestDay: day === 0 ? null : day, total, latest, words: list };
  if (v === 1) return snapshot;
  // A stage for every word, each -1 (not known) or 0 to 5; the dollar figure in whole cents, 0 for none.
  if (!Array.isArray(stages) || stages.length !== list.length || !stages.every((g) => Number.isInteger(g) && (g as number) >= -1 && (g as number) <= 5)) return null;
  if (!whole(usdCents)) return null;
  snapshot.stages = (stages as number[]).map((g) => (g < 0 ? null : g));
  if (usdCents > 0) snapshot.usdCents = usdCents;
  return snapshot;
}

// ── what the card and the post say ─────────────────────────────────────────────────────────────

/** Test $WORD is never passed off as the real token: the card and the post name it (the sheet does too). */
export const unitLabel = (testnet: boolean) => (testnet ? "test $WORD" : "$WORD");

/**
 * The sharer's clock, minutes EAST of UTC (the `tz` in the link; `-new Date().getTimezoneOffset()`).
 * Cosmetic and bounded: anything that isn't a real offset is UTC.
 */
export function parseTz(raw: string | null | undefined): number {
  if (!raw || !/^-?\d{1,3}$/.test(raw)) return 0;
  const n = Number(raw);
  return n >= -720 && n <= 840 ? n : 0;
}

/**
 * The payout's date, "Nov 25", on the SHARER's calendar. The card is kept for good, so it prints a
 * date, never "today"; and the payout is 00:05 UTC, which is the evening before in the Americas,
 * where a UTC date would read as tomorrow's (the sheet says "today" by the same local rule).
 */
export function payoutDateLabel(latestDay: number, tzMinutes = 0): string {
  const local = new Date(latestDay * 86_400_000 + PAYOUT_MINUTE_MS + tzMinutes * 60_000);
  return local.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** All the hero word has earned, when the SIGNED snapshot names it; otherwise nothing is said of it. */
export function heroEarned(s: EarningsSnapshot, hero: string | null | undefined): number | null {
  const found = hero ? s.words.find(([w]) => w === hero.toUpperCase()) : undefined;
  return found && found[1] > 0 ? found[1] : null;
}

/**
 * The hero word's ascension stage, when the SIGNED snapshot names the word and knows its stage;
 * otherwise null, and the word is drawn without gilding (as a word's own picture is when the chain
 * doesn't answer in time). A hero the token doesn't name gets no gilding, as it gets no amount: the
 * token names the account's top earners, and the game pictures the top earner the player HOLDS,
 * which is one of them unless five words since sold out-earned it.
 */
export function heroStage(s: EarningsSnapshot, hero: string | null | undefined): number | null {
  const i = hero ? s.words.findIndex(([w]) => w === hero.toUpperCase()) : -1;
  return i >= 0 ? (s.stages?.[i] ?? null) : null;
}

/**
 * "about $24.0K": what the total was worth when the snapshot was signed, or null. Never for test
 * $WORD (a dollar figure beside it made a tester expect their real $WORD to count: decisions.md
 * #46), and only from the token, which carries one only at a live price.
 */
export function aboutUsd(s: EarningsSnapshot, testnet: boolean): string | null {
  return !testnet && s.usdCents && s.usdCents > 0 ? `about ${fmtUsdShort(s.usdCents / 100)}` : null;
}

export interface EarningsCardText {
  kicker: string;
  amount: string;
  unit: string;
  /** "about $24.0K", or null (`aboutUsd`). */
  usd: string | null;
  /** "+180.5K on Nov 25", or null when the latest payout brought nothing (never "+0"). */
  latest: string | null;
  /** "CRANE has earned 96.3K": only for a word the snapshot names, and only when it isn't the whole total. */
  plate: string | null;
  /**
   * `latest` and `plate` as the tag's ledger, a name and a value each: ["Nov 25", "+180.5K"],
   * ["CRANE", "96.3K"]. The picture sets a name in Söhne and a value in the card's serif, as the
   * card's back does (decisions.md #35); a word is a name, so it is never in the serif.
   */
  ledger: [name: string, value: string][];
}

/** Every word on the card. The words lead ("My words have earned"), as docs/messaging.md asks. */
export function earningsCardText(s: EarningsSnapshot, o: { testnet: boolean; tz?: number; hero?: string | null }): EarningsCardText {
  const mine = heroEarned(s, o.hero);
  const date = s.latest > 0 && s.latestDay !== null ? payoutDateLabel(s.latestDay, o.tz ?? 0) : null;
  const shown = mine !== null && mine < s.total ? o.hero!.toUpperCase() : null;
  return {
    kicker: "My words have earned",
    amount: fmtWord(s.total),
    unit: unitLabel(o.testnet),
    usd: aboutUsd(s, o.testnet),
    latest: date ? `+${fmtWord(s.latest)} on ${date}` : null,
    plate: shown ? `${shown} has earned ${fmtWord(mine!)}` : null,
    ledger: [...(date ? [[date, `+${fmtWord(s.latest)}`] as [string, string]] : []), ...(shown ? [[shown, fmtWord(mine!)] as [string, string]] : [])],
  };
}

/**
 * The post's words. They lead with the word, never with the earning. On X they name the game's
 * account; a cast says "Lexigotchi" ("@lexigotchi" on Farcaster is someone else).
 */
export function earningsPostText(s: EarningsSnapshot, o: { testnet: boolean; hero?: string | null; on: "x" | "fc" }): string {
  const game = o.on === "x" ? `@${X_HANDLE}` : "Lexigotchi";
  const amount = `${fmtWord(s.total)} ${unitLabel(o.testnet)}`;
  const mine = heroEarned(s, o.hero);
  const hero = o.hero?.toUpperCase();
  if (mine !== null && s.words.length === 1 && mine === s.total) return `${hero} has earned ${amount} in ${game} ✨`;
  if (mine !== null && s.words.length > 1) return `${hero} and my other words have earned ${amount} in ${game} ✨`;
  return `My words have earned ${amount} in ${game} ✨`;
}

// ── the link ───────────────────────────────────────────────────────────────────────────────────

export interface EarningsShareLook {
  /** The word whose card lies beside the tag, as a showcase text (its case is each tile's case). */
  hero?: string;
  scene?: SceneId;
  /** Minutes east of UTC (parseTz). */
  tz?: number;
}

function query(look: EarningsShareLook, more: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  if (look.hero) q.set("w", look.hero);
  // Always named: a link with no scene means the Stage (lib/scenes LINK_DEFAULT_SCENE), which is not where a word starts.
  if (look.scene) q.set("scene", look.scene);
  if (look.tz) q.set("tz", String(look.tz));
  for (const [k, v] of Object.entries(more)) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** The page a post links to (`/e/<token>`): its og:image is this snapshot's card. */
export function earningsShareUrl(token: string, look: EarningsShareLook = {}): string {
  return `${SITE_URL}/e/${token}${query(look)}`;
}

/**
 * The card picture, on this site (Save image reads it same-origin). X: 1200×630. Farcaster:
 * 1200×800 (the embed spec's 3:2). `wide` is the 16:9 picture that travels alone (1200×675), and
 * `saved` adds the corner wordmark, as on a word's saved card.
 */
export function earningsCardPath(token: string, ratio: "x" | "fc" | "wide" = "x", look: EarningsShareLook = {}, saved = false): string {
  return `/e/${token}/card${query(look, {
    ...(ratio === "fc" ? { ratio: "3x2" } : ratio === "wide" ? { ratio: "16x9" } : {}),
    ...(saved ? { saved: "1" } : {}),
    v: earningsCardV(),
  })}`;
}

export function earningsCardUrl(token: string, ratio: "x" | "fc" | "wide" = "x", look: EarningsShareLook = {}): string {
  return `${SITE_URL}${earningsCardPath(token, ratio, look)}`;
}
