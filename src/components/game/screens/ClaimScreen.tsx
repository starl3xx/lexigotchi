"use client";
/**
 * Spell: build a word from any 5 of your letters, in any mix of lowercase and UPPERCASE, and claim a
 * valid dictionary word (decisions.md #17). The rack claims exactly the tiles picked; a word from the
 * list claims each letter UPPERCASE where the bag has one (claimCase, "UPPERCASE first"). A filter
 * (All, lowercase, UPPERCASE; filterBag) narrows the tray and the list to one case, and says so when
 * a case is empty or spells nothing alone.
 *
 * It used to take five letters of ONE case, behind a lowercase/UPPERCASE switch that locked until
 * five letters were raised. A tester with four raised letters saw UPPERCASE locked and those letters
 * missing from the tray, with nothing saying why.
 *
 * A claim COSTS $WORD on top of the 5 letters it locks inside the Word NFT, and the fee follows the
 * word's rarity (decisions.md #60: the base, a Common word's, times the tier's earning weight;
 * `g.claimFee(word)`, the contract's live numbers). A tester found out from the wallet's "−2.3M
 * WORD" line, so the fee is said up front: in the intro, on every Claim button with the word's
 * tier ("Rare word: … to claim"), and, when the balance is short, with a way to get exactly that.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { TIERS, type Tier } from "@/lib/economy";
import { aTierWord, claimLadderLive } from "@/lib/claimFee";
import { rarestByScore } from "@/lib/rarity";
import { cantClaim } from "@/lib/dictionaryList";
import { Button, Card, EmptyState, Pill, SectionTitle, TierBadge, Segmented } from "../primitives";
import { TierMark } from "../TierMark";
import { useWorld } from "../useWorld";
import { LetterTile, WordTiles } from "../LetterTile";
import { Basket, Sparkle } from "../ui/icons";
import { anagramsOf, canSpell, charToIdx, claimCase, fmtUsd, fmtWord, idxToChar, mineLower, mineUpper, showsUsd, spellableNow, useGame } from "../state";
import { takeQueuedSpell } from "../spellHandoff";
import { useDictionary } from "../useDictionary";
import { useTierOf } from "../useRarity";

/** A tile in the rack or the tray: a letter (0..25) and its case. */
type Tile = { i: number; upper: boolean };

/**
 * The case each letter of `word` takes when claimed from these rack tiles: a letter the rack holds
 * in UPPERCASE uses that tile first. Only the count per case matters, so any order is the same claim.
 */
export function rackCases(word: string, rack: readonly Tile[]): boolean[] {
  const upper = new Map<number, number>();
  for (const t of rack) if (t.upper) upper.set(t.i, (upper.get(t.i) ?? 0) + 1);
  return [...word].map((ch) => {
    const i = charToIdx(ch);
    const left = upper.get(i) ?? 0;
    if (left <= 0) return false;
    upper.set(i, left - 1);
    return true;
  });
}

/** Which letters the tray and the word list show (starl3xx: "show all letters a player has, of
 *  every case, and then let them filter upper- or lower-case"). */
export type CaseFilter = "all" | "lower" | "upper";

const NONE: readonly number[] = new Array(26).fill(0);

/**
 * What a filter does to the bag and to a claim. "all" spells in any mix of cases and claims each
 * letter UPPERCASE where there's one (claimCase); "lower" and "upper" spell from that case alone
 * and claim the whole word in it, so "upper" lists exactly the words born earning.
 */
export function filterBag(show: CaseFilter, lower: readonly number[], upper: readonly number[]) {
  return {
    lower: show === "upper" ? NONE : lower,
    upper: show === "lower" ? NONE : upper,
    casesFor: (word: string): boolean[] =>
      show === "all" ? claimCase(word, upper) : [...word].map(() => show === "upper"),
  };
}

export function ClaimScreen() {
  const tierOf = useTierOf();
  const g = useGame();
  const { state } = g;
  const [rack, setRack] = useState<Tile[]>([]);
  const [show, setShow] = useState<CaseFilter>("all");

  // MINE, not the union: Words.claim consumes letters from msg.sender — spelling with a linked
  // wallet's letters would build a transaction the contract is guaranteed to revert.
  const lower = mineLower(state);
  const upper = mineUpper(state);
  const bag = useMemo(() => filterBag(show, lower, upper), [show, lower, upper]);
  const owned = useMemo(() => new Set(state.words.map((w) => w.word)), [state.words]);

  // A word handed over from the Dictionary's word view (../spellHandoff) starts on the rack, in
  // the case a quick claim would use (UPPERCASE first), if these letters still spell it. Once, on
  // arrival: the rack is the player's from then on.
  useEffect(() => {
    const w = takeQueuedSpell();
    if (!w || !canSpell(w, lower, upper)) return;
    const cases = claimCase(w, upper);
    setRack([...w].map((ch, k) => ({ i: charToIdx(ch), upper: cases[k] })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rackCount = (t: Tile) => rack.filter((x) => x.i === t.i && x.upper === t.upper).length;
  const held = (t: Tile) => (t.upper ? upper : lower)[t.i];
  const lowerCount = lower.reduce((a, b) => a + b, 0);
  const upperCount = upper.reduce((a, b) => a + b, 0);
  // The loose letters the filter shows, UPPERCASE first (as Today lists them). The rack keeps its
  // tiles across filters, so a word can mix cases picked under different filters.
  const trayLetters: (Tile & { c: number })[] = [
    ...bag.upper.map((c, i) => ({ i, c, upper: true })),
    ...bag.lower.map((c, i) => ({ i, c, upper: false })),
  ].filter((x) => x.c > 0);

  const spelled = useMemo(
    () => (rack.length === 5 ? anagramsOf(rack.map((t) => idxToChar(t.i))).filter((w) => !owned.has(w)) : []),
    [rack, owned],
  );
  // EVERY word these letters spell (it used to stop at the first 8, all early in A), minus words
  // another player already owns: a claim of one reverts (AlreadyClaimed). Until the owners are
  // known, a word stays listed, as the Dictionary does.
  const world = useWorld();
  // Owners are KNOWN only once the world read succeeds (always, in the practice game). Until then
  // a word may belong to someone, so its Claim waits: a claim of an owned word reverts and can
  // still cost gas (Bugbot on #146; the Dictionary does the same).
  const ownersKnown = !state.chainBacked || world.data?.live === true;
  // A failed read is not a check in progress: say so, as the Dictionary does. The read retries on
  // its own (useWorld refetches), so the Claims come back when it lands (Bugbot on #146).
  const ownerWait = world.isError || (world.data && !world.data.live) ? "Can’t check owner yet" : "Checking owner…";
  // Who has a word is the Dictionary's question (useDictionary `statusOf`): a word on the Market's
  // board has an owner, its seller, even before the minute-old world read knows it (decisions.md
  // #32). So this list is exactly the Dictionary's "Can spell", and neither offers a claim that reverts.
  const { statusOf } = useDictionary();
  // "Taken" here is "a claim can't go through": someone has it, or it is held back in a set that
  // hasn't unlocked (lib/dictionaryList `cantClaim`). Neither is offered.
  const taken = useCallback((w: string) => cantClaim(statusOf(w)), [statusOf]);
  const spellable = useMemo(
    () => spellableNow(bag.lower, bag.upper, owned, Infinity).filter((w) => !taken(w)),
    [bag, owned, taken],
  );
  const [order, setOrder] = useState<"rarest" | "az">("rarest");
  const [tier, setTier] = useState<Tier | "All">("All");
  const tierCounts = useMemo(() => {
    const c: Partial<Record<Tier, number>> = {};
    for (const w of spellable) c[tierOf(w)] = (c[tierOf(w)] ?? 0) + 1;
    return c;
  }, [spellable, tierOf]);
  // A chosen rarity with nothing left in it (its last word claimed, or the case switched) shows
  // All rather than an empty list under a heading that counts words (Bugbot on #146).
  const activeTier: Tier | "All" = tier !== "All" && !tierCounts[tier] ? "All" : tier;
  const quick = useMemo(() => {
    const list = activeTier === "All" ? spellable : spellable.filter((w) => tierOf(w) === activeTier);
    // The dictionary is alphabetical already; rarest first ranks by the same score that sets tiers,
    // under the game's tier (lib/rarity.ts): a collab word sorts with the Legendary words.
    return order === "rarest" ? [...list].sort(rarestByScore(tierOf)) : list;
  }, [spellable, activeTier, order, tierOf]);
  // A full bag spells hundreds of words; render them a page at a time so a phone stays smooth.
  const [shown, setShown] = useState(SPELL_PAGE);
  useEffect(() => setShown(SPELL_PAGE), [activeTier, order, show]);

  const claim = (word: string, cases: boolean[]) => {
    g.claim(word, cases);
    setRack([]);
  };
  // functional updater so rapid/batched clicks can't push past 5 slots or beyond what you own
  const addLetter = (t: Tile) =>
    setRack((prev) => {
      if (prev.length >= 5) return prev;
      const used = prev.filter((x) => x.i === t.i && x.upper === t.upper).length;
      if (held(t) - used <= 0) return prev;
      return [...prev, { i: t.i, upper: t.upper }];
    });

  // The claim fee by rarity (decisions.md #60): each word's own, by the tier the game shows.
  const usd = showsUsd(state);
  const amountText = (fee: number) => (usd ? `${fmtWord(fee)} $WORD (${fmtUsd(fee)})` : `${fmtWord(fee)} $WORD`);
  const ladder = claimLadderLive();
  const baseFee = g.tierClaimFee("Common");
  const topFee = g.tierClaimFee(TIERS[TIERS.length - 1].name);
  const feeOf = (w: string) => g.claimFee(w);
  const canClaimWord = (w: string) => g.canAfford(feeOf(w));
  // The balance sheet opens with exactly what this word needs (its Buy pre-fills from it).
  // Why a word costs what it does: its tier, where the ladder is live; the plain fee where every
  // word costs the base (a Words without the ladder: saying "Rare word" there would be untrue).
  const feeSay = (w: string) => (ladder ? `${tierOf(w)} word: ${amountText(feeOf(w))} to claim` : `Claiming costs ${amountText(feeOf(w))}`);
  const getWordFor = (w: string) => g.openSheet({ kind: "balance", need: { amount: feeOf(w), action: aTierWord(tierOf(w)) } });

  return (
    <div className="space-y-3">
      <div>
        <h1 className="font-display text-2xl font-extrabold md:hidden">Spell a word</h1>
        <p className="text-sm text-ink/60">
          Any five letters, any mix of lowercase and UPPERCASE.{" "}
          {ladder ? (
            <>
              Claiming a dictionary word costs from <strong className="font-bold text-ink">{amountText(baseFee)}</strong> for a
              Common word to {amountText(topFee)} for a {TIERS[TIERS.length - 1].name} one: rarer words cost more. It locks the
              word’s five letters inside it.
            </>
          ) : (
            <>
              Claiming a dictionary word costs <strong className="font-bold text-ink">{amountText(baseFee)}</strong> and locks its
              five letters inside it.
            </>
          )}{" "}
          The word is yours alone: every word has one owner.
        </p>
      </div>

      {/* rack */}
      <Card>
        <div className="flex items-center justify-center gap-1.5">
          {Array.from({ length: 5 }).map((_, slot) => {
            const tile = rack[slot];
            return tile === undefined ? (
              <div key={slot} className="h-12 w-12 rounded-lg border-[3px] border-dashed border-ink/30" />
            ) : (
              <LetterTile
                key={slot}
                char={idxToChar(tile.i)}
                upper={tile.upper}
                size={48}
                onClick={() => setRack((prev) => prev.filter((_, s) => s !== slot))}
                title="remove"
              />
            );
          })}
        </div>

        {/* result */}
        <div className="mt-3 min-h-[2.25rem] text-center">
          {rack.length < 5 ? (
            <span className="text-sm text-ink/50">{5 - rack.length} more letter{rack.length === 4 ? "" : "s"}…</span>
          ) : spelled.length > 0 ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="text-xs text-ink/60">spells</span>
              {spelled.map((w) =>
                // Someone else's word: say so, rather than offer a claim the contract reverts.
                taken(w) ? (
                  <span key={w} className="rounded-lg border-2 border-ink/30 px-2 py-1 text-sm font-bold text-ink/55">
                    {statusOf(w) === "held" ? `${w} isn’t available yet` : `${w} is already owned`}
                  </span>
                ) : (
                  <button
                    key={w}
                    onClick={() => claim(w, rackCases(w, rack))}
                    disabled={!canClaimWord(w) || !ownersKnown}
                    className="inline-flex items-center gap-1 rounded-lg border-[3px] border-ink bg-teal px-2 py-1 font-display text-sm font-extrabold text-ink shadow-[2px_2px_0_#1b1714] disabled:opacity-40"
                  >
                    {ownersKnown ? (
                      <>
                        Claim {w} <Sparkle weight="fill" size={13} />
                      </>
                    ) : (
                      `${w}: ${ownerWait.toLowerCase()}`
                    )}
                  </button>
                ),
              )}
            </div>
          ) : (
            <span className="text-sm font-bold text-candy-ink">not a dictionary word</span>
          )}
        </div>
        {/* The fee only for a word the rack spells that you could claim, not one someone else owns:
            the word's tier, its fee, and a way to get exactly that when the balance is short. */}
        {rack.length === 5 &&
          spelled
            .filter((w) => !taken(w))
            .map((w) => (
              <FeeLine
                key={w}
                text={`${feeSay(w)}${ladder && spelled.filter((x) => !taken(x)).length > 1 ? ` ${w}` : ""}.`}
                canClaim={canClaimWord(w)}
                onGetWord={() => getWordFor(w)}
              />
            ))}
        {rack.length > 0 && (
          <button onClick={() => setRack([])} className="mx-auto mt-2 block text-xs font-bold text-ink/50 underline">
            clear rack
          </button>
        )}
      </Card>

      {/* tray */}
      <div>
        {/* Unused: letters already spelled into your words are locked inside them and never show
            here. "your letters" read as everything you own. */}
        <SectionTitle>Your unused letters</SectionTitle>
        <p className="-mt-1 mb-2 text-xs text-ink/50">Letters already in your words stay in them, so they aren’t listed.</p>
        <Segmented
          className="mb-3 md:max-w-sm"
          value={show}
          onChange={setShow}
          options={[
            { value: "all", label: <FilterLabel name="All" count={lowerCount + upperCount} /> },
            { value: "lower", label: <FilterLabel name="lowercase" count={lowerCount} /> },
            { value: "upper", label: <FilterLabel name="UPPERCASE" count={upperCount} /> },
          ]}
        />
        {trayLetters.length === 0 ? (
          // Never a filter that empties the tray without saying why (a locked, silent UPPERCASE
          // switch is what a tester hit).
          show === "upper" ? (
            <EmptyState Icon={Basket} title="No UPPERCASE letters yet" sub="Roll a letter to raise it. A raised letter can go into any word." />
          ) : show === "lower" ? (
            <EmptyState Icon={Basket} title="No lowercase letters" sub="Mint a pack to fill your bag." />
          ) : (
            <EmptyState Icon={Basket} title="No letters" sub="Mint a pack to fill your bag." />
          )
        ) : (
          <div className="grid grid-cols-6 gap-2.5 md:grid-cols-[repeat(auto-fill,52px)]">
            {trayLetters.map((t) => {
              const avail = t.c - rackCount(t);
              const ch = t.upper ? idxToChar(t.i) : idxToChar(t.i).toLowerCase();
              return (
                <LetterTile
                  key={`${t.upper ? "U" : "l"}${t.i}`}
                  char={idxToChar(t.i)}
                  upper={t.upper}
                  count={avail}
                  dim={avail <= 0}
                  onClick={avail > 0 && rack.length < 5 ? () => addLetter(t) : undefined}
                  title={`add ${ch}`}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* A filtered case that spells nothing on its own: say so, and where the words are. */}
      {spellable.length === 0 && show !== "all" && trayLetters.length > 0 && (
        <p className="text-sm text-ink/60">
          Your {show === "upper" ? "UPPERCASE" : "lowercase"} letters don’t spell a word on their own yet. Show{" "}
          <button onClick={() => setShow("all")} className="font-bold text-ink underline">
            All
          </button>{" "}
          to mix them with your {show === "upper" ? "lowercase" : "UPPERCASE"} ones.
        </p>
      )}

      {/* every word you can spell now */}
      {spellable.length > 0 && (
        <div>
          {/* A count of words the letters can each spell ALONE, not all at once: spelling one uses
              five letters another may need (starl3xx: "You can spell 1,570 words now" misled). */}
          <SectionTitle>
            {show === "upper" ? "Your UPPERCASE letters" : show === "lower" ? "Your lowercase letters" : "Your letters"} can spell{" "}
            {spellable.length === 1 ? "1 possible word" : `${spellable.length.toLocaleString("en-US")} possible words`}
          </SectionTitle>
          {spellable.length > 1 && (
            <p className="-mt-1 mb-1 text-xs text-ink/60">One at a time: each word uses five of your letters, so spelling one can use letters another needs.</p>
          )}
          {show === "upper" && <p className="-mt-1 mb-1 text-xs text-ink/60">All five raised: each earns $WORD from day one once staked.</p>}
          <p className="text-xs text-ink/60">
            {ladder ? (
              <>
                The claim fee follows the word’s rarity:{" "}
                {TIERS.map((t, i) => (
                  <span key={t.name}>
                    {i > 0 ? " · " : ""}
                    {t.name} <strong className="font-bold text-ink">{fmtWord(g.tierClaimFee(t.name))}</strong>
                  </span>
                ))}{" "}
                $WORD.
              </>
            ) : (
              <>
                Each claim costs <strong className="font-bold text-ink">{amountText(baseFee)}</strong>.
              </>
            )}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Segmented
              className="w-full sm:w-64"
              value={order}
              onChange={setOrder}
              options={[
                { value: "rarest", label: "Rarest first" },
                { value: "az", label: "A–Z" },
              ]}
            />
            <div className="flex flex-wrap gap-1.5">
              {SPELL_TIERS.filter((t) => t === "All" || tierCounts[t]).map((t) => (
                <button key={t} onClick={() => setTier(t)} className="group round-btn rounded-full">
                  <Pill className={activeTier === t ? "bg-ink text-paper" : "bg-card transition-colors group-hover:bg-paper-dark"}>
                    {t !== "All" && <TierMark tier={t} size={12} />}
                    {t}
                    <span className={activeTier === t ? "text-paper/60" : "text-ink/40"}>·{t === "All" ? spellable.length : tierCounts[t]}</span>
                  </Pill>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 space-y-2 lg:grid lg:grid-cols-2 lg:gap-2.5 lg:space-y-0">
            {quick.slice(0, shown).map((w) => {
              // The case the filter claims in (filterBag): under All, each letter UPPERCASE where the
              // bag has one ("UPPERCASE first"). The tiles show exactly that.
              const cases = bag.casesFor(w);
              return (
                <div key={w} className="cel-sm flex items-center gap-3 rounded-2xl bg-card p-2.5">
                  <WordTiles word={w} upper={cases} size={26} tier={tierOf(w)} still />
                  <div className="flex-1">
                    <div className="font-display text-sm font-extrabold">{w}</div>
                    <TierBadge tier={tierOf(w)} />
                  </div>
                  {ownersKnown && !canClaimWord(w) ? (
                    // Short of THIS word's fee: the way to get exactly that, never a dead button.
                    <Button size="sm" variant="ghost" onClick={() => getWordFor(w)} title={feeSay(w)}>
                      Need {fmtWord(feeOf(w))}
                    </Button>
                  ) : (
                    <Button size="sm" variant="teal" disabled={!ownersKnown} onClick={() => claim(w, cases)} title={feeSay(w)}>
                      {ownersKnown ? `Claim · ${fmtWord(feeOf(w))}` : ownerWait}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          {quick.length > shown && (
            <Button full variant="ghost" className="mt-3" onClick={() => setShown((n) => n + SPELL_PAGE)}>
              Show {Math.min(SPELL_PAGE, quick.length - shown)} more · {(quick.length - shown).toLocaleString("en-US")} left
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** A filter's name and how many loose letters it holds. */
function FilterLabel({ name, count }: { name: string; count: number }) {
  return (
    <>
      {name} <span className="opacity-60">·{count}</span>
    </>
  );
}

const SPELL_TIERS: (Tier | "All")[] = ["All", "Mythic", "Legendary", "Rare", "Uncommon", "Common"];
const SPELL_PAGE = 60;

/** A word's claim fee, said plainly with its tier; when the balance can't cover it, the way to get more. */
function FeeLine({ text, canClaim, onGetWord }: { text: string; canClaim: boolean; onGetWord: () => void }) {
  return (
    <div className="mt-1 text-center text-xs text-ink/60">
      <strong className="font-bold text-ink">{text}</strong>
      {!canClaim && (
        <>
          {" "}You don’t have enough.{" "}
          <button onClick={onGetWord} className="font-bold text-candy-ink underline">
            Get $WORD
          </button>
        </>
      )}
    </div>
  );
}
