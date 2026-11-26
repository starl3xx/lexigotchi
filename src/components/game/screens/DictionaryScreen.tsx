"use client";
/**
 * Dictionary: every claimable word (WORD_COUNT), who has it, and how close the player is to
 * spelling it (decisions.md #30).
 *
 * - **An entry shows what the player holds.** Its tiles are the word as it would be claimed: a
 *   letter the player doesn't hold is an empty dashed slot, and the line under the name says where
 *   they stand ("You can spell it", "Needs a q", lib/wordNeed). A word someone else has steps back
 *   (faded tiles); one that is for sale, or the player's own, stays at full strength.
 * - **A tap opens the word** (sheets/LookupSheet): what's needed and how to get it. The player's
 *   own words open their card, as before.
 * - **Closest first** and the quick filters find the near misses (lib/dictionaryList). Spell
 *   already lists what the letters spell; this screen's new ground is one letter away.
 * - **Nothing is promised before the owners are known** (useDictionary): until the world read
 *   answers, entries say "Checking who owns it…", and the distance sort and filters wait.
 */
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { WORDS, WORD_COUNT } from "@/lib/dictionary";
import { TIER_COUNTS, wordTier, type Tier } from "@/lib/economy";
import { cardNumber } from "@/lib/cardFacts";
import { DICT_SORTS, listDictionary, type DictFilter, type DictSort, type EntryStatus } from "@/lib/dictionaryList";
import { bagTotals, distanceOf, elsewhereTotals, needTokens, wordNeed } from "@/lib/wordNeed";
import { Button, Pill, Segmented, TierBadge } from "../primitives";
import { TierMark } from "../TierMark";
import { fmtWord, useGame } from "../state";
import { PlayerChip } from "../PlayerChip";
import { MiniTiles } from "../MiniTiles";
import { NeedText } from "../NeedText";
import { Check } from "../ui/icons";
import { useDictionary } from "../useDictionary";
import { useStoredChoice } from "../useStoredChoice";

const TIERS: (Tier | "All")[] = ["All", "Common", "Uncommon", "Rare", "Legendary", "Mythic"];
const LOWER = [false, false, false, false, false];
/** A page of the list: 80 words is 400 tiles, the most a slow phone draws without lagging the search. */
const PAGE = 80;

export function DictionaryScreen() {
  const g = useGame();
  const d = useDictionary();
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<Tier | "All">("All");
  const [filter, setFilter] = useState<DictFilter>("all");
  const [sort, setSort] = useStoredChoice<DictSort>("lexigotchi:dictionary:sort", DICT_SORTS, "closest");

  // There is something to count once the player holds a letter and the owners are known. Before
  // that an absent owner means "unknown", and a distance would be a promise the game can't keep.
  const counting = d.hasLetters && d.ownersKnown;
  const distances = useMemo(() => {
    if (!counting) return null;
    const here = bagTotals(d.here);
    const elsewhere = elsewhereTotals(d.here, d.all);
    // every word's distance, once per bag: half a millisecond for the whole dictionary
    return WORDS.map((w) => distanceOf(w, here, elsewhere));
  }, [counting, d.here, d.all]);

  // A filter that can't be answered yet shows everything, rather than an empty list.
  const needsCount = filter === "can" || filter === "one" || filter === "two";
  const activeFilter: DictFilter = (needsCount && !counting) || (!d.ownersKnown && filter !== "all") ? "all" : filter;
  // The list draws each word in its tiles: typing updates the box at once and the list a moment
  // later, so a slow phone never lags behind the keys.
  const query = useDeferredValue(q);
  const list = useMemo(
    () => listDictionary({ query, tier, filter: activeFilter, sort: counting ? sort : "az" }, d.statusOf, distances),
    [query, tier, activeFilter, sort, counting, d.statusOf, distances],
  );
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [query, tier, activeFilter, sort]);

  const open = (word: string, status: EntryStatus) =>
    status === "mine" ? g.openSheet({ kind: "word", word }) : g.openSheet({ kind: "lookup", word });

  const chip = (value: DictFilter, label: string, count?: number, off = false) => (
    <button key={value} onClick={() => setFilter(value)} disabled={off} className="group round-btn rounded-full disabled:opacity-40">
      <Pill className={activeFilter === value ? "bg-ink text-paper" : "bg-card transition-colors group-hover:bg-paper-dark"}>
        {label}
        {count !== undefined && <span className={activeFilter === value ? "text-paper/60" : "text-ink/40"}>·{count.toLocaleString("en-US")}</span>}
      </Pill>
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between md:justify-end">
        <h1 className="font-display text-2xl font-extrabold md:hidden">Dictionary</h1>
        <span className="text-xs text-ink/55">
          you own {d.ownedSet.size}
          {d.claimedCount > 0 && <> · {d.claimedCount.toLocaleString("en-US")} claimed</>} · {WORD_COUNT.toLocaleString("en-US")} words
        </span>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="search the dictionary…"
        className="w-full rounded-xl border-[3px] border-ink bg-card px-3 py-2.5 font-display text-sm font-bold placeholder:font-body placeholder:font-normal placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-candy"
      />

      {counting && (
        <Segmented
          className="w-full sm:w-80"
          value={sort}
          onChange={setSort}
          options={[
            { value: "closest", label: "Closest first" },
            { value: "az", label: "A to Z" },
          ]}
        />
      )}

      <div className="flex flex-wrap gap-1.5">
        {chip("all", "All")}
        {counting && chip("can", "Can spell", list.counts.can)}
        {counting && chip("one", "One away", list.counts.one)}
        {counting && chip("two", "Two away", list.counts.two)}
        {chip("unclaimed", "Unclaimed", undefined, !d.ownersKnown)}
        {chip("claimed", "Claimed", undefined, !d.ownersKnown)}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TIERS.map((t) => (
          <button key={t} onClick={() => setTier(t)} className="group round-btn rounded-full">
            <Pill className={tier === t ? "bg-ink text-paper" : "bg-card transition-colors group-hover:bg-paper-dark"}>
              {t !== "All" && <TierMark tier={t} size={12} />}
              {t}
              {/* the count stays readable on the selected (ink) chip, as Spell's does */}
              {t !== "All" && <span className={tier === t ? "text-paper/60" : "text-ink/40"}>·{TIER_COUNTS[t as Tier]}</span>}
            </Pill>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
        {list.words.slice(0, shown).map((w) => {
          const status = d.statusOf(w);
          const wTier = wordTier(w);
          const owner = d.owners?.[w];
          const number = d.numbers?.[w];
          const listing = d.listings.get(w);
          // the player's letters are counted only against a word nobody has
          const need = status === "open" && counting ? wordNeed(w, d.here, d.all) : null;
          const spellable = !!need && need.missing.length === 0 && need.away.length === 0;
          const yours = status === "mine" || status === "mineAway";
          return (
            <button
              key={w}
              onClick={() => open(w, status)}
              className={`press flex min-w-0 flex-col items-start gap-2 rounded-xl p-3 text-left ${yours ? "cel bg-teal/10" : "cel-sm bg-card"}`}
            >
              {/* the word in flat tiles, still: as it would be claimed (a dashed slot for a letter
                  the player lacks), in its owner's case when it's the player's or for sale, and
                  stepped back when someone else has it and isn't selling */}
              <MiniTiles
                large
                word={w}
                upper={need ? need.upper : (d.caseOf.get(w) ?? listing?.upper ?? LOWER)}
                letters={need?.letters}
                tier={status === "unknown" ? undefined : wTier}
                className={status === "taken" ? "opacity-50" : ""}
              />
              <span className="flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span className="font-display text-[15px] font-extrabold leading-tight">{w}</span>
                <TierBadge tier={wTier} />
              </span>
              <span className="flex w-full min-w-0 items-center gap-1.5 text-[13px] leading-snug">
                {status === "mine" || status === "mineAway" ? (
                  <span className="font-extrabold text-teal-ink">{status === "mine" ? "Yours" : "Yours, in another wallet"}</span>
                ) : status === "sale" && listing ? (
                  <span className="font-bold text-gold-ink">For sale · {fmtWord(listing.price)} $WORD</span>
                ) : (status === "taken" || status === "sale") && owner ? (
                  <span className="min-w-0 text-ink/70">
                    <PlayerChip address={owner} profile={d.profiles?.[owner]} size={16} />
                  </span>
                ) : status === "unknown" ? (
                  <span className="text-ink/55">{d.checkFailed ? "Can’t check the owner yet" : "Checking who owns it…"}</span>
                ) : !need ? (
                  <span className="text-ink/60">Unclaimed</span>
                ) : spellable ? (
                  <span className="inline-flex items-center gap-1 font-extrabold text-teal-ink">
                    <Check weight="bold" size={13} /> You can spell it
                  </span>
                ) : (
                  <span className="min-w-0 text-ink">
                    <NeedText tokens={needTokens(need, w, "line")} />
                  </span>
                )}
                {number && status !== "open" && status !== "unknown" ? (
                  <span className="shrink-0 font-bold tabular-nums text-ink/60">{cardNumber(number)}</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      {list.words.length > shown && (
        <Button full variant="ghost" onClick={() => setShown((n) => n + PAGE)}>
          Show {Math.min(PAGE, list.words.length - shown)} more · {(list.words.length - shown).toLocaleString("en-US")} left
        </Button>
      )}
      {list.words.length === 0 && <p className="py-8 text-center text-sm text-ink/55">no words match.</p>}
    </div>
  );
}
