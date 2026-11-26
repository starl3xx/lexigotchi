"use client";
/**
 * Your earnings: what the player's words have earned, word by word, and how earning works
 * (mindlessmonk, 2026-11-25: "is there a place to see how much has been earned so far?").
 *
 * Earnings are paid automatically (decisions.md #16), so this sheet is a record, not a to-do: the
 * total, the latest payout, each word's share and what would make it earn more. "Collect" shows
 * only when a share wasn't paid out by itself (the payout failed or is late).
 */
import { useMemo, useState } from "react";
import { Button, Card, Pill, Sheet, TweenNumber } from "../primitives";
import { WordTiles, careState } from "../LetterTile";
import { Coins, DownloadSimple, ShareNetwork, XLogo } from "../ui/icons";
import { fmtUsd, fmtWord, hunger, showsUsd, useGame, type OwnedWord } from "../state";
import { earningStatus, payoutPhrase, payoutTimeLocal, payoutWhen, type EarningStatus } from "../earnings";
import { usePostToX, useSaveImage, useShare } from "../useShare";
import { useWordScene } from "../../scenes/useWordScene";
import { DEFAULT_PARAMS } from "@/lib/params";
import { NETWORK } from "@/lib/onchain/network";
import { showcaseWordText } from "@/lib/showcase";
import { decodeSnapshot, earningsCardPath, earningsPostText, earningsShareUrl, type EarningsShareLook } from "@/lib/earningsShare";

const STATUS: Record<EarningStatus["kind"], { label: (s: EarningStatus) => string; tone: string }> = {
  earning: { label: () => "earning", tone: "bg-gold/20 text-gold-ink" },
  half: { label: () => "peckish: half", tone: "bg-gold/10 text-gold-ink" },
  paused: { label: () => "hungry: paused", tone: "bg-candy/10 text-candy-ink" },
  unstaked: { label: () => "stake to earn", tone: "bg-card text-ink/60" },
  raise: { label: (s) => (s.kind === "raise" ? `raise ${s.left} letter${s.left === 1 ? "" : "s"}` : ""), tone: "bg-card text-ink/60" },
};

/** Earning words first (biggest earners first), then the rest, best placed to earn first. */
const RANK: Record<EarningStatus["kind"], number> = { earning: 0, half: 1, paused: 2, unstaked: 3, raise: 4 };

export function EarningsSheet() {
  const g = useGame();
  const { state } = g;
  const e = g.earnings;
  const mine = state.words;
  const rows = mine
    .map((w) => ({ w, s: earningStatus(w, hunger(w)), earned: e?.byWord[w.word] }))
    .sort(
      (a, b) =>
        (b.earned?.total ?? 0) - (a.earned?.total ?? 0) ||
        RANK[a.s.kind] - RANK[b.s.kind] ||
        (a.s.kind === "raise" && b.s.kind === "raise" ? a.s.left - b.s.left : 0) ||
        a.w.word.localeCompare(b.w.word),
    );
  const when = e?.latestAt ? payoutWhen(e.latestAt) : null;
  const waiting = g.claimables.reduce((a, c) => a + c.amount, 0);
  const half = Math.round(DEFAULT_PARAMS.care.peckishYieldFactor * 100);
  // Share (lib/earningsShare.ts): only with the server's signed snapshot, and a word whose card lies
  // beside the tag. The list's first word is the one pictured: the player's top earner.
  const [sharing, setSharing] = useState(false);
  const hero = rows[0]?.w;

  return (
    <Sheet open onClose={g.closeSheet} title="Your earnings">
      <Card className="bg-gradient-to-b from-card to-gold/15 text-center">
        <div className="flex items-center justify-center gap-1.5 text-ink/60">
          <Coins weight="fill" />
          <span className="text-sm font-bold">Earned by your words</span>
        </div>
        {e ? (
          <>
            <div className="mt-1 font-display text-4xl font-extrabold text-gold-deep">
              <TweenNumber value={e.total} format={fmtWord} />
            </div>
            {/* dollars hide on testnet, as everywhere (showsUsd): test $WORD isn't worth them */}
            <div className="text-sm text-ink/60">{showsUsd(state) ? `${fmtUsd(e.total)} · $WORD` : state.chainBacked ? "test $WORD" : "$WORD"}</div>
            <div className="mt-1 text-sm">
              {when && e.latest > 0 ? (
                <>
                  <strong className="text-gold-ink">+{fmtWord(e.latest)}</strong> {payoutPhrase(when)}
                </>
              ) : when ? (
                // the latest payout paid other players' words, not these: say so, never "+0"
                <span className="text-ink/60">Nothing earned {payoutPhrase(when)}</span>
              ) : (
                <span className="text-ink/60">No payouts yet</span>
              )}
            </div>
          </>
        ) : (
          <p aria-busy className="py-3 text-sm text-ink/60">
            Adding up your earnings…
          </p>
        )}
      </Card>
      <p className="mt-2 text-center text-xs text-ink/60">
        {state.chainBacked
          ? `Paid every day at ${payoutTimeLocal()} your time, straight to the wallet that holds each word. Nothing to collect.`
          : "In practice, your words are paid each time you skip to the next day."}
      </p>

      {g.earningsShare && hero && (
        <>
          <Button full variant={sharing ? "primary" : "ghost"} className="mt-3" aria-expanded={sharing} onClick={() => setSharing((on) => !on)}>
            <ShareNetwork weight="fill" /> Share
          </Button>
          {/* Mounted only when asked for: it draws the card, and saving fetches it ahead on phones. */}
          {sharing && <ShareEarnings token={g.earningsShare} hero={hero} />}
        </>
      )}

      {/* the rare share that didn't go out by itself */}
      {waiting > 0 && (
        <Card className="mt-3 text-sm">
          <p>
            <strong>{fmtWord(waiting)} $WORD</strong> hasn’t been paid out yet. It goes out by itself with the next payout, or you can collect it now.
          </p>
          <Button full variant="teal" className="mt-2" onClick={() => g.claimEarnings()}>
            <Coins weight="fill" /> Collect {fmtWord(waiting)}
          </Button>
        </Card>
      )}

      <div className="mt-4 mb-2 font-display font-extrabold">Your words</div>
      {rows.length === 0 ? (
        <p className="py-2 text-sm text-ink/60">Spell a word, raise all 5 letters to UPPERCASE, and stake it. Then it earns $WORD every day.</p>
      ) : (
        <div className="space-y-2">
          {rows.map(({ w, s, earned }) => (
            <WordRow key={w.word} word={w} status={s} total={earned?.total ?? 0} latest={earned?.latest ?? 0} when={when} />
          ))}
        </div>
      )}
      {e && e.bounty > 0 && (
        <div className="cel-sm mt-2 flex items-center justify-between rounded-xl bg-card px-3 py-2 text-sm">
          <span className="font-bold">Theme bounties</span>
          <span className="font-display font-extrabold text-gold-ink">{fmtWord(e.bounty)}</span>
        </div>
      )}

      <div className="mt-4 rounded-xl bg-paper-dark/40 p-3 text-xs text-ink/70">
        <div className="mb-1 font-display text-sm font-extrabold text-ink">How earning works</div>
        <ul className="list-disc space-y-1 pl-4">
          <li>A word earns once all 5 letters are UPPERCASE and it’s staked.</li>
          <li>Fed, it earns a full share. Peckish, {half}%. Hungry, nothing until you feed it.</li>
          <li>Each day’s payout is split between every earning word. Rarer words get bigger shares.</li>
        </ul>
      </div>
    </Sheet>
  );
}

/**
 * Share the earnings as a word shares itself (cards/WordSheetCard): X first, Farcaster second, or
 * keep the picture. The link's card is drawn by the server from ITS numbers (the signed token), so
 * the post's words read the token too, never this screen's fresher sums: the picture and the
 * sentence always say the same amount. The player's top word's card lies beside the tag.
 */
function ShareEarnings({ token, hero }: { token: string; hero: OwnedWord }) {
  const share = useShare();
  const postToX = usePostToX();
  const { scene } = useWordScene(hero.word);
  const snapshot = useMemo(() => decodeSnapshot(token.slice(0, token.lastIndexOf("."))), [token]);
  const look: EarningsShareLook = { hero: showcaseWordText(hero.word, hero.upper), scene, tz: -new Date().getTimezoneOffset() };
  // The picture that travels alone is 16:9 and carries the game's name in a corner.
  const picture = earningsCardPath(token, "wide", look, true);
  const saveImage = useSaveImage(picture, "lexigotchi-earnings.png");
  if (!snapshot) return null;
  const words = (on: "x" | "fc") => earningsPostText(snapshot, { testnet: NETWORK.isTestnet, hero: hero.word, on });
  const url = earningsShareUrl(token, look);
  return (
    <div className="mt-2 space-y-2 rounded-2xl border-2 border-ink bg-card p-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={picture}
        width={1200}
        height={675}
        alt={`${hero.word}’s card, beside a tag that says what your words have earned`}
        className="block h-auto w-full rounded-xl border-2 border-ink bg-paper-dark/40"
      />
      <Button full variant="primary" onClick={() => postToX({ text: words("x"), url })}>
        <XLogo weight="bold" /> Post my earnings on X
      </Button>
      {/* The same wait as a word's card: X reads a new link before it shows the picture. */}
      <p className="text-center text-xs text-ink/55">X adds the picture once it reads the link.</p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={() => share({ text: words("fc"), embed: url })}>
          <ShareNetwork weight="fill" /> Cast
        </Button>
        <Button variant="ghost" onClick={() => void saveImage()}>
          <DownloadSimple weight="bold" /> Save image
        </Button>
      </div>
    </div>
  );
}

function WordRow({ word, status, total, latest, when }: { word: OwnedWord; status: EarningStatus; total: number; latest: number; when: string | null }) {
  const g = useGame();
  const st = STATUS[status.kind];
  return (
    <button
      onClick={() => g.openSheet({ kind: "word", word: word.word })}
      className="cel-sm press flex w-full items-center gap-2.5 rounded-xl bg-card px-3 py-2 text-left"
    >
      <WordTiles word={word.word} upper={word.upper} size={20} state={careState(word)} tier={word.tier} still />
      <span className="min-w-0 flex-1">
        <span className="block font-display font-extrabold">{word.word}</span>
        <Pill className={st.tone}>{st.label(status)}</Pill>
      </span>
      <span className="text-right leading-tight">
        <span className="block font-display font-extrabold">{total > 0 ? fmtWord(total) : "–"}</span>
        {latest > 0 && when && (
          <span className="block text-xs font-bold text-gold-ink">
            +{fmtWord(latest)} {when}
          </span>
        )}
      </span>
    </button>
  );
}
