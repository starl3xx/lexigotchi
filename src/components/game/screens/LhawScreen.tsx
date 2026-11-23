"use client";
/**
 * Let's Have A Word!: Lexigotchi's sibling in the $WORD universe, inside the game. Live numbers
 * from LHAW's public API (via /api/lhaw, cached a minute), how to play it, and how the two games
 * connect. The how-to-play facts come from LHAW's FAQ (its repo's FAQ.md, 2026-11); if LHAW changes
 * a rule, change it here too.
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, SectionTitle } from "../primitives";
import { BookOpen, Coins, Trophy } from "../ui/icons";
import { fmtWord } from "../state";
import { WORD_COUNT } from "@/lib/dictionary";
import type { LhawSummary } from "@/app/api/lhaw/route";

const LHAW_URL = "https://letshaveaword.fun";
const usd = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);

export function LhawScreen() {
  const q = useQuery({
    queryKey: ["lhaw"],
    queryFn: async (): Promise<LhawSummary> => (await fetch("/api/lhaw")).json(),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const d = q.data;

  return (
    <div className="space-y-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0">
      <Card className="bg-gradient-to-b from-paper to-gold/15 lg:col-span-2">
        <h1 className="font-display text-2xl font-extrabold">Let’s Have A Word!</h1>
        <p className="mt-1 text-sm text-ink/70">
          Lexigotchi’s sibling in the $WORD universe: a word hunt where everyone in the world chases the same
          secret 5-letter word, and the finder wins the pot.
        </p>
        <a
          href={LHAW_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="cel mt-3 inline-flex items-center justify-center gap-2 rounded-xl bg-candy-deep px-5 py-2.5 font-display text-base font-extrabold text-paper transition-[transform,box-shadow] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
        >
          Play Let’s Have A Word! ↗
        </a>
      </Card>

      <Card>
        <SectionTitle>Live round</SectionTitle>
        {d?.live ? (
          <div className="space-y-2">
            <Stat label={`Round ${d.live.round} pot`} big>
              {d.live.potWord != null ? `${fmtWord(d.live.potWord)} $WORD` : usd(d.live.potUsd)}
              {d.live.potWord != null && d.live.potUsd != null && (
                <span className="ml-1 text-sm font-bold text-ink/55">({usd(d.live.potUsd)})</span>
              )}
            </Stat>
            <Stat label="Guesses so far">{d.live.guesses.toLocaleString("en-US")}</Stat>
            {d.live.top10Left != null && (
              <Stat label="Top 10 Early Guessers">
                {d.live.top10Left > 0 ? `${d.live.top10Left.toLocaleString("en-US")} guesses left to get in` : "locked for this round"}
              </Stat>
            )}
          </div>
        ) : (
          <Empty loading={q.isLoading} />
        )}
      </Card>

      <Card>
        <SectionTitle>Last round</SectionTitle>
        {d?.last ? (
          <div className="space-y-2">
            <Stat label={`Round ${d.last.round}’s word`} big>
              {d.last.word}
            </Stat>
            <Stat label="Jackpot">{usd(d.last.jackpotUsd)}</Stat>
            <Stat label="Players">
              {d.last.players.toLocaleString("en-US")} players, {d.last.guesses.toLocaleString("en-US")} guesses
            </Stat>
            {d.roundsPlayed != null && <Stat label="Rounds played">{d.roundsPlayed.toLocaleString("en-US")}</Stat>}
          </div>
        ) : (
          <Empty loading={q.isLoading} />
        )}
      </Card>

      <Card>
        <SectionTitle>How to play</SectionTitle>
        <ul className="ml-1 list-disc space-y-1.5 pl-4 text-sm leading-snug text-ink/80 marker:text-ink/30">
          <li>
            <strong>Everyone hunts the same secret word.</strong> Every wrong guess removes that word for
            everybody, so the field narrows together.
          </li>
          <li>
            <strong>One free guess a day</strong> (resets at 11:00 UTC). Earn more by sharing your guess or
            holding $WORD, or buy packs of 3.
          </li>
          <li>
            <strong>Bring about $3 of $WORD.</strong> Playing needs it in your wallet, held or staked. You keep
            it; playing spends nothing.
          </li>
          <li>
            <strong>Find the word, win the pot.</strong> The finder takes 80%, and the Top 10 Early Guessers
            share 10%.
          </li>
          <li>
            <strong>Provably fair.</strong> Each round’s words are committed onchain before anyone guesses, and
            anyone can check them afterward.
          </li>
        </ul>
      </Card>

      <Card>
        <SectionTitle>One universe</SectionTitle>
        <div className="space-y-2.5 text-sm text-ink/80">
          <Line icon={<BookOpen weight="bold" size={18} />}>
            <strong>Same dictionary.</strong> Lexigotchi’s {WORD_COUNT.toLocaleString("en-US")} words are Let’s Have
            A Word!’s, so every word you can claim here is a word you can guess there.
          </Line>
          <Line icon={<Coins weight="fill" size={18} />}>
            {/* No market cap here: the footer shows it, from our own oracle, and two sources a few
                dollars apart on one page read as a bug. */}
            <strong>Same token.</strong> Both games run on $WORD.
            {d?.token?.staked ? <> {fmtWord(d.token.staked)} $WORD is staked</> : null}
            {d?.token?.burned ? <>, and {fmtWord(d.token.burned)} burned</> : null}
            {d?.token?.staked || d?.token?.burned ? "." : null}
          </Line>
          <Line icon={<Trophy weight="fill" size={18} />}>
            <strong>Separate jackpots.</strong> Each game draws its own secret word and pays its own pot.
          </Line>
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, big = false, children }: { label: string; big?: boolean; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wide text-ink/55">{label}</div>
      <div className={big ? "font-display text-2xl font-extrabold text-gold-deep" : "text-sm font-bold"}>{children}</div>
    </div>
  );
}

function Line({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 shrink-0 text-ink/60" aria-hidden>
        {icon}
      </span>
      <p className="leading-snug">{children}</p>
    </div>
  );
}

function Empty({ loading }: { loading: boolean }) {
  return <p className="text-sm text-ink/55">{loading ? "Loading…" : "Let’s Have A Word! didn’t answer. Try again in a minute."}</p>;
}
