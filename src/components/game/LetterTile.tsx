"use client";
/**
 * Legacy tile API — now backed by the vaudeville {@link TileCharacter} rig. `LetterTile` and
 * `WordTiles` keep their original prop surface so every existing call site upgrades to the new
 * tiles for free; they additionally accept `state` / `gild` / `value` so screens that hold word
 * data can surface a word's care + prestige. `CaseBadge` / `PrestigeStars` are unchanged.
 */
import { TileCharacter, TileWord, type Gild, type TileDetail, type TilePose, type TileState } from "./TileCharacter";
import { Pill } from "./primitives";
import { Star } from "./ui/icons";
import { hunger, wordCase, type CaseState, type OwnedWord } from "./state";

/** Map a word's hunger to the idle / peckish / hungry display state of its tiles. */
export function careState(w: OwnedWord): TileState {
  const h = hunger(w);
  return h === "hungry" ? "hungry" : h === "peckish" ? "peckish" : "idle";
}

export function LetterTile({
  char,
  upper = false,
  count,
  selected = false,
  dim = false,
  size = 44,
  onClick,
  title,
  state = "idle",
  gild = 0,
  value,
  pose = "rest",
}: {
  char: string;
  upper?: boolean;
  count?: number;
  selected?: boolean;
  dim?: boolean;
  size?: number;
  onClick?: () => void;
  title?: string;
  state?: TileState;
  gild?: Gild;
  value?: number;
  pose?: TilePose;
}) {
  return (
    <TileCharacter
      char={char}
      upper={upper}
      state={state}
      gild={gild}
      value={value}
      pose={pose}
      size={size}
      count={count}
      selected={selected}
      dim={dim}
      onClick={onClick}
      title={title}
    />
  );
}

/** A claimed word as a tight row of case-derived tiles (the "link" pose at full size). */
export function WordTiles({
  word,
  upper,
  size = 34,
  state = "idle",
  gild = 0,
  detail = "auto",
}: {
  word: string;
  upper: boolean[];
  size?: number;
  state?: TileState;
  gild?: Gild;
  detail?: TileDetail;
}) {
  return <TileWord word={word} upper={upper} state={state} gild={gild} size={size} detail={detail} />;
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
    <span className="inline-flex text-gold-deep" title={`Gilded L${level}`} aria-label={`Gilded level ${level}`}>
      {Array.from({ length: level }).map((_, i) => (
        <Star key={i} weight="fill" size={11} />
      ))}
    </span>
  );
}
