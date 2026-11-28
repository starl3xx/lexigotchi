import { CROWN_BAND, MARK_BOX, MARK_GOLD, MARK_OUTLINE, MARK_SHADE, RAYS_FROM, SHADE_FROM, TWINKLE_RAYS, markHairline, markStroke, type MarkKind } from "@/lib/engravedMark";

/**
 * The game's own star, crown, or twinkle (lib/engravedMark; decisions.md #66, part 2): an ink
 * outline, a flat gold fill, and ruled shade lines where it is large enough to hold them.
 *
 * - The outline is drawn in the text's colour (ink, unless the box it sits in says otherwise), so
 *   a mark on a dark ground still has a line that shows.
 * - `earned={false}` is the mark not yet won (a stage of the ladder still ahead): its outline
 *   alone, no fill.
 * - It always sits beside the words that say what it means, so it is decorative (hidden from
 *   screen readers). It never moves and never changes size. No hooks: it draws on the server too.
 */
export function EngravedMark({
  kind,
  size,
  earned = true,
  fill = MARK_GOLD,
  className = "",
}: {
  kind: MarkKind;
  /** its width and height on the screen, in pixels */
  size: number;
  earned?: boolean;
  /** the fill of an earned mark, where gold would be lost on its ground */
  fill?: string;
  className?: string;
}) {
  const line = markStroke(size);
  const fine = markHairline(size);
  return (
    <svg className={className} viewBox={`0 0 ${MARK_BOX} ${MARK_BOX}`} width={size} height={size} style={{ flex: "none" }} fill="none" stroke="currentColor" strokeLinejoin="round" strokeLinecap="round" aria-hidden data-mark={kind}>
      {kind === "twinkle" && size >= RAYS_FROM && <path d={TWINKLE_RAYS} strokeWidth={fine} />}
      <path d={MARK_OUTLINE[kind]} fill={earned ? fill : "none"} strokeWidth={line} />
      {earned && size >= SHADE_FROM && <path d={MARK_SHADE[kind]} strokeWidth={fine} opacity={0.6} />}
      {kind === "crown" && <path d={CROWN_BAND} strokeWidth={size >= SHADE_FROM ? fine * 1.4 : line * 0.75} />}
    </svg>
  );
}
