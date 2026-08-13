"use client";
/** The "Do something" tile grid — shared by Home and the More page so the two can't drift. */
import { ArrowsLeftRight, Backpack, BookOpen, MaskHappy, Medal, Sparkle, TextAa, Trophy } from "./ui/icons";
import { useGame, type View } from "./state";

const TILES: { Icon: typeof Sparkle; label: string; sub: string; to: View }[] = [
  { Icon: Sparkle, label: "Mint letters", sub: "packs & daily", to: "mint" },
  { Icon: TextAa, label: "Spell a word", sub: "claim it forever", to: "claim" },
  { Icon: BookOpen, label: "Lexidex", sub: "4,438 words", to: "lexidex" },
  { Icon: MaskHappy, label: "Showcase", sub: "flex & cast", to: "showcase" },
  { Icon: ArrowsLeftRight, label: "Swap", sub: "trade letters", to: "swap" },
  { Icon: Backpack, label: "My bag", sub: "letters & words", to: "bag" },
];

/** Extra rows the More page adds beyond Home's six. */
const MORE_TILES: typeof TILES = [
  { Icon: Trophy, label: "Jackpot", sub: "today's draw", to: "jackpot" },
  { Icon: Medal, label: "Bounty", sub: "this week's theme", to: "bounty" },
];

export function QuickGrid({ extended = false }: { extended?: boolean }) {
  const { nav } = useGame();
  const tiles = extended ? [...TILES, ...MORE_TILES] : TILES;
  return (
    <div className="grid grid-cols-2 gap-3">
      {tiles.map((t) => (
        <button
          key={t.label}
          onClick={() => nav(t.to)}
          className="cel flex flex-col gap-1 rounded-2xl bg-paper p-3 text-left transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
        >
          <t.Icon size={26} weight="bold" className="text-candy" />
          <span className="font-display text-sm font-extrabold leading-tight">{t.label}</span>
          <span className="text-[11px] text-ink/55">{t.sub}</span>
        </button>
      ))}
    </div>
  );
}
