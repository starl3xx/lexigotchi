/**
 * The shared rubber-hose "rig" (spec §7): one rig drives all 52 characters via per-letter
 * silhouette + accessories + a maturity variant. 1930s rubber-hose vocabulary — noodle
 * limbs, white gloves, pie-cut eyes, squash-and-stretch. Animation states map 1:1 to game
 * states; here we cover the Phase-1 set (idle / peckish / hungry / celebrate) in pure CSS
 * keyframes (Rive replaces this in Phase 3).
 *
 * Lowercase = "the kids" (smaller, rounder, gap-toothed). UPPERCASE = "the glow-ups"
 * (taller, top hat, monocle). The case is derived, never stored — this component just
 * renders whatever case + state it's handed.
 */
import type { CSSProperties } from "react";

export type RigState = "idle" | "peckish" | "hungry" | "celebrate";
export type RigCase = "lower" | "upper";

const ANIM: Record<RigState, string> = {
  idle: "animate-idle",
  peckish: "animate-droop",
  hungry: "animate-slump",
  celebrate: "animate-happy-dance",
};

// rough per-letter accent color so the 3 demo characters read as distinct individuals
const LETTER_TINT: Record<string, string> = {
  S: "#2a9d8f", // teal
  Q: "#7b4ea3", // regal purple — the Charizard
  A: "#d8463f", // candy red
  E: "#e0a93b",
};

export interface RigProps {
  letter: string; // single A–Z glyph (the character's identity)
  state?: RigState;
  variant?: RigCase;
  /** true when the word/letter is staked & earning (adds a faint coin sparkle) */
  earning?: boolean;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function Rig({
  letter,
  state = "idle",
  variant = "lower",
  earning = false,
  size = 160,
  className = "",
  style,
}: RigProps) {
  const isUpper = variant === "upper";
  const glyph = isUpper ? letter.toUpperCase() : letter.toLowerCase();
  const tint = LETTER_TINT[letter.toUpperCase()] ?? "#2a9d8f";
  const eyeOpen = state !== "hungry";
  const mouth =
    state === "hungry"
      ? "M62 118 q18 -16 36 0" // deep frown
      : state === "peckish"
        ? "M64 116 h32" // flat line
        : "M62 108 q18 26 36 0"; // big toothy grin
  const eyeY = isUpper ? 66 : 72;

  return (
    <div
      className={`inline-block ${className}`}
      style={{ width: size, height: size, ...style }}
      aria-label={`${glyph} character — ${state}${isUpper ? " (UPPERCASE)" : ""}`}
      role="img"
    >
      <svg
        viewBox="0 0 160 190"
        width={size}
        height={size * 1.18}
        className={`${ANIM[state]} origin-bottom overflow-visible`}
      >
        {/* shadow — scales with the body footprint */}
        <ellipse cx="80" cy="182" rx={isUpper ? 50 : 40} ry="7" fill="#1b1714" opacity="0.18" />

        {/* noodle legs + spats */}
        <path d="M64 150 q-10 18 -18 28" stroke="#1b1714" strokeWidth="7" fill="none" strokeLinecap="round" />
        <path d="M96 150 q10 18 18 28" stroke="#1b1714" strokeWidth="7" fill="none" strokeLinecap="round" />
        <ellipse cx="44" cy="180" rx="11" ry="6" fill="#1b1714" />
        <ellipse cx="116" cy="180" rx="11" ry="6" fill="#1b1714" />

        {/* body = the letter tile, squash/stretch via the parent animation */}
        <g>
          <rect
            x={isUpper ? 32 : 42}
            y={isUpper ? 36 : 48}
            width={isUpper ? 96 : 76}
            height={isUpper ? 104 : 84}
            rx={isUpper ? 12 : 26}
            fill={tint}
            stroke="#1b1714"
            strokeWidth="4"
          />
          {/* the glyph — UPPERCASE glow-ups are markedly taller & bolder */}
          <text
            x="80"
            y={isUpper ? 118 : 110}
            textAnchor="middle"
            fontFamily="var(--font-display)"
            fontWeight="800"
            fontSize={isUpper ? 78 : 52}
            fill="#f4ead2"
            stroke="#1b1714"
            strokeWidth="1.5"
          >
            {glyph}
          </text>

          {/* pie-cut eyes */}
          <g>
            {eyeOpen ? (
              <>
                <circle cx="63" cy={eyeY} r="12" fill="#f4ead2" stroke="#1b1714" strokeWidth="3" />
                <circle cx="97" cy={eyeY} r="12" fill="#f4ead2" stroke="#1b1714" strokeWidth="3" />
                {/* pupils — sink & cross-in when peckish (tired) */}
                <circle cx={state === "peckish" ? 64 : 66} cy={eyeY + (state === "peckish" ? 5 : 2)} r="5" fill="#1b1714" />
                <circle cx={state === "peckish" ? 96 : 100} cy={eyeY + (state === "peckish" ? 5 : 2)} r="5" fill="#1b1714" />
                {/* glints */}
                <circle cx="68" cy={eyeY - 3} r="2" fill="#f4ead2" opacity="0.85" />
                <circle cx="102" cy={eyeY - 3} r="2" fill="#f4ead2" opacity="0.85" />
              </>
            ) : (
              <>
                <path d={`M53 ${eyeY} q10 7 20 0`} stroke="#1b1714" strokeWidth="3" fill="none" strokeLinecap="round" />
                <path d={`M87 ${eyeY} q10 7 20 0`} stroke="#1b1714" strokeWidth="3" fill="none" strokeLinecap="round" />
              </>
            )}
          </g>

          {/* mouth */}
          <path d={mouth} stroke="#1b1714" strokeWidth="3" fill="none" strokeLinecap="round" />

          {/* hungry: zzz */}
          {state === "hungry" && (
            <text x="120" y="56" fontFamily="var(--font-display)" fontSize="16" fill="#1b1714">
              z
            </text>
          )}
        </g>

        {/* noodle arms + white gloves */}
        <path
          d={state === "celebrate" ? "M40 96 q-16 -22 -6 -40" : "M40 100 q-16 6 -20 22"}
          stroke="#1b1714"
          strokeWidth="7"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d={state === "celebrate" ? "M120 96 q16 -22 6 -40" : "M120 100 q16 6 20 22"}
          stroke="#1b1714"
          strokeWidth="7"
          fill="none"
          strokeLinecap="round"
        />
        <circle cx={state === "celebrate" ? 32 : 18} cy={state === "celebrate" ? 54 : 124} r="8" fill="#f4ead2" stroke="#1b1714" strokeWidth="3" />
        <circle cx={state === "celebrate" ? 128 : 142} cy={state === "celebrate" ? 54 : 124} r="8" fill="#f4ead2" stroke="#1b1714" strokeWidth="3" />

        {/* UPPERCASE glow-ups wear a top hat + monocle */}
        {isUpper && (
          <g>
            {/* top hat with gold hatband */}
            <rect x="50" y="10" width="60" height="28" rx="2" fill="#1b1714" />
            <rect x="52" y="33" width="56" height="3.5" rx="1" fill="#e0a93b" />
            <rect x="42" y="37" width="76" height="7" rx="3" fill="#1b1714" />
            {/* monocle over the right eye, with a dangling cord */}
            <circle cx="97" cy={eyeY} r="15" fill="none" stroke="#e0a93b" strokeWidth="2.5" />
            <line x1="104" y1={eyeY + 12} x2="100" y2="106" stroke="#e0a93b" strokeWidth="1.5" opacity="0.85" />
          </g>
        )}

        {earning && (
          <g className="animate-blink">
            <circle cx="136" cy="38" r="12" fill="#e0a93b" stroke="#1b1714" strokeWidth="2.5" />
            <text x="136" y="43" textAnchor="middle" fontFamily="var(--font-display)" fontSize="15" fontWeight="800" fill="#1b1714">
              $
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
