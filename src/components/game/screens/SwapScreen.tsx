"use client";
/**
 * Market (the "swap" view; starl3xx: "Swap tab should probably be Market now") — words for sale
 * ($WORD, 10% to the Rewards Pool; decisions.md #18) and a direct two-sided letter escrow ("my Q for
 * your two Z's"), shareable to Farcaster/X.
 */
import { useState } from "react";
import { shopEnabled } from "@/lib/shop/config";
import { ALPHABET, wordTier } from "@/lib/economy";
import { Button, Card, SectionTitle, TierBadge } from "../primitives";
import { LetterTile, PrestigeStars, WordTiles } from "../LetterTile";
import { ArrowsDownUp, ShareNetwork } from "../ui/icons";
import { charToIdx, fmtUsd, fmtWord, idxToChar, mineLower, mineUpper, showsUsd, useGame, type WordListing } from "../state";
import { useShare } from "../useShare";
import { useAccount } from "wagmi";
import { PlayerChip } from "../PlayerChip";
import { useMyWallets } from "../useWorld";
import { WordValue, useCostToMake } from "../WordValue";

const QUICK_WORD = [0, 500_000, 1_000_000, 2_500_000];

export function SwapScreen() {
  const g = useGame();
  const { state } = g;
  const share = useShare();
  // The REAL swap (chain): a Seaport bulletin — sign an offer for free, fills settle on-chain.
  if (state.chainBacked) return <ChainSwap />;
  const [give, setGive] = useState<number[]>([]);
  const [want, setWant] = useState<number[]>([]);
  const [ask, setAsk] = useState(0);
  const [created, setCreated] = useState(false);

  const giveUsed = (i: number) => give.filter((x) => x === i).length;
  const myLetters = state.lower.map((c, i) => ({ i, c })).filter((x) => x.c > 0);
  // functional updater so batched taps can't offer more of a letter than the bag holds
  const addGive = (i: number) =>
    setGive((prev) => {
      const usedInGive = prev.filter((x) => x === i).length;
      if (state.lower[i] - usedInGive <= 0) return prev;
      return [...prev, i];
    });
  const fmtSet = (arr: number[]) =>
    arr.length ? arr.map((i) => idxToChar(i)).join(" ") : "–";

  const reset = () => {
    setGive([]);
    setWant([]);
    setAsk(0);
    setCreated(false);
  };

  if (created) {
    return (
      <div className="space-y-3">
        <h1 className="font-display text-2xl font-extrabold">Swap created</h1>
        <Card className="bg-gradient-to-b from-candy/10 to-paper">
          <div className="text-center text-xs font-bold text-ink/60">A Lexigotchi swap</div>
          <div className="my-3 space-y-3">
            <div className="text-center">
              <div className="text-xs text-ink/55">they give you</div>
              <div className="font-display text-lg font-extrabold">{fmtSet(want)}</div>
            </div>
            <div className="flex justify-center text-ink/70"><ArrowsDownUp weight="bold" size={22} /></div>
            <div className="text-center">
              <div className="text-xs text-ink/55">you give</div>
              <div className="font-display text-lg font-extrabold">
                {fmtSet(give)} {ask > 0 && <span className="text-teal-ink">+ {fmtWord(ask)} $WORD</span>}
              </div>
            </div>
          </div>
        </Card>
        <Button
          full
          size="lg"
          variant="primary"
          onClick={() =>
            share({
              text: `Lexigotchi swap: you give me ${fmtSet(want)}, I give you ${fmtSet(give)}${ask > 0 ? ` + ${fmtWord(ask)} $WORD` : ""}. Deal?`,
            })
          }
        >
          {/* Farcaster only: an X post must tag @lexigotchi and carry a card of what's shared, and a
              swap has no card of its own yet (the link would show only the generic game card). */}
          <ShareNetwork weight="fill" /> Share to Farcaster
        </Button>
        <Button full variant="ghost" onClick={reset}>
          New swap
        </Button>
        <p className="text-center text-xs text-ink/50">
          A swap goes straight from one player to another: both sides move together, or nothing moves.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0">
      <div className="lg:col-span-2">
        <h1 className="font-display text-2xl font-extrabold">Propose a swap</h1>
        <p className="text-sm text-ink/60">Trade exact letters with a friend. Shareable as a cast.</p>
      </div>

      {/* you give */}
      <Card>
        <SectionTitle action={give.length > 0 ? <button onClick={() => setGive([])} className="text-xs font-bold text-ink/45 underline">clear</button> : undefined}>
          You give: {fmtSet(give)}
        </SectionTitle>
        {myLetters.length === 0 ? (
          <p className="text-sm text-ink/55">No loose letters to offer.</p>
        ) : (
          <div className="grid grid-cols-6 gap-2.5 md:grid-cols-[repeat(auto-fill,52px)]">
            {myLetters.map(({ i, c }) => {
              const avail = c - giveUsed(i);
              return <LetterTile key={i} char={idxToChar(i)} count={avail} dim={avail <= 0} onClick={avail > 0 ? () => addGive(i) : undefined} />;
            })}
          </div>
        )}
        <div className="mt-3">
          <div className="mb-1 text-xs font-bold text-ink/55">…and add $WORD?</div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_WORD.map((amt) => (
              <button key={amt} onClick={() => setAsk(amt)}>
                <span className={`inline-block rounded-full border-2 border-ink px-2.5 py-1 text-xs font-bold ${ask === amt ? "bg-teal text-ink" : "bg-card"}`}>
                  {amt === 0 ? "none" : `+${fmtWord(amt)}`}
                </span>
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* you want */}
      <Card>
        <SectionTitle action={want.length > 0 ? <button onClick={() => setWant([])} className="text-xs font-bold text-ink/45 underline">clear</button> : undefined}>
          You want: {fmtSet(want)}
        </SectionTitle>
        {/* Fixed 38px tracks from md: they wrap to whatever the card is (a full-width card at md,
            a half-width one at lg). A fixed 13 columns overflowed the half-width card (Bugbot). */}
        <div className="grid grid-cols-7 gap-1.5 md:grid-cols-[repeat(auto-fill,38px)]">
          {ALPHABET.map((L) => (
            <LetterTile key={L} char={L} size={38} selected={want.includes(charToIdx(L))} onClick={() => setWant((prev) => [...prev, charToIdx(L)])} />
          ))}
        </div>
      </Card>

      <Button full size="lg" variant="primary" className="lg:col-span-2" disabled={give.length === 0 && ask === 0} onClick={() => setCreated(true)}>
        Create swap link →
      </Button>
    </div>
  );
}


/** Chain-backed swap: 1 letter ⇄ 1 letter through Seaport. The mock's escrow toy stays mock. */
function ChainSwap() {
  const g = useGame();
  const { state } = g;
  const { address } = useAccount();
  const [give, setGive] = useState<number | null>(null);
  const [want, setWant] = useState<number | null>(null);

  const my = mineLower(state).map((c, i) => ({ i, c })).filter((x) => x.c > 0);
  const myUpper = mineUpper(state).map((c, i) => ({ i: i + 26, c })).filter((x) => x.c > 0);
  const mine = [...my, ...myUpper];
  const tile = (id: number) => idxToChar(id % 26);
  const isUpper = (id: number) => id >= 26;
  // The board is every open offer, yours included (tagged, with cancel in place of Trade), so a
  // freshly listed offer shows where the player looks for it. It used to hide your own offers in a
  // separate card, and "0 open" read as the listing having failed (starl3xx, 2026-11-24).
  //
  // "Yours" is the PLAYER, not the wallet (starl3xx: "swap board should be profile-based"): an
  // offer from any wallet in your profile is yours, never one to trade with. Only the wallet that
  // signed an offer can cancel it, and only the connected wallet can fill one, so those two verbs
  // still name the wallet when it isn't the connected one.
  const me = address?.toLowerCase();
  const myWallets = useMyWallets();
  const isMine = (o: { maker: string }) => myWallets.has(o.maker) || o.maker === me;
  const board = [...g.swapBoard].sort((a, b) => Number(isMine(b)) - Number(isMine(a)));
  const heldHere = (id: number) => (id >= 26 ? mineUpper(state)[id - 26] : mineLower(state)[id]) ?? 0;
  const heldAnywhere = (id: number) => (id >= 26 ? state.upper[id - 26] : state.lower[id]) ?? 0;
  const canFill = (wantId: number) => heldHere(wantId) > 0;
  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const elsewhere = (state.lower.reduce((a, b) => a + b, 0) + state.upper.reduce((a, b) => a + b, 0)) > mine.reduce((a, x) => a + x.c, 0);

  return (
    <div className="space-y-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0">
      <div className="lg:col-span-2">
        <h1 className="font-display text-2xl font-extrabold md:hidden">Market</h1>
        <p className="text-sm text-ink/60">
          Sell words for $WORD, and trade one letter for one letter. Seaport settles both: listing is a
          free signature, and the trade happens the moment someone takes it.
        </p>
      </div>

      <WordsForSale />

      {/* create */}
      <Card>
        <SectionTitle>Swap letters</SectionTitle>
        <div className="mb-1 text-xs font-bold text-ink/60">You give</div>
        <div className="flex flex-wrap gap-1.5">
          {mine.length === 0 && (
            <span className="text-sm text-ink/50">
              {elsewhere
                ? "No letters in this wallet. Your other wallets hold some: switch to one, or move them here from your profile."
                : "No spare letters in this wallet."}
            </span>
          )}
          {mine.map(({ i }) => (
            <LetterTile key={i} char={tile(i)} upper={isUpper(i)} size={38} onClick={() => setGive(i)} selected={give === i} />
          ))}
        </div>
        <div className="mb-1 mt-3 text-xs font-bold text-ink/60">You want</div>
        <div className="flex flex-wrap gap-1.5">
          {ALPHABET.map((ch, i) => (
            <LetterTile key={i} char={ch.toLowerCase()} size={30} onClick={() => setWant(i)} selected={want === i} />
          ))}
        </div>
        <Button full variant="primary" className="mt-3" disabled={give === null || want === null}
          onClick={() => { if (give !== null && want !== null) { g.createSwapOffer(give, want); setGive(null); setWant(null); } }}>
          <ArrowsDownUp weight="bold" /> List the offer (free to sign)
        </Button>
      </Card>

      {/* board */}
      <Card>
        <SectionTitle action={<span className="text-xs text-ink/55">{board.length} open</span>}>Letter offers</SectionTitle>
        {board.length === 0 ? (
          <p className="py-3 text-center text-sm text-ink/50">No open offers. List one above.</p>
        ) : (
          <div className="space-y-2">
            {board.map((o) =>
              isMine(o) ? (
                <div key={o.orderHash} className="flex items-center justify-between gap-2 rounded-xl border-2 border-ink bg-gold/10 px-3 py-2">
                  <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                    <LetterTile char={tile(o.giveId)} upper={isUpper(o.giveId)} size={30} />
                    <span className="text-ink/50">for</span>
                    <LetterTile char={tile(o.wantId)} upper={isUpper(o.wantId)} size={30} />
                    <span className="rounded-full border-2 border-ink bg-card px-1.5 py-0.5 text-[10px] font-bold">Yours</span>
                  </span>
                  {o.maker === me ? (
                    <button onClick={() => g.cancelSwapOffer(o.orderHash)} className="shrink-0 text-xs font-bold text-ink/45 underline">
                      Cancel
                    </button>
                  ) : (
                    <span className="shrink-0 text-right text-[11px] leading-tight text-ink/50">
                      From {short(o.maker)}.
                      <br />
                      Switch to it to cancel.
                    </span>
                  )}
                </div>
              ) : (
                <div key={o.orderHash} className="flex items-center justify-between gap-2 rounded-xl border-2 border-ink bg-paper-dark/30 px-3 py-2">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm">
                      <LetterTile char={tile(o.giveId)} upper={isUpper(o.giveId)} size={30} />
                      <span className="text-ink/50">for your</span>
                      <LetterTile char={tile(o.wantId)} upper={isUpper(o.wantId)} size={30} />
                    </span>
                    <span className="mt-1 block text-xs text-ink/60">
                      <PlayerChip address={o.maker} profile={o.face} size={18} />
                    </span>
                    {!canFill(o.wantId) && heldAnywhere(o.wantId) > 0 && (
                      <span className="mt-0.5 block text-[11px] text-ink/50">
                        Another of your wallets holds it: switch to that wallet, or move it here.
                      </span>
                    )}
                  </span>
                  <Button variant="teal" disabled={!canFill(o.wantId)}
                    title={canFill(o.wantId) ? "" : heldAnywhere(o.wantId) > 0 ? "Another of your wallets holds it" : "You don’t hold the letter they want"}
                    onClick={() => g.fillSwapOffer(o.orderHash)}>
                    Trade
                  </Button>
                </div>
              ),
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * Words for sale (decisions.md #18). Each row shows the word as it is NOW (case, prestige, ascension
 * pity, days unfed), read live by the board's route, since a listing can be days old. "Yours" is the
 * player, not the wallet, as on the letter board: only the wallet that listed a word can take it off
 * sale, and only the connected wallet buys.
 */
function WordsForSale() {
  const g = useGame();
  const { state } = g;
  const { address } = useAccount();
  const me = address?.toLowerCase();
  const myWallets = useMyWallets();
  const isMine = (l: WordListing) => myWallets.has(l.maker) || l.maker === me;
  const rows = [...g.wordBoard].sort((a, b) => Number(isMine(b)) - Number(isMine(a)) || a.price - b.price);
  const worth = (n: number) => (showsUsd(state) ? `${fmtWord(n)} $WORD (${fmtUsd(n)})` : `${fmtWord(n)} $WORD`);
  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const now = Date.now() / 1000;
  return (
    <Card className="lg:col-span-2">
      <SectionTitle action={<span className="text-xs text-ink/55">{rows.length} for sale</span>}>Words for sale</SectionTitle>
      {/* The Customization Spec: taste stays with the player (decisions.md #22). Only once there's a Shop. */}
      {shopEnabled() && <p className="-mt-1 mb-2 text-xs text-ink/55">Scenes and costumes stay with the seller.</p>}
      {rows.length === 0 ? (
        <p className="py-3 text-center text-sm text-ink/50">
          No words for sale yet. To sell one, open it in your bag and tap Sell.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((l) => {
            const unfed = l.lastFedAt > 0 ? Math.floor((now - l.lastFedAt) / 86_400) : 0;
            const mine = isMine(l);
            return (
              <div
                key={l.orderHash}
                className={`flex items-center justify-between gap-3 rounded-xl border-2 border-ink px-3 py-2 ${mine ? "bg-gold/10" : "bg-paper-dark/30"}`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <WordTiles word={l.word} upper={l.upper} size={26} tier={wordTier(l.word)} still />
                    <TierBadge tier={wordTier(l.word)} />
                    <PrestigeStars level={l.prestigeLevel} />
                  </div>
                  <div className="mt-1 text-xs text-ink/60">
                    <strong className="font-display text-ink">{worth(l.price)}</strong>
                    {l.prestigePity > 0 && ` · ${l.prestigePity} failed ascension${l.prestigePity === 1 ? "" : "s"}, so better odds next time`}
                    {unfed > 0 && ` · unfed ${unfed} day${unfed === 1 ? "" : "s"}`}
                  </div>
                  <ListingValue listing={l} />
                  {!mine && (
                    <span className="mt-1 block text-xs text-ink/60">
                      <PlayerChip address={l.maker} profile={l.face} size={18} />
                    </span>
                  )}
                </div>
                {mine ? (
                  l.maker === me ? (
                    <button onClick={() => g.cancelWordListing(l.orderHash)} className="shrink-0 text-xs font-bold text-ink/45 underline">
                      Take off sale
                    </button>
                  ) : (
                    <span className="shrink-0 text-right text-[11px] leading-tight text-ink/50">
                      From {short(l.maker)}.
                      <br />
                      Switch to it to take it off sale.
                    </span>
                  )
                ) : (
                  <Button size="sm" variant="teal" className="shrink-0" disabled={!address} onClick={() => g.buyWord(l.orderHash)}>
                    Buy
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-xs text-ink/55">
        The buyer pays the price in $WORD: 90% to the seller, 10% to the Rewards Pool, which pays staked words. The word arrives
        with its letters, case, and prestige. “To make” is about what building the word costs at today’s prices, with the
        average number of tries.
      </p>
    </Card>
  );
}

/** A listing's reference numbers (WordValue): its own component, since the cost is a hook. */
function ListingValue({ listing }: { listing: WordListing }) {
  const shape = { word: listing.word, upper: listing.upper, prestigeLevel: listing.prestigeLevel };
  const cost = useCostToMake(shape);
  return <WordValue word={shape} cost={cost} compact />;
}
