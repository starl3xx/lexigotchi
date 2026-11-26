"use client";
/**
 * A word opened from the Dictionary (decisions.md #30): what the player needs to spell it ("You
 * only need a q."), or who has it. The game's letter characters stand at the top, still, with an
 * empty slot for each letter the player doesn't hold; then the ways to get what's missing, and the
 * word's facts.
 *
 * - **A promise, so it follows lib/wordNeed's rules:** only the connected wallet's letters count,
 *   and nothing is promised until the owners are known (useDictionary).
 * - **It claims nothing.** A word the player can spell is handed to Spell (../spellHandoff), where
 *   the Claim button, the owner check, and the fee line already live.
 * - **"Mint a pack" is offered only while the letter can still be minted** (the chain game reads
 *   each letter's supply here; a sold-out letter points at the Market).
 * The player's own words never open here: they open their card (sheets/WordSheet).
 */
import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { WORDS, WORD_COUNT } from "@/lib/dictionary";
import { LETTER_ODDS, LETTER_SUPPLY_CAP, RANKED_WORDS, wordTier } from "@/lib/economy";
import { cardNumber, wordPoints } from "@/lib/cardFacts";
import { dailyEarnEstimate } from "@/lib/wordCost";
import { readLetterSupply } from "@/lib/onchain/reads";
import { NETWORK } from "@/lib/onchain/network";
import { article, finishedBy, heldList, nameList, needParts, needTokens, ordinal, wordNeed } from "@/lib/wordNeed";
import { Button, Sheet, TierBadge } from "../primitives";
import { TileCharacter, TileWord } from "../TileCharacter";
import { PlayerChip } from "../PlayerChip";
import { NeedText } from "../NeedText";
import { useCostToMake } from "../WordValue";
import { useWorld } from "../useWorld";
import { useDictionary } from "../useDictionary";
import { queueSpell } from "../spellHandoff";
import { THEMES, fmtWord, useGame } from "../state";

const LOWER = [false, false, false, false, false];
const ALL_UPPER = [true, true, true, true, true];
/** 1 = the rarest word in the dictionary. */
const RAREST = new Map(RANKED_WORDS.map((r) => [r.word, WORD_COUNT - r.rank]));
const STAGE = 54; // a letter character's width on the stage, px
const idx = (letter: string) => letter.toUpperCase().charCodeAt(0) - 65;

/** Each letter's supply from the chain: how many can ever exist, and how many are left to mint. Chain game only. */
function useLetterSupply(enabled: boolean) {
  const { state } = useGame();
  return useQuery({
    queryKey: ["letterSupply", NETWORK.id],
    enabled: enabled && state.chainBacked,
    staleTime: 5 * 60_000,
    queryFn: readLetterSupply,
  });
}

export function LookupSheet({ word }: { word: string }) {
  const g = useGame();
  const { state } = g;
  const world = useWorld();
  const d = useDictionary();
  const tier = wordTier(word);
  const status = d.statusOf(word);
  const owner = d.owners?.[word];
  const listing = d.listings.get(word);
  const open = status === "open";

  const need = useMemo(() => wordNeed(word, d.here, d.all), [word, d.here, d.all]);
  const parts = useMemo(() => needParts(need, word), [need, word]);
  const canSpell = open && d.hasLetters && need.missing.length === 0 && need.away.length === 0;
  const counting = open && d.hasLetters; // the player's letters are counted against this word
  const supply = useLetterSupply(counting && parts.length > 0);

  // unclaimed words the same letter would also finish, rarest first (one pass over the dictionary)
  const skip = (w: string) => w === word || d.statusOf(w) !== "open";
  const rarestFirst = (a: string, b: string) => (RAREST.get(a) ?? 0) - (RAREST.get(b) ?? 0);
  const also = useMemo(() => {
    if (!counting || parts.length !== 1 || parts[0].count !== 1) return [];
    return finishedBy(parts[0].letter, WORDS, d.here, skip).sort(rarestFirst);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counting, parts, d.here, d.statusOf, word]);
  // for a word someone has: unclaimed words one of ITS letters would finish, the rarest letter first
  const consolation = useMemo(() => {
    if ((status !== "taken" && status !== "sale") || !d.hasLetters) return null;
    const lacking = [...new Set(need.missing)].sort((a, b) => LETTER_ODDS[a.toUpperCase()] - LETTER_ODDS[b.toUpperCase()]);
    for (const letter of lacking) {
      const words = finishedBy(letter, WORDS, d.here, skip).sort(rarestFirst);
      if (words.length) return { letter, words };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, d.hasLetters, need, d.here, d.statusOf, word]);

  const cost = useCostToMake({ word, upper: LOWER, prestigeLevel: 0 });
  const today = world.data?.live ? world.data.yieldToday : undefined;
  const earns = today ? dailyEarnEstimate({ word, upper: ALL_UPPER, prestigeLevel: 0 }, today) : null;
  const drawn = !state.chainBacked ? "never" : world.data?.live && world.data.drawn ? (world.data.drawn[word] ?? "never") : null;
  const theme = THEMES[state.bountyTheme];
  const number = d.numbers?.[word];
  const rarest = RAREST.get(word);

  // ── the first line, and the line under it ────────────────────────────────────────────────────
  const held = [...word].filter((_, k) => need.letters[k] === "here").map((ch) => ch.toLowerCase());
  const the = parts.length === 1 ? parts[0] : null;
  let lead: ReactNode;
  let sub: string | null = null;
  if (status === "unknown") {
    lead = d.checkFailed ? "Can’t check who owns it yet." : "Checking who owns it…";
    sub = d.checkFailed ? "Try again in a moment." : null;
  } else if (status === "sale") {
    lead = `${word} is for sale.`;
    sub = listing ? `Its owner is asking ${fmtWord(listing.price)} $WORD.` : null;
  } else if (status === "taken" || status === "mineAway") {
    lead = status === "mineAway" ? `${word} is yours, in a linked wallet.` : `${word} has an owner.`;
    sub = status === "mineAway" ? "Connect that wallet to open its card." : "There’s only one of each word.";
  } else if (!d.hasLetters) {
    lead = `Nobody owns ${word} yet.`;
    sub = "Five letters make a word, and this one could be yours alone.";
  } else {
    lead = <NeedText tokens={needTokens(need, word, "lead")} />;
    if (canSpell) sub = `Nobody owns ${word}. Spell it and it’s yours alone.`;
    else if (the && the.count === 1 && !the.more) {
      sub = `You hold ${heldList(held)}.`;
      if (also.length) sub += ` ${article(the.letter) === "an" ? "An" : "A"} ${the.letter} would also finish ${nameList(also)}.`;
    } else if (parts.length > 0) {
      sub = held.length ? `You hold ${held.length} of its five letters.` : "You hold none of its letters yet.";
      if (need.away.length) sub += ` ${need.away.length === 1 ? `Your ${need.away[0]} is` : `${need.away.length} more are`} in your other wallet: move ${need.away.length === 1 ? "it" : "them"} here too.`;
    }
  }
  if (consolation && (status === "taken" || status === "sale")) {
    const { letter, words } = consolation;
    sub = `${sub ?? ""} ${
      words.length === 1
        ? `${words[0]} is still unclaimed, and you’re one ${letter} away.`
        : `${nameList(words)} are still unclaimed, and each needs only ${article(letter)} ${letter}.`
    }`.trim();
  }

  // ── what to do about it ──────────────────────────────────────────────────────────────────────
  // A letter the chain says is minted out can't come from a pack. Unknown (practice, or the read
  // still loading) is not sold out: the button stays, and only the supply line waits.
  const soldOut = (letter: string) => supply.data?.available[idx(letter)] === 0;
  const allSoldOut = parts.length > 0 && parts.every((p) => soldOut(p.letter));
  const capOf = (letter: string) => (state.chainBacked ? supply.data?.caps[idx(letter)] : LETTER_SUPPLY_CAP[letter.toUpperCase()]);
  const offers = the ? g.swapBoard.filter((o) => o.giveId % 26 === idx(the.letter)).length : 0;
  const go = (view: "mint" | "swap" | "claim") => g.nav(view); // a nav closes the sheet

  return (
    <Sheet
      open
      onClose={g.closeSheet}
      title={
        <span className="flex items-center gap-2">
          {word} <TierBadge tier={tier} />
        </span>
      }
    >
      {/* the word, in the game's letter characters, still: a slot for each letter the player lacks */}
      <div className="mb-3 flex min-h-[96px] items-end justify-center rounded-2xl border-2 border-ink/15 bg-card px-2 pb-1 pt-3" role="img" aria-label={word}>
        {counting && !canSpell ? (
          [...word].map((ch, k) =>
            need.letters[k] === "missing" ? (
              <span key={k} className="lk-slot" style={{ width: STAGE * 0.7, height: STAGE * 0.7, marginBottom: STAGE * 0.2 }}>
                {ch.toLowerCase()}
              </span>
            ) : (
              <span key={k} className={need.letters[k] === "away" ? "lk-letter opacity-50" : "lk-letter"} style={{ margin: `0 ${-STAGE * 0.11}px` }}>
                <TileCharacter char={ch} upper={need.upper[k]} size={STAGE} detail="full" tier={tier} index={k} still />
              </span>
            ),
          )
        ) : (
          <TileWord
            word={word}
            upper={status === "sale" && listing ? listing.upper : canSpell ? need.upper : LOWER}
            size={STAGE}
            detail="full"
            tier={tier}
            still
          />
        )}
      </div>

      <p className="font-display text-xl font-extrabold leading-tight">{lead}</p>
      {sub && <p className="mt-1 text-sm leading-snug text-ink/70">{sub}</p>}

      <div className="mt-3 space-y-3">
        {canSpell && (
          <Action hint={`Opens Spell with ${word} on the rack.`}>
            <Button
              full
              variant="teal"
              onClick={() => {
                queueSpell(word);
                go("claim");
              }}
            >
              Spell {word}
            </Button>
          </Action>
        )}
        {counting && parts.length > 0 && !allSoldOut && (
          <Action hint={the && capOf(the.letter) ? `Only ${capOf(the.letter)!.toLocaleString("en-US")} ${the.letter}’s will ever exist.` : "Every pack holds five letters."}>
            <Button full variant="primary" onClick={() => go("mint")}>
              Mint a pack
            </Button>
          </Action>
        )}
        {counting && parts.length > 0 && (
          <Action
            hint={
              allSoldOut
                ? the
                  ? `Every ${the.letter} has been minted, so the Market is the only place to find one.`
                  : "These letters have all been minted, so the Market is the only place to find them."
                : offers > 0
                  ? `${offers === 1 ? "1 player is" : `${offers} players are`} offering one now.`
                  : "Offer a letter you can spare."
            }
          >
            <Button full variant="ghost" onClick={() => go("swap")}>
              {the ? `Swap for ${article(the.letter)} ${the.letter} in the Market` : "Swap letters in the Market"}
            </Button>
          </Action>
        )}
        {counting && need.away.length > 0 && (
          <Action hint="Only the wallet you’re connected with can spell.">
            <Button full variant={parts.length ? "ghost" : "teal"} onClick={() => g.openSheet({ kind: "profile", focus: "move" })}>
              Move {need.away.length === 1 ? "it" : "them"} here
            </Button>
          </Action>
        )}
        {open && !d.hasLetters && (
          <Button full variant="primary" onClick={() => go("mint")}>
            Get letters
          </Button>
        )}
        {status === "sale" && (
          <Button full variant="ghost" onClick={() => go("swap")}>
            See it in the Market
          </Button>
        )}
      </div>

      <dl className="mt-4">
        {(status === "taken" || status === "sale" || status === "mineAway") && owner && (
          <Fact label="Owner">
            <PlayerChip address={owner} profile={d.profiles?.[owner]} size={18} />
          </Fact>
        )}
        {number ? <Fact label="Card">{cardNumber(number)}</Fact> : null}
        {rarest ? (
          <Fact label="Rarity">
            {tier} · the {ordinal(rarest)} rarest of {WORD_COUNT.toLocaleString("en-US")}
          </Fact>
        ) : null}
        <Fact label="Points">{wordPoints(word)}</Fact>
        {open && <Fact label="Owner">Nobody yet</Fact>}
        {open && drawn !== null && <Fact label="The daily word">{drawn === "never" ? "Not drawn yet" : `Drawn already (draw ${drawn})`}</Fact>}
        {open && cost && <Fact label="Cost to make">~{fmtWord(cost.total)} $WORD</Fact>}
        {open && earns ? <Fact label="Earns staked">~{fmtWord(earns)} $WORD a day, once all UPPERCASE</Fact> : null}
        {open && theme.test(word) && <Fact label="Fits this week’s bounty">{theme.name}</Fact>}
        {status === "taken" && <Fact label="In the Market">Not for sale</Fact>}
        {status === "sale" && listing && <Fact label="In the Market">{fmtWord(listing.price)} $WORD</Fact>}
      </dl>
    </Sheet>
  );
}

/** A button and the line under it that says what it does. */
function Action({ hint, children }: { hint: string; children: ReactNode }) {
  return (
    <div>
      {children}
      <p className="mt-1.5 text-center text-xs text-ink/60">{hint}</p>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-ink/15 py-2 text-sm">
      <dt className="shrink-0 font-semibold text-ink/65">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}
