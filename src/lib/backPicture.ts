/**
 * What the back of a word's card says in a PICTURE (the share video's back, app/s/[text]/back;
 * decisions.md #48, part 5). The game's back speaks to the word's holder ("Yours since", "Earned so
 * far"). A picture travels to strangers, so it says the same things about the WORD, and nothing
 * about "you":
 *
 * - "Yours since" is "Held since", the day the word reached its holder's profile.
 * - "Earned so far" is left out: an amount a player earned is only ever shown from a signed record
 *   (the earnings share, decisions.md #38).
 * - "Staked" is left out: it changes from day to day, and a posted video stays.
 * - Everything else the game's back says is a fact about the word, and is here.
 *
 * Pure: every value is handed in, already read from the chain by the caller. A value that could
 * not be read is null, and its line is left out (never a dash: a picture can't be asked again).
 */
import { ascensionLabel, cardDate, caseLabel, wordPoints } from "./cardFacts";
import { fmtWord } from "./wordAmount";

export interface BackFacts {
  /** The word, UPPERCASE. */
  word: string;
  /** Each letter's case, as the card shows it. */
  upper: readonly boolean[];
  /** Its ascension stage, or null when it couldn't be read. */
  level: number | null;
  /** Who first found it ("@name" or a short address), or null. */
  finder: string | null;
  /** When it reached its holder's profile (unix seconds), or null. */
  since: number | null;
  /** About what it earns a day staked and fed; "upper" when it can't earn until it is UPPERCASE; null when not known. */
  perDay: number | "upper" | null;
  /** About what it costs to make at today's prices, or null. */
  cost: number | null;
  /** Its draw number if the jackpot has drawn it, "never", or null when not known. */
  drawn: number | "never" | null;
  /** Its onchain id, shortened, or null where there is no chain. */
  token: string | null;
  /** The reserved set it was released in, or null (none, or not known). */
  set?: string | null;
}

/** The ledger's lines, in the game's order: a name, a value. */
export function backLedger(f: BackFacts): [string, string][] {
  const rows: [string, string][] = [["Case", caseLabel(f.upper)]];
  if (f.level !== null) rows.push(["Ascension", ascensionLabel(f.level)]);
  if (f.since !== null) rows.push(["Held since", cardDate(f.since)]);
  if (f.perDay !== null) rows.push(["Earns staked", f.perDay === "upper" ? "Once UPPERCASE" : `~${fmtWord(f.perDay)} a day`]);
  if (f.cost !== null && f.cost > 0) rows.push(["Cost to make", `~${fmtWord(f.cost)} $WORD`]);
  rows.push(["Points", String(wordPoints(f.word))]);
  if (f.finder) rows.push(["Found by", f.finder]);
  return rows;
}

/** The longest a set's name runs on a back's bottom line, which is ONE line: the jackpot and the token come after it. */
export const FOOT_SET_MAX = 28;

/** A set's name as the bottom line shows it: whole, or cut with an ellipsis (a name may be 60 characters). */
export function footSetName(name: string): string {
  return name.length <= FOOT_SET_MAX ? name : `${name.slice(0, FOOT_SET_MAX - 1).trimEnd()}…`;
}

/** The line along the bottom: its set (a word released in a reserved set), the jackpot, then the token. */
export function backFoot(f: BackFacts): string[] {
  const parts: string[] = [];
  if (f.set) parts.push(`Set: ${footSetName(f.set)}`);
  if (f.drawn !== null) parts.push(f.drawn === "never" ? "Never drawn for the jackpot" : `Drawn for the jackpot (draw ${f.drawn})`);
  if (f.token) parts.push(f.token);
  return parts;
}
