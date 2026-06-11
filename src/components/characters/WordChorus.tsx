/**
 * A claimed Word as a chorus line (spec §7): five characters holding hands. Lowercase words
 * shuffle side to side; full-UPPERCASE words do the synchronized kick. Trophy words wear a
 * medal; the day's jackpot winner does the confetti number.
 */
import { Rig, type RigState } from "./Rig";

export interface WordChorusProps {
  word: string;
  variant?: "lower" | "upper";
  /** override the per-letter state (else derived from variant) */
  state?: RigState;
  trophy?: boolean;
  earning?: boolean;
  size?: number;
}

export function WordChorus({
  word,
  variant = "lower",
  state,
  trophy = false,
  earning = false,
  size = 110,
}: WordChorusProps) {
  const letters = word.toUpperCase().split("");
  const choreography = variant === "upper" ? "animate-kick" : "animate-shuffle";
  const baseState: RigState = state ?? "idle";

  return (
    <div className="relative inline-flex flex-col items-center">
      <div className={`flex items-end ${choreography}`} style={{ gap: -size * 0.06 }}>
        {letters.map((ch, i) => (
          <div
            key={i}
            // stagger the chorus so the line ripples rather than moving as a block
            style={{ animationDelay: `${i * 0.08}s`, marginLeft: i ? -size * 0.05 : 0 }}
          >
            <Rig
              letter={ch}
              variant={variant}
              state={baseState}
              earning={earning}
              size={size}
            />
          </div>
        ))}
      </div>
      {/* stage floorboards */}
      <div
        className="mt-[-6px] h-2 rounded-full bg-ink/15"
        style={{ width: letters.length * size * 0.72 }}
      />
      {trophy && (
        <div className="mt-1 flex items-center gap-1 font-display text-sm font-bold text-gold-deep">
          <span aria-hidden>★</span> trophy — a past LHAW answer
        </div>
      )}
    </div>
  );
}
