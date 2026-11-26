/**
 * A $WORD amount as players read it: "2.40M", "96.3K", "512". One formatter for the game's screens
 * (re-exported by components/game/state) and for pictures drawn on the server (the earnings share
 * card, app/e), which can't import the client store.
 */
export function fmtWord(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n)}`;
}
