import type { Token } from "@/lib/wordNeed";

/**
 * A line from lib/wordNeed ("Needs a q", "You only need a q."), with each letter drawn as a tiny
 * tile, in lowercase: a letter always arrives lowercase. One inline run of text, so a "’s" stays
 * tight against its tile and the line wraps like a sentence.
 */
export function NeedText({ tokens }: { tokens: readonly Token[] }) {
  return (
    <>
      {tokens.map((t, i) =>
        typeof t === "string" ? (
          <span key={i}>{t}</span>
        ) : (
          <b key={i} className="need-letter">
            {t.letter}
          </b>
        ),
      )}
    </>
  );
}
