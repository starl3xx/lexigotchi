"use client";
/**
 * Legacy tile API — now backed by the vaudeville {@link TileCharacter} rig. `LetterTile` and
 * `WordTiles` keep their original prop surface so every existing call site upgrades to the new
 * tiles for free; they additionally accept `state` / `gild` / `value` so screens that hold word
 * data can surface a word's care + prestige. `CaseBadge` / `PrestigeStars` are unchanged.
 */
import { TileCharacter, TileWord, type Gild, type TileDetail, type TilePose, type TileState } from "./TileCharacter";
import { Pill } from "./primitives";
import { EngravedMark } from "./EngravedMark";
import { stageName } from "@/lib/ascension";
import type { Tier } from "@/lib/economy";
import type { CollabLook } from "@/lib/collabLook";
import { hunger, wordCase, type CaseState, type OwnedWord } from "./state";
import { caseBadgeText } from "./careNote";

/** Map a word's hunger to the idle / peckish / hungry display state of its tiles. Hunger only
 *  advances for staked words (and only staked words show a hunger badge), so an unstaked word
 *  always reads as idle — never stale peckish/hungry. */
export function careState(w: OwnedWord): TileState {
  if (!w.staked) return "idle";
  const h = hunger(w);
  return h === "hungry" ? "hungry" : h === "peckish" ? "peckish" : "idle";
}

/** Clamp a raw prestige level (game data is a plain number) into the rig's 0–5 scale (5 = Holographic). */
const asGild = (n: number): Gild => (n <= 0 ? 0 : n >= 5 ? 5 : (Math.round(n) as Gild));

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
  gild?: number;
  value?: number;
  pose?: TilePose;
}) {
  return (
    <TileCharacter
      char={char}
      upper={upper}
      state={state}
      gild={asGild(gild)}
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
  tier,
  still = false,
  look,
}: {
  word: string;
  upper: boolean[];
  size?: number;
  state?: TileState;
  gild?: number;
  detail?: TileDetail;
  /** The word's rarity, worn as its tiles' material. Pass it where a player's own word is drawn
   *  (decisions.md #23); a list draws it still, since only the word in focus moves. */
  tier?: Tier;
  /** Hold the tiles still: a list draws its words still (only the card in focus moves). */
  still?: boolean;
  /** The word's collab look, when the caller already holds it (a page outside the game); otherwise it is looked up by the word. */
  look?: CollabLook | null;
}) {
  // A collab word's tiles wear its set's two colors in place of its rarity's material: TileWord
  // looks the word's look up itself (lib/collabLook.ts).
  return <TileWord word={word} upper={upper} state={state} gild={asGild(gild)} size={size} detail={detail} tier={tier} still={still} look={look} />;
}

const CASE_STYLE: Record<CaseState, string> = {
  lowercase: "bg-ink/10 text-ink",
  Mixed: "bg-gold/25 text-gold-ink",
  UPPERCASE: "bg-gold text-ink",
};
export function CaseBadge({ word }: { word: OwnedWord }) {
  return <Pill className={CASE_STYLE[wordCase(word)]}>{caseBadgeText(word, hunger(word))}</Pill>;
}

export function PrestigeStars({ level }: { level: number }) {
  if (level <= 0) return null;
  return (
    <span className="inline-flex text-ink" title={stageName(level)} aria-label={stageName(level)}>
      {Array.from({ length: level }).map((_, i) => (
        <EngravedMark key={i} kind="star" size={12} />
      ))}
    </span>
  );
}
