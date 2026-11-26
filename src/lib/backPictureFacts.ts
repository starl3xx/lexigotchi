/**
 * The facts on a word's back picture that need the shared world and the game's prices (decisions.md
 * #48, part 5): the day it reached its holder, about what it earns a day, what it costs to make, and
 * whether the jackpot drew it. For app/s/[text]/back, which draws them (lib/backPicture words them).
 *
 * Every read has a short wait, and a fact whose read doesn't arrive is null: the picture is drawn
 * with what is known, never held up and never guessed. Nothing here takes anything from a link.
 */
import { yoursSince, type WordStory } from "./cardFacts";
import { costToMake, dailyEarnEstimate } from "./wordCost";
import { stageFeeMultiple } from "./ascension";
import { worldNow, type WorldNow } from "./worldSnapshot";
import { readGameParams, type GameParams } from "./onchain/reads";
import { accountWallets } from "./db/walletLinks";

/** A read that answers within `ms`, or null: nothing here may hold the picture up, and nothing throws. */
function soon<T>(read: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([read.catch(() => null), late]).finally(() => clearTimeout(timer));
}
const WORLD_WAIT_MS = 4000;
const PRICE_WAIT_MS = 2500;

// The game's prices, for "Cost to make": kept a few minutes, and callers that arrive together share one read.
const PRICES_TTL_MS = 5 * 60_000;
let prices: { at: number; params: GameParams } | null = null;
let pricesRead: Promise<GameParams> | null = null;
function pricesNow(): Promise<GameParams> {
  if (prices && Date.now() - prices.at < PRICES_TTL_MS) return Promise.resolve(prices.params);
  pricesRead ??= readGameParams()
    .then((params) => {
      prices = { at: Date.now(), params };
      return params;
    })
    .finally(() => {
      pricesRead = null;
    });
  return pricesRead;
}

/**
 * The word's facts that need the shared world and the prices: the day it reached its holder, about
 * what it earns a day, what it costs to make, and whether the jackpot drew it. Each is null when
 * its read didn't arrive. How many letters are UPPERCASE is the chain's count here (the world's),
 * never the link's casing: a link can't make a lowercase word look like an earner.
 */
export async function readBackFacts(word: string, level: number | null, story: WordStory | null): Promise<{ since: number | null; perDay: number | "upper" | null; cost: number | null; drawn: number | "never" | null }> {
  const [world, params] = await Promise.all([soon<WorldNow>(worldNow(), WORLD_WAIT_MS), soon<GameParams>(pricesNow(), PRICE_WAIT_MS)]);
  const holder = world?.body.owners?.[word] ?? null;
  const raised = world?.raised[word];
  let since: number | null = null;
  if (holder && story) {
    // the holder's whole profile: a move between its own wallets keeps the day
    const wallets = await soon(accountWallets(holder), 1500);
    since = yoursSince(story.transfers, new Set((wallets?.wallets ?? [holder]).map((w) => w.toLowerCase())));
  }
  const today = world?.body.yieldToday;
  let perDay: number | "upper" | null = null;
  if (raised !== undefined && level !== null) {
    if (raised < word.length) perDay = "upper";
    // it is already in today's weight if it earns now: take its own part out before counting it in
    else if (today) perDay = dailyEarnEstimate({ word, upper: [...word].map(() => true), prestigeLevel: level }, { pot: today.pot, weight: Math.max(0, today.weight - (world?.weights[word] ?? 0)) });
  }
  let cost: number | null = null;
  if (params && raised !== undefined && level !== null) {
    const p = params.word;
    cost = costToMake({ word, upper: [...word].map((_, i) => i < raised), prestigeLevel: level }, { pack: p.pack, roll: p.roll, claim: p.claim, prestigeFee: (l) => p.prestigeFee * stageFeeMultiple(l), prestigeSnack: p.prestigeSnackCost }).total;
  }
  const drawnMap = world?.body.drawn;
  const drawn: number | "never" | null = drawnMap ? (drawnMap[word] ?? "never") : null;
  return { since, perDay, cost, drawn };
}

/** Tests only: forget the kept prices. */
export function resetBackFacts() {
  prices = null;
  pricesRead = null;
}
