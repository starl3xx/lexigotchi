"use client";
/**
 * In-game FAQ — an accordion mirroring FAQ.md (the repo copy). Numbers are pulled from the live
 * economy derivation so they can never drift from the game. Interactive answers can jump straight
 * into the relevant surface (e.g. opening the wallet sheet to buy $WORD).
 */
import { useState, type ReactNode } from "react";
import { WORD_COUNT } from "@/lib/dictionary";
import { TOTAL_SUPPLY_CAP, TIER_COUNTS, LEGENDARIES } from "@/lib/economy";
import { Sheet } from "../primitives";
import { CaretRight } from "../ui/icons";
import { useGame } from "../state";
import { useOnboarding } from "../Onboarding";

const WORD_TOKEN = "0x304e649e69979298bd1aee63e175adf07885fb4b";

function useFaq(): { q: string; a: ReactNode }[] {
  const g = useGame();
  const buy = () => g.openSheet({ kind: "balance" });
  return [
    {
      q: "What is Lexigotchi?",
      a: (
        <>
          A tamagotchi-style collection game on Base. You mint <strong>rubber-hose letter
          characters</strong>, roll them from lowercase to <strong>UPPERCASE</strong>, spell words
          from a {WORD_COUNT.toLocaleString()}-word dictionary to claim them as NFTs, then stake and
          feed them to earn <strong>$WORD</strong> and chase a daily jackpot. It&apos;s a sibling game
          to <em>Let&apos;s Have A Word!</em> in the same $WORD ecosystem.
        </>
      ),
    },
    {
      q: "What's the core loop?",
      a: (
        <>
          <strong>Mint</strong> lowercase letters → <strong>Raise</strong> them to UPPERCASE with
          rolls → <strong>Claim</strong> a dictionary word by escrowing 5 letters → <strong>Stake &
          Snack</strong> to earn yield and a jackpot ticket → <strong>Win</strong> when your staked,
          fed word is the day&apos;s secret answer.
        </>
      ),
    },
    {
      q: "How do I mint letters?",
      a: (
        <>
          Two ways: a discounted <strong>daily single</strong> (1 per Farcaster FID per day — the
          habit loop) and full-price <strong>packs of 5</strong>, anytime. Every mint is{" "}
          <strong>100% lowercase</strong>; a letter&apos;s pull rate equals its share of the 22,190
          dictionary slots, so common letters come up often and Q/Z/X/J are the grails. You can pay in
          $WORD or ETH (auto-swapped to $WORD).
        </>
      ),
    },
    {
      q: "How do I get UPPERCASE letters?",
      a: (
        <>
          You <strong>raise</strong> them with rolls — capitals are never pulled directly. A roll
          succeeds at <strong>45% base</strong>, climbing <strong>+10pp per consecutive miss</strong>{" "}
          on that letter (a pity streak), capped at <strong>85%</strong> and reset on success.
          Expected ~1.9 rolls per success. A failed roll <strong>never burns or downgrades</strong>{" "}
          your letter — it only bumps the pity. Only fully-UPPERCASE words earn daily yield —
          lowercase words earn none, but any staked, fed word can still win the jackpot.
        </>
      ),
    },
    {
      q: "How does claiming a word work?",
      a: (
        <>
          Spell any dictionary word with 5 letters of <strong>uniform case</strong> from your bag.
          Claiming <strong>escrows</strong> those 5 letters and mints you one ERC-721 — the Word NFT.
          There is exactly <strong>one NFT per word</strong> for its lifetime
          (<code>tokenId = keccak256(word)</code>), so two people can never both own CRANE. A word&apos;s
          case is <em>derived</em> from its escrowed letters (lowercase → Mixed → UPPERCASE), never
          stored separately.
        </>
      ),
    },
    {
      q: "What are rarity tiers?",
      a: (
        <>
          Every word is scored by how rare its letters are and bucketed into 5 tiers:{" "}
          <strong>Common ({TIER_COUNTS.Common.toLocaleString()})</strong>, Uncommon, Rare, Epic, and{" "}
          <strong>Legendary ({TIER_COUNTS.Legendary})</strong>. Rarer tiers carry more stake weight
          (Common 1 → Legendary 8). <strong>JAZZY</strong> is the apex crown — the only word combining
          two distinct ultra-rares with a double letter.
        </>
      ),
    },
    {
      q: "How do staking and yield work?",
      a: (
        <>
          Stake a Word to put it to work. <strong>Daily yield is UPPERCASE-only</strong>, paid from
          the Rewards Pool and weighted by tier (and prestige). Separately, <strong>any</strong> staked
          word of any case — as long as it&apos;s fed — is a <strong>jackpot ticket</strong>. Yield is
          a self-scaling fraction of the pool, so it finds an equilibrium and never drains.
        </>
      ),
    },
    {
      q: "What's hunger? Do I have to feed my words?",
      a: (
        <>
          Yes. A staked word gets <strong>peckish</strong> after a day unfed (half yield) and{" "}
          <strong>hungry</strong> after three (zero yield <em>and</em> no jackpot ticket). Feed it a{" "}
          <strong>snack</strong> to reset the clock. Snacks are <strong>100% burned</strong>, and you
          get one free snack a day. Neglect is a real faucet gate — a hungry word can&apos;t win.
        </>
      ),
    },
    {
      q: "How does the daily jackpot work?",
      a: (
        <>
          Lexigotchi picks one secret word per day from its <strong>own pre-committed sequence</strong>{" "}
          (a hash-chain, so the answer can&apos;t be steered). If that word exists, is staked, and is
          not hungry, its owner wins the whole pot — case doesn&apos;t matter. Otherwise it{" "}
          <strong>rolls over</strong> and grows. There&apos;s also a soft bonus when a{" "}
          <em>Let&apos;s Have A Word!</em> round&apos;s winning word happens to be one you own.
        </>
      ),
    },
    {
      q: "What's the weekly bounty?",
      a: (
        <>
          Each period features a <strong>category</strong> of words (contains a rare letter, has a
          double, ends in -ING, …). Every player holding a <strong>staked, not-hungry matching
          word</strong> shares a bounty pool pro-rata, weighted by rarity. It&apos;s funded zero-sum
          from the yield pool, reaches the whole base, and an unsatisfied period rolls forward.
        </>
      ),
    },
    {
      q: "What is prestige / ascension?",
      a: (
        <>
          A full-UPPERCASE staked Word can <strong>ascend</strong> through 4 Gilded stages, each
          multiplying its yield and bounty weight. Like rolls, an attempt pays a fee and burns a snack
          and succeeds on a pity ramp; <strong>failure is a no-op</strong> — your word is never harmed.
          It&apos;s the renewable late-game depth for collectors who&apos;ve maxed a word.
        </>
      ),
    },
    {
      q: "What are showcases and swaps?",
      a: (
        <>
          A <strong>showcase</strong> arranges any letters you own into any string (no dictionary
          check) and casts it — pure vanity, no NFT, every cast an ad. A <strong>swap</strong> is a
          direct two-sided letter escrow (&quot;my Q for your two Z&apos;s, + some $WORD&quot;) you
          share as a cast. It&apos;s not a marketplace — open price discovery still lives on any
          standard NFT venue.
        </>
      ),
    },
    {
      q: "Can I dissolve a word?",
      a: (
        <>
          Yes. <strong>Dissolving</strong> burns the Word NFT, returns its 5 escrowed letters to you
          (in their current case), and frees the name for anyone to re-claim. It&apos;s the escape
          hatch for a claim you regret — so you can claim boldly.
        </>
      ),
    },
    {
      q: "What is $WORD and how do I buy it?",
      a: (
        <>
          $WORD is the game&apos;s ERC-20 on Base (<code>{WORD_TOKEN.slice(0, 10)}…</code>). It pays for
          mints, rolls, claims, and snacks, and funds yield + the jackpot.{" "}
          <button onClick={buy} className="font-bold text-candy underline">
            Open your wallet to buy $WORD →
          </button>{" "}
          (native swap in Farcaster, or the $WORD swap page on the web).
        </>
      ),
    },
    {
      q: "Where do my fees go?",
      a: (
        <>
          Every fee splits into four buckets: the <strong>Rewards Pool</strong> (UPPERCASE yield), the{" "}
          <strong>Jackpot</strong>, a <strong>Burn</strong> (deflation), and the{" "}
          <strong>Treasury</strong>. Snacks are 100% burned. The buckets can never pay out more than
          they hold — solvency is guaranteed by construction.
        </>
      ),
    },
    {
      q: "Is it provably fair?",
      a: (
        <>
          The value-bearing rolls use a commit→reveal flow, the daily jackpot word comes from a
          pre-committed on-chain hash-chain (so no one — not even the team — can change a future
          answer), and a failed roll <strong>provably never harms your asset</strong>. The full
          dictionary and letter odds are published and derived from the data.
        </>
      ),
    },
    {
      q: "Do I need a Farcaster account?",
      a: (
        <>
          You can play in any Farcaster client (you&apos;re auto-connected) or on the open web by{" "}
          <strong>signing in with Farcaster</strong> or connecting a Base wallet. The free{" "}
          <strong>daily single needs an identity</strong> — a Farcaster account, or a{" "}
          <strong>Coinbase-verified wallet</strong> — packs and everything else work without one.
        </>
      ),
    },
    {
      q: "How many words and letters are there?",
      a: (
        <>
          {WORD_COUNT.toLocaleString()} claimable words and a global supply cap of{" "}
          {TOTAL_SUPPLY_CAP.toLocaleString()} letters across the 26 ids. {LEGENDARIES.length} of the
          words are Legendary.
        </>
      ),
    },
    {
      q: "Are the contracts live?",
      a: (
        <>
          This is the <strong>Phase 0 prototype</strong>. The full Solidity suite (letters, words,
          rolls, staking, jackpot, bounty, prestige) is written, tested, and ready — but not yet
          deployed or audited. The playable app runs on a faithful mock of those contracts, so prices
          and balances here are illustrative.
        </>
      ),
    },
  ];
}

export function FaqSheet() {
  const g = useGame();
  const faq = useFaq();
  const { replay } = useOnboarding();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Sheet open onClose={g.closeSheet} title="FAQ — how Lexigotchi works">
      <div className="space-y-2">
        {faq.map((item, i) => {
          const isOpen = open === i;
          return (
            <div key={i} className="cel overflow-hidden rounded-xl bg-paper">
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                aria-expanded={isOpen}
              >
                <span className="font-display text-sm font-extrabold">{item.q}</span>
                <CaretRight
                  weight="bold"
                  size={14}
                  className={`shrink-0 text-ink/50 transition-transform ${isOpen ? "rotate-90" : ""}`}
                />
              </button>
              {isOpen && <div className="px-3 pb-3 text-sm leading-relaxed text-ink/80">{item.a}</div>}
            </div>
          );
        })}
        <button
          onClick={() => {
            g.closeSheet();
            replay();
          }}
          className="mx-auto mt-1 block text-xs font-bold text-candy underline"
        >
          Replay the intro
        </button>
        <p className="pt-1 text-center text-xs text-ink/45">
          Phase 0 prototype · spec v0.2 · $WORD on Base
        </p>
      </div>
    </Sheet>
  );
}
