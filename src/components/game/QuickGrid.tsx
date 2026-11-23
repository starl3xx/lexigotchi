"use client";
/** The "Do something" tile grid — shared by Home and the More page so the two can't drift. */
import { ArrowsLeftRight, Backpack, BookOpen, MaskHappy, Medal, Planet, Ranking, Sparkle, TextAa, Trophy } from "./ui/icons";
import { useGame, type View } from "./state";
import { WORD_COUNT } from "@/lib/dictionary";

const TILES: { Icon: typeof Sparkle; label: string; sub: string; to: View }[] = [
  { Icon: Sparkle, label: "Mint letters", sub: "packs & daily", to: "mint" },
  { Icon: TextAa, label: "Spell a word", sub: "claim it forever", to: "claim" },
  { Icon: BookOpen, label: "Dictionary", sub: `${WORD_COUNT.toLocaleString("en-US")} words`, to: "dictionary" },
  { Icon: MaskHappy, label: "Showcase", sub: "flex & cast", to: "showcase" },
  { Icon: ArrowsLeftRight, label: "Swap", sub: "trade letters", to: "swap" },
  { Icon: Backpack, label: "My bag", sub: "letters & words", to: "bag" },
];

/** Extra rows the More page adds beyond Home's six. */
const MORE_TILES: typeof TILES = [
  { Icon: Trophy, label: "Jackpot", sub: "today’s draw", to: "jackpot" },
  { Icon: Medal, label: "Bounty", sub: "this week’s theme", to: "bounty" },
  { Icon: Ranking, label: "Leaderboard", sub: "top players", to: "leaderboard" },
  { Icon: Planet, label: "Let’s Have A Word!", sub: "the $WORD word hunt", to: "lhaw" },
];

export function QuickGrid({ extended = false }: { extended?: boolean }) {
  const { nav } = useGame();
  const tiles = extended ? [...TILES, ...MORE_TILES] : TILES;
  return (
    <div className={`grid grid-cols-2 gap-3 md:grid-cols-3 ${extended ? "lg:grid-cols-4" : "xl:grid-cols-6"}`}>
      {tiles.map((t) => (
        <button
          key={t.label}
          onClick={() => nav(t.to)}
          className="cel-sm flex flex-col gap-1 rounded-2xl bg-paper p-3 text-left transition-[transform,box-shadow] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
        >
          <t.Icon size={26} weight="bold" className="text-candy-ink" />
          <span className="font-display text-sm font-extrabold leading-tight">{t.label}</span>
          <span className="text-xs text-ink/60">{t.sub}</span>
        </button>
      ))}
    </div>
  );
}
