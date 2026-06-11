/**
 * Lexigotchi wordmark — vintage Scrabble-tile lockup. Each letter sits on a wooden tile
 * with its dictionary point-ish value; the whole thing reads as "a word made of letters,"
 * which is the entire game. The "GOTCHI" half nods to the tamagotchi care loop.
 */
export function Wordmark({ size = 1 }: { size?: number }) {
  const letters = "LEXIGOTCHI".split("");
  const tile = 44 * size;
  const gap = 6 * size;
  return (
    <div className="flex items-end" style={{ gap }}>
      {letters.map((ch, i) => (
        <span
          key={i}
          className="tile inline-flex items-center justify-center font-display font-extrabold"
          style={{
            width: tile,
            height: tile,
            fontSize: 26 * size,
            transform: `rotate(${(i % 2 ? 1 : -1) * (1 + (i % 3))}deg)`,
            background: i < 4 ? "#e8c98a" : "#e0a93b",
          }}
        >
          {ch}
        </span>
      ))}
    </div>
  );
}
