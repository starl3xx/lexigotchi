"use client";
/** Scrabble-tile letter rendering — the atom of the whole game. Lowercase = kid, UPPERCASE = glow-up. */
import { LETTERS_BY_FREQUENCY } from "@/lib/economy";
import { Pill } from "./primitives";
import { wordCase, type CaseState, type OwnedWord } from "./state";

// the 6 rarest letters get a star (Q J X Z K V …)
const RAREST = new Set(LETTERS_BY_FREQUENCY.slice(-6));

export function LetterTile({
  char,
  upper = false,
  count,
  selected = false,
  dim = false,
  size = 44,
  onClick,
  title,
}: {
  char: string;
  upper?: boolean;
  count?: number;
  selected?: boolean;
  dim?: boolean;
  size?: number;
  onClick?: () => void;
  title?: string;
}) {
  const glyph = upper ? char.toUpperCase() : char.toLowerCase();
  const isRare = RAREST.has(char.toUpperCase());
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      title={title}
      style={{ width: size, height: size }}
      className={`relative inline-flex shrink-0 items-center justify-center rounded-lg border-[3px] border-ink font-display font-extrabold leading-none transition-all
        ${upper ? "bg-gold text-ink shadow-[2px_2px_0_#b07d20]" : "bg-tile text-ink shadow-[2px_2px_0_#1b1714]"}
        ${selected ? "-translate-y-1 ring-2 ring-candy ring-offset-1 ring-offset-paper" : ""}
        ${dim ? "opacity-35" : ""}
        ${onClick ? "active:translate-x-[2px] active:translate-y-[2px] active:shadow-none" : ""}`}
    >
      <span style={{ fontSize: size * 0.5 }}>{glyph}</span>
      {isRare && (
        <span className="absolute -right-1 -top-1.5 text-[10px] text-gold-deep" aria-hidden>
          ✦
        </span>
      )}
      {upper && (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[10px]" aria-hidden>
          👑
        </span>
      )}
      {count !== undefined && count > 1 && (
        <span className="absolute -bottom-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-ink bg-paper px-1 text-[11px] font-bold">
          {count}
        </span>
      )}
    </Tag>
  );
}

/** A claimed word rendered as a tight row of 5 case-derived tiles. */
export function WordTiles({ word, upper, size = 34 }: { word: string; upper: boolean[]; size?: number }) {
  return (
    <div className="flex gap-1">
      {[...word].map((ch, i) => (
        <LetterTile key={i} char={ch} upper={upper[i]} size={size} />
      ))}
    </div>
  );
}

const CASE_STYLE: Record<CaseState, string> = {
  lowercase: "bg-ink/10 text-ink",
  Mixed: "bg-gold/25 text-gold-deep",
  UPPERCASE: "bg-gold text-ink",
};
export function CaseBadge({ word }: { word: OwnedWord }) {
  const c = wordCase(word);
  const upcount = word.upper.filter(Boolean).length;
  return (
    <Pill className={CASE_STYLE[c]}>
      {c === "UPPERCASE" ? "UPPERCASE · 2× yield" : c === "Mixed" ? `${upcount}/5 raised` : "lowercase"}
    </Pill>
  );
}

export function PrestigeStars({ level }: { level: number }) {
  if (level <= 0) return null;
  return (
    <span className="text-gold-deep" title={`Gilded L${level}`} aria-label={`Gilded level ${level}`}>
      {"★".repeat(level)}
    </span>
  );
}
