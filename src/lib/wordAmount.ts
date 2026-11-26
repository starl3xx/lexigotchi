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

/**
 * A dollar amount read at a glance, for "about" figures: "$4.20", "$420", "$1.2K", "$3.4M". The
 * $WORD page and Today's pots share it. Unknown (or not a number) is an en dash, never "$0".
 */
export function fmtUsdShort(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return "–";
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(1)}K`;
  return `$${usd.toFixed(usd < 10 ? 2 : 0)}`;
}
