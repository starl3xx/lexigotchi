"use client";
/**
 * Leaderboard: the wallets with the most words, letters, UPPERCASE letters, and jackpot wins
 * (lib/world, served by /api/world). Farcaster names and pictures where a wallet has an account.
 * "You" marks the connected wallet and every wallet Farcaster links to you.
 */
import { useState } from "react";
import { Card, EmptyState, Pill } from "../primitives";
import { Ranking } from "../ui/icons";
import { fmtWord, useGame } from "../state";
import { PlayerChip } from "../PlayerChip";
import { useMyWallets, useWorld } from "../useWorld";
import type { BoardKey } from "@/lib/world";

const BOARDS: { key: BoardKey; label: string; unit: (n: number) => string; blurb: string }[] = [
  { key: "words", label: "Words", unit: (n) => (n === 1 ? "word" : "words"), blurb: "Words owned, staked or held." },
  { key: "letters", label: "Letters", unit: (n) => (n === 1 ? "letter" : "letters"), blurb: "Every letter, loose or spelled into words." },
  { key: "raised", label: "UPPERCASE", unit: (n) => (n === 1 ? "letter" : "letters"), blurb: "UPPERCASE letters, loose or in words." },
  { key: "wins", label: "Jackpot wins", unit: (n) => (n === 1 ? "win" : "wins"), blurb: "Daily jackpots won." },
];

export function LeaderboardScreen() {
  const { state } = useGame();
  const world = useWorld();
  const mine = useMyWallets();
  const [board, setBoard] = useState<BoardKey>("words");
  const meta = BOARDS.find((b) => b.key === board)!;

  if (!state.chainBacked || world.data?.live === false) {
    return (
      <EmptyState
        Icon={Ranking}
        title="The leaderboard opens with the onchain game"
        sub="It ranks real wallets by words, letters, UPPERCASE letters, and jackpot wins."
      />
    );
  }

  const rows = world.data?.boards?.[board] ?? [];
  const profiles = world.data?.profiles ?? {};

  return (
    <div className="space-y-3">
      <h1 className="font-display text-2xl font-extrabold md:hidden">Leaderboard</h1>
      <div className="flex flex-wrap gap-1.5">
        {BOARDS.map((b) => (
          <button key={b.key} onClick={() => setBoard(b.key)}>
            <Pill className={board === b.key ? "bg-ink text-paper" : "bg-paper"}>{b.label}</Pill>
          </button>
        ))}
      </div>
      <p className="text-xs text-ink/55">{meta.blurb} Updated every minute.</p>

      <Card className="p-0">
        {world.isLoading ? (
          <p className="p-6 text-center text-sm text-ink/55">Loading the leaderboard…</p>
        ) : world.isError ? (
          <p className="p-6 text-center text-sm text-ink/55">The leaderboard couldn’t load. Try again in a minute.</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink/55">Nobody’s on this board yet. You could be first.</p>
        ) : (
          <ol className="divide-y-2 divide-ink/10">
            {rows.map((r, i) => {
              const you = mine.has(r.address);
              return (
                <li key={r.address} className={`flex items-center gap-3 px-3 py-2.5 text-sm ${you ? "bg-teal/10" : ""}`}>
                  <span className={`w-6 shrink-0 text-center font-display font-extrabold ${i < 3 ? "text-gold-ink" : "text-ink/45"}`}>
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <PlayerChip address={r.address} profile={profiles[r.address]} you={you} />
                  </span>
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="font-display font-extrabold">{r.value.toLocaleString("en-US")}</span>{" "}
                    <span className="text-xs text-ink/55">{meta.unit(r.value)}</span>
                    {board === "wins" && r.amount ? (
                      <span className="block text-[11px] text-ink/55">{fmtWord(r.amount)} $WORD</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}
