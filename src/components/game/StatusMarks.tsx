/**
 * A word's three status marks (./stageMarks: Fed, Jackpot, Earns), drawn. In full: an icon, the
 * mark's small label, and its few words, three across (the Today placard, the word's sheet).
 * `compact`: the three icons alone in the colours of their meaning, each with its words for a
 * screen reader and on hover (a card in the Bag).
 */
import { Coins, Cookie, Ticket } from "./ui/icons";
import { marksSentence, type MarkKey, type MarkTone, type StageMark } from "./stageMarks";

const ICON: Record<MarkKey, typeof Cookie> = { fed: Cookie, jackpot: Ticket, earns: Coins };
/** One meaning per colour (the game's rule): teal care and growth, gold chance, candy "it needs you", quiet nothing yet. */
const TONE: Record<MarkTone, string> = {
  teal: "bg-teal/20 text-teal-ink",
  gold: "bg-gold/30 text-gold-ink",
  candy: "bg-candy/15 text-candy-ink",
  quiet: "bg-ink/[0.07] text-ink/70",
};

export function StatusMarks({ marks, compact = false, className = "" }: { marks: readonly StageMark[]; compact?: boolean; className?: string }) {
  if (compact) {
    return (
      <ul className={`tm tm-compact ${className}`} aria-label={marksSentence(marks)}>
        {marks.map((m) => {
          const Icon = ICON[m.key];
          return (
            <li key={m.key} className={`tm-mark ${TONE[m.tone]}`} title={`${m.about}: ${m.value}`}>
              <Icon weight="fill" size={14} aria-hidden />
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <ul className={`tm ${className}`}>
      {marks.map((m) => {
        const Icon = ICON[m.key];
        return (
          <li key={m.key} className={`tm-mark ${TONE[m.tone]}`}>
            <Icon weight="fill" size={18} aria-hidden className="shrink-0" />
            <span>
              <small>{m.about}</small>
              <b>{m.value}</b>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
