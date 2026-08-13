# Lexigotchi — FAQ

This mirrors the in-game FAQ (the **?** in the app header). Lexigotchi is a Phase 0 prototype;
prices and balances in the app are illustrative until the contracts deploy.

## What is Lexigotchi?

A tamagotchi-style collection game on **Base**. You mint rubber-hose **letter characters**, roll
them from lowercase to **UPPERCASE**, spell words from a 4,438-word dictionary to claim them as NFTs,
then stake and feed them to earn **$WORD** and chase a daily jackpot. It's a sibling game to
*Let's Have A Word!* in the same $WORD ecosystem.

## What's the core loop?

**Mint** lowercase letters → **Raise** them to UPPERCASE with rolls → **Claim** a dictionary word by
escrowing 5 letters → **Stake & Snack** to earn yield and a jackpot ticket → **Win** when your
staked, fed word is the day's secret answer.

## How do I mint letters?

Two ways: a free **daily single** (1 per identity per day — a Farcaster account, or a
[Coinbase-verified](https://www.coinbase.com/onchain-verify) wallet — the habit loop) and full-price
**packs of 5**, anytime. Every mint is **100% lowercase**; a letter's pull rate equals its share of
the 22,190 dictionary slots, so common letters come up often and Q/Z/X/J are the grails. Mints are
**$WORD-only** at launch — tap the balance pill to buy $WORD first if you only hold ETH.

## How do I get UPPERCASE letters?

You **raise** them with rolls — capitals are never pulled directly. A roll succeeds at **45% base**,
climbing **+10pp per consecutive miss** on that letter (a pity streak), capped at **85%** and reset on
success (expected ~1.9 rolls per success). A failed roll **never burns or downgrades** your letter —
it only bumps the pity. Only UPPERCASE words earn daily yield.

## How does claiming a word work?

Spell any dictionary word with 5 letters of **uniform case** from your bag. Claiming **escrows** those
5 letters and mints you one ERC-721 — the Word NFT. There is exactly **one NFT per word** for its
lifetime (`tokenId = keccak256(word)`), so two people can never both own CRANE. A word's case is
*derived* from its escrowed letters (lowercase → Mixed → UPPERCASE), never stored separately.

## What are rarity tiers?

Every word is scored by how rare its letters are and bucketed into 5 tiers: **Common** (2,219),
Uncommon, Rare, Epic, and **Legendary** (45). Rarer tiers carry more stake weight (Common 1 →
Legendary 8). **JAZZY** is the apex crown — the only word combining two distinct ultra-rares with a
double letter.

## How do staking and yield work?

Stake a Word to put it to work. **Daily yield is UPPERCASE-only**, paid from the Rewards Pool and
weighted by tier (and prestige). Separately, **any** staked word of any case — as long as it's fed —
is a **jackpot ticket**. Yield is a self-scaling fraction of the pool, so it finds an equilibrium and
never drains.

## What's hunger? Do I have to feed my words?

Yes. A staked word gets **peckish** after a day unfed (half yield) and **hungry** after three (zero
yield *and* no jackpot ticket). Feed it a **snack** to reset the clock. Snacks are **100% burned**,
and you get one free snack a day. Neglect is a real faucet gate — a hungry word can't win.

## How does the daily jackpot work?

Lexigotchi picks one secret word per day from its **own pre-committed sequence** (a hash-chain, so the
answer can't be steered). If that word exists, is staked, and is not hungry, its owner wins the whole
pot — case doesn't matter. Otherwise it **rolls over** and grows. There's also a soft bonus when a
*Let's Have A Word!* round's winning word happens to be one you own.

## What's the weekly bounty?

Each period features a **category** of words (contains a rare letter, has a double, ends in -ING, …).
Every player holding a **staked, not-hungry matching word** shares a bounty pool pro-rata, weighted by
rarity. It's funded zero-sum from the yield pool, reaches the whole base, and an unsatisfied period
rolls forward.

## What is prestige / ascension?

A full-UPPERCASE staked Word can **ascend** through 4 Gilded stages, each multiplying its yield and
bounty weight. Like rolls, an attempt pays a fee and burns a snack and succeeds on a pity ramp;
**failure is a no-op** — your word is never harmed. It's the renewable late-game depth for collectors
who've maxed a word.

## What are showcases and swaps?

A **showcase** arranges any letters you own into any string (no dictionary check) and casts it — pure
vanity, no NFT, every cast an ad. A **swap** is a direct two-sided letter escrow ("my Q for your two
Z's, + some $WORD") you share as a cast. It's not a marketplace — open price discovery still lives on
any standard NFT venue.

## Can I dissolve a word?

Yes. **Dissolving** burns the Word NFT, returns its 5 escrowed letters to you (in their current case),
and frees the name for anyone to re-claim. It's the escape hatch for a claim you regret — so you can
claim boldly.

## What is $WORD and how do I buy it?

$WORD is the game's ERC-20 on Base (`0x304e649e69979298bd1aee63e175adf07885fb4b`). It pays for mints,
rolls, claims, and snacks, and funds yield + the jackpot. Tap the balance pill in the app to buy —
the native swap in Farcaster, or DexScreener on the web.

## Where do my fees go?

Every fee splits into four buckets: the **Rewards Pool** (UPPERCASE yield), the **Jackpot**, a
**Burn** (deflation), and the **Treasury**. Snacks are 100% burned. The buckets can never pay out more
than they hold — solvency is guaranteed by construction.

## Is it provably fair?

The value-bearing rolls use a commit→reveal flow, the daily jackpot word comes from a pre-committed
on-chain hash-chain (so no one — not even the team — can change a future answer), and a failed roll
**provably never harms your asset**. The full dictionary and letter odds are published and derived
from the data.

## Do I need a Farcaster account?

You can play in any Farcaster client (you're auto-connected) or on the open web by **signing in with
Farcaster** or connecting a Base wallet. The free **daily single needs an identity** — a Farcaster
account, or a [Coinbase-verified](https://www.coinbase.com/onchain-verify) wallet — packs and
everything else work without one.

## I play on web AND in the Farcaster app — is my bag shared?

Yes — your bag is **one collection per person**: everything held by your connected wallet plus every
wallet your **Farcaster account has verified**, shown together wherever you play. Two details:
letters always **mint to the wallet that's connected**, and actions (spelling, rolling, staking,
feeding) need the wallet that holds the piece. If you play on the web with a wallet your account
hasn't verified, those letters won't appear in the Farcaster app — the fix is to **verify that
wallet** (Warpcast → Settings → Verified addresses) and your whole bag folds together, instantly
and retroactively.

## How many words and letters are there?

4,438 claimable words and a global supply cap of 55,467 letters across the 26 ids. 45 of the words are
Legendary.

## Are the contracts live?

This is the **Phase 0 prototype**. The full Solidity suite (letters, words, rolls, staking, jackpot,
bounty, prestige) is written, tested, and ready — but not yet deployed or audited. The playable app
runs on a faithful mock of those contracts, so prices and balances there are illustrative.
