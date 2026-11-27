/**
 * The beta group's alert when someone makes a Mythic word (starl3xx, 2026-11-26: "would also be
 * cool to get notifications when mythic words are spelled"): a post from @lexigotchi_bot with the
 * word's card, within minutes of the claim (`/api/cron/telegram-alerts`, every five minutes).
 *
 *   💎 Mythic word
 *   ----------------
 *   ann just made OXBOW, one of the game’s 46 Mythic words.
 *
 * - **Only the rarest tier.** There are 46 Mythic words, so this can't become a feed. To alert on
 *   another tier, add it to `ALERT_TIERS`; the words below name whichever tier the word has.
 * - **Only a fresh claim** (`ALERT_WINDOW_S`): the post says "just". A claim older than the window
 *   (the check was down, or this is the first run after a deploy) is never announced late.
 * - **Public game facts only,** sent with no parse mode: the heading is bold by an entity, so a
 *   player's name can't be read as formatting. A name is never written with an "@".
 * - **House copy rules** (tests/telegram-alerts.test.ts): curly apostrophes, no em dashes.
 */
import type { Tier } from "./economy";
import { tierCountsWith, tierWith, type CollabWords } from "./rarity";
import { showcaseCardUrl, showcaseWordText } from "./showcase";
import { readClaimsBetween, type Claim } from "./onchain/claims";
import { readChainTime } from "./onchain/reads";

/** The tiers whose words are announced when made. */
export const ALERT_TIERS: readonly Tier[] = ["Mythic"];

/**
 * How old a claim may be and still be announced, in seconds. Wider than the check's cadence (five
 * minutes) several times over, so a run or two that fail lose nothing; narrow enough that "just"
 * stays true.
 */
export const ALERT_WINDOW_S = 30 * 60;

/** The most alerts one run posts: the rest are still fresh at the next run, five minutes on. */
export const ALERTS_PER_RUN = 3;

/**
 * The heading, in the update posts' own shape (.github/scripts/tester-note.mjs): a bold label over
 * a line of hyphens about as wide as it (16 in SF Pro for "💎 Mythic word"; measure again if a
 * label changes). The label is the word's own tier.
 */
const HEADING: Partial<Record<Tier, { emoji: string; rule: number }>> = { Mythic: { emoji: "💎", rule: 16 } };
const PLAIN_HEADING = { emoji: "💎", rule: 16 };

/** True for a claim worth an alert: a word of an alerted tier, as the game treats it (`collab`: lib/rarity.ts). */
export function isAlertWord(word: string, collab: CollabWords): boolean {
  return ALERT_TIERS.includes(tierWith(word, collab));
}

/**
 * The alert for one claim: its words (the photo's caption, or the message when the card can't be
 * drawn), where its heading's label sits, and the card's address, in the case the word was made in.
 */
export function alertPost(claim: Pick<Claim, "word" | "upper">, maker: string, collab: CollabWords): { text: string; bold: { offset: number; length: number }[]; photoUrl: string } {
  const tier = tierWith(claim.word, collab);
  const { emoji, rule } = HEADING[tier] ?? PLAIN_HEADING;
  const head = `${emoji} `;
  const label = `${tier} word`;
  return {
    text: `${head}${label}\n${"-".repeat(rule)}\n${maker} just made ${claim.word}, one of the game’s ${tierCountsWith(collab)[tier].toLocaleString("en-US")} ${tier} words.`,
    bold: [{ offset: head.length, length: label.length }],
    photoUrl: showcaseCardUrl(showcaseWordText(claim.word, claim.upper), "x", undefined, true),
  };
}

/** A claim's send-once mark: its own event, so a word made again after a dissolve is announced again. */
export function alertMark(claim: Pick<Claim, "transactionHash" | "logIndex">): string {
  return `${claim.transactionHash}:${claim.logIndex}`;
}

/** The fresh claims worth an alert, oldest first. Throws when the chain can't be read. */
export async function readAlertClaims(collab: CollabWords): Promise<Claim[]> {
  const now = await readChainTime();
  return (await readClaimsBetween(now - ALERT_WINDOW_S)).filter((c) => isAlertWord(c.word, collab));
}
