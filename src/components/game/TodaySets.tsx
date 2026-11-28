"use client";
/**
 * Today's Sets card (decisions.md, "A set's moments in the game"): every set that is still news,
 * one row each. A player who never opens the Dictionary still learns that a set is coming, that it
 * unlocked, or that its first day is running.
 *
 * - A row says what the Dictionary says of the set (sets.ts todayLine), under the set's name and
 *   one of its words in its own tiles (a collab's wear its two colors). A tap opens the Dictionary
 *   at its Sets section.
 * - Only what is public: revealed and released sets. A locked slot stays in the Dictionary.
 * - Nothing shows while the sets aren't known, and nothing when no set is news (sets.ts todaySets).
 */
import { MiniTiles } from "./MiniTiles";
import { Card, SectionTitle } from "./primitives";
import { CaretRight } from "./ui/icons";
import { todayLine, todaySets, type ShownSet } from "./sets";
import { useGame } from "./state";
import { useTierOf } from "./useRarity";
import { useMinuteClock, useSets } from "./useSets";

const LOWER = [false, false, false, false, false];
/** Rows shown before "and N more": Today is not the list of sets. */
export const TODAY_SETS_MAX = 2;

function Row({ set, now, gate, onOpen }: { set: ShownSet; now: number; gate: boolean; onOpen: () => void }) {
  const tierOf = useTierOf();
  const first = set.words[0]?.word;
  return (
    <li>
      <button onClick={onOpen} className="press flex w-full items-center gap-3 py-2.5 text-left">
        {first && (
          <span className="shrink-0" aria-hidden>
            <MiniTiles word={first} upper={LOWER} tier={tierOf(first)} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[15px] font-extrabold leading-tight">{set.name}</span>
          {set.collab && <span className="block truncate text-xs leading-snug text-ink/60">A collaboration with {set.collab.partner}</span>}
          <span className="block text-[13px] leading-snug text-ink/75">{todayLine(set, now, gate)}</span>
        </span>
        <CaretRight className="shrink-0 text-ink/40" aria-hidden />
      </button>
    </li>
  );
}

export function TodaySets() {
  const { known, sets, gate } = useSets();
  const now = useMinuteClock();
  const g = useGame();
  if (!known) return null;
  const news = todaySets(sets, now);
  if (news.length === 0) return null;
  const open = () => g.nav("dictionary", "sets");
  const more = news.length - TODAY_SETS_MAX;
  return (
    <Card>
      <SectionTitle>Sets</SectionTitle>
      <ul className="divide-y-2 divide-ink/10 [&>li:first-child>button]:pt-0 [&>li:last-child>button]:pb-0">
        {news.slice(0, TODAY_SETS_MAX).map((s) => (
          <Row key={s.id} set={s} now={now} gate={gate} onOpen={open} />
        ))}
      </ul>
      {more > 0 && (
        <button onClick={open} className="mt-2 w-full border-t-2 border-ink/10 pt-2 text-left text-xs font-bold text-ink/60 underline">
          and {more} more in the Dictionary
        </button>
      )}
    </Card>
  );
}
