# Lexigotchi — decisions & findings (Phase 0)

Running log of decisions made and things discovered during the Phase 0 build. Specs of
record: `docs/spec/v0.1.md` + `docs/spec/v0.2-changelog.md` (v0.2 wins on any conflict).

## Build decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Standalone repo, modern clean stack** — Next.js App Router, TypeScript, Tailwind, recharts. Not coupled to the LHAW pages-router codebase. | Owner's call; fresh tooling over copy-paste leverage. |
| D2 | **Foundry** for the eventual on-chain layer (not Hardhat like LHAW). | Invariant + fuzz testing is the right tool for the solvency math; the off-chain sim here already encodes the invariants to port. |
| D3 | **Sim/economy core is zero-runtime-dependency TypeScript.** | Runs and verifies via `tsx`/`vitest` independent of the app; the de-risking artifact must not depend on the UI building. |
| D4 | **Dictionary vendored + economy derived in code, asserted against the spec in tests.** | The published tables can never silently drift from the data. |
| D5 | **EGGS = commit + server-signed reveal** (not blockhash). Mirror for rolls/mints; *strengthen* for the jackpot (hash-chain). | See `docs/reference/eggs/PATTERN.md`. |

## Spec corrections found while reconciling Appendix A/B against the real dictionary

These are confirmations-with-footnotes — the spec is trustworthy; three figures needed a
precise reading. All are encoded + tested in `src/lib/economy.ts` / `tests/economy.test.ts`.

1. **Dedup is required and the vendored list is already unique.** The file's `WORDS` export
   (`[...categories].filter(notBanned).sort()`) evaluates to exactly **4,438 unique** words —
   the categories don't actually overlap. (An earlier text-parse suggesting 4,457/19-dupes
   was a regex artifact.) Our `Set()` pass is a defensive no-op. ✅ matches spec.
2. **Supply caps sum to 55,467, not 55,475.** The deployable per-ID caps are
   `floor(slots × 2.5)` and sum to **55,467** — which is exactly what the spec's own Appendix A
   per-letter column sums to. The prose headline "55,475" is the idealized `2.5 × 22,190`
   *before* per-letter flooring. Use 55,467 as the deployed total.
3. **Rarity tier cuts use `floor` percentiles + alphabetical tiebreak.** This reproduces the
   spec's anchor counts exactly (Common 2,219 / Epic 177 / Legendary 45 and the exact
   45-Legendary list). One word straddles the Uncommon/Rare score-tie boundary, so the
   computed split is 1,331/666 vs the spec's 1,330/667 — the **combined 1,997 is invariant**;
   the boundary word's tier is a documented tiebreak, immaterial to gameplay.

## What the Phase 0 sim revealed (v0.2 mechanics)

Run it: `npm run sim` (defaults: 270 days, 800 players, seed 1930). Findings are robust to
seed; **absolute magnitudes depend on player-budget assumptions** (placeholders) — read the
*relative* dynamics, not the exact numbers.

1. **Solvency is structural and holds.** Yield = `rate × pool` (≤ pool) and the jackpot pays
   only what it holds, so no bucket ever goes negative. Asserted every day in the ledger and
   in `tests/economy-model.test.ts`. The spec's "solvency by construction" is real.
2. **The mint sink is finite.** All 55,467 letters mint out (≈ day 69 on the revised ladder;
   the whole dictionary claims out ~day 70), after which the one-time mint/claim revenue is gone
   and the economy runs **only on the recurring sinks — rolls + snacks**. This is the single most
   important long-run insight: the durable economy depends on roll volume and snack burn, not
   minting. (Higher per-letter prices push mint-out slightly later than the old $0.60-pack ladder,
   which completed ~day 64.)
3. **The Rewards Pool finds an equilibrium**, not an ever-rising balance: `pool* ≈
   (daily pool inflow) / (daily distribution rate)`. With UPPERCASE-only yield, early payouts
   are tiny (few uppercase words) and the pool grows; as upgrades accumulate, outflow rises
   and the pool settles toward `pool*`. (The printed `est. equilibrium` uses trailing-30-day
   inflow and assumes it holds — a post-mint-out shape shift can move the true level.)
4. **Jackpot escalation is driven by neglect, not just the early game.** The claim-rush window
   produces the first big rollovers; but after the churn+hunger fix (Bugbot finding #8), a
   *held-but-hungry* word is jackpot-ineligible, so rollovers stay high (~53% of days) even at
   saturation — neglected words can't claim the pot, so it keeps escalating (~57% of days on the
   revised ladder). Player churn + hunger are first-order faucet gates, not flavor.
5. **Strongly deflationary.** Burn (snacks 100% + 20% of mints/rolls + 25% of claims) far
   exceeds treasury accrual — $WORD is net-burned over the run.
6. **Casual players (50% of the base) can be shut out of claiming** and earn ~0% because
   high-budget archetypes win the claim race for unclaimed words. **Caveat: the sim models no
   per-letter secondary trading** (only a macro royalty inflow, added after the Phase-0
   review — see `phase-0-review.md`). v0.2's marketplace (royalty → pool) and showcase (letter
   demand outside the dictionary) are exactly what give low-budget players an economic role.
   A real letter market is the highest-value next sim iteration; until then this is a retention
   flag, not a verdict. **→ now modeled — see "Secondary letter market — sim experiment" below.**

The Phase 0 build was then put through a 5-agent **adversarial review** (3 solvency skeptics +
spec-completeness + art critics). The solvency core survived all three skeptics with **zero
real defects**; the one real (low) finding — a dead royalty faucet — is now fixed, and the art
findings are implemented. Full writeup: `docs/phase-0-review.md`.

## Launch decisions — LOCKED (2026-06-22)

The launch rulings from the decision walkthrough. These are the **live spec** — where they conflict
with the dated analysis below (the $0.05 daily, the "multisig" peg language, the LP-depth lever, the
old pump numbers), **these win**. The findings below stay as the historical record of what the sims
showed; only the *decisions* changed.

1. **Daily mint — FREE, FID-gated**, claimable in Farcaster clients AND the Base App (`base:app_id`
   meta shipped). The FID is the only Sybil gate; never an ungated wallet daily.
   **AMENDED 2026-08-12 — verified-wallet daily added** (Jake's ruling). Two premises broke: Base
   App dropped Farcaster/FID identity on 2026-04-09 (pure Base App users could not claim at all),
   and a fresh FID costs ~$0.30 scriptable — a speed bump, not a wall. The daily is now gated on
   **FID OR a Coinbase Verified Account** (EAS attestation on Base mainnet, KYC-backed, checked
   server-side; `src/lib/onchain/verifications.ts`). Verified wallets use synthetic keys
   `2^160 | address` in the same on-chain `dailyUsed` mapping — zero contract changes, audited
   before build (the contract never interprets the key). Never an *unverified* wallet daily.
   Known ceiling, accepted: one Coinbase account can attest ~3 addresses, so a maximally-equipped
   human = up to 4 dailies/day (1 FID + 3 attested wallets), each behind KYC. Upgrade path: Base
   Verify's per-consumer `identityHash` (strict one-human-one-claim) once access is granted —
   applied via their interest form.
   **AMENDED by #21 (2026-11-25):** 10 free daily letters per profile in all (still at most one a
   day), plus a free pack, from a 30,000-letter budget, ending near 95% of the dictionary claimed.
2. **Campaign airdrop — claim-on-first-open**: the eligible player connects and the signer mints a
   one-time 5-pack voucher to their own wallet (idempotent vs `pack_grants`). No FID→address
   resolution, no gas on no-shows.
   **AMENDED by #21 (2026-11-25):** the free pack is for every verified profile (Farcaster, X, or
   Coinbase-verified), not the campaign's add-and-share reward; the campaign still records both.
3. **Jackpot — operator rake cut 25%→10%** (freed share to burn/pool). **No AMOE** (owner's call);
   the `AnswerChain` skill element is the non-lottery argument — counsel to vet chance-vs-skill.
4. **Full letter supply at launch** (2.5× cap, ~55,467); no metered waves.
5. **Price ladder v1 = current params** (pack $1 · roll $0.25 · claim $0.50 · snack $0.02 · **daily
   free**); owner-tunable post-deploy. Free-daily re-sim: ~$27K demand, mint-out ~day 56, dictionary
   100% ~day 90, solvency holds.
6. **No treasury ETH seeded for liquidity** — launch on the ~$21K book; accept the ~8× pump (peak
   mcap ~$190K, self-heals ~$60K; cost-to-play ~1.1× so players are unaffected). Still publish the
   disclosures (holdings, lock/vesting, reframe copy to play-not-price).
7. **Automated peg — an `onlyKeeper` repeg setter** + guardrails (drift threshold ~5%, max-move
   clamp, min-liquidity floor). Shipped on-chain as `maxMoveBps` (default ±20%) per repeg with a
   hardcoded 5-minute cooldown (`RepegKeeper`); the "~±25%/day" of the original ruling is keeper
   *policy* — the daily cadence is enforced off-chain, not by the contract. Reuses LHAW's
   off-chain $WORD price fetch (same token) but not its one-value-to-one-setter model.
8. **$WORD-only at launch** (`SWAP_ROUTER` blank); ETH-only players use the Buy-$WORD redirect. No
   swap-adapter build.
9. **Mini-app AND general web wallet** play (two connector paths); the free daily stays FID-gated
   (web users sign in with Neynar for it).
   **AMENDED 2026-11-20 — standalone onchain game** (starl3xx's ruling, verbatim): "what I want is for
   people to be able to play without having an account on Farcaster or Base BUT be able to link them
   if they want... it should be a standalone onchain game". The
   WALLET is the account: any wallet connects through the RainbowKit modal (`src/lib/onchain/wagmi.ts`),
   and Farcaster is an optional link (Sign In With Farcaster on the web — Neynar's SIWN retired
   2026-08-14). Linking Farcaster or using a Coinbase-verified wallet still unlocks the free daily,
   because a wallet alone proves nothing about personhood — decision 1's "never an *unverified*
   wallet daily" stands. A wallet-only player plays on packs, so they need $WORD first (decision 8).
   "Link Base" (starl3xx, 2026-11-20, verbatim): "link Base should be the connect to Base button
   provided by Base (I think Let’s Have A Word! uses it?)". So the start screen carries Base's
   official `SignInWithBaseButton` beside the RainbowKit modal (`SignInWithBase.tsx`). It CONNECTS a
   Base Account as the player's wallet: no server session, because no route needs proof of wallet
   ownership, and no wallet-to-wallet merge (see the 2026-11-24 amendment below: Link another wallet
   now joins wallets into one account, by signature). It does not unlock the free daily by itself (a Base
   Account is not a Coinbase-verified wallet).
   Reminders for wallet-only players (starl3xx, 2026-11-20, verbatim): "browser push... no email
   (unless we get it somehow?)". So browser push (Web Push, VAPID), keyed by wallet, ships dark
   behind `WEB_PUSH_ENABLED`; nobody already reached on Farcaster gets the same message twice. No
   email: nothing in the game collects one.
   **AMENDED 2026-11-24 — profiles, X, and email are on** (starl3xx, 2026-11-23: "link X, Farcaster,
   or Coinbase for a free daily letter", "Reminders by email", "Public, with a clear notice"). The
   profile (`sheets/ProfileSheet.tsx`) links X (OAuth 2.0; an X account older than 90 days also
   unlocks the free daily, one letter a day per player across every linked account) and takes an
   OPTIONAL email, confirmed with a 6-digit code, for hunger, daily-letter, and jackpot reminders,
   each with one-click unsubscribe. The player copy now says "an email is optional" instead of "no
   email". The name and picture come only from a linked X or Farcaster account.
   **AMENDED 2026-11-24 — linked wallets** (starl3xx: "i should be able to share a single account
   across multiple wallets (self-custody, farcaster, etc)"). Link another wallet (profile) joins up
   to five wallets into one account, named by its first wallet: one bag, one profile, one free daily
   letter. Each joining wallet signs a link message naming the account (a single-use server code as
   the nonce), so it works across devices and from a Farcaster host. Letters and words stay in the
   wallet that holds them (the contracts act on msg.sender); linking never creates a daily key; links
   are public, like X. Unlinking waits for tomorrow on a day the account took its letter.
   Then (same day, starl3xx: "fix all of those, including move here"): the leaderboard counts an
   account as one player; hunger, winner, and daily-ready reminders resolve by account; and Move
   here lets the holding wallet send its loose letters and held words to another wallet in its
   account (staked words stay; the destination is read fresh from the account; it can't be undone).
   Then (same day, starl3xx: "everything should be profile-based... no matter how they first sign
   in, their profile is built from that"; chose "Yes, automatically" for Farcaster wallets): "you"
   is the player on every screen (usePlayerWallets), the swap board shows players, and wallets a
   Farcaster account verified join the profile on their own (via "farcaster", migration 0009) when
   that FID also verified a wallet the profile already had by signature or as its first wallet. They
   leave when Farcaster stops verifying them; Unlink refuses them.
   Then (same day, starl3xx: "this wallet/profile issue is critically important for the success of
   the game"; yes to both): a GAME WALLET the player chooses (table game_wallets, migration 0010),
   with notices that speak only when it matters (gameWalletAdvice: choose / move to it / switch to it
   / gather), $WORD in Move (opt-in), and a warning before staking off it. Not the profile's first
   wallet by default: that one is sometimes picked by rule. A contract change so any of a player's
   wallets can play and feed is being DESIGNED before mainnet (no contract edits yet).
   Then (same day; starl3xx: "1. yes 2. no for now 3. yes 4. full redeploy"): the caretaker list
   (diff A) is in the contracts, plus a guard so Staking refuses a Word sent to it directly (audit
   scan); caretaker unstake (diff B) is NOT taken; opt-in approvals between a player's wallets come
   later in the app; Base Sepolia gets a full redeploy (testers' testnet items reset).
   Then (same day; starl3xx: "only one wallet per profile should get a free anything"): the free daily
   letter and the free pack are recorded per PROFILE in the database (free_claims), so a profile's
   other wallets are refused even when the Farcaster lookups behind the onchain walk fail. The free
   snack becomes one per profile too (starl3xx: "yes you should design and build it", with the
   mixed-case redeploy): the server signs a voucher naming the caller, the staker, and the staker's
   profile (its account), and `Staking.feedWithSnack` spends `freeSnackDayPlusOne[profile]`. Plain
   `feed` always pays. The snack is the STAKER's profile's, whoever feeds, so caretakers in other
   profiles can't multiply it.
   Open, not yet ruled: whether the game should REMEMBER a link across visits (today the Farcaster
   session is tab-scoped by design, `src/lib/auth/siwfWeb.ts`).
10. **Chain reads — a custom Neon/Drizzle indexer + viem multicall** (not a subgraph).
11. ~~**Prestige OFF at launch** (enable post-cohort)~~ (reversed by #19: ascension, as the word
    ladder, is ON at launch); the secondary-letter swap is P1. **The weekly
    bounty is ON at launch** (amended by starl3xx, 2026-11-23: "the bounty should be on at launch"):
    deploy with `BOUNTY_CARVE_BPS=1500` (params `bounty.carveFraction` 0.15, zero-sum against
    yield), and the keeper's `bounty` job is in the default run. A week pays when it ends: the run on
    the first day of week P settles week P − 1 (`bountyPeriodToSettle`), so players can chase the
    theme all week.
12. **No external audit and no legal review** (starl3xx, 2026-11-21, verbatim): "there won't be a
    security audit (you can find skills to look at this) or lawyer convo". The internal audit with
    the `solidity-auditor` skill replaces the external one (`contracts/AUDIT.md`, second pass); its
    four confirmed findings were fixed before any mainnet deploy.
13. **Copy and sharing, from the first browser-wallet test** (starl3xx, 2026-11-23). The word
    browser is the **Dictionary**, never "Lexidex", in every surface: "“Lexidex” should just be
    “Dictionary”". **Showcase is built for X first, Farcaster second**: "Showcase should be built
    for Twitter first, Farcaster 2nd". So "Post on X" is the primary button, and each share links
    to `/s/<letters>`, a page whose card draws the letters (X shows a picture only for a link that
    carries its own `og:image`). And a tap must never look ignored: "there should be a loading
    indicator or something to indicate to the user that their action has been recorded/submitted
    and is processing" (`src/lib/onchain/actionGate.ts`, the BusyPill). Staking copy says what it
    buys: "stake makes you eligible for the jackpot, but only uppercase, fed words can earn WORD";
    so a word that isn't fully UPPERCASE offers "Stake for jackpot", and the word sheet says why
    Feed is off (`careNote.ts`). A word nobody has fed is "full", not "fed": "this says “fed” but
    there's no feeding necessary/enabled yet. that's misleading". Coinbase renamed Base
    Account to **Coinbase Wallet** ("looks like sign in with Base is now Coinbase Wallet BTW"), and
    every surface says so: "shouldn't this be “Coinbase Wallet”?" Coinbase still ships only the
    sealed "Sign in with Base" button, so it is replaced by our own **Sign in with Coinbase Wallet**
    (`SignInWithCoinbaseWallet.tsx`, same `baseAccount` connector, text only), and the connect
    modal's row is relabeled (`coinbaseWalletAccount` in `lib/onchain/wagmi.ts`). This supersedes the
    2026-11-20 choice of Base's official button.
14. **The server finishes rolls; approvals stay standard** (starl3xx, 2026-11-23). A roll was two
    wallet confirmations, and the second (the reveal) spoiled the result: "the transaction itself
    *spoils* the outcome, by showing an NFT or nothing". Chosen: "Game finishes it". The player
    confirms only the paid commit; `/api/roll/reveal` (`{ relay: true }`) sends `Rolls.reveal` from a
    fourth hot key, `RELAYER_PRIVATE_KEY` (`src/lib/onchain/relayer.ts`, builder code on every
    write), and answers with the outcome read from the mined reveal's event. `Rolls.reveal` is
    permissionless, so no contract change. Without the key, or when nothing was broadcast, the
    player's wallet sends the reveal as before. Packs, the daily letter, and ascension still reveal
    from the wallet and spoil the same way; the same relay can cover them later. Also ruled: the
    unlimited $WORD approval and the one-time letter and word "approve all" stay ("I think
    unlimited spending permission is fine"; "Keep as is").
15. **Showcase shows only your own words; words live in scenes** (starl3xx, 2026-11-24). Reverses
    the free-text Showcase of #13: "Changed my mind: Showcase should only be for words you own
    (people could tweet all sorts of crazy shit otherwise!)". The Showcase now offers the player's
    own words (the whole bag), and `/s/<text>` and its card draw dictionary words only
    (`parseShowcase`, plus `HOUSE_CARDS` for the game's own HEYOO welcome card). Any other link is a
    404, including the free-text shares made before this. The dictionary is the guard, not
    ownership: the page doesn't check who owns the word, because a word changes hands and its case
    changes as its letters are rolled up, and a posted link must keep drawing after both. So a
    hand-typed link can still draw a dictionary word the sender doesn't own. That is the limit, and
    it is harmless. And each word gets a **scene**, its home on the Today stage, in the Showcase,
    and on the share card: "the background is a user’s words’ home habitat, it should be very
    thoughtfully designed and pretty/delightful". The Stage for everyone, redrawn with perspective
    and motion. Trophy Case, Picture Day, Spring, Summer, Fall, and Winter unlock at 3 words and
    stay unlocked ("an Unlock for reaching, say, 3 words spelled"; "unlock should stay open after 3
    words, even if one is dissolved"): the count is every word the bag's wallets have EVER held,
    read from the same transfer scan as the bag (`readWordsHeld`, `unionEverHeld`), so it holds on
    every device with nothing stored. The scene shows the word's mood: grey and foggy when peckish,
    near-grey under thick rolling fog when hungry, clear when fed ("a cool animated, opaque fog";
    no film grain: "not a fan of the grain"). The share link carries the scene (`?scene=`).
    **Where a pick lives** ("make sure you're thinking through how scenes are stored/preserved/tied
    to a user and their profile"): in the browser always, at once (offline, before sign-in, practice
    mode), and in table `word_scenes` (migration 0011, `/api/scenes`) when profiles are on and the
    player already has a profile session, so it follows them to every device and host. A row is
    keyed by the wallet HOLDING the word, not the profile account: the bag knows every word's holder,
    and linking or unlinking wallets moves nothing. A session may save for every wallet in its
    profile account, so one sign-in covers a unified profile (the single-profile work in progress)
    with no change here. A scene pick never asks to sign in: unsynced picks upload the next time a
    session exists, and the newer pick wins when the browser and the server disagree. No onchain
    ownership check on save: a row only changes what its own wallet's words show.
16. **Earnings are paid automatically, and shown wherever a word is** (starl3xx, 2026-11-25, on a
    tester's "If you have a 5/5 uppercase staked and earning $word is there a place to see how much
    has been earned so far?": chose "Paid automatically"). Until now each day's yield share sat in a
    Merkle epoch until the player found a Collect button and signed a claim, and nothing showed what
    a word had earned. `MerkleEpochs.claim` is permissionless and always pays the leaf's baked-in
    account, so the keeper's new `payout` job (after `yield` and `bounty`, in the default
    KEEPER_JOBS) sends every unpaid share's claim itself, batched through Multicall3 with per-call
    failure allowed, oldest epoch first, within 90 s of the cron's 300. No contract change. Cost to the
    operator: about 57k gas per share (171,089 for three in one batch, measured on a Base Sepolia
    fork), about $0.001 per earning word per day at 2026-11-25 Base prices. Players never sign, pay
    gas, or watch the 90-day window close. Display: `/api/rewards/earnings` (each word's earnings
    for the player's wallets, the latest payout day by chain time, anything unpaid), the Earnings
    sheet, a line under the Today stage and the Bag's words, the featured word's bubble, the word
    sheet, the Bag card's coin, the balance sheet, and a toast once per payout. The verb is
    "Collect" (never "Claim", which is spelling a word), kept only as the fallback for a share the
    keeper missed. Practice pays its words on Skip a day, as the keeper would.
17. **Mixed-case claims** (starl3xx, 2026-11-24). Replaces v0.1's "any case, but uniform — Mixed
    sets cannot initiate a claim": "you should be able to spell a word with a mix of any case
    letters". A tester with four UPPERCASE letters found the Spell screen's UPPERCASE tab locked and
    their raised letters missing from the tray, because no five of one case spelled a word.
    `Words.claim(word, uint8 upperMask, proof)` now names each letter's case (bit k ⇒ position k
    escrowed UPPERCASE; 0 all lowercase, 0x1F all UPPERCASE), and `Claimed` carries the mask. Nothing
    else in the contracts changes: the escrow always stored a per-letter mask (raising a letter in a
    word made Mixed words already), so case stays derived, a staked Mixed word is jackpot-eligible,
    and yield still needs all five raised. **The app's quick Claim uses UPPERCASE first** where the
    player holds both cases of a letter ("UPPERCASE first"); picking tiles by hand claims exactly
    the tiles picked. The sim does the same. **Sim effect** (365 days, 1,500 players, seeds 7/11/23,
    vs one-case claims): claims still reach the whole dictionary and solvency holds, but year-one
    all-UPPERCASE words fall 7–15% (838/820/812 → 712/727/756) and yield-eligible words 13–24%
    (373/382/419 → 325/292/329). Lowercase first instead keeps a few more all-UPPERCASE words
    (809/733/766), not consistently, and loses the same yield (322/293/353), so the cause is the
    mixing itself, not which case goes first. Why is not yet traced: a guess is that raised letters
    now spread across many Mixed words instead of waiting to fill whole UPPERCASE ones. Archetype
    ROI moves too (gamblers recoup about 130–145% instead of 100–120%); the staker archetype swings
    between 0% and 80% on every seed and rule, so it says nothing here. **Ships with a redeploy**:
    Words isn't upgradeable and Staking, Jackpot, Rolls, and Prestige hold its address, so the
    app's claim call (`claimCalls`), the `Claimed` event the bag and the keeper read
    (`onchain/reads.ts`, `keeper/scan.ts`), and `abis.ts` switch in the same change that points the
    registry at a Words with this signature, on branch `feat/mixed-case-spell`. Either order alone
    breaks testnet: the app first, and every claim reverts on the old Words; the redeploy first,
    and every claim reverts on the new one and claimed words drop out of the bag and the keeper's
    scan. Until then the deployed Words still takes one case (owner: "Build now, deploy later").

18. **Words sell on the in-game board, in $WORD, with a 10% fee to the Rewards Pool** (starl3xx,
    2026-11-25: "WORD only", "fee rate should be 10%, to rewards pool", and "no counsel"). This
    reverses three earlier calls. "Integrate, don't build" for price discovery: the board is now the
    game's market for words, and OpenSea stays open. The 2.5% in-house fee rate. And ROYALTY → 100%
    Treasury, which existed because marketplace royalties arrive in ETH; this fee is $WORD, so it
    needs no swap. Why: once the dictionary is claimed (about day 70), buying a word is the only way
    a new player gets one, and a unique word is where a price says something (a letter has
    thousands of copies, and the June sim found letter trading changes little). Mechanics: a Seaport
    order offers one Word, through a per-token approval (ERC-721 clears it on any transfer or burn,
    so staking, moving, or dissolving the word kills a stale listing, and a phished signature can't
    reach other words). Its payment is two $WORD items: the price less 10% to the seller, and 10% to
    `SaleFees`, whose permissionless `flush()` routes the fee through FeeSource.ROYALTY (pool 100%,
    less the bounty carve: 85/15 at 1500 bps). The board's server rejects any order that pays less.
    The buyer approves only the price. Staked words can't be listed. The ERC-2981 signal is
    unchanged (2.5% → Treasury, paid in ETH on other venues). No counsel: the owner accepted the risk
    raised at the time, a priced word that earns yield and holds jackpot entries, on a market the
    game runs and takes a cut of.
19. **The economy rewards staked, fed word holders** (starl3xx, 2026-11-25). The goal, in the owner's
    words: "we want them to buy letters, upgrade them to uppercase and stake them as words … the
    economy should be structured to reward staked and fed word holders." Decided after a simulated
    retune (1,500 players, a year, five seeds, archetypes interleaved through onboarding; see below):
    - **Every paid action (packs, the daily letter, rolls, claims, ascension) splits 75% Rewards
      Pool / 10% jackpot / 10% burn / 5% treasury.** Was 40/10/20/30 on mints, 47.5/10/27.5/15 on
      rolls and ascension, 32.5/10/32.5/25 on claims. The pool's daily yield is the one reward that
      needs every step of the loop (buy, raise, stake, feed). The jackpot stays at #3's 10% (two 25%
      options were measured and declined). The treasury never sells, so 5% is a reserve for seeding
      the pool or bounty, not income. Measured: 58% of all spending returns to staked, fed words
      (37% before); a dedicated staker gets back 55¢ per dollar (36¢); about a fifth less burn than
      before; no player type gets back more than it spends (whales 81¢, 83¢ with the whole package).
    - **Snacks stay 100% burned.** Sending half of each snack to the pool would have paid whales
      $1.04 per dollar spent, funded by everyone else's snacks.
    - **Rolls: 40% first try, +15pp per miss, cap 85%** (was 45 / +10 / 85). The average stays about
      1.97 rolls per raised letter (was 1.91): raising is the step the game wants players to take.
    - **Ascension is the word ladder, ON at launch and on Sepolia** (reverses #11). Five stages:
      Gilded 1–4, then Holographic (the gold turns to iridescent foil). First-try odds
      40/35/30/25/20%, +10pp per miss on that word, cap 85%. A stage-N attempt costs N × $0.50
      ($0.50 … $2.50) plus a burned snack: `Prestige.sol` charges `prestigeFee × (level + 1)`
      (`stageFee`), so the price keeper still repegs one base number, and each commit records the
      stage so the signer draws at that stage's odds. 1.10× yield and bounty weight per stage (a
      Holographic Legendary ≈ 12.9× a Common). No cap on holographic words for now: harder odds are a
      setting if they get too common; a hard limit would be a new contract feature. The contract
      change reopens #12's internal audit for `Prestige.sol`.
    - **What the split can't fix:** spending per staked word falls about tenfold from the building
      phase to the late game, and prizes and returns both scale with it, so no split keeps both big
      all year. Paid spending late in the game is the ladder's job. Revisit the split with real
      numbers after a few months (an owner setter, one call per fee).
    - **Found while measuring:** `simulate.ts` onboards archetypes in blocks (casuals first, whales
      last), so at large populations the whales arrive after letters sell out and never play. These
      numbers come from a copy that interleaves them. The repo's simulator still needs that fix, and
      the "Renewable late-game loop" findings below (casual bounty share ~18%, whale yield share
      ~48–52%) came from the block roster and may not hold (interleaved: ~2% and 76%).

**NO MULTISIGS anywhere.** Owner = a single EOA (hardware wallet), used rarely (param ceilings,
`seed()`, upgrades). Keeper = a separate hot key, `onlyKeeper`-scoped (jackpot resolve, epoch opens,
AnswerChain reveal, and now the repeg). This drops the Safe / `transferOwnership`-to-multisig step
from the launch path.

**Pre-freeze contract changes** (must land before the audit freeze — they alter the audited surface):
(1) a free-daily signer voucher on `Letters`, (2) a free-pack signer voucher on `Letters`
(claim-on-first-open airdrop), (3) the 10% jackpot-rake split default, (4) the `onlyKeeper` repeg
setter. All small, riding existing suite patterns.

**Builder code** `bc_bu1cyzms` rides every on-chain action (ERC-8021, `src/lib/onchain/builderCode.ts`).

20. **A jackpot word is drawn at most once, ever** (starl3xx, 2026-11-25: "drawn words should be
    guaranteed not to be drawn again"). Two layers:
    - **The list covers the whole pool.** A seeded answer list defaults to every word in the frozen
      pool, once (`FULL_SCHEDULE_DAYS` = 4,584 days, about 12.5 years). The old 730-day default (the
      generator's, from #47) would have run out after two years, and the next list could repeat old
      answers. Sepolia's list was re-committed at full length before its first reveal (block
      63,523,610); the same seed kept its first 730 answers.
    - **The contract refuses a repeat (mainnet).** `AnswerChain.wasRevealed` records every revealed
      word, keyed like its Words tokenId, across every list the contract ever holds, and `reveal`
      reverts `AlreadyRevealed` on a repeat. Accepted trade-off: a faulty list stops the jackpot at the
      repeat (and `setHead` can't replace it mid-stream) instead of drawing a word twice. Sepolia's
      deployed AnswerChain predates the guard and relies on the full-length list.

21. **Letter supply 3.0×, and a free pack plus 10 free daily letters for every verified player**
    (starl3xx, 2026-11-25). In the owner's words:
    - "okay yeah let's do 3.0x"
    - "every verified player (FC, X, or CB-verified) gets a free 5-pack at launch and 10 free daily letters"
    - "30K budget is good"
    - On farming: "it would be such a headache to farm this, I feel like, especially since we're giving
      away letters, not words"

    Background: a supply simulation (letters spread across player bags, no trading, 1,500–6,000
    players) found the dictionary reaches 99% claimed after 36–55K letters. At 3.0× (68,760) that
    leaves about 14K letters for latecomers and re-claims. Beyond about 55K, most extra letters never
    end up in a word.
    - **Supply:** `DEMAND_MULTIPLE` 2.5 → 3.0 (68,760 letters; Q 115 → 138). Caps are Letters
      constructor args, so this takes effect at the mainnet deploy; Sepolia keeps 2.5× (57,294) to avoid
      a testing redeploy (starl3xx: "it's okay if we keep the current cap on Sepolia and change it for
      mainnet"). The economy sim (365 days, 1,500 players, seeds 7/11/23) at 3.0× against 2.5×: mint-out
      on day 59 against days 55–56; 99% of the dictionary on day 50–51 either way; solvent either way;
      about $8.7–9.2K burned against $8.3–9.0K; the Rewards Pool's equilibrium $299–368 against
      $198–267; about $33K of $WORD bought to play against $28–29K.
    - **Free letters:** every verified player (Farcaster, an X account older than 90 days, or a
      Coinbase-verified wallet) gets a free 5-pack and 10 free daily letters (at most one a chain day),
      once per profile. Amends #1 (one free letter a day, forever) and #2 (the pack only for the
      campaign). All free letters share a budget of 30,000 (`FREE_LETTER_BUDGET`), and free grants stop
      when the dictionary is about 95% claimed. Server-side only: no contract changes.
22. **Rarity shows on the tiles, and the top two tiers are renamed** (starl3xx, 2026-11-25: "the
    rarity of the letters is ultra important... it should be delightful and amazing and make people
    WANT better rarities"; chosen over several rounds of mocks).
    - **Rename:** Epic becomes **Legendary**, and the old Legendary becomes **Mythic**. Weights,
      counts, and cuts are unchanged (Legendary 184 words, weight 5; Mythic 46, weight 8). The
      contracts rank tiers by number, so nothing onchain moves (`npm run derive:contracts` gives no
      diff). Earlier entries here keep the old names: read their "Epic" as Legendary and their
      "Legendary" as Mythic.
    - **Finishes:** each tier above Common wears a subtle, translucent material on its letter
      tiles (`lib/rarityFinish.ts`, `components/game/TileFinish.tsx`): Uncommon satin jade, Rare
      sapphire foil, Legendary polished gold with engraved scrollwork, Mythic cut amethyst with
      spectral fire. Common stays plain. Rainbow belongs to Holographic ascension (#19) and Mythic's
      fire only. A peckish word's shine dims; a hungry word's goes until it's fed.
    - **The light moves in moments, not loops** (starl3xx: the mocks were "melting my laptop's GPU…
      make it as efficient as possible across all devices"). Every tier's period (7–10 s), the word in
      focus gets one moment: a light crosses it letter by letter, then everything rests. Looping the
      same effects on every tile kept a 4×-slowed phone's main thread at 99% (a Common word: 37%). In
      moments, the share page costs 16% (Legendary) and 26% (Mythic) over 12 s at 4× slowed (headless
      Chrome, software raster: a real GPU, a real iPhone, and a low-end Android are untested). Only
      full-size words move, only on screen, never under reduced motion or Save-Data or on a phone
      with 2 GB or less. Lists draw still tiles. The core count isn't a test: WebKit reports at most
      2 on iOS, which would have kept every iPhone still.
    - **Share cards draw each finish as a still** (`app/_og/tile.tsx`, the same geometry). **No name on
      a link card** (starl3xx: the old pill under the word "looks cheap/misplaced and makes the card
      look imbalanced"): X prints the site under the card and the post tags @lexigotchi. A picture
      that travels alone (Save image, the Telegram welcome, later the share video) carries a quiet
      corner wordmark (`?saved=1`). Cards cache a week at the edge, so a link shared before this
      keeps its old card until then.
    - Next, in order: scene cards with backs and the Showcase folded into the Bag; live backs drawn
      with OGL; the share loop (front, turn, back).

## Pricing & launch economics (decided June 2026)

$WORD is **live** on Base — WORD/WETH pool `0xc5db…a275` (GeckoTerminal, as of 2026-06-11):
price **$2.357e-7**, **mcap/FDV ~$23.5K**, ~100B supply, **liquidity ~$21.2K**, **24h volume ~$0
(dormant)**. Paired with WETH (so the LP + every secondary trade are ETH-denominated). Team
treasury 10B+ $WORD (~$2,350).

- **USD-pegged pricing** (decision): prices are USD targets; an automated `onlyKeeper` keeper
  re-sets the on-chain $WORD amounts as the price moves (no multisig — see Launch decisions). The sim runs in USD; `priceWord()` converts. `WORD_USD_PRICE`
  is the live peg input.
- **Price ladder** (revised 2026-06-11; _daily SUPERSEDED 2026-06-22 → **FREE**, see Launch decisions_): daily **$0.05** · pack **$1.00** · roll **$0.25** ·
  claim **$0.50** · snack **$0.02**. (Was pack $0.60 / roll $0.15; raised on owner's call.) Per
  letter: pack $0.20, daily $0.05 — the FID single is 4× cheaper/letter, sharpening the habit hook.
- **Fee routing change (2026-06-11):** secondary royalty now **100% Treasury** (was 100% Pool,
  v0.2 §8) — see "Royalty & marketplace architecture". External royalties modeled as ≈0 (open
  composability); the in-house swap fee is the only enforced royalty.
- **Treasury bootstrap** (decision: bootstrap; compliance-reconciled): seed the **Rewards Pool**
  ($240) only. **`seed.jackpot = 0`** — an operator-funded chance prize is the core lottery risk
  (compliance verdict: rework). The jackpot self-funds from fee splits. Treasury's other lever
  is **LP depth** (a market op, not a faucet seed).
- **Mechanical peg** (recommended): peg off a 30-min TWAP, repeg on |Δ|>10–15% or weekly, ±25%/day
  cap — a keeper rule, NOT a discretionary or multisig lever (market-integrity crux). **DECIDED: an
  `onlyKeeper` repeg setter (see Launch decisions).** The AMM layer shows a *weekly*
  repeg already holds cost-to-play within ~10%, so this is cheap to honor.

**What the AMM/market layer found** (`npm run market` — constant-product layer; revised ladder):
- The game drives **~$27.1K** of $WORD buy-demand (>mcap) → an **~8.8× price pump** (peak mcap
  ~$207K) over the day-60–90 mint rush. Bigger than the old $0.60-pack ladder's ~6.4× — raising
  prices raises cost-to-play, so more $WORD must be bought to play, a stronger (steeper) catalyst.
- **Liquidity self-heals**: buy pressure deepens the pool **$21K → ~$63K** organically.
- **Burn ≈ 11.3% of supply** (not the ~50% a flat-peg sim implies — each $WORD is worth more as
  it's burned).
- **Peg holds**: weekly repeg keeps cost-to-play within ~1.1× even through the pump.
- **LP depth is the pump lever** ($5K LP → 6.7×, $10K → 5.5×), but treasury (~$2.4K) only funds
  ~$1.5–2K of it; real flattening needs ETH-paired liquidity.

**Structural launch risks surfaced by the 4-lens review** (`docs/pricing-review.md`) — these
matter more than the prices:
- **Compliance: rework the jackpot + get counsel BEFORE Phase 1** (not Phase 3). Add no-purchase
  free entry, geo/age-gating, official rules; stop the "lottery" language; minimize operator rake.
- **Collection completes ~day 70 → retention cliff** (active 596→138). Raising the cap multiple
  does NOT help (claim-race-gated). Needs a **renewable late-game loop** (UPPERCASE evolution
  stages / weekly bounties / seasons).
- **Market-integrity**: publish a treasury lock/vesting policy, the peg formula, seed tx links,
  a 48h sell-notice; reframe all copy from price/demand to play/collection; never publish the
  demand number.

## Contract-design corrections (June 11, 2026)

Surfaced while walking the game loop; recorded so they don't drift into the contracts.

- **Dissolution was never dropped from the design** — it lives in `Words.sol` (claim/dissolve),
  v0.1 §5.4, and the P1/Phase-4 roadmap, reaffirmed in v0.2 §6. It *was* missing from the sim
  (claims were permanent — `claims.set` with no `delete`) and from one verbal walkthrough. The
  sim now models it as a lever (below). Dissolution is the only liquidity escape hatch for a bad
  claim; "permanent, no exit" would change how boldly people claim, so keep it firmly in P1.
- **Pity must key on the WORD-OWNER address for escrowed-letter rolls — not the token holder.**
  When a letter is escrowed, the 1155 is held by `Words.sol`; keying pity on the current holder
  would collapse every player's escrowed-letter pity onto the escrow contract's *shared* counter
  (pump it cheap, harvest near-cap upgrades on anyone's word). Key on `Words.ownerOf(tokenId)`.
  Documented in `docs/reference/eggs/PATTERN.md` (property #5 + the `Rolls.sol` row).
- **Swap primitive ≠ marketplace** (reconciles the "build a marketplace" instinct with v0.2 §8's
  "integrate, don't build"). **Build** a small two-sided swap-escrow contract ("my Q for your two
  Z's, or for N $WORD"), shareable as a Farcaster/X link/cast — it solves exact-match discovery
  and doubles as the P1 mutuals-gifting loop. **Integrate** standard 1155/721 marketplaces
  (OpenSea et al.) for open price discovery, deep-linked from the Dictionary. The swap is in-house;
  open price discovery is not.

## Royalty & marketplace architecture (June 11, 2026)

- **Open composability — NO on-chain royalty enforcement.** Both token contracts are standard,
  freely transferable 1155/721 with **EIP-2981 as a signal only**. We do NOT adopt ERC721-C /
  ERC1155-C. Rationale: permissionless transfer (showcases, the swap primitive, listing on any
  venue) is worth more than defending an optional royalty. ERC721-C would restrict sales to
  LimitBreak Payment-Processor marketplaces (OpenSea + Magic Eden only) and OpenSea's
  "earnings-matching" drops the rate to whatever a non-honoring venue charges anyway.
- **Secondary royalty → Treasury, 100%** (overrides v0.2 §8's pool routing). Marketplace
  royalties arrive in ETH; Treasury holds ETH without an ETH→$WORD swap, whereas pool routing
  would force a swap on every drip. Not a compliance issue (a sales royalty isn't chance-based);
  it shifts value player-rewards → team, which the ETH-handling rationale justifies.
- **The only ENFORCED secondary-revenue rail is the in-house swap primitive.** Because it's our
  contract, it takes the 2.5% at clearing unconditionally — no marketplace goodwill needed. So
  the swap gains a second rationale beyond casual recoup: it's the enforceable royalty channel.
  `params.market.royaltyRate` should be read as the **in-house swap fee**, not an external
  royalty we can rely on.
- **Modeling consequence (implemented 2026-06-11):** the macro-royalty proxy (the trading-OFF
  path) would route `grossGMV × secondaryVolumeRatio × royaltyRate` to Treasury *as if external
  royalties are collected* — under open composability they mostly aren't. So `secondaryVolumeRatio`
  is now set to **0** in `params.ts` (external royalty ≈ 0); the in-house swap fee (the `trading`
  lever) is the sole royalty → Treasury. Applied in the live-data re-sim.

## Secondary letter market — sim experiment (June 11, 2026)

Built the lever the gate demanded *before* committing to a swap-primitive build: a SIMPLE daily
clearing (surplus duplicate letters list at a floor; blocked claimers bid for letters toward
their nearest unclaimed word; P2P $WORD, only the 2.5% royalty leaks out — to Treasury) plus
DISSOLUTION (voluntary recycle of dead low-tier claims), as two independent, default-off toggles
in `params.ts`. Run: `npm run trade-exp`. Verified: 36 tests, a daily letter-conservation guard
(held + 5×words == minted, every day), determinism, and a 5-seed robustness sweep.

**Verdict: the economic case for the swap primitive is weak; build it (lightly) for the social
case, not the numbers.** Specifically, robust across seeds:
- **Claim velocity does NOT reliably improve.** Completion sits ~day 70 and trading's effect is
  mixed across seeds — it helps some (`d70→d64`, `d83→d66`) and *delays* others (`d67→d69`).
  Reason: letter supply (55,467) hugely exceeds demand (4,438×5),
  so completion is gated by claim-race *ordering*, not letter scarcity — and the one thing
  trading can't manufacture is more *rare* letters, which is the only real per-word bottleneck.
  The "let me buy the one Z I'm missing" story is true individually but doesn't move the aggregate
  because nobody has spare Z's to sell. *Caveat:* this rests on the **flat floor** — a rarity-tiered
  floor would price spare rare letters higher and might draw more onto the market, so don't
  over-read the scarcity verdict (the tiered floor is the next refinement). Dissolution alone can
  also leave the dictionary perpetually a few words short of 100% (some always mid-recycle);
  adding trading lets it re-complete, but late.
- **Casual recoup is real but small and stable: ~4.4–4.7% of casual spend** (≈ $0.38/casual over
  270d on the revised ladder; was ~3% at the $0.60 pack — it tracks the floor, which is derived
  from pack price). NOT a windfall — it's "pulling junk letters isn't a total loss." NB: measure
  recoup from the isolated `recoup` field, never total `earned` — earned is dominated by lumpy
  yield/jackpot and swings ±100% seed-to-seed, which nearly tricked this analysis.
- **Casuals get modestly more claims (+4–11%)** with trading (buying toward near-complete words).
- **Dissolution** mechanically churns ownership (gross claims +~85%, mostly re-grabs of recycled
  commons by *active* redeploy players) and bumps casual claims ~+16% (they pick up the freed
  names). It slightly *raises* jackpot rollover (≈59% vs 57% baseline) — dissolving a live word
  opens a brief unclaimed window before re-claim. Its *headline* value — de-risking claims so
  people claim more boldly, and gifting/re-claim drama — is **behavioral and invisible to a
  greedy-claim agent model**. Treat the dissolution columns as "mechanical churn only," not a
  verdict on the feature.

**Implication for the build:** a swap-escrow is cheap (one small contract) and the social/UX case
(exact-match discovery, mutuals gifting, a psychological floor under surplus) is genuinely good —
so build it *light*. Do NOT scope or justify it as a major economic/retention lever; the sim says
it isn't one. The day-70 completion cliff still needs a *renewable late-game loop*, which neither
trading nor dissolution addresses.

**Known model limits (don't over-read):** demand detection is a bounded "nearest unclaimed word"
scan (lowercase path, ≤64 words, ≤3 letters/day bid) — deliberately conservative, so it sets a
*lower* bound on blocked-claimer demand; the floor is flat (no rarity pricing — a rarity-tiered
floor would let scarce letters clear higher and is the obvious next refinement); dissolution can't
capture the de-risking benefit. **Most important — churn is exogenous, so literal re-engagement of
churned players cannot be modeled.** "Casual recoup / +claims" measures earnings *while active*,
NOT retention of lapsed players. So the original question — *"does a letter market move
retention?"* — is **not answered here**; the sim only shows active casuals claim slightly more. A
5–10% re-engagement rate among churned casuals would reshape the case and is invisible to this
model. Making churn endogenous (success → lower churn) is the way to actually test retention.

## Jackpot architecture — decoupled from LHAW (June 11, 2026)

**Decision: Lexigotchi runs its OWN daily jackpot; LHAW becomes a bonus tie-in, not a core
dependency.** Corrects a spec misalignment — Let's Have A Word! runs on *rounds* (not daily) with
no winning word every day, so gating the core jackpot on "the daily LHAW answer" (v0.1 / v0.2 §2)
was both factually wrong and a needless external dependency. Two jackpots now:

- **Core daily jackpot (self-contained).** Lexigotchi picks one dictionary word per day from its
  OWN pre-committed sequence (its own `AnswerChain` — Lexigotchi's commit cadence, NOT LHAW-sourced).
  Resolution is unchanged: a single `keccak256(word)` lookup — claimed + staked + not-hungry → pay
  the pot, else roll over; case-agnostic. Funded by the **Jackpot** fee bucket as today. **This
  removes the v0.1/v0.2 "LHAW answer hash-chain" Phase-3 HARD dependency from core gameplay** — the
  game launches on its own clock.
- **LHAW bonus jackpot (soft tie-in).** When an LHAW *round* resolves its secret word, a Lexigotchi
  player who **owns** that word wins a bonus.
  - **Separate pool** (decision): its own accrual, so LHAW's irregular cadence can't destabilize the
    daily jackpot and each pool stays solvent-by-construction. Funded by a thin slice carved from
    the jackpot fee share (placeholder %, set when the bonus is modeled).
  - **Ownership-only** (decision): NO staked/not-hungry gate — pure ownership of the LHAW winning
    word wins (a serendipitous surprise-delight that also rewards collectors who don't stake).
  - **Read-only soft integration**: an oracle/indexer reads LHAW's resolved winning word. If it's
    down, the core daily jackpot is unaffected. LHAW is upside, never a blocker.

**Sim status:** the sim ALREADY models the core daily jackpot correctly — `answerOrder =
rng.shuffle([...WORDS])` *is* "Lexigotchi picks a word/day from its own sequence" (the old "LHAW
answer" label was a misnomer, now reframed in code/UI). The **bonus pool is NOT modeled** —
upside-only and irregular; documented as a Phase-1 addition (model it when sizing the carve %).

**Fairness/compliance unchanged:** the daily word is still a chance payout, so it stays unsteerable
via Lexigotchi's own pre-committed hash-chain, and the lottery-compliance rework (no-purchase free
entry, geo/age-gating, official rules, `seed.jackpot = 0`) applies to BOTH jackpots. Ownership-only
on the bonus doesn't change its chance nature (which word LHAW picks is the chance element).

## Renewable late-game loop — sim experiment (June 11, 2026)

The day-70 completion cliff (pricing review: active 596→138) is the biggest unresolved risk. Built
the owner-named fix as two independent **default-off levers** (mirroring trading/dissolution): run
`npm run loop-exp`; tests in `tests/loop.test.ts` (now **43 total**).

- **`prestige`** — a full-UPPERCASE staked Word ascends L1..L4 (EGGS parity). Each attempt pays the
  roll fee + burns a snack on a pity ramp; **success** bumps the level (monotonic), **failure is a
  no-op** (asset untouched — same compliance stance as rolls). Reuses the roll budget (no new assumed
  spend). Each level multiplies that word's yield + bounty weight. Solvency-neutral by construction
  (a bigger slice of the **same** `pool × rate` pot).
- **`bounty`** — a weekly featured **category** (`THEMES` in `simulate.ts`: rare-letter / repeated /
  -ING / vowel-start / -Y / Epic-or-Legendary, 0.7%–32.8% of the dict). At period end, every owner of
  a staked + not-hungry matching word shares a pool **carved zero-sum from `pool` inflow** (15%) —
  NOT from jackpot (which empties daily late-game). A claimer steers toward matching words with prob
  `chaseProbability` (the load-bearing behavioral assumption). The pro-rata split is **rarity-aware**:
  each match is weighted `TIER_WEIGHT[tier] ** rarityWeight × prestigeMult` — the **breadth ↔ rarity
  dial** (`rarityWeight` 0 = flat / max casual reach, 1 = tier-proportional like yield, default 1.0).

**Two decisions taken:** (1) **provable economics only** — the endogenous-churn / κ\* retention
instrument was deliberately **not** built (churn=f(success) would be an *assumed input*, not a
measurement — the tautology trap). Churn stays exogenous; **retention is explicitly unanswered here**
(a live cohort is the honest artifact). (2) **theme/category bounty**, not a single featured word (one
word = one owner = just a second jackpot; a theme reaches the whole base).

**What the sim CAN prove, and did (seed 1930 + 5-seed sweep):**
- **Solvency + conservation hold**, including a stress row (both on, `chaseProbability=1.0`): every
  seed solvent, `bountyPool` ~$2 residual, daily `assertSolvent` + `assertBountyConserved` held.
- **Prestige is a *modest, finite* durable sink**: fee throughput past mint-out **+3% (prestige),
  +5% (both)**; +1%–+7% across seeds. It **deepens** the post-completion economy for the ~25%
  UPPERCASE cohort — it does not transform it (4 levels × maxed words is finite, by design).
- **Bounty is *not* a fee sink** (−2% on its own): it's a zero-sum redistribution + a goal. Its real
  demand channel — acquiring matching words — is **mostly invisible post-completion** (no word
  secondary market is modeled), so the bounty's economic effect here is a **lower bound**.
- **Prestige mildly concentrates yield onto whales**: whale yield-share **48.1%** (flat-weight
  control, `mult=1.0`) → **~52%** (`mult=1.10`), i.e. ~+4pp from the boost itself (the rest is
  stream-divergence noise the control isolates). The gentle 1.10 default keeps it marginal; casuals
  get ~0% of yield either way (no UPPERCASE words).
- **Bounty reaches casuals** — the one bright result: **~18% of payouts go to casuals at the rw=1
  default (~21% flat)** (vs ~0% of yield), **~220 words eligible per period** (a broad share, not a
  single-winner jackpot). **Collectors dominate (~64–72%)** — they're the high-claim crown hunters
  holding the most matching words — so rarity weighting mostly redistributes *within* them, not away
  from casuals; the visible rarity lever is **whale share 4.4% (flat) → 8.8% (rarityWeight 2)**.
  `chaseProbability` 0.25→1.0 lifts casual bounty share 19.8%→25.4%. Net: rarity weighting costs only
  ~3pp of casual reach to add a real rare-word incentive (the secondary-acquisition driver).
- **Completion timing is noise-dominated** (d66–never across seeds, both directions) — same as the
  trading finding; do not read a velocity signal into it.

**What it does NOT prove:** retention (churn exogenous), and post-completion word-acquisition demand
(no word market). Neither lever dramatically moves the sim's economic metrics — *because the things
they exist to move (retention, re-acquisition demand) are exactly what this sim can't see.*

**Build verdict (evidence-gated):**
- **Prestige — build it, scoped honestly:** a modest finite sink + a depth/engagement goal for the
  whale/staker cohort. Keep the **gentle 1.10** multiplier (cap whale concentration). NOT a broad
  cliff fix — it doesn't reach casuals.
- **Bounty — build it as the casual-reachable renewable goal,** but justify it on **reach + the
  behavioral/social case** (a weekly reason to log in, feed, and acquire), not on the sim's economic
  deltas — which understate it (no post-completion word market), exactly like dissolution's
  de-risking was invisible to a greedy-claim model. The theme breadth and the **`rarityWeight` dial**
  (now implemented) are tuning knobs; `chaseProbability` is the assumption to pin with real data.
- **Recommended defaults:** prestige `{levels 4, fee = roll $0.25, 1.10×/level}`; bounty `{periodDays
  7, carve 15% from pool, requiresNotHungry, chaseProbability 0.5, rarityWeight 1.0}`. All default
  **off**. (`rarityWeight` 0.5 is the breadth-favouring alternative if casual reach matters more.)

## Open questions still owed

- **Cap multiple (2.5×) / mint cadence** — mint-out is ~2 months at any real scale and is
  population-driven, not price-driven; pace it with cadence (waves), not price. (A bigger cap
  does not delay *dictionary completion* — that's claim-race-gated.)
- **Secondary letter market** — ✅ now modeled (see the experiment section above). Verdict: weak
  economic lever (~4.5% casual recoup, no reliable velocity gain), strong social case → build the
  swap primitive light. Refinement owed: a rarity-tiered floor (scarce letters should clear higher).
- **Renewable late-game loop** — ✅ now modeled (prestige + theme bounty; see "Renewable late-game
  loop" above). Verdict: prestige = a modest finite durable sink + mild whale yield-concentration;
  theme bounty = the casual-reachable goal whose economic demand the sim *understates* (no
  post-completion word market). Build both light, on reach + behavioral grounds. Rarity-aware bounty
  weight ✅ now added (`rarityWeight` dial, default tier-proportional). Still owed: real
  `chaseProbability` calibration, and — the honest gap — **retention itself is unmeasured** (churn is
  exogenous; a live cohort, not this sim, is the artifact for it).
- **Demand damping in the market layer** — currently demand is held at the game-sim level; a
  fuller model would damp it by cost-to-play. (Minor while cost-to-play stays ~1.1×.)
- **Daily-word `AnswerChain`** — Lexigotchi's OWN pre-committed daily-word hash-chain (no longer
  the LHAW dependency; see "Jackpot architecture"). Still owed: commit cadence + reveal mechanics.
- **LHAW bonus integration** — the read-only oracle that reads LHAW's resolved winning word, plus
  the separate bonus-pool carve %. Phase-1, upside-only (not blocking).
