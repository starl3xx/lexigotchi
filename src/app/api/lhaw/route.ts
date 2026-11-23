import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET — Let's Have A Word!'s public numbers for the in-game LHAW page: the live round, the last
 * finished round, the rounds played, and $WORD's supply figures. Read from LHAW's own public API
 * on the server (no cross-site call from the browser), and cached a minute. Each part is optional:
 * a part LHAW doesn't answer is simply absent, and the page shows the rest.
 */
const LHAW = "https://letshaveaword.fun";
const TTL_MS = 60_000;
const WEI = 10n ** 18n;

export interface LhawSummary {
  ok: true;
  live?: { round: number; potUsd: number | null; potWord: number | null; guesses: number; top10Left: number | null };
  last?: { round: number; word: string; jackpotUsd: number | null; players: number; guesses: number };
  roundsPlayed?: number;
  token?: { marketCapUsd: number | null; burned: number | null; staked: number | null };
}

let cached: { at: number; body: LhawSummary } | null = null;

async function get(path: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${LHAW}${path}`, { signal: AbortSignal.timeout(6_000), headers: { accept: "application/json" } });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const wholeWord = (wei: unknown) => {
  try {
    return wei == null ? null : Number(BigInt(String(wei)) / WEI);
  } catch {
    return null;
  }
};

async function build(): Promise<LhawSummary> {
  const [state, latest, list, token] = await Promise.all([
    get("/api/round-state"),
    get("/api/archive/latest"),
    get("/api/archive/list?limit=1"),
    get("/api/word-tokenomics"),
  ]);
  const body: LhawSummary = { ok: true };
  if (state && num(state.roundId) != null) {
    body.live = {
      round: num(state.roundId)!,
      potUsd: num(state.prizePoolUsd),
      potWord: state.prizeCurrency === "word" ? wholeWord(state.prizePoolWord) : null,
      guesses: num(state.globalGuessCount) ?? 0,
      top10Left: state.top10Locked ? 0 : num(state.top10GuessesRemaining),
    };
  }
  const r = (latest?.round ?? null) as Record<string, unknown> | null;
  if (r && typeof r.targetWord === "string") {
    body.last = {
      round: num(r.roundNumber) ?? 0,
      word: r.targetWord.toUpperCase(),
      jackpotUsd: num(r.finalJackpotUsdCents) != null ? num(r.finalJackpotUsdCents)! / 100 : null,
      players: num(r.uniquePlayers) ?? 0,
      guesses: num(r.totalGuesses) ?? 0,
    };
  }
  if (list && num(list.total) != null) body.roundsPlayed = num(list.total)!;
  if (token) body.token = { marketCapUsd: num(token.marketCap), burned: num(token.totalBurned), staked: num(token.totalStaked) };
  return body;
}

export async function GET() {
  const headers = { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" };
  if (cached && Date.now() - cached.at < TTL_MS) return NextResponse.json(cached.body, { headers });
  const body = await build();
  if (body.live || body.last) cached = { at: Date.now(), body };
  return NextResponse.json(body.live || body.last ? body : cached?.body ?? body, { headers });
}
