/**
 * The beta group's daily recap: one post from @lexigotchi_bot after the day's jackpot draw
 * (`/api/cron/telegram-recap`). It says how the draw went and what the pot is now, names the words
 * made the day before, and on a week's first day names the new bounty theme.
 *
 *   📅 Daily recap
 *   ---------------
 *   The secret word was CRANE. Nobody held it staked and fed, so the jackpot rolled over: it is now 143.49M $WORD.
 *
 *   New words yesterday: OXBOW, STORE, and DOUGH.
 *
 * - **It waits for the draw.** With no draw for today there is no recap: the route skips, and tries
 *   once more two hours on. A late daily run is the operator's news (`/status` says it), not a post.
 * - **A fact that couldn't be read is left out,** never shown as zero or "none" (as the commands do:
 *   lib/telegramCommands). The draw itself is the one fact a recap can't go without.
 * - **Public game facts only,** sent with no parse mode: the heading is bold by an entity, so a
 *   player's name can't be read as formatting. A name is never written with an "@".
 * - **House copy rules** (tests/telegram-recap.test.ts): curly apostrophes, no em dashes.
 *
 * `recapPost` is a pure function of plain facts; `readRecap` reads them.
 */
import { fmtWord } from "./wordAmount";
import { DEFAULT_PARAMS } from "./params";
import { THEMES, themeForPeriod } from "./themes";
import { readClaimsBetween } from "./onchain/claims";
import { drawState, readJackpot, type LastDraw } from "./telegramCommands";

const DAY = 86_400;

export interface RecapFacts {
  /** Today's draw: the word (null when its reveal couldn't be matched) and who won, if anyone. */
  draw: LastDraw;
  /** The jackpot now, in whole $WORD, or null when unread. */
  pot: number | null;
  /** The words made the day before, oldest first, or null when unread. */
  made: string[] | null;
  /** The new week's bounty theme, on a week's first day; else null. */
  newTheme: string | null;
}

/**
 * The heading, in the update posts' own shape (.github/scripts/tester-note.mjs): a bold label over
 * a line of hyphens about as wide as it. 15 is that width in SF Pro, the font Telegram uses on
 * Apple devices (Roboto, on Android, is within one). Measure again if the label changes.
 */
const HEADING = { emoji: "📅", label: "Daily recap", rule: 15 };

/** How many new words are named before the rest are counted. */
const NAMED_MAX = 8;

/** "A", "A and B", "A, B, and C" (the Oxford comma, the house style). */
function listed(items: readonly string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function drawLine(draw: LastDraw, pot: number | null): string {
  if (draw.winner) {
    const won = `${draw.winner.name} held ${draw.word ?? "the secret word"} and won the jackpot: ${fmtWord(draw.winner.amount)} $WORD.`;
    return pot === null ? won : `${won} The next one starts at ${fmtWord(pot)} $WORD.`;
  }
  const rolled = `${draw.word ? `The secret word was ${draw.word}. Nobody held it` : "Nobody held the secret word"} staked and awake, so the jackpot rolled over`;
  return pot === null ? `${rolled}.` : `${rolled}: it is now ${fmtWord(pot)} $WORD.`;
}

function madeLine(made: readonly string[]): string {
  if (made.length === 1) return `New word yesterday: ${made[0]}.`;
  if (made.length <= NAMED_MAX) return `New words yesterday: ${listed(made)}.`;
  return `New words yesterday: ${made.slice(0, NAMED_MAX).join(", ")}, and ${made.length - NAMED_MAX} more.`;
}

/** The post: its text, and where its heading's label sits, to be set in bold. */
export function recapPost(f: RecapFacts): { text: string; bold: { offset: number; length: number }[] } {
  const head = `${HEADING.emoji} `;
  const lines = [drawLine(f.draw, f.pot)];
  if (f.made?.length) lines.push(madeLine(f.made));
  if (f.newTheme) lines.push(`A new bounty week starts today. The theme: ${f.newTheme}.`);
  return {
    text: `${head}${HEADING.label}\n${"-".repeat(HEADING.rule)}\n${lines.join("\n\n")}`,
    bold: [{ offset: head.length, length: HEADING.label.length }],
  };
}

/** The new week's theme when `day` (UTC days since the epoch) opens a bounty week, else null. */
export function newThemeOn(day: number, periodDays: number = DEFAULT_PARAMS.bounty.periodDays): string | null {
  return day % periodDays === 0 ? THEMES[themeForPeriod(day / periodDays)].name : null;
}

/** The words made between `from` (inclusive) and `to` (exclusive), in chain seconds, oldest first, each once. Throws when unread. */
export async function readWordsMade(from: number, to: number): Promise<string[]> {
  return [...new Set((await readClaimsBetween(from, to)).map((c) => c.word))];
}

/**
 * Today's recap, or why there is none yet: "draw_unread" (the chain didn't say) or "draw_not_done"
 * (the daily run hasn't drawn today's word). `day` is the chain's UTC day, the recap's send-once mark.
 */
export async function readRecap(): Promise<{ ok: true; day: number; facts: RecapFacts } | { ok: false; why: "draw_unread" | "draw_not_done" }> {
  const { facts: jackpot, now } = await readJackpot();
  if (jackpot.lastDrawDay === null || jackpot.last === undefined) return { ok: false, why: "draw_unread" };
  if (!jackpot.last || drawState(now, jackpot.lastDrawDay).state !== "done") return { ok: false, why: "draw_not_done" };
  const day = Math.floor(now / DAY);
  const made = await readWordsMade((day - 1) * DAY, day * DAY).catch(() => null);
  return { ok: true, day, facts: { draw: jackpot.last, pot: jackpot.pot, made, newTheme: newThemeOn(day) } };
}
