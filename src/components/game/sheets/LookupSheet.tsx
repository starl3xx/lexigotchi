"use client";
/**
 * A word opened from the Dictionary or the Market (decisions.md #31, #32): what the player needs to
 * spell it ("You only need a q."), or who has it, and, when it is for sale, its price and a Buy.
 * The game's letter characters stand at the top, still, with an empty slot for each letter the
 * player doesn't hold; then the ways to get what's missing, and the word's facts.
 *
 * - **A promise, so it follows lib/wordNeed's rules:** only the connected wallet's letters count,
 *   and nothing is promised until the owners are known (useDictionary).
 * - **It claims nothing.** A word the player can spell is handed to Spell (../spellHandoff), where
 *   the Claim button, the owner check, and the fee line already live.
 * - **"Mint a pack" is offered only while the letter can still be minted** (the chain game reads
 *   each letter's supply here; a sold-out letter points at the Market).
 * - **A word for sale is bought here** (one word view for both screens): the listing as it is now
 *   (case, ascension, hunger), its price against what it costs to make, and Buy, which closes the
 *   sheet, because the word is the player's from then on and opens as its card. No Buy without a
 *   connected wallet (the Dictionary is public), nor on the player's own listing.
 * - **Its links land on the thing they name:** "Find a q in the Market" opens the Letters shelf at
 *   q, and a word for sale opens the Market on Words (`nav` with a section, state.tsx).
 * The player's own words never open here: they open their card (sheets/WordSheet).
 */
import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { WORDS, WORD_COUNT } from "@/lib/dictionary";
import { LETTER_ODDS, LETTER_SUPPLY_CAP, RANKED_WORDS, wordTier } from "@/lib/economy";
import { cardNumber, wordPoints } from "@/lib/cardFacts";
import { stageName } from "@/lib/ascension";
import { dailyEarnEstimate } from "@/lib/wordCost";
import { readLetterSupply } from "@/lib/onchain/reads";
import { NETWORK } from "@/lib/onchain/network";
import { article, finishedBy, nameList, needNote, needParts, needTokens, ordinal, wordNeed } from "@/lib/wordNeed";
import { Button, Sheet, TierBadge } from "../primitives";
import { TileCharacter, TileWord, type Gild } from "../TileCharacter";
import { PlayerChip } from "../PlayerChip";
import { NeedText } from "../NeedText";
import { WordValue, useCostToMake } from "../WordValue";
import { versus, versusLabel } from "@/lib/market/deals";
import { timeAgo } from "../market/bits";
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
  const listing = d.listings.get(word);
  // a word on the board is its seller's, whatever the minute-old world read says (useDictionary)
  const holder = d.holderOf(word);
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
    return finishedBy(parts[0].letter, WORDS, d.here, skip, d.all).sort(rarestFirst);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counting, parts, d.here, d.all, d.statusOf, word]);
  // for a word someone has: unclaimed words one of ITS letters would finish, the rarest letter first
  const consolation = useMemo(() => {
    if ((status !== "taken" && status !== "sale") || !d.hasLetters) return null;
    const lacking = [...new Set(need.missing)].sort((a, b) => LETTER_ODDS[a.toUpperCase()] - LETTER_ODDS[b.toUpperCase()]);
    for (const letter of lacking) {
      const words = finishedBy(letter, WORDS, d.here, skip, d.all).sort(rarestFirst);
      if (words.length) return { letter, words };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, d.hasLetters, need, d.here, d.all, d.statusOf, word]);

  const cost = useCostToMake({ word, upper: LOWER, prestigeLevel: 0 });
  // A word for sale is priced against what IT costs to make: its own case and ascension stage.
  const listed = { word, upper: listing?.upper ?? LOWER, prestigeLevel: listing?.prestigeLevel ?? 0 };
  const listedCost = useCostToMake(listed);
  const unfed = listing && listing.lastFedAt > 0 ? Math.floor((Date.now() / 1000 - listing.lastFedAt) / 86_400) : 0;
  // Buying needs a wallet that can pay (the Dictionary is public, and the stores ignore a Buy without one).
  const canBuy = status === "sale" && !!listing && state.status === "ready";
  const today = world.data?.live ? world.data.yieldToday : undefined;
  const earns = today ? dailyEarnEstimate({ word, upper: ALL_UPPER, prestigeLevel: 0 }, today) : null;
  const drawn = !state.chainBacked ? "never" : world.data?.live && world.data.drawn ? (world.data.drawn[word] ?? "never") : null;
  const theme = THEMES[state.bountyTheme];
  const number = d.numbers?.[word];
  const rarest = RAREST.get(word);

  // ── the first line, and the line under it ────────────────────────────────────────────────────
  const the = parts.length === 1 ? parts[0] : null;
  let lead: ReactNode;
  let sub: ReactNode = null;
  if (status === "unknown") {
    lead = d.checkFailed ? "Can’t check who owns it yet." : "Checking who owns it…";
    sub = d.checkFailed ? "Try again in a moment." : null;
  } else if (status === "sale") {
    lead = `${word} is for sale.`;
    // the price, beside what this word costs to make as it is (under is the news, as on the Market's rows)
    const v = listing ? versus(listing.price, listedCost?.total) : null;
    const beside = versusLabel(v);
    sub = listing ? (
      <>
        Its owner is asking {fmtWord(listing.price)} $WORD
        {beside && (
          <>
            , <span className={v !== null && v <= -0.03 ? "font-bold text-teal-ink" : undefined}>{beside} what it costs to make</span>
          </>
        )}
        .
      </>
    ) : null;
  } else if (status === "taken" || status === "mineAway") {
    lead = status === "mineAway" ? `${word} is yours, in a linked wallet.` : `${word} has an owner.`;
    sub = status === "mineAway" ? "Connect that wallet to open its card." : "There’s only one of each word.";
  } else if (!d.hasLetters) {
    lead = `Nobody owns ${word} yet.`;
    sub = "Five letters make a word, and this one could be yours alone.";
  } else {
    lead = <NeedText tokens={needTokens(need, word, "lead")} />;
    // what's held, what else the letter would finish, and any letter to move (lib/wordNeed needNote)
    sub = canSpell ? `Nobody owns ${word}. Spell it and it’s yours alone.` : needNote(need, word, also) || null;
  }
  // For a word someone has: what the player could spell instead. Its own line, after the price.
  let instead: string | null = null;
  if (consolation && (status === "taken" || status === "sale")) {
    const { letter, words } = consolation;
    instead =
      words.length === 1
        ? `${words[0]} is still unclaimed, and you’re one ${letter} away.`
        : `${nameList(words)} are still unclaimed, and each needs only ${article(letter)} ${letter}.`;
  }

  // ── what to do about it ──────────────────────────────────────────────────────────────────────
  // A letter the chain says is minted out can't come from a pack. Unknown (practice, or the read
  // still loading) is not sold out: the button stays, and only the supply line waits.
  const soldOut = (letter: string) => supply.data?.available[idx(letter)] === 0;
  // No pack can be opened once fewer than five letters are left in all (as the Mint screen says).
  const packsOut = g.lettersLeft !== null && g.lettersLeft < 5;
  const allSoldOut = parts.length > 0 && (packsOut || parts.every((p) => soldOut(p.letter)));
  const capOf = (letter: string) => (state.chainBacked ? supply.data?.caps[idx(letter)] : LETTER_SUPPLY_CAP[letter.toUpperCase()]);
  // "Only 115 q’s will ever exist" is worth saying for a scarce letter, and silly for an o.
  const SCARCE = 1000;
  const cap = the ? capOf(the.letter) : undefined;
  const scarce = cap && cap <= SCARCE ? cap : null;
  // The letter for sale in the Market right now (decisions.md #30), in either case, since a claim
  // takes either; the player's own listings aside. How many, and the least one costs.
  const asks = the
    ? [idx(the.letter), idx(the.letter) + 26].flatMap((id) => g.market.letterBook[id]?.asks ?? []).filter((a) => a.available > 0 && !g.market.isMine(a.maker))
    : [];
  const forSale = asks.reduce((n, a) => n + a.available, 0);
  const least = asks.reduce((m, a) => Math.min(m, a.unitPrice), Infinity);
  const go = g.nav; // a nav closes the sheet

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
            gild={status === "sale" && listing ? (Math.min(5, Math.max(0, listing.prestigeLevel)) as Gild) : 0}
            size={STAGE}
            detail="full"
            tier={tier}
            still
          />
        )}
      </div>

      <p className="font-display text-xl font-extrabold leading-tight">{lead}</p>
      {sub && <p className="mt-1 text-sm leading-snug text-ink/70">{sub}</p>}
      {instead && <p className="mt-1 text-sm leading-snug text-ink/70">{instead}</p>}

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
          <Action hint={scarce ? `Only ${scarce.toLocaleString("en-US")} ${the!.letter}’s will ever exist.` : "Every pack holds five letters."}>
            <Button full variant="primary" onClick={() => go("mint")}>
              Mint a pack
            </Button>
          </Action>
        )}
        {counting && parts.length > 0 && (
          <Action
            hint={
              allSoldOut
                ? packsOut
                  ? "Packs are sold out, so the Market is the only place to find letters."
                  : the
                    ? `Every ${the.letter} has been minted, so the Market is the only place to find one.`
                    : "These letters have all been minted, so the Market is the only place to find them."
                : !the
                  ? "Letters are for sale there, from other players."
                  : forSale > 0
                    ? `${forSale.toLocaleString("en-US")} for sale now, from ${fmtWord(least)} $WORD.`
                    : "None for sale right now."
            }
          >
            {/* the shelf, at this letter's sellers when there is one letter to find */}
            <Button full variant={allSoldOut ? "primary" : "ghost"} onClick={() => go("swap", the ? `letter:${the.letter}` : "letters")}>
              {the ? `Find ${article(the.letter)} ${the.letter} in the Market` : "Find letters in the Market"}
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
        {canBuy && listing && (
          <Action hint={`${word} arrives with its letters, their case, and its ascension.`}>
            <Button
              full
              variant="teal"
              onClick={() => {
                // the word is the player's from here on, and opens as its card: this view is done
                g.closeSheet();
                g.buyWord(listing.orderHash);
              }}
            >
              Buy for {fmtWord(listing.price)} $WORD
            </Button>
          </Action>
        )}
        {/* From the Dictionary, the way to the other words for sale. On the Market it would lead nowhere. */}
        {status === "sale" && state.view !== "swap" && (
          <Button full variant="ghost" onClick={() => go("swap", "words")}>
            See it in the Market
          </Button>
        )}
      </div>

      {status === "sale" && listing && <WordValue word={listed} cost={listedCost} compact />}

      <dl className="mt-4">
        {(status === "taken" || status === "sale" || status === "mineAway") && holder && (
          <Fact label="Owner">
            <PlayerChip address={holder.address} profile={holder.profile} size={18} />
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
        {status === "sale" && listing && (
          <Fact label="In the Market">
            {fmtWord(listing.price)} $WORD{listing.listedAt ? `, listed ${timeAgo(Date.parse(listing.listedAt))}` : ""}
          </Fact>
        )}
        {status === "sale" && listing && listing.prestigeLevel > 0 && <Fact label="Ascension">{stageName(listing.prestigeLevel)}</Fact>}
        {status === "sale" && listing && listing.prestigePity > 0 && (
          <Fact label="Failed ascensions">{listing.prestigePity}, so better odds next time</Fact>
        )}
        {status === "sale" && listing && unfed > 0 && (
          <Fact label="Unfed">
            {unfed} day{unfed === 1 ? "" : "s"}
          </Fact>
        )}
        {status === "sale" && listing?.lastSale && (
          <Fact label="Last sold for">
            {fmtWord(listing.lastSale.price)} $WORD, {timeAgo(listing.lastSale.at)}
          </Fact>
        )}
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
