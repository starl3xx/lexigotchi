"use client";
/**
 * Dictionary: browse every claimable word (WORD_COUNT), its tier, and who owns it. Your own words
 * are marked and open their sheet; a word someone else owns shows their Farcaster picture and name
 * (or a short address), from the shared world read (/api/world).
 */
import { useMemo, useState } from "react";
import { WORDS, WORD_COUNT } from "@/lib/dictionary";
import { TIER_COUNTS, wordTier, type Tier } from "@/lib/economy";
import { Pill, TierBadge } from "../primitives";
import { useGame } from "../state";
import { PlayerChip } from "../PlayerChip";
import { useMyWallets, useWorld } from "../useWorld";

const TIERS: (Tier | "All")[] = ["All", "Common", "Uncommon", "Rare", "Epic", "Legendary"];

export function DictionaryScreen() {
  const g = useGame();
  const { state } = g;
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<Tier | "All">("All");

  const ownedSet = useMemo(() => new Set(state.words.map((w) => w.word)), [state.words]);
  const world = useWorld();
  const mine = useMyWallets();
  const owners = world.data?.owners ?? {};
  const profiles = world.data?.profiles ?? {};
  const claimedCount = Object.keys(owners).length;
  // Owners are KNOWN only once the world read succeeds (always, in the practice game, which has no
  // other players). While it loads or after it fails, an absent owner means "unknown", never
  // "unclaimed": telling a player to spell a word someone owns sends them into an AlreadyClaimed
  // revert (Bugbot on #120).
  const ownersKnown = !state.chainBacked || world.data?.live === true;

  const results = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const out: string[] = [];
    for (const w of WORDS) {
      if (needle && !w.includes(needle)) continue;
      if (tier !== "All" && wordTier(w) !== tier) continue;
      out.push(w);
      if (out.length >= 80) break;
    }
    return out;
  }, [q, tier]);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between md:justify-end">
        <h1 className="font-display text-2xl font-extrabold md:hidden">Dictionary</h1>
        <span className="text-xs text-ink/55">
          you own {ownedSet.size}
          {claimedCount > 0 && <> · {claimedCount.toLocaleString("en-US")} claimed</>} · {WORD_COUNT.toLocaleString("en-US")} words
        </span>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="search the dictionary…"
        className="w-full rounded-xl border-[3px] border-ink bg-card px-3 py-2.5 font-display text-sm font-bold placeholder:font-body placeholder:font-normal placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-candy"
      />

      <div className="flex flex-wrap gap-1.5">
        {TIERS.map((t) => (
          <button key={t} onClick={() => setTier(t)} className="group round-btn rounded-full">
            <Pill className={tier === t ? "bg-ink text-paper" : "bg-card transition-colors group-hover:bg-paper-dark"}>
              {t}
              {t !== "All" && <span className="text-ink/40">·{TIER_COUNTS[t as Tier]}</span>}
            </Pill>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
        {results.map((w) => {
          // Yours: in your bag (the union bag covers linked wallets) or owned by one of your wallets.
          const owner = owners[w];
          const owned = ownedSet.has(w) || (!!owner && mine.has(owner));
          const theirs = !owned && !!owner;
          const ownerName = owner ? (profiles[owner] ? `@${profiles[owner].username}` : `${owner.slice(0, 6)}…${owner.slice(-4)}`) : "";
          return (
            <button
              key={w}
              onClick={() =>
                owned && ownedSet.has(w)
                  ? g.openSheet({ kind: "word", word: w })
                  : theirs
                    ? g.toast(`${w} belongs to ${ownerName}.`, "info")
                    : owned
                      ? g.toast(`${w} is yours, in a linked wallet.`, "info")
                      : ownersKnown
                        ? g.toast(`${w} is unclaimed. Spell it to own it.`, "info")
                        : g.toast(
                            world.isError ? `Couldn’t check who owns ${w}. Try again in a moment.` : `Checking who owns ${w}…`,
                            "info",
                          )
              }
              className={`${owned ? "cel" : "cel-sm"} flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left press ${
                owned ? "bg-teal/10 ring-2 ring-teal ring-offset-1 ring-offset-paper" : "bg-card"
              }`}
            >
              <div className="min-w-0">
                <div className="font-display text-sm font-extrabold">{w}</div>
                {theirs ? (
                  <div className="mt-0.5 text-xs text-ink/70">
                    <PlayerChip address={owner} profile={profiles[owner]} size={16} />
                  </div>
                ) : (
                  <TierBadge tier={wordTier(w)} />
                )}
              </div>
              {owned ? (
                <span className="shrink-0 rounded-full bg-teal px-1.5 py-0.5 text-[10px] font-extrabold text-ink">yours</span>
              ) : theirs ? (
                <TierBadge tier={wordTier(w)} />
              ) : ownersKnown ? null : (
                <span className="text-ink/20" title="checking the owner">…</span>
              )}
            </button>
          );
        })}
      </div>
      {results.length >= 80 && <p className="text-center text-xs text-ink/45">showing the first 80. Keep typing to narrow.</p>}
      {results.length === 0 && <p className="py-8 text-center text-sm text-ink/55">no words match.</p>}
    </div>
  );
}
