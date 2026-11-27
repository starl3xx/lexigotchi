/**
 * What @lexigotchi_bot answers to a command (lib/telegram `commandOf`), in the beta testers' group
 * or in a private chat with the bot: `/help`, `/status`, `/jackpot`, `/bounty`, and `/word CRANE`.
 *
 * - **The list is `config/telegram-commands.json`,** in the shape Telegram's `setMyCommands` takes:
 *   the "Telegram webhook" workflow sends that same file, so the "/" menu and `/help` can't
 *   disagree. A command added here without a line there answers, but isn't offered.
 * - **Public game facts only:** what the chain says, and a player's public name. `/status` says
 *   whether the game is up and the daily draw has run, and never what the operator console's System
 *   tab shows (keys, switches: lib/admin/systemStatus is behind the admin gate for a reason).
 * - **A fact that couldn't be read is left out, or said to be unknown,** never shown as zero or
 *   "nobody". Every read has a short wait (`soon`), so one slow read can't hold the answer.
 * - **Answers go out as typed** (lib/telegram `sendMessage` sets no parse mode), so a player's name
 *   can't be read as formatting. A name is never written with an "@": in Telegram that would
 *   mention whoever has that username there, who is someone else.
 * - **House copy rules** (tests/telegram-commands.test.ts holds them): curly apostrophes, no em
 *   dashes, "onchain".
 *
 * The words are pure functions of plain facts (`statusText`, `jackpotText`, `bountyText`,
 * `wordText`), tested without a chain; `answer` reads the facts and picks the words.
 */
import { getAbiItem } from "viem";
import commands from "../../config/telegram-commands.json";
import { isWord } from "./dictionary";
import { wordTier, type Tier } from "./economy";
import { cardNumber, tierCount } from "./cardFacts";
import { stageName } from "./ascension";
import { fmtWord } from "./wordAmount";
import { DEFAULT_PARAMS } from "./params";
import { THEMES, themeForPeriod } from "./themes";
import { showcaseCardUrl, showcaseWordText } from "./showcase";
import { NETWORK } from "./onchain/network";
import { isChainBacked } from "./onchain/gameMode";
import { addressOf, deployBlock } from "./onchain/addresses";
import { getPublicClient, readChainTime, readFeeBuckets, toWholeWord } from "./onchain/reads";
import { answerChainAbi, jackpotAbi, stakingAbi, wordsAbi } from "./onchain/abis";
import { tokenIdOf } from "./onchain/tokenId";
import { cardNumberSoon } from "./onchain/cardNumbers";
import { playerFaces } from "./profile/faces";
import { isHeldBack } from "./sets/server";

/** An answer: its words, and for a word that is held, its card's picture to send them under. */
export interface BotReply {
  text: string;
  photoUrl?: string;
}

const DAY = 86_400;
const ZERO = "0x0000000000000000000000000000000000000000";
/** How long any one read may take before the answer goes without it. */
const READ_WAIT_MS = 8_000;

/** A read that answers within `ms`, or null: nothing here throws, and nothing holds the answer up. */
function soon<T>(read: Promise<T>, ms = READ_WAIT_MS): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([read.catch(() => null), late]).finally(() => clearTimeout(timer));
}

/** A length of time in words, largest two units: "2 days 4 h", "3 h 12 min", "12 min". */
export function spanText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / DAY);
  const h = Math.floor((s % DAY) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} ${d === 1 ? "day" : "days"}${h > 0 ? ` ${h} h` : ""}`;
  if (h > 0) return `${h} h${m > 0 ? ` ${m} min` : ""}`;
  return m > 0 ? `${m} min` : "less than a minute";
}

/** A wallet as a player reads it when it has no name: "0x12ab…cdef". */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// ── /help ────────────────────────────────────────────────────────────────────────────────────────

export const COMMANDS: readonly { command: string; description: string }[] = commands;

export function helpText(): string {
  return ["Here’s what I can do:", ...COMMANDS.filter((c) => c.command !== "help").map((c) => `/${c.command}: ${c.description}`)].join("\n");
}

// ── /status ──────────────────────────────────────────────────────────────────────────────────────

export interface StatusFacts {
  network: string;
  testnet: boolean;
  /** False in practice mode: no contracts on this network, or the brake is on. */
  chainBacked: boolean;
  /** The chain's clock in seconds, or null when the chain didn't answer. */
  chainTime: number | null;
  /** The UTC day of the last jackpot draw (0: there has never been one), or null when unread. */
  lastDrawDay: number | null;
}

/** How long after midnight UTC the daily run (00:05) may take before "due any minute" becomes "behind". */
const DRAW_GRACE_S = 20 * 60;

/**
 * Where the daily draw stands, from the chain's clock and the jackpot's last resolved day (a draw
 * can only happen for the current UTC day, so "done" is the two being equal; 0 is "never"). One rule
 * for /status and /jackpot, so the two can't disagree in the minutes after midnight.
 */
export function drawState(chainTime: number, lastDrawDay: number): { state: "never" | "done" | "due" | "behind"; behind: number } {
  const behind = Math.floor(chainTime / DAY) - lastDrawDay;
  if (lastDrawDay === 0) return { state: "never", behind: 0 };
  if (behind <= 0) return { state: "done", behind: 0 };
  return { state: behind === 1 && chainTime % DAY < DRAW_GRACE_S ? "due" : "behind", behind };
}

export function statusText(f: StatusFacts): string {
  if (!f.chainBacked) return "Lexigotchi is in practice mode here: nothing is onchain yet.";
  const lines = [`Lexigotchi is running on ${f.network}${f.testnet ? " (a test network)" : ""}.`];
  if (f.chainTime === null) {
    lines.push("I can’t reach the chain right now, so the game may be slow or stuck.");
    return lines.join("\n");
  }
  lines.push("The chain is answering.");
  if (f.lastDrawDay === null) return lines.join("\n");
  const { state, behind } = drawState(f.chainTime, f.lastDrawDay);
  if (state === "never") lines.push("The jackpot hasn’t had its first draw yet.");
  else if (state === "done") lines.push("Today’s jackpot draw is done.");
  else if (state === "due") lines.push("Today’s jackpot draw is due any minute.");
  else lines.push(`The daily run is behind: the last jackpot draw was ${behind} ${behind === 1 ? "day" : "days"} ago.`);
  return lines.join("\n");
}

// ── /jackpot ─────────────────────────────────────────────────────────────────────────────────────

/** The last day's draw. The word is null when its reveal couldn't be matched to the draw. */
export interface LastDraw {
  word: string | null;
  /** Null when nobody held the word staked and fed: the pot rolled over. */
  winner: { name: string; amount: number } | null;
}

export interface JackpotFacts {
  /** Whole $WORD, or null when unread. */
  pot: number | null;
  /** Null: there has never been a draw. Undefined: unread. */
  last: LastDraw | null | undefined;
  /** The UTC day of the last draw, as /status reads it (0: never), or null when unread. */
  lastDrawDay: number | null;
}

/** `nowSeconds` is the chain's clock where it could be read, else this server's. */
export function jackpotText(f: JackpotFacts, nowSeconds: number): string {
  const lines = [f.pot === null ? "I can’t read the pot right now." : `The jackpot is ${fmtWord(f.pot)} $WORD.`];
  // After midnight and before the day's draw, the next word is today's, not tomorrow's.
  const draw = f.lastDrawDay === null ? null : drawState(nowSeconds, f.lastDrawDay).state;
  if (draw === "due") lines.push("Today’s secret word is due any minute.");
  else if (draw === "behind") lines.push("Today’s draw is late: the daily run is behind.");
  else lines.push(`The next secret word is revealed just after midnight UTC, in about ${spanText(DAY - (nowSeconds % DAY))}.`);
  if (f.last === null) lines.push("There hasn’t been a draw yet.");
  else if (f.last) {
    const word = f.last.word ? `Last draw: ${f.last.word}. ` : "Last draw: ";
    if (f.last.winner) lines.push(`${word}${f.last.winner.name} held ${f.last.word ? "it" : "the word"} and won ${fmtWord(f.last.winner.amount)} $WORD.`);
    else lines.push(`${word}${f.last.word ? "Nobody held it" : "nobody held the word"} staked and fed, so the pot rolled over.`);
  }
  lines.push("Every word you keep staked and fed is in the running.");
  return lines.join("\n");
}

// ── /bounty ──────────────────────────────────────────────────────────────────────────────────────

export function bountyText(pot: number | null, nowSeconds: number): string {
  const periodDays = DEFAULT_PARAMS.bounty.periodDays;
  const period = Math.floor(Math.floor(nowSeconds / DAY) / periodDays);
  const ends = (period + 1) * periodDays * DAY;
  const lines = [`This week’s bounty theme: ${THEMES[themeForPeriod(period)].name}.`];
  if (pot !== null) lines.push(`The pool is ${fmtWord(pot)} $WORD.`);
  lines.push(`The week ends in ${spanText(ends - nowSeconds)}. Every matching word that is staked and not hungry then shares the pool.`);
  return lines.join("\n");
}

// ── /word ────────────────────────────────────────────────────────────────────────────────────────

export interface HeldWord {
  /** The beneficial owner (the staker of a staked word), as shown: a public name or a short address. */
  holder: string;
  staked: boolean;
  /** Each letter's case, by position, or null when unread. */
  upper: boolean[] | null;
  /** Its ascension stage (0: not ascended), or null when unread. */
  level: number | null;
  /** Whole days since it was last fed, or null when unread. Only a staked word gets hungry. */
  daysUnfed: number | null;
  /** Its card number, or null when unknown. */
  number: number | null;
}

/** The word a `/word` names: "ok" with the dictionary word, or why not. */
export function parseWordArg(args: string): { kind: "none" } | { kind: "unknown"; shown: string | null } | { kind: "ok"; word: string } {
  const first = args.trim().split(/\s+/)[0] ?? "";
  if (!first) return { kind: "none" };
  const letters = /^[A-Za-z]{1,12}$/.test(first);
  const word = first.toUpperCase();
  // Only plain letters are ever written back: nothing else a person typed is repeated to the group.
  if (!letters || !isWord(word)) return { kind: "unknown", shown: letters ? word : null };
  return { kind: "ok", word };
}

/** Its rarity, as the cards count it: "CRANE is one of 229 Rare words." */
function tierLine(word: string, tier: Tier): string {
  return `${word} is one of ${tierCount(tier).toLocaleString("en-US")} ${tier} words.`;
}

/**
 * `held`: the word's holder and state; null when nobody holds it; undefined when the chain couldn't
 * be read (or in practice mode, where there is no chain to read: `chainBacked` false).
 */
export function wordText(word: string, held: HeldWord | null | undefined, chainBacked = true, notYet = false): string {
  const lines = [tierLine(word, wordTier(word))];
  if (!chainBacked) return lines[0];
  if (held === undefined) return [...lines, "I can’t read the chain right now, so I don’t know who holds it."].join("\n");
  // `notYet`: held back in a reserved set (decisions.md, "Reserved word sets"). A plain "not yet",
  // and never which set or when.
  if (held === null) return [...lines, notYet ? "It isn’t available yet." : "Nobody holds it right now."].join("\n");
  lines.push(`${held.holder} holds it, ${held.staked ? "staked" : "not staked"}.`);
  if (held.upper) {
    const raised = held.upper.filter(Boolean).length;
    if (raised === 0) lines.push("Its letters are all lowercase.");
    else if (raised === held.upper.length) lines.push("All of its letters are UPPERCASE.");
    else lines.push(`${raised} of its ${held.upper.length} letters are UPPERCASE.`);
  }
  if (held.level) lines.push(`It has ascended to ${stageName(held.level)}.`);
  if (held.staked && held.daysUnfed !== null) {
    const care = DEFAULT_PARAMS.care;
    // Only a word whose every letter is UPPERCASE earns, so only that one is told what hunger does
    // to its earnings. Any staked word is in the jackpot until it is hungry.
    const earns = held.upper !== null && held.upper.every(Boolean);
    if (held.daysUnfed >= care.hungryAfterDays) lines.push(`It is hungry: it ${earns ? "earns nothing and " : ""}sits out the jackpot until it is fed.`);
    else if (held.daysUnfed >= care.peckishAfterDays) lines.push(earns ? "It is peckish: it earns half until it is fed." : "It is peckish: feed it before it gets hungry.");
  }
  if (held.number) lines.push(`Card ${cardNumber(held.number)}.`);
  return lines.join("\n");
}

// ── The reads ────────────────────────────────────────────────────────────────────────────────────

// From the generated ABIs, never a hand copy: a log filter on a stale signature silently matches nothing.
const JACKPOT_WON = getAbiItem({ abi: jackpotAbi, name: "JackpotWon" });
const JACKPOT_ROLLED_OVER = getAbiItem({ abi: jackpotAbi, name: "JackpotRolledOver" });
const WORD_REVEALED = getAbiItem({ abi: answerChainAbi, name: "WordRevealed" });

/** A wallet's public name (its profile's X or Farcaster name), else its short address. Never throws. */
export async function nameOf(address: string): Promise<string> {
  const a = address.toLowerCase();
  const faces = await soon(playerFaces([a]), 3_000);
  return faces?.profiles[a]?.username || shortAddress(a);
}

async function readStatus(): Promise<StatusFacts> {
  const base = { network: NETWORK.name, testnet: NETWORK.isTestnet, chainBacked: isChainBacked() };
  if (!base.chainBacked) return { ...base, chainTime: null, lastDrawDay: null };
  const [chainTime, lastDraw] = await Promise.all([soon(readChainTime()), soon(readLastDrawDay())]);
  return { ...base, chainTime, lastDrawDay: lastDraw === null ? null : Number(lastDraw) };
}

/** A draw as the jackpot logged it: JackpotWon carries a winner and an amount, JackpotRolledOver neither. */
export interface DrawLog {
  blockNumber: bigint;
  logIndex: number;
  transactionHash: string;
  tokenId: bigint;
  winner?: string;
  amount?: bigint;
}

/**
 * The latest draw and its word, or null when there has never been one.
 *
 * The word comes from the reveal in the draw's OWN transaction (Jackpot.resolve calls
 * AnswerChain.reveal), and only if it hashes to the draw's tokenId: a reveal that doesn't match
 * both is not named, so the answer can never pair one day's word with another day's result.
 */
export function lastDrawOf(
  draws: readonly DrawLog[],
  reveals: readonly { transactionHash: string; word: string }[],
): { word: string | null; winner: string | null; amount: bigint | null } | null {
  const last = [...draws].sort((x, y) => (x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : x.blockNumber < y.blockNumber ? -1 : 1)).at(-1);
  if (!last) return null;
  const said = reveals.find((r) => r.transactionHash === last.transactionHash)?.word;
  const word = said && tokenIdOf(said) === last.tokenId ? said.toUpperCase() : null;
  return { word, winner: last.winner ?? null, amount: last.winner ? (last.amount ?? 0n) : null };
}

/** The last draw, from the jackpot's own events: null when there has never been one. Throws when unread. */
async function readLastDraw(): Promise<LastDraw | null> {
  const client = getPublicClient();
  const jackpot = addressOf("jackpot");
  const range = { fromBlock: deployBlock(), toBlock: "latest" as const };
  const [won, rolled, revealed] = await Promise.all([
    client.getLogs({ address: jackpot, event: JACKPOT_WON, ...range }),
    client.getLogs({ address: jackpot, event: JACKPOT_ROLLED_OVER, ...range }),
    client.getLogs({ address: addressOf("answerChain"), event: WORD_REVEALED, ...range }),
  ]);
  const at = (l: { blockNumber: bigint; logIndex: number; transactionHash: string }) => ({ blockNumber: l.blockNumber, logIndex: l.logIndex, transactionHash: l.transactionHash });
  const last = lastDrawOf(
    [
      ...won.map((l) => ({ ...at(l), tokenId: l.args.tokenId ?? 0n, winner: String(l.args.winner), amount: l.args.amount ?? 0n })),
      ...rolled.map((l) => ({ ...at(l), tokenId: l.args.tokenId ?? 0n })),
    ],
    revealed.map((l) => ({ transactionHash: l.transactionHash, word: String(l.args.word ?? "") })),
  );
  if (!last) return null;
  if (!last.winner) return { word: last.word, winner: null };
  return { word: last.word, winner: { name: await nameOf(last.winner), amount: toWholeWord(last.amount ?? 0n) } };
}

const readLastDrawDay = () => getPublicClient().readContract({ address: addressOf("jackpot"), abi: jackpotAbi, functionName: "lastResolvedDay" });

/** The jackpot's facts, and the clock to say them by: the chain's, else this server's. (The daily recap reads them too: lib/telegramRecap.) */
export async function readJackpot(): Promise<{ facts: JackpotFacts; now: number }> {
  const [buckets, last, chainTime, lastDrawDay] = await Promise.all([
    soon(readFeeBuckets()),
    soon(readLastDraw().then((d) => ({ d }))),
    soon(readChainTime()),
    soon(readLastDrawDay()),
  ]);
  return {
    facts: { pot: buckets?.jackpot ?? null, last: last === null ? undefined : last.d, lastDrawDay: lastDrawDay === null ? null : Number(lastDrawDay) },
    now: chainTime ?? Math.floor(Date.now() / 1000),
  };
}

/** Who holds `word` and in what state: null when nobody does. Throws when the chain can't be read. */
async function readHeld(word: string): Promise<HeldWord | null> {
  const id = tokenIdOf(word);
  const words = addressOf("words");
  const staking = addressOf("staking");
  const client = getPublicClient();
  // allowFailure: ownerOf REVERTS for a word nobody holds (never made, or dissolved). A chain that
  // can't be reached throws instead, and the caller says so.
  const [r, letters, now, number] = await Promise.all([
    client.multicall({
      allowFailure: true,
      contracts: [
        { address: staking, abi: stakingAbi, functionName: "stakerOf", args: [id] },
        { address: words, abi: wordsAbi, functionName: "ownerOf", args: [id] },
        { address: words, abi: wordsAbi, functionName: "prestigeLevel", args: [id] },
        { address: staking, abi: stakingAbi, functionName: "lastFed", args: [id] },
      ],
    }),
    client.multicall({
      allowFailure: true,
      contracts: Array.from({ length: word.length }, (_, pos) => ({ address: words, abi: wordsAbi, functionName: "escrowLetter" as const, args: [id, pos] as const })),
    }),
    readChainTime().catch(() => Math.floor(Date.now() / 1000)),
    cardNumberSoon(word).catch(() => null),
  ]);
  const [stakerOf, ownerOf, level, lastFed] = r;
  // The same rule as the keeper's scan: the staker of a staked word, else the holder.
  const staker = stakerOf.status === "success" ? String(stakerOf.result) : ZERO;
  const owner = staker !== ZERO ? staker : ownerOf.status === "success" ? String(ownerOf.result) : ZERO;
  if (owner === ZERO) return null;
  const fed = lastFed.status === "success" ? Number(lastFed.result) : null;
  return {
    holder: await nameOf(owner),
    staked: staker !== ZERO,
    upper: letters.every((l) => l.status === "success") ? letters.map((l) => Boolean((l.result as unknown as readonly [number, boolean])[1])) : null,
    level: level.status === "success" ? Number(level.result) : null,
    // lastFed 0 is a word that has never needed feeding yet, not one starving since 1970 (keeper/scan).
    daysUnfed: fed === null ? null : fed === 0 ? 0 : Math.floor(Math.max(0, now - fed) / DAY),
    number,
  };
}

async function answerWord(args: string): Promise<BotReply> {
  const arg = parseWordArg(args);
  if (arg.kind === "none") return { text: "Name a word, like this: /word CRANE" };
  if (arg.kind === "unknown") return { text: arg.shown ? `${arg.shown} isn’t in the game’s dictionary.` : "That isn’t in the game’s dictionary." };
  if (!isChainBacked()) return { text: wordText(arg.word, undefined, false) };
  const read = await soon(readHeld(arg.word).then((h) => ({ h })));
  const held = read === null ? undefined : read.h;
  const notYet = held === null ? (await isHeldBack(arg.word).catch(() => null)) === true : false;
  return { text: wordText(arg.word, held, true, notYet), photoUrl: held ? cardUrlOf(arg.word, held) : undefined };
}

/**
 * The picture to send a held word's facts under: its card in its real case, the picture that
 * travels alone (it carries the game's name), or undefined when its case couldn't be read.
 *
 * The address names the word's stage, as the game's own share links do: a word's picture is kept
 * for a week under an address, so without the stage in it a word that has since ascended would be
 * sent in its old, ungilded picture under words that say it is gilded (Bugbot on #258).
 */
export function cardUrlOf(word: string, held: Pick<HeldWord, "upper" | "level">): string | undefined {
  return held.upper ? showcaseCardUrl(showcaseWordText(word, held.upper), "x", undefined, true, held.level) : undefined;
}

/**
 * The answer to a command, or null for one that isn't ours to answer. In the group an unknown
 * command is left alone (it may be another bot's), and so is `/start`; in a private chat `/start`
 * is the greeting and an unknown command gets the list.
 */
export async function answer(cmd: { name: string; args: string }, where: { private: boolean }): Promise<BotReply | null> {
  const now = Math.floor(Date.now() / 1000);
  switch (cmd.name) {
    case "help":
      return { text: helpText() };
    case "start":
      return where.private ? { text: `HEYOO! I’m the Lexigotchi bot.\n\n${helpText()}` } : null;
    case "status":
      return { text: statusText(await readStatus()) };
    case "jackpot": {
      if (!isChainBacked()) return { text: "The jackpot starts when the game is onchain. This is practice mode." };
      const jackpot = await readJackpot();
      return { text: jackpotText(jackpot.facts, jackpot.now) };
    }
    case "bounty":
      return { text: bountyText(isChainBacked() ? ((await soon(readFeeBuckets()))?.bounty ?? null) : null, now) };
    case "word":
      return answerWord(cmd.args);
    default:
      return where.private ? { text: `I don’t know that one.\n\n${helpText()}` } : null;
  }
}
