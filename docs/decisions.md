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
22. **The Shop: cosmetics in USDC on Base, split in the same transaction** (starl3xx, 2026-11-25;
    the Lexigotchi Customization Spec, "Money and plumbing"). In the owner's words:
    - "what if we make the add-ons in USDC on base?"
    - "20% should buy $WORD and add it to the reward pool"
    - "ideally, when someone buys something in USDC, the same transaction does the split all in one
      (splitting, buying WORD, adding it where it needs to go, and sending the remaining USDC to a
      treasury/revenue wallet)"
    - "i want to make sure the above prompt doesn't introduce the actual cosmetic / limited items, but
      just lays the infrastructure for when they're added"
    - "we'll also need a way for beta testers to acquire testnet USDC on Base, in order to test this (in
      the swap panel, and/or elsewhere)"

    Why: the shop is the studio's revenue line, so income never depends on selling treasury $WORD,
    and every sale is also buy pressure on $WORD and yield for staked, fed words (#19). Playing stays
    in $WORD. The spec's two rules hold: history travels with the word and taste stays with the
    player, and status can't be bought (cosmetics get the scene and what letters wear, never the tile's
    material, border, or rings).
    - **Mechanics** (`contracts/src/Shop.sol`): an owner-managed registry of prices in USDC, sale
      windows, and supply, EMPTY at deploy; what an item is lives off chain. A purchase sends
      `revenueBps` (80%; the owner may change it, never above 90%) straight from the buyer to the
      revenue wallet, swaps the rest to $WORD, and routes it through FeeSource.ROYALTY like the
      word-sale fee (#18): the Rewards Pool, less the bounty carve. One transaction, no weekly buy (the
      spec's open question on timing is answered by the owner's "same transaction").
    - **The swap never blocks a sale.** It runs in its own call frame inside try/catch: on any failure
      the USDC waits in the Shop, `SwapDeferred` says why, and the sale completes; anyone may `sweep`
      later, and the keeper does it daily beside `SaleFees.flush()`.
    - **The floor reads the price keeper's peg** where it already lives (Letters' `packPrice` for a $1
      pack, #7), so the Shop adds no price-keeper job (the spec: "no price keeper is needed"); every swap
      must buy at least that worth less `maxSlippageBps` (10% by default: the real route's fees measured
      0.7% on a Base fork, and the peg moves only on a 5% drift). No peg = the swap waits, never runs
      unprotected. A Uniswap v4 pool has no built-in TWAP, so the peg is the only onchain price.
    - **No shop money reaches the jackpot** (the spec): a swap refuses to route while the ROYALTY split
      gives the jackpot a share. Nothing here changes Words.sol or the FeeRouter; the FeeRouter's owner
      registers the Shop with `setCollector`.
    - **No owner function withdraws USDC or $WORD** (pinned by `tests/shop-abi.test.ts`). The one
      indirect path, a hostile adapter with a floor near zero, is behind a 2-day public delay: the
      adapter and the floor's peg change together, only through `proposeRoute` then `acceptRoute`.
    - **Sweeps come in chunks**: at most `maxSweepUsdc` ($100 by default) a call, once a block, so a
      sandwich of a permissionless sweep costs more in pool fees than it can take (the internal audit,
      `contracts/AUDIT.md`), and a large backlog still drains.
    - **The route** (`contracts/src/adapters/UniV4UsdcWordAdapter.sol`): USDC → WETH on Uniswap v3's
      0.05% pool, then WETH → $WORD on $WORD's v4 pool (Clanker's, with its dynamic-fee hook), in one
      Universal Router call. The pool key was read onchain and hashes to the pool id. It sits behind
      `IUsdcSwapAdapter`, so a new route is a new adapter, not a new Shop.
    - **Ownership of items is a database record keyed by profile**, filled from `Purchased`, so every
      linked wallet shares it; not tradeable at first. Scene picks move from the holding wallet to
      (profile, word) and clear when the word leaves the profile; the Market says "Scenes and costumes
      stay with the seller".
    - **Testnet only:** test USDC (`MockUSDC`: Circle's permit name "USD Coin" and version "2", 6
      decimals) with a faucet of 25 per profile per UTC day, vouched by the app's signer, because the
      test $WORD faucet has no limit to copy and only the server knows a wallet's profile. One
      placeholder "Test item" on Base Sepolia exercises the flow; never on mainnet.
    - **Still owed before the shop opens on mainnet:** the owner's go-ahead for the mainnet deploy; the
      price keeper key in production, or the floor's peg goes stale; the CDP paymaster allowlist, for
      sponsored buys; and a sales-tax check with an accountant (the spec: Iowa taxes some digital
      products).
23. **Rarity shows on the tiles, and the top two tiers are renamed** (starl3xx, 2026-11-25: "the
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

24. **Lexigotchi is a word-pet game: the messaging guide** (starl3xx, 2026-11-25). In the owner's words:
    "the thing that's unique about this game is its unique combination of tamagotchi + pokemon + letters/words, and the fact that it's onchain and you can own and sell and swap and customize stuff. we can't lose the basic premise (get letters, form words, feed them, earn, eg) but we can be strategic how we talk about the broader game/universe and different hooks we use when promoting and talking about it"
    - **The guide** is `docs/messaging.md`, the source of truth for every player-facing word: the
      positioning line ("a word-pet game: collect living letters, raise them, and spell words nobody
      else can own"), the premise every hook lands on, the hooks, the voice, the Say / Instead of
      table, and the never-write list.
    - **Ruling: the Tamagotchi/Pokémon comparison stays internal.** Player-facing copy never names
      either one (both are guarded trademarks), nor near-quotes them ("gotta spell 'em all",
      "Pokédex"). The comparison explains the game to the team; players hear "word pets".
    - **Lead with a pet, a word, or a rare letter, never with earning.** Being onchain is the proof
      that "yours" means yours, not the pitch. The jackpot always carries "staked and fed".
    - **Guarded in code:** `tests/copy-rules.test.ts` fails on the never-write list and the "Instead
      of" terms in player-facing code and the player docs (contracts.mdx and fairness.mdx keep their
      technical terms), with a short allowlist whose entries each carry a reason.
25. **Every word is a card, and the Showcase folds into the Bag** (starl3xx, 2026-11-25, on the
    "Scene Cards" mock: "every formed word is presented in a scene... back of the card with
    info... rethink the whole showcase feature as maybe something that's built into the bag?").
    Step 2 of the four in #23.
    - **The card:** a word's scene is its front; the button in the top right turns it over. The
      back is "deep" (a rich material per tier, cream type), with a faint card-stock texture, the
      tiles still on a rack in perspective, and the words on steady plates. Labels semibold and as
      written, the same size as their values; values regular.
    - **The back:** rarity (one of N) and its card number; case; ascension; **Yours since** (the
      day it reached the player's profile; a move between their own wallets keeps it); staked and
      mood; earned, earns a day, cost to make; points; **Found by** (the first player ever to claim
      it, kept through a dissolve and re-spell); the jackpot (drawn or never, no date: the draw
      counter isn't a calendar); the token. The two history facts read the word's own Claimed and
      Transfer logs (`/api/words/story`, keyed by the word alone, cached a minute; staking's moves
      left out), only while a back shows. Unknown is a dash, never "you" or "never".
      **The card number** (starl3xx, 2026-11-25: "#0001… numbered based on their creation… not
      alphabet or rarity or anything"; it was the dictionary's A-to-Z place): `#` and four digits,
      the word's place in the order words were FIRST claimed (`madeOrder`: every `Claimed` event,
      by block then log index), so #0001 is the first word anyone spelled. A word dissolved and
      spelled again keeps its number, as it keeps its first finder, so a number never changes or
      repeats. Served as `/api/world`'s `numbers` from the keeper's scan (no extra read); the share
      loop's back picture reads the same events, and leaves the number off when it can't know it.
      The practice game numbers the player's words by when each came to them. No table: no
      migration.
    - **Where cards are:** the Today stage (the card in focus: it moves), the Bag (opens on Words; a
      grid of still cards with each card's rarity in its corner and its name and state under it, my
      addition to the mock so hunger and sale stay visible), and an opened word's sheet (its card
      on top, with Scene and Share under it). Up next on Today, the claim celebration, and a
      flippable Market card stay as they were: left for later.
    - **The Showcase screen is gone:** Share and Scene sit under an opened card; onchain badges
      moved to the profile; a scene picked from an opened word returns to it.
    - **The GPU rules, measured** (phone size, CPU 4× slowed, practice mode): only the card in
      focus moves; a still character holds entirely still (it used to keep its idle bounce);
      the Bag draws each card's scene only as it nears the screen (32 cards drew 32,000 elements
      and took 2.4 s to open; now 11,000 and 1.3 s, idle at rest); the back's material is CSS
      drawn once, and nothing on a card loops; each tile defines only the gradients it draws.
      Finishes reach Spell, the Market, and the Jackpot as still tiles, and the Dictionary as flat
      tiles with the material baked per tier (the full rig made each keystroke 2–4× slower).
    - Next: live backs drawn with OGL (step 3), then the share loop (step 4).
26. **A card's back catches the light, live** (step 3 of #23; starl3xx, 2026-11-25: "yep, continue").
    - **OGL** (WebGL, public domain; `ogl` 1.0.11, the one package this work adds; loaded the first
      time a back goes live, so it stays out of the game's first download) draws the back's
      material on the card in focus (the Today stage, an opened word) while its back is up: the
      mock's shader, deep treatment (`cards/live/liveSurface.ts`). The words and tiles stay HTML on
      their plates; the CSS material stays under the canvas, and is all there is under reduced
      motion, on a low-end phone, in the Bag's small cards, and wherever WebGL won't start.
    - **The light** sweeps across once as the back comes up (1 s), then follows the pointer, a
      finger dragging sideways across the back, or the phone's tilt. iOS asks for the tilt only
      from a tap, so the tap that turns a card over asks (once a page load, and only when that back
      will draw live: not under reduced motion, Save-Data, a low-end phone, or no WebGL); a no
      leaves the finger.
    - **The GPU rules, kept:** one context at a time, made when a back comes up and lost
      (`WEBGL_lose_context`) when it turns back or leaves; frames only on change (one per frame
      however many moves arrive; nothing at rest; a test counts them). A held phone sends tilt
      readings all the time, so a tilt draws only once the light has moved about a degree, at most
      ~30 frames a second, and nothing while the card is off screen (`makeTiltFilter`, tested: a
      hand's tremor draws nothing). At most 1.25× the CSS size;
      no antialiasing. Measured (headless Chrome, software WebGL, so the GPU figures run high): a
      resting live back costs the renderer 5–8% of a core and the pointer moving 11–17%, against
      17–20% for the scene on the front at rest. Each mount makes its own canvas: a canvas keeps one
      context for life, and a lost one never draws again (React mounts twice in development). The
      Today stage's back stops being live while a sheet covers it, so only the card in focus holds
      the context; a back that loses it to a newer one anyway steps aside for its CSS material.
    - **Phones see the whole back:** below 560 px a back shows four stats (#25), so an opened card
      lists the rest under it while its back is up (`CardMore`; my reading of starl3xx's "yep,
      continue" after I offered it).
    - Not done: baking the shader's material into a picture for the cards that aren't live (CSS
      stands in), and the share loop (step 4).
27. **The share loop: a video of the card turning over** (step 4 of #23; starl3xx, 2026-11-25:
    "a video or GIF that shows front, rotates, shows back, on a like 5-8s loop would be magical";
    "move on to step 4"). A link's card on X shows only a still, so the turn goes out as a video
    the player attaches to the post.
    - **Made in the player's browser**, when they ask (Share → "Make a video of the card"): six
      seconds, 30 fps, 1280×720, H.264 MP4. OGL draws each frame (`cards/loop/loopRenderer.ts`, the
      mock's turn: the scene, a lift and a glare as it passes edge-on, the back catching the
      light, home); the back's material is the live back's own shader (`cards/live/materialGlsl.ts`,
      one source for both), under the back's words and tiles (`/s/<word>/back`, Satori, 1200×630,
      transparent). The browser's own encoder (WebCodecs) encodes; mp4-muxer packs. Proven first
      in Chromium, Chrome, and WebKit: a playable 6 s MP4, about 2.9 MB.
    - **Why not MediaRecorder** (no package): it records in real time and drops frames on a slow
      device. Drawing each frame and waiting for the encoder makes the same six seconds everywhere.
    - **mp4-muxer, not Mediabunny:** 9.4 kB gzipped against 35.9 kB for the same MP4 pieces, and
      MIT against MPL-2.0; but mp4-muxer is deprecated in Mediabunny's favour (no more fixes).
      Swapping later touches one file (`cards/loop/makeLoop.ts`).
    - **The back, for strangers:** the video travels beyond the player, so its back speaks of the
      word, never "you": rarity and number, case (from the link, like the card), points, and from
      the chain when the game is live, ascension and the first finder. Nothing from the query
      string; cached minutes, not the card's week.
    - **The GPU rules:** made only on the tap; the live back lets the one context go first
      (`releaseLive`), and the loop's context is lost when it's done, fails, or is called off;
      every frame waits for the encoder and yields; OGL and the muxer load on the tap (`/play` grew
      2 kB). The preview plays twice and rests (a test fails on a looping `<video>`).
    - **Two taps** (make, then share or save): iOS opens the share sheet only from the tap itself.
      Offered only where the file can leave: a share sheet that takes files, or a download outside
      a mini-app host. Farcaster keeps the link (a GIF in a cast is untested). The corner wordmark is
      on every frame (#23: "corner mark on saved images/videos"), in ink: the video's corners are
      the game's paper, not a scene. Not on a low-end phone. The share sheet's target is unknown, so
      its words carry no @-handle (on Farcaster that names someone else), and they carry the
      link, since the file has none.
    - **Departures:** the back picture's labels are bold, not the semibold the game uses (Satori
      has only Söhne's regular and bold). Untested: an iPhone making and sharing the video, the
      mini-app hosts, X taking the file, and a real GPU's make time (software WebGL: 5–12 s).
28. **The letter characters, reviewed** (starl3xx, 2026-11-25, on the "Letter Character Review":
    "this is fantastic, yes"; picks: "bean", "no brows at rest", "lean looks good", "hover as perk
    up", "breath as 12 poses doesn't render as well as smooth"). #27 is the share loop (PR #214).
    - **Shapes.** Shoes are a bean with a round toe (the old toe was 3 px tall on the stage: a
      point). Hands are mitts: a palm, a thumb, a cuff. Arms are drawn over the ring and under the
      face, so UPPERCASE and gilded letters have arms (they hid behind the ring). Eyes are tall
      ovals, wide open at rest, with one highlight (the pie cut). No brows at rest: a brow means a
      feeling. A shut eye keeps its outline (the eyes are the character's head). A smile pushes
      the lower lid up (eating, a win).
    - **Words hold hands.** Each pair's hands meet low between the tiles, the arms a V, drawn once
      as one clasp; the end letters' outer arms hang at rest. Each letter leans up to 2°, uneven,
      the same every time for the same word (`leanFor`), in the app, on a still card, and on the
      share card. A mood still reads: it leans the whole word one way and changes the eyes.
    - **The roll.** No "?" (the sign for an error). The letter can't look: eyes shut tight, one
      peeking every few seconds, hands on its top corners, knees knocking, for as long as the
      chain takes. The pale bar that swept the roll sheet is gone: it parked over the letter's
      left third after 1.1 s, for the rest of the roll.
    - **Hover on the Today stage.** No glow and no hop. The letters rise onto their toes one after
      another and their eyes follow the pointer; feet, shadow, and held hands stay put. The glow
      was a filter over five moving drawings: a Legendary word went from about 70% of a processor
      core to 126% in WebKit while the pointer rested on it.
    - **The breath is smooth, on layers.** The owner chose the smooth breath over one drawn in 12
      poses. A smooth loop INSIDE an `<svg>` makes WebKit (every iPhone browser and mini-app host)
      redraw the whole letter on every frame: one Common word at rest measured 47% of a core as
      the old bounce, and 53% as the smooth breath. So the character is four stacked `<svg>`
      layers (floor, legs, body, top), and the loops are CSS transforms on the legs and body
      layers, which a browser slides without redrawing: 6.5%. The 12-pose breath inside one
      `<svg>` measured 15%, so the layers beat the poses too. Keyframe distances are in the
      drawing's units through `--ux` / `--uy`, so the motion is the same at every size.
    - **Life in moments.** One timer for a word (`useWordLife`, never one a tile): a blink (the
      open eye swapped for its shut drawing for 120 ms), a glance at a neighbour, a twinkle of a
      rare letter's star or a gilded tile's. Those twinkles were loops inside the drawing; a loop
      there would undo the layers. A small tile with no legs stands still at rest (the loose
      letters on Today ran the bounce). A hungry word sleeps: a slow rise and fall.
    - **One source for the shapes.** `components/game/tileShapes.ts` holds the numbers; the rig and
      the share card's Satori letter (`app/_og/tile.tsx`) both draw from it. The card's copy had
      drifted (arms at rest inside a word, simpler eyes).
    - **How it was measured** (my method, not a standard one): headless WebKit, the processor time
      of all its processes over 12 to 16 s, one five-letter word on a 650 px stage at 2× pixels,
      on the owner's Mac; headless Chromium's GPU process for comparison. The scene's art stood
      still on both sides, so these are the letters alone: on the live Today stage the scene's own
      loops add to both. Ratios, not absolutes: a real iPhone hasn't been measured. The main-thread figure under a 4× slowdown, used for #23,
      says nothing here: Chromium already moves these loops off the main thread.
    - Not done, and worth their own look: the rarity light moments are now the largest cost at
      rest (a Legendary word measured 33% with them, 7.5% without); the Holographic foil's drifting
      gradient is still a loop inside the drawing; a free arm that trails the breath (in the
      review) was dropped, because it would be a moving shape inside the body's layer.
29. **Rarity marks: a bead, then one more corner per tier** (starl3xx, 2026-11-25: "i don't like
    the cube next to the rarity... like cube mythic, cube common. I feel like each rarity should
    have its own icon (common shouldn't be 'bad' just common/plain)"; then, of the proposal's
    three sets: "I like Cuts - let's go with that"). The rarity plate wore one cube in five
    colours. Each tier now has its own mark (`lib/tierMark.ts`, `components/game/TierMark.tsx`):
    Common is a round wooden bead, and each tier after it is a cut stone with one more corner:
    three for Uncommon, four for Rare, five for Legendary, six for Mythic.
    - **Why a shape per tier** (the research, in the proposal): games mark rarity five ways:
      one shape recoloured (Hearthstone's gem, Magic's set symbol: what the cube was), a shape
      per tier (Pokémon cards, Lorcana, Riftbound), counting, a letter, or a whole-card treatment
      (Marvel Snap). The game already has the treatment (the finishes, #23, and the card backs,
      #25); the mark is the small backup that reads in one ink, at 12 px, and without colour.
    - **The rule a player reads it by:** count the corners. Riftbound and Lorcana order theirs
      the same way. Common is the plainest shape, drawn as well as the rest: plain, not poor.
    - **Shapes it stays clear of**, because the game already uses them: the star and the tilted
      diamonds (ascension), the crown (a raised letter, and Gilded 4 and up), the sparkle (Mint).
      Rare's square stands upright; the ascension pips are tilted. A textbook circle, diamond,
      star, crown ladder would have collided on the card back itself.
    - **Drawn for the game, not from Phosphor:** Phosphor's shapes are these without the
      drawing (one flat colour, no ink line), and it has no gem but the Sketch app's logo. Each
      mark is three flat paths in a 20×20 box, as the cube was: a base in the tier's colour
      inside the ink line, a light, a shade. No gradients, filters, or motion, so it costs no
      frame and Satori draws the same paths on the share loop's back picture.
    - **Where it shows:** the card back's plate, the Bag card's badge, the back picture, and,
      new, every rarity pill (`TierBadge`: the Dictionary, the Market, Spell, a word's sheet),
      the tier filters in the Dictionary and Spell, and the landing page's top-tier fact. The
      player docs picture all five (`docs-site/images/marks.svg`, from `npm run docs:art`).
    - **Weighed and passed over:** "Materials" (a wooden tile, a jade ring, a cut sapphire, a
      sun, amethyst crystals: more character, but an order that can't be counted) and Phosphor
      alone. Known weak spot of Cuts: five and six corners are close at 12 px, where colour
      still tells them apart.
    - **My readings, not starl3xx's words:** the pills and filters get the mark ("everywhere
      else it needs to be"); Common's colour warms from the cube's grey-beige `#cbbb9c` to wood
      `#c79c63`, as the proposal drew it.
30. **The Market sells letters too, shows what sold, and helps with the price** (starl3xx,
    2026-11-25, in the owner's words: "Market should have recent sales, and generally be beefed up
    as a marketplace"; "a user should be able to browse/sort for listed letters and words"; "Letters
    shouldn't be “swap” anymore, they should be listable like words (and consider that a user might
    want to list multiple Ws at a time, for example)"; "Think through if/when there are a bunch of
    words and letters listed: how is this presented and made navigable for the user?"; "I should be
    able to list words and letters both from the Market, as well as browse and buy"; "Market
    listing should be intelligent; that is, helping the user with suggested prices, comparison,
    etc, and directing the user to the best deal *for them*"; "not everything has to be in its own
    box; you can think through how to present this tab uniquely, within the existing design
    constraints of the game"). Extends #18 from words to letters, and retires the one-for-one
    letter swap ("swap primitive, light", June 2026).
    - **Letters sell for $WORD, several at a time.** One Seaport order offers `qty` of one letter id
      at a price each, and a buyer takes any number of them (OrderType PARTIAL_OPEN, filled with
      `fulfillAdvancedOrder` as k of qty). No new contract: `SaleFees` routes any $WORD it holds.
      **Every amount is a per-letter amount times the quantity**, because Seaport fills a part only
      when every share is a whole amount: the fee is split per letter (rounded up), then
      multiplied. Splitting it on the total, as a word's is, makes orders no part of which can fill
      (proven on a fork; the route refuses them as `uneven_price`). Prices are whole $WORD, so the
      price shown is the price paid.
    - **The fee is 10%, to the Rewards Pool, the same as a word** (`params.market.letterSaleFee`,
      its own number). **This is an inference, and the owner's to confirm:** he said "listable like
      words" and named no fee. It reverses two earlier entries: the feeless letter trade (the swap
      "carries no fees"), and the June 2.5% in-house rate that #18 had already replaced for words.
      Reason for the default: one rule for the whole Market, and the fee pays staked, fed words
      (#19). The same risk #18 named applies (a market the game runs and takes a cut of); "no
      counsel" was the owner's ruling there, and nobody asked again here.
    - **A stale letter order is a money risk a stale word order never was.** A word's approval is
      for that word and clears when it moves; ERC-1155 has only approve-for-all, which never
      clears. An order the seller can't honor now would fill again, at its old price, the next
      time they held that letter. So: one live order per seller per letter; listing again cancels
      the earlier ones onchain in the same send as the approval; a listing must be backed by the
      letters when it is made; and the seller always sees their own orders under Sell, paused ones
      included, with a way to take each off sale. The one old swap offer that existed gets the same.
    - **The swap is retired, not deleted.** Nothing new lists (`/api/swap/orders` answers 410), and
      the board no longer hands those offers to anyone. A signed offer stays fillable onchain until
      cancelled or expired, so its maker still sees it, with Cancel.
    - **Recent sales are read from the chain**, never reported by a client: every sale pays
      `SaleFees`, so the $WORD transfers into it list every sale's transaction, and Seaport's
      `OrderFulfilled` in that transaction says what sold (for a part, the amounts of that part).
      `market_sales` is a copy of that history, idempotent on (chain, transaction, log index); the
      sales route and the keeper's `fees` job both read forward from a cursor.
    - **Many listings** (the owner's question). Letters: 52 kinds hold any number of listings, so
      the board is the alphabet with one tag per letter (the lowest price, how many), and its
      counter lists a letter's sellers cheapest first, a page at a time. The server reads only the
      cheapest rows of each letter (numeric prices, one index), checks only those against the
      chain, and keeps the answer a few seconds, so the work is bounded by 52, not by the number of
      listings. Words: one of a kind, so the list can never pass the dictionary's 4,584; it is
      served whole and small (no orders or signatures: an order is fetched by its hash when the
      player acts), then searched, narrowed, and sorted in the browser. Not done: paging the words
      list on the server, which the live state behind "best deal" would need a stored copy for.
    - **Helping with the price.** Three references stand beside a price, none of them "what it's
      worth": about what the thing costs to make (`lib/wordCost.ts`; a letter is its share of a
      pack, an UPPERCASE one adds the average rolls), the lowest price the same thing is for sale
      at, and what it sold for lately. A sell form offers prices with their reasons; a listing
      shows its price against the cost to make.
    - **The best deal for them** (`lib/market/deals.ts` `pickDeals`): up to three listings, never
      the player's own. First, a letter that finishes a word their bag is exactly one letter short
      of, among the words nobody owns (rarest word first); then whatever is furthest under its cost
      to make, a word only if they can pay for it. A big bag is one short of something with almost
      every letter, so one place is always kept for a price under cost.
    - **The page** (`screens/MarketScreen.tsx`, `components/game/market/`): Words, Letters, Sell,
      and Sold behind one switch, with "Just sold" and the picks above. Drawn as a market: the
      letter shelf (tiles on a plank, a paper price tag hanging under each letter for sale), ruled
      headings, and dashed dividers in place of a stack of boxed cards. Selling is on the Market
      itself, for words and letters; an opened word keeps its Sell.
    - **The practice game has a Market** (a seeded stall, `market/practiceMarket.ts`), so the page
      can be tried, and pictured in the docs, with no wallet.
    - **Proven before it shipped:** the order against Seaport itself on a fork
      (`scripts/market-fork-check.ts`: buy 2 of 5, ask for more than is left, sold out, cancelled,
      uneven payments), and the routes against that fork and a throwaway database
      (`scripts/market-routes-check.ts`).
    - **A purchase celebrates** (starl3xx, 2026-11-25: "we need an animation or popup with a toast or
      something when a user purchases a word or letter ... (ie "Congrats, it's yours!" +
      scene/card)"). It used to end with a toast. A bought word opens the claim's own "is yours"
      sheet (`sheets/CelebrateSheet`, `bought`) standing in its scene, over what was paid and how
      that compares with making it, with Stake and "See its card". Bought letters hop in the way a
      pack's do (`sheets/BoughtLettersSheet`) over the word they newly finish, with its claim right
      there: most letters are bought to finish a word, and it is the word the pick named
      (`newlySpellable` keeps `oneLetterShort`'s order). Both stores open it only once the purchase
      shows (the chain store after the read-back), through the reducer's `arrive`: if another sheet
      is open by then, a toast says it and that sheet stays. A word the jackpot already drew is not
      promised the jackpot, on a claim either.
    - **Not done:** a reminder to the seller when something sells (the template exists, unwired);
      buying one letter from several sellers in one send; an X card for a listing; offers (a
      buyer naming a price). Migration 0017 adds `letter_listings` and `market_sales`; until it
      runs, letters can't be listed and recent sales are empty, and words sell as before.
    - **Open on the test build since 2026-11-25**: the owner ran 0017 in production, the letters
      board answered `open: true`, and the sales reader caught up from the chain by itself (the two
      word sales made before this existed showed at once, with their rarities). Still wanted: one
      pass with a real wallet (list a letter, buy part of a listing, cancel).

31. **The Dictionary shows what you hold, and a tap shows what you need** (starl3xx, 2026-11-25:
    "the dictionary entries / tiles look poorly designed and spaced... would be nice if i click a
    tile to see like 'you only need an X to make this word' and other cool stuff like that"; on
    the proposal: "this is fantastic. i prefer the card, tbh. yes to closest first and the quick
    filters. i like what you have in the word view"). An entry was five small tiles and a pill in
    the corner of a card half empty, faded when unclaimed, and a tap showed one line.
    - **The entry** (cards, two across on a phone): the word's tiles as it would be claimed, its
      name and rarity, then one line. A letter the player doesn't hold is an empty dashed slot, as
      on Spell's rack. The line says "You can spell it", "Needs a q", "Needs an h", "Needs one more
      o", "Needs 2 z's", or who has it.
    - **The fade moved.** The scene-cards mock (2026-11-25) faded unclaimed words. Now an
      unclaimed word is at full strength, and the word that steps back is one someone else holds
      and isn't selling: it is off the table. Dashes appear only on unclaimed words; a claimed
      word's tiles show the word, not the player's letters.
    - **"Needs a q" is a promise, so it has rules** (`lib/wordNeed.ts`, pure, tested against
      Spell's own `canSpell` for every word): only the connected wallet's letters count, because
      only that wallet can claim; a letter in a linked wallet is "away" (a dashed teal edge, "move
      it here"), never held and never missing; doubles are counted; nothing is counted until the
      owners are known ("Checking who owns it…"), nor for a player with no letters at all (a
      visitor sees who has a word, not "Needs 5 letters").
    - **The word view** (`sheets/LookupSheet`): the game's letter characters stand at the top,
      still, with a slot for each missing letter; the first line says what's needed; then the ways
      to get it (Mint a pack, Find it in the Market, Move it here) and the word's facts (rarity and
      rank among all words, points, owner, card number, whether it has been the daily word, cost
      to make, what it would earn, whether it fits the week's bounty, whether it's for sale). It
      names other unclaimed words the same letter would finish.
    - **It claims nothing.** A word the player can spell is handed to Spell (`spellHandoff`),
      which opens with the word on the rack. One place claims, so the owner check, the fee line,
      and the case rules live once.
    - **"Mint a pack" is offered only while the letter can still be minted:** the chain game
      reads each letter's supply when the sheet opens (checked on Sepolia: 26 caps, 115 q's); a
      sold-out letter, or sold-out packs, points at the Market.
    - **Closest first** (`lib/dictionaryList.ts`): what the player can spell, then one letter
      away, then two; the rarest first within a distance; a move counts as closer than a mint.
      The choice is remembered. Quick filters: Can spell (exactly Spell's list), One away, Two
      away, Unclaimed, Claimed. Spell already lists what the letters spell; the Dictionary's new
      ground is the near misses and other players' words.
    - **What it costs:** the list keeps flat tiles (no letter characters, no motion); one pass
      over the dictionary per change of letters (half a millisecond); the word view draws one
      word, still. On a 4×-slowed CPU, production build, practice mode: a keystroke answers in
      24 ms, a filter or sort tap in 88 ms, opening a word in 56 ms.
    - **Left for later:** pack odds for the missing letter; another player's word in its real
      case (the scan knows it, the world read passes on only a count); a wish list.
    - **Found on the way:** the chain game took the week's bounty theme from a read that runs
      only for a wallet with a daily key, so a visitor or an unverified wallet saw theme 0
      whatever the week. It now falls back to the clock's day (`chainDayNow`).
    - **My readings, not starl3xx's words:** "Closest first" is the default; an Unclaimed filter
      stays beside the new ones; a word of the player's in a linked wallet opens this view, saying
      to connect that wallet; the proposal's "Swap for a q in the Market" became "Find a q in the
      Market", with how many are for sale and from how much, because #30 retired letter swaps
      while this was being built.

32. **The Market and the Dictionary think alike, and link into each other** (starl3xx,
    2026-11-25: "take a look at the Market and see if anything we designed/decided would be good
    to integrate into the Market as well, design-wise"; on the five findings: "okay build all 5 as
    one PR"). The Market (#30) and the Dictionary (#31) were built the same day by two sessions,
    and each answered "what is this player one letter away from?" on its own.
    - **One word view.** A word on the Market (a listing, a pick, a sold word) opens the word view
      the Dictionary opens (`useOpenWord`; the player's own word opens its card). For a word for
      sale the view shows the listing as it is now (case, ascension, hunger), its price beside
      what it costs to make as it is, and **Buy**, which closes the view: the word is the
      player's from then on. No Buy without a connected wallet (the Dictionary is public), nor on
      the player's own listing. Listings show the card number (#25: the order of first claims).
    - **A listed word has an owner: its seller** (`lib/dictionaryList` `entryStatus`, pure,
      tested; read through `useDictionary` `statusOf`). The Market's board is read live and the
      world read is a minute old, so a word claimed and listed since then was "unclaimed" in the
      Dictionary with a price tag on it in the Market; the practice stall's words always were (its
      sellers are in no world read), and two of them, TIGER and OCEAN, read "You can spell it".
      The board is asked FIRST, before the world's owner: a word that changed hands and was
      listed again inside that minute read as its previous owner's, and one the player had just
      sold as "yours, in a linked wallet" (Bugbot on #224). The word view takes the seller and
      the seller's face together (`holderOf`), never one's address with the other's face.
      Today's next steps and the bought-letters sheet take the board's words as taken as well
      (`useTakenWords`), so "Now you can spell" never names a word that is for sale.
      **Spell asks the same question** (`isTaken(statusOf(w))`), so #31's rule still holds: the
      Dictionary's "Can spell" is exactly Spell's list (1,010 words for the practice bag on both,
      1,012 before), and neither offers a claim that would revert.
    - **One rule for "this letter finishes this word"** (`lib/wordNeed` `finishingLetter`: exactly
      one letter held nowhere, and nothing to move). The Market's picks (`oneLetterShort`), the
      Dictionary's new "Only needs a q" filter, and the word view's "would also finish" all read
      it. The Market had its own count, of the connected wallet alone: it offered to sell a
      player a letter they held in a linked wallet (the Dictionary says "move it here"), and
      called a word finished by a purchase when another letter still had to be moved. Both are
      tests now. Its lists are rarest first word by word (they were by tier, then A to Z), by one
      comparator (`lib/market/deals` `rarestFirst`) that the word view and the bought-letters
      sheet (#30, #223) use too, so all three name the same word first.
    - **One wording.** "One more x finishes UNBOX" said "one more" to a player holding no x. Now
      "An x finishes UNBOX", and "One more o finishes BLOOD" only when one is held
      (`finishTokens`), beside the Dictionary's "Needs an x" and "Needs one more o".
    - **The gap is drawn.** A pick, and a letter's sellers, show the word in the Dictionary's
      flat tiles with a dashed slot where the letter goes.
    - **Links both ways, as state** (`ViewSection`: `letter:q`, `needs:q`, `words`, `letters`;
      `sectionLetter`). The word view's "Find a q in the Market" opens the Letters shelf with q's
      sellers showing (it opened whichever part was last used). The Market's "and 45 more words"
      opens the Dictionary on those 46 words, under a chip "Only needs an x". The number and the
      cards come from the same function, and a test holds them equal for every letter. A link is
      state, not a value handed over once (as `spellHandoff` is), because the word view can be
      open on the Market itself. And the same link must land twice: a screen keys its effect on
      `navSeq` (a count of navigations, in the one reducer both stores use) as well as the
      section, because following "Find an x in the Market" again, after closing x's sellers, left
      the section unchanged and did nothing (found in review, before the first push).
    - **Marks and order.** The Market's rarity chips wear each rarity's mark (#29) and a
      stepped-back count, and "Just sold" marks its words. Rarity chips read rarest first on all
      three screens: the Dictionary's ran Common first and was the odd one, not the Market's,
      which matched Spell.
    - **The 12 px floor.** "Yours" and "Lowest" tags and the Market's small captions (Words,
      Letters, Sell, Sold) were 10 and 11 px. The shelf's price tags and its "!" stay: they are
      compact chips, 26 across a phone.
    - **Left alone, and why:** the Market's chip shape (taller, with a press) is also the Bag's,
      so it is one of two chip shapes in the game, not a one-off. Making the four screens one
      chip is its own change. The Market's look (the shelf, ruled lists) is its own.
    - **Seen and not seen:** all of it in practice mode at 1280 and 424 px. Card numbers on
      listings and the linked-wallet cases need a wallet on the chain; they are held by tests.
      A visitor's view of a word for sale (no Buy, only "See it in the Market") needs the chain
      game with no wallet: checked on the live test game after the deploy.
    - **My readings, not starl3xx's words:** "Only needs an x" as the chip's name; a sold word
      opens its view only in the chain game (or when it is the player's), since practice has no
      other owners; the Dictionary's rarity chips flipped rather than the Market's.

33. **The Mint tab shows every letter's actual odds** (starl3xx, 2026-11-25: "mint letter odds
    should show the whole alphabet in Mint tab, not styled as a card... like the actual odds % per
    letter"; then "order should be A-Z", and how many are left "only for the low ones"). It replaces
    a card that pictured the five most common letters and the five rarest, with no numbers.
    - **The numbers are the draw's own.** `lib/letterOdds.ts` `letterWeights` is the weight the
      signer's `drawLetters` uses (a letter's dictionary share, or 0 once none can be minted), and
      the list shows it normalized (`letterOdds`). One function, so the screen can't drift from a
      pack. The draw's arithmetic did not change: `tests/draw-pinned.test.ts` holds the letters it
      gave for fixed seeds, recorded before the weights moved, because a paid commit's letters are a
      function of its id and the supply.
    - **Actual, not nominal.** In the chain game the list reads each letter's supply
      (`useLetterSupply`, the lookup sheet's read, now shared): a sold-out letter says "Sold out"
      with no odds, and every other letter shows the higher odds it has without it. While that read
      loads, or after it fails, the list shows the odds with every letter in the draw and says so.
    - **"Left" only for a letter running low:** a tenth of its supply or less (`LOW_SHARE`), a share
      of the CHAIN's cap, because q's cap is in the hundreds and e's in the thousands, and a
      deployed Letters can hold older caps than `economy.ts`.
    - **A to Z, read down the columns** (two on a phone, three on desktop), with no sort switch: the
      bars show which letters are common. Not a card: a ruled heading and dashed rows. Bars are
      gold (chance). 26 still tiles.
    - **Plain words for the rarest:** "About 1 pack in 100 has a q", computed for the rarest letter
      still in the draw (five independent draws). The player docs carry the same table
      (`docs-site/letters.mdx`), pinned to the code by `tests/letter-odds.test.ts`.
    - **The copy says "pull", never "draw"** (#24 keeps "draw" from the player, where it reads as
      a lottery; "pull" is the Mint tab's own word). The supply is read again every minute while
      the Mint tab is open, so "Sold out" and "N left" can be up to a minute old.
    - The old card's caption named a Pokémon character, against #24; it went with the card, and
      the copy-rules test now refuses the name.
    - **Seen and not seen:** the list in practice mode at 390 and 1200 px. The sold-out and low
      rows only with a made-up supply (the test network has no low letter): the live supply path
      is held by tests.

34. **A card is an object, and its scene is a still engraving** (starl3xx, 2026-11-25, on the
    "Cards, Scenes, and Logo" proposal, six versions: "this is ABSOLUTELY the right direction for
    the cards"; then "After these are fixed, you're free to start building"). The owner pointed at
    Peter Voth's engraved cards and labels for the manner, and asked that the letters "retain their
    current style but ... live on top of" such card scenes. Nothing of his is copied.
    - **The card.** Its own paper, a shade lighter than the page, with a grain and a linen weave;
      the scene's art in a window; a frame in the rarity's ink (an edge rule, a chain of engraved
      links, the window's rule) with the rarity's mark in its four corners; and a ribbon set into
      the frame's lower edge. The rarity has no box of its own (the owner: it "looks out of place
      ... it should be incorporated into the card design").
    - **The ribbon reads "one of one", the card's number, the rarity,** in that order (the
      owner's), in capitals ("I like capitals for the front info"). Its tails are drawn shapes, so
      the notch carries the ink line; its paper has a grain and fine ruled lines. A phone-sized
      card drops "one of one". A thumbnail has no ribbon.
    - **Words are only ever set in Söhne** (the owner: "as a rule, the letters/words should only
      ever be in Sohne"). The card's serif letters what a card says ABOUT a word (its rarity, its
      number), never the word. It is **Iowan Old Style only where the device has it** (Macs and
      iPhones; "only use Iowan where the device has it"): no font is licensed or shipped for the
      app, and other devices use their own old-style serif. The share picture is drawn on a server,
      which has no fonts, so it ships **TeX Gyre Pagella**, an open look-alike of Palatino ("let's
      ship an open-licensed Palatino look-alike for the share card"; GUST Font License, the text
      beside the file).
    - **The scenes.** Every word starts on **the stock card**: no place, the card's own engraving
      in grey with the rarity as an overtone ("grayscale with rarity color overtones"; each
      rarity's wash has its own strength, because a green reads stronger than a brown or a gold),
      on a tiled floor in perspective ("I still want it to look like letters are standing on
      something other than a flat line"). **The Stage** is free for everyone, its colors at about
      two thirds of their strength and its curtains drawn back to the edges. **The Trophy Case**
      and **Spring** open at 3 words ever held, as before. **Picture Day, Summer, Fall, and Winter
      are retired**; a saved pick or a link that names one reads as the stock card. The Bookshelf
      and Outer Space are drawn (in the proposal) and wait for the Shop.
    - **The letters stand two thirds of the way down the card** (they stood three quarters down:
      "it looks too low in every scene"). **On curved ground each letter stands on the curve:**
      a scene gives one thing, its ground's height across the card, and each letter is lowered to
      it and turned to its slope, about its own feet (`lib/cardArt/scenes`, GROUND; the owner, of
      the proposal's planet: "the outer space curve is perfect... we should make sure it's
      replicable for future scenes"). Spring's hill uses it. Hands stay joined while the curve is
      gentle (a slope under about 12°).
    - **A scene never moves. The card does** (the owner: "the only animation for still scenes
      should be something that makes the card itself look cool, not the objects in the scene",
      then "much more subtle/transparent"): on the card in focus, a faint band of light crosses
      the front every 7 to 11 seconds and when the pointer arrives, and the card leans up to 3.5°
      toward a mouse pointer, with a faint glare. Never in a grid, never for a hungry word.
    - **How it is built.** A scene's art and the frame are two SVG documents made as strings
      (`lib/cardArt`), shown as background images in the game and placed as images on the share
      picture: no shapes in the page. A scene was about 1,000 elements; the art is 50 to 260
      shapes in one picture. One source draws the game's card and the server's.
    - **What it measured** (headless WebKit on the owner's Mac, the real Today screen in practice
      mode at 2× pixels, the pointer away, two runs each; a real iPhone hasn't been measured): with
      a fed Common word on stage, 50% and 57% of a processor core before, 8% and 9% after. The old
      scene's own loops were nearly all of it. **That is a fed word only.** With a hungry word on
      stage, which Today shows first, it was 54% before and 47% after: the sleeping letters' "Zzz"
      was nearly all of that (44% with it, 5% with it held still, measured the same way), and it was
      the letters', not the scene's (PR #227 put each z on a layer of its own). The card's light adds nothing measurable: the lean
      follows the pointer by writing its transform directly, with no transition (a transition
      restarted on every frame cost a third of a core).
    - **The share picture** is the card on a dark table, in X's shape (1.91:1) and Farcaster's
      (3:2); `?face=1` is the card's front alone, 16:9, which the share video turns over. The
      number on a share picture is the chain's, never the link's, and the picture waits a second
      and a half for it at most (a crawler is waiting), then is drawn without it and kept for
      minutes only. `CARD_LOOK` is 3.
    - **The turn.** At rest the face turned away is hidden outright. Headless WebKit kept drawing
      the back, mirrored, over the front after a turn home (it did before this change too).
    - **My readings, not starl3xx's words:** a share link with no scene keeps meaning the Stage
      (such links are posted for good), so the stock card is named in its link; the 3-word unlock
      now opens two scenes; the front does not lean with a phone's tilt; the Bag's rarity badge
      moved off the art to the line under the card, where the mark is large enough to read.
    - **Not in this step:** the back's new lettering and the game's seal (logo B), so until
      then the front letters its number "No. 0003" and the back "#0003"; the status
      placard under the Today card, the logo's new eyes and the exports of both marks, and the
      Shop's scenes and plastic case. Found on the way, and not this change's: a hungry word's
      "Zzz" looped inside each letter's top layer (the layer rule of #28, broken), and cost about
      40 points of a core at rest. Fixed beside this change (PR #227: a layer for each z), so a
      hungry word on the new card measures 5% too.

35. **The card's back is relettered, and the game's seal is pressed into it** (step 2 of #34;
    starl3xx, 2026-11-25, on the same proposal).
    - **The number is the headline.** "No." small, then the digits large, in the card's serif (Iowan
      Old Style where the device has it, as on the front). While the number isn't known there is no
      headline: never a dash that reads as a number.
    - **The facts are a ledger:** a name, a row of dots, a value. Names in Söhne and as written (the
      owner: "back word casing can stay as it is"); values in the card's serif. The words stand
      straight on the material with a soft shadow; the plates are gone from a full back (a Bag
      thumbnail's two lines keep theirs, to read at a glance).
    - **The seal** is logo B (the gilded tile's drawing), pressed into the material in one ink,
      behind the facts, in the material's own line colour. The owner, in order: "I really like the
      Pressed, one ink version of the back"; "the lines go through the eyes, and they shouldn't";
      "the eyes of the one-ink seal should also have the triangular cutouts"; "invert the colors
      of the eyes, so the irises aren't colored". So: everything behind the eyes is cut away where
      they are, the eyeball is ink, the pupil is clear, and the pupil's pie cut is ink again. It
      is one picture (`lib/cardArt/seal.ts`), used by the game's back and the server's picture of
      it, so the share video's back matches. Not on a thumbnail.
    - **The word is only ever its tiles** (in Söhne, on the rack). "1 of 1" reads "One of one", as
      on the front's ribbon.
    - **A phone's back** (under 430 px) drops the ascension pips (the stage's name stays) and the
      count of words in the rarity, which an opened card then says in the rows under it.
    - **My readings, not starl3xx's words:** the seal sits right of centre behind the ledger at
      about a seventh of full strength; a Legendary back's rarity steps clear of its corner
      scrollwork; the server's picture uses dashes for the ledger's dots (its renderer has no
      dotted line) and lining figures (it sets no old-style ones).
36. **Ascending has its own sheet, and a try is never called "ascending"** (starl3xx, 2026-11-25:
    "ascend need its own animation like roll does for letters... like where the word's letters
    get nervous, etc... and a similar modal to roll's roll (and then roll again) screen"; and,
    while it was being built: "the toast / popup shouldn't say “Ascending” it should say
    “Attempting ascension” so as not to mislead the player"). Ascension was one button inside the
    word sheet, and its result was a toast.
    - **The sheet** (`sheets/AscendSheet.tsx`, sheet kind `ascend`, opened by the word sheet's
      Ascend button; closing returns to the word). The word stands at full size holding hands,
      over the ladder as five stars (a ring on the stage this try is for), this try's odds, and
      one priced button: "Try for Gilded 2 · N $WORD". The price is the whole of what the wallet
      pays, the stage's fee plus the snack the try burns; the word sheet's button showed the fee
      alone. After a result, "Try again" (a miss) or "Try for" the next stage (a hit) tries at
      once, so climbing a word never means closing and reopening. Its rules are
      `components/game/ascendFlow.ts` (pure, tested).
    - **The animation.** While a try is out the letters can't look: the rig's `rolling` state,
      each letter a part of a shake behind the last, sweating and peeking in turn (five in step
      read as one machine). Then the result passes along the word, a letter every 110 ms: on a
      hit each opens its eyes in its new gold, the word cheers for 2.6 s over turning rays (gold;
      the foil's colors for Holographic), and stands at rest; on a miss each droops, and the word
      settles beside its new odds. `TileWord` takes a state and a stage per letter for this. The
      stars, the odds, and the price hold at the tap's stage until the last letter has the result.
    - **The wording.** "Attempting ascension" wherever a try is in flight (the status pill, the
      toast, the sheet's button), and "try" for the act: a button that says "Ascend" over a 35%
      chance promises what it can't. The word sheet's button still says "Ascend": it opens the
      sheet and spends nothing.
    - **A result is the chain's, not the signature's.** The reveal is sent by the player's
      wallet, and a send returns when the wallet accepts. So the store now waits for the reveal to
      land and reads the word's stage in the same block (`readPrestigeAttempt`,
      `lib/onchain/ascendResult.ts`), then shows that stage at once over the slower words read
      (`lib/onchain/stageOverlay.ts`). Before this, "try again" could find the finished attempt
      still open, a miss kept its old odds, and the next stage was priced from the stage before.
      A resumed attempt that wasn't this word's own puts the sheet back to ready, never "missed".
      A reveal that never shows is "still finishing", with no try offered. The sheet shows the
      stage and pity the store read back, never ones it works out from "hit" or "miss": a signed
      success that no longer counts (the word was unstaked or moved first) is no hit and adds no
      miss, and the first build showed such a word odds 10 points too high (Bugbot on #229).
    - **A result or an unfinished try is said once, and always** (Bugbot on #229 found the
      second half missing). The sheet the try was made in shows how it ends. If that sheet has
      gone, a toast says it: the result, or "paid, and not finished" over the note. And the store
      marks a word whose try ended unfinished, for the session (`unfinishedAscents`): the word
      sheet's Ascend card says so, and the ascend sheet's button becomes "Finish your attempt",
      with no price and no wait on the balance (`prestige(word, { finishOnly: true })`: it sends
      the open attempt's reveal and never pays for a new one). A priced try there was a dead end
      for a player who paid with their last $WORD and declined the second wallet prompt: greyed
      out, asking for $WORD it would not have charged (Bugbot on #229, High). Nor does finishing
      wait on the stake: the word sheet's button into the sheet reads "Finish" and always opens
      for such a word (`ascendDoor`), where it had stayed shut for a word unstaked since. The
      mark goes when a reveal is read back for the word, or when the words read shows it past the
      stage it was marked at.
    - **Still two wallet confirmations** (the paid attempt, then its reveal): the docs said one,
      and now say two. Having the server finish it, as it does for rolls (#14, which names
      ascension as a later case), would make it one and keep the letters nervous without a
      second prompt in the middle. Not built here: it is a new server write path.
    - **Measured, and one thing fixed for it** (headless WebKit, this Mac, one plain word
      alone at the sheet's size): nervous, it cost 45% of a processor core against 3 to 9% at
      rest. 27 points of that were the sweat: two beads a letter, looping inside the letter's top
      layer, which WebKit redraws every frame (the cost #227 took off sleeping letters' z's the
      same day). Each bead is now a layer of its own, and a nervous word costs about 20%; the
      roll sheet's one letter gets the same. The peeking eye swaps in steps and costs nothing.
      The rays turn as one HTML element, so the letters aren't redrawn for them. A Legendary
      word's own light moments keep running in the sheet, as they do on Today. A first reading on
      a Legendary word (38% at rest, 45% nervous) hid all of this behind those moments: measure
      a plain word.
    - **Seen and not seen:** the whole flow in the practice game, in Chromium and WebKit, at
      phone and desktop widths. The chain game's path (two confirmations, the wait for the
      reveal, a stranded try) is held by tests of its rules. Its one new chain read
      (`readPrestigeAttempt`) was run, read-only, against the 80 attempts on Base Sepolia; the
      flow itself was not driven with a wallet.
    - **My readings, not starl3xx's words:** "Try for <stage>" as the button; the result passing
      letter by letter; the practice game's 1.4 s of nerves; a hungry word standing bright in
      this sheet, as a letter does in the roll sheet.

37. **The back, as proposed, at every size** (starl3xx, 2026-11-26, on the live backs of #35: "the
    new card backs in prod don't quite match your proposal", "the backs need to be redesigned for
    all sizes / display locations", "the back of the card isn't in the share video yet").
    - **What #35 got wrong.** It kept the old back's skeleton (a top row, then two columns, four
      facts under 560 px) and relettered inside it, so at Today's size on a computer the rarity
      sat in the corner, four facts showed in place of the whole ledger, and the bottom line and
      the frame's dotted line were missing. The proposal's own measures are used now.
    - **One back, sized by the card's width.** Two columns, centred: on the left the rarity, the
      number, a rule, "One of one", how many words share the rarity, the rack; on the right the
      ledger; a line along the bottom (found by, the jackpot, the token, with a middle dot between);
      a dotted line just outside the frame's line.
      - **470 px and wider** (Today on a computer, an opened word): all of it.
      - **Under 470 px** (a phone): the first four facts; no count, pips, or bottom line. An
        opened card lists what is left out, the count first.
      - **A thumbnail** (the Bag's grid): the left column alone (the rarity, the number, one line,
        the rack) with the seal beside it, and no plates; on a phone's grid (about 175 px), the
        rarity, the number, and the tiles.
      - **The server's picture** (the share video's back) is laid out the same way.
    - **The share video drew the old back** because the back's picture had no version in its
      address, so a browser and the edge served the copy they had (the same miss as #217, on the
      other face). Its address carries `CARD_LOOK` now, which is 4.
    - **"No."** is never under the 12 px text floor, and the lettering in the material's line
      colour is lifted a little toward cream, so Common's reads on its dark back.
    - **A process note, mine:** the game's back is now built from the proposal's own CSS and was
      compared with it at each size before merging. #35 was checked against itself.
    - **Not settled:** the owner's picture of the proposal shows old-style figures (round zeros).
      On this Mac, Iowan Old Style draws lining figures in Chrome and WebKit whatever CSS asks, so
      the owner's browser may be showing another serif there (Georgia's figures are old-style).
      Asked; the stack is unchanged.
38. **"Your earnings" shares like a word does** (starl3xx, 2026-11-25: "this 'Your earnings' thing
    should be sharable in the same way words are... share to X, FC, download image... think through
    how to best visualize it in a 16:9 image"). The sheet has a Share button: Post on X, Cast, Save
    image, with the picture shown first.
    - **The numbers on the card are the server's, never the link's.** A word's card can be drawn
      from its link because the dictionary is the guard (#15). An amount has no such guard: a link
      that could carry one would put any number on the game's card. So `/api/rewards/earnings`
      signs a SNAPSHOT of what it computed (`lib/earningsShareToken.ts`: the totals in whole $WORD
      and the top five earning words, HMAC-SHA256), the link is `/e/<token>`, and the picture
      (`app/e/[token]/card`) draws only from a token whose signature holds. It reads no chain and no
      database, because X's crawler won't wait, and a token is one picture for good, which is right
      for a post made on a given day.
    - **One player's numbers.** The earnings route adds up any list of wallets it is given, so the
      snapshot covers ONE account only: the first wallet's (`accountWalletsOf`, the wallet links;
      the game sends the connected wallet first). A wallet the game counts as the player's but the
      links don't (a Farcaster wallet that hasn't joined the account) is left out of the picture,
      so the picture's amount can be under the sheet's; the Share panel shows the picture before
      anything is posted. When the links can't be read, the snapshot is the first wallet's alone.
      A token proves the numbers are some account's real ones, not that the sharer is that
      account: the route is public, like the chain it reads.
    - **The key** is `EARNINGS_SHARE_SECRET`, else one DERIVED from `PROFILE_SESSION_SECRET` under
      its own label (my choice, so the share works wherever profiles are configured without a new
      setting; a share token can't stand in for a session). Never the signer's draw secret. With
      neither, nothing is signed and there is no Share. A read accepts either key, so giving the
      share its own secret later keeps every posted link alive; ROTATING the session secret ends
      the links signed under it. A token names its network and is refused on another: test $WORD
      must never draw as the real one.
    - **The picture** (my design): two things on the card's dark table (#34). The player's top
      word as its own CARD, the same drawing as its share picture (`app/_og/wordCard.tsx`, moved out
      of the word's route; that route's pictures are byte for byte the same), and beside it a paper
      tag: "My words have earned", the amount in the sheet's gold, "$WORD" or "test $WORD", what the
      latest payout brought with its DATE (never "today": the picture is kept for good), and what
      the pictured word itself has earned. Side by side at 1200×630 (X) and 1200×675 (the 16:9 the
      owner asked for: Save image); the card over a wide tag at 1200×800 (Farcaster's 3:2).
    - **The word leads** (#24): it is first in the picture, the tag says "My words have earned",
      and the post says "CRANE and my other words have earned…". No dollars, ever, on mainnet
      either, though the sheet shows them there. No name, handle, or wallet in the link or the
      picture.
    - **No bars, no breakdown.** The sheet's rows don't add up to its total (words since sold and
      bounties are in the total), so the picture never reads as a sum. An amount stands beside the
      pictured word only when the TOKEN names that word; the word, its scene, and the clock offset
      for the date are the link's and cosmetic, as on `/s/`.
    - **The date is the sharer's.** The payout is 00:05 UTC, the evening before in the Americas, so
      the link carries the clock offset (`tz`, bounded) and the picture prints that calendar's date.
    - **Never in practice,** whose numbers are invented, and not until something is earned.
    - **Seen and not seen:** the picture in every case with tokens signed by a local key (large
      amounts, one word, a quiet day, a bounty only, each scene); the Share panel in the practice
      game through a temporary hook, removed. Not seen: a real wallet's token, and how X crops and
      shows the card.

39. **A word's status is three marks on a placard, not a sentence in a bubble** (step 3 of #34;
    starl3xx, 2026-11-25, on the proposal: the status popup "doesn't look right... we need to think
    through where and how this info is displayed so it's both easy to find at a glance when needed
    (i.e. not buried on the back of the card) and beautiful"; then "placard looks great").
    - **Three marks, always in the same order and place: Fed, Jackpot, Earns**
      (`components/game/stageMarks.ts`, pure and tested). Each is an icon, a small label, and a few
      words, in the colour of its meaning: teal (care, earning), gold (chance, or "soon"), candy (it
      needs you now), quiet (nothing to say yet). The old line was three facts in one sentence
      ("TEASE is full, in the jackpot, and earning $WORD."), in a bubble that covered the art.
    - **The Today stage is a card and a placard.** The card is clean: no bubble, no arrows on the
      art. The placard under it holds the marks, the one thing to do (Feed, Stake, Open, or See it
      in the Market) with Feed all and the scene picker beside it, the earnings line, and a pager
      ("Word 2 of 4", with the arrows). A swipe on the card and the arrow keys still change the word.
    - **The placard never names the word** (the owner: "seeing JAZZY immediately underneath the card
      is redundant (especially with Open JAZZY)"). The button's label does, in Söhne.
    - **The same marks follow the word:** in full on the word's sheet (in place of the hunger badge
      and "jackpot-eligible"), and as three small icons beside its name in the Bag, each with its
      words on hover and for a screen reader.
    - **The empty stage** is a blank stock card with its line and its one button on the placard.
    - The old sentence is still said, to a screen reader only, and announced when it changes.
    - **My readings, not starl3xx's words:** the Jackpot mark says "In the running" (the messaging
      guide's words; the proposal's mock said "In today's draw", and the guide rules out "draw" as a
      noun); the Earns mark shows the latest payout ("+40.2K today") where the mock showed a rate,
      because the game shows what was earned, not a forecast; a full word's button reads "Open
      TEASE" (it was "See TEASE"); a listed word's price stays a pill in the Bag, since no mark
      says a price; the pager draws dots up to 8 words, then the count alone.

40. **The logo: A with the letters' eyes, B as the seal, and both as files** (step 4 of #34;
    starl3xx, 2026-11-25: "I still like A as the primary logo", "I LOVE B as a logo... it could be
    a seal on the back somewhere maybe? I would want exports of both A and B for various places").
    - **A, the primary logo,** is the icon as it was (the glow-up tile on paper, its wooden edge,
      its grain) with the eyes the letters have had since #28: tall ovals, one big pupil each with
      its pie cut, no brows. Nothing else moved. It is the app icon, the tab's icon, the mini
      app's icon, and the docs' favicon.
    - **B, the seal,** is the gilded tile on engraved blue. Pressed in one ink it is on every
      card's back (#35).
    - **One source:** `src/lib/cardArt/logo.ts` draws A and B, `seal.ts` draws B in one ink, and
      `npm run brand:art` makes the app's icons and the exports in `docs/brand` from them: each
      mark as SVG and as pictures at 1024, 512, 192, 180, 64, 32, and 16 px, B round on a clear
      ground, and B in one ink. A test fails if the files and the source differ.
    - **The letter is an outline, not type.** Söhne Fett's "L" is a plain polygon, so the marks
      need no font: the icon no longer needs Söhne installed on the machine that makes it.
    - **My readings, not starl3xx's words:** A's SVG has no paper grain (a grain is pixels; the
      pictures have it); the old icon's Python page builder is gone, and its grain script stays;
      where else B goes (profile pictures, the saved picture's corner, emails) is listed in
      `docs/brand/README.md` and not built.

41. **The Bookshelf and Outer Space are the Shop's scenes** (step 5 of #34; starl3xx, 2026-11-25:
    "add bookshelf, outer space (maybe as shop items, but still good to build)").
    - **Built, not listed.** Both scenes are drawn (`lib/cardArt/scenes.ts`), and the game knows
      how a player comes to have one. Nobody has one until the Shop lists it, and listing is the
      owner's: `Shop.addItem` (the admin's Shop tab builds it), then a `shop_items` row with
      `kind` "scene" and `art` "bookshelf" or "space". Until then the picker doesn't show them.
    - **What grants a scene** (`lib/shop/scenes.ts`, pure and tested): an item in the profile's
      wardrobe whose `shop_items` row is kind "scene" and names a Shop scene in `art`. Nothing
      else: not an item with no row (the test network's "Test item"), not a row that names a free
      scene, not a typo. Buying one doesn't open the other.
    - **In the game.** The picker lists a Shop scene only when the player has it (it is picked
      like any scene) or can buy it now (it shows its price and opens the Shop). The Shop's card
      for a scene shows the scene. In Outer Space the letters stand on the planet's arc (#34's
      curved ground), and the card's light is fainter over the dark plate.
    - **The server won't save a Shop scene for a profile that hasn't bought it** (`/api/scenes`
      leaves that pick out, names its word in `refused`, and saves the rest). When it can't check,
      it saves no Shop scene.
    - **Unknown is not "no".** While the wardrobe is loading, its read failed, or the Shop is
      switched off, a word's saved Shop scene keeps showing: taking a paid scene off a buyer's
      card because a read failed would be the worse mistake. The picker offers one only on a
      positive answer. (The 3-word unlock treats unknown the same way.) "Unknown" includes a
      Shop answer that couldn't say what its items are: `/api/shop` sets `metaKnown: false`
      when the database read failed, and the Shop sheet lists nothing then (Bugbot on #235: every
      `meta` null read as "no item is a scene", and a buyer's scene came off their card).
    - **A scene is sold once, and never on a guess** (Bugbot on #235: the Shop answers before the
      wardrobe does). The picker offers a scene for sale only when it is known the player doesn't
      have it (`shopSceneOffer`), and the Shop sheet shows Buy for a scene only then
      (`sceneSale`): "You have it" with no Buy for one they own, by any item that sells it.
    - **Left open, the owner's call:** a share link draws whatever scene it names, as it always
      has (the page doesn't ask who owns a word, #15), so a hand-typed link can picture a word in
      a Shop scene its owner hasn't bought. It is a picture only. Closing it means the share page
      asking who owns the word and what their profile bought, on every card.
    - **My readings, not starl3xx's words:** the Shop scenes are not part of the 3-word unlock;
      the practice game has no Shop, so it has neither scene; the player docs say nothing of them
      until one is listed.

42. **The plastic case** (step 5 of #34; starl3xx, 2026-11-25: "a plastic case (like PSA-rated
    cards)... should be able to rotate like the card does now"; then "the plastic case is SO
    COOL" and "case looks good for now").
    - **What it is.** A clear slab around a word's card, with a paper label across the top
      (`components/cards/CardCase.tsx`). The front label says what the card's ribbon says, in
      the ribbon's order (one of one, the number, the rarity) and never the word. The back label
      says who found the word, when it was cased, and "Sealed by Lexigotchi" with the game's
      seal (logo B), its rim in the label's ink. The number is the chain's, and is left out
      while unknown.
    - **Built, not listed.** Nobody has a case until the Shop lists one, and listing is the
      owner's: `Shop.addItem`, then a `shop_items` row with `kind` "case". Until then no Case
      button shows anywhere.
    - **One case holds one word** (`lib/shop/cases.ts`, pure and tested). A profile may have as
      many words in cases as it has bought cases. Taking a word out frees its case, and a case
      comes off a word that leaves the profile, as its scene does (the keeper's
      `clearPicksOffLeftWords`). **This is my reading, not starl3xx's word.** It is the strict
      one on purpose: it can be loosened later (one purchase for every word) without taking
      anything from a buyer; the other way round could not.
    - **The server is the one place that counts.** `PUT /api/cases {word, on}` under a profile
      session puts one word in or takes it out, counts the profile's cases from the wardrobe,
      and refuses with `none_left` (or `try_again` when the wardrobe can't be read: no case on
      a guess). One profile's changes run one at a time. A cased word is a `word_picks` row of
      kind "case" (no new table, no migration). The game shows a case only for a word the
      server lists, and reads the list wherever this network has a Shop, even while the Shop is
      switched off, so a buyer's words keep their cases. `scripts/case-db-check.ts` proves the
      SQL against a real Postgres on this machine (the unit tests stand a map in for it): a row
      under a linked wallet's own key counts, and two requests at once can't both take the last
      free case.
    - **A read that is missing is never read as zero** (`casesState`, `caseOffer`, pure and
      tested). Three reads feed the game: the server's list, the Shop's items, the wardrobe.
      While the list isn't known, no word shows a case and nothing is offered (an unknown list
      read as "none cased" would offer a case the server then refuses). While the count isn't
      known, every listed word keeps its case and no word is offered one.
    - **A case doesn't outlive its purchase** (`casesShown`). Once the count is known, at most
      that many words show a case, the oldest first. If the wallet that bought a case leaves the
      profile, the newest cased words stop showing one; their rows still count as cases in use
      until the player takes a word out. A Shop scene is checked against the purchase the same
      way.
    - **Where it shows.** An opened word: in its case, turned with the corner button or a
      sideways drag. The Today stage: in its case, turned with the button (a drag there is the
      swipe between words). The Bag: the thumbnail wears the plastic's rim and light. The Case
      button under an opened card puts the word in or takes it out, and lists every case in use
      with a way to free it, so a case is never stuck on a word the player can't open.
    - **The case is the card's one turn.** The case turns over and the card's back is in its
      other side: there is no second flip inside it. A host remembers "turned over" for what it
      shows now (`cards/useFlipOf`: the word, and bare or cased), decided while rendering, so a
      card that goes into a case or comes out mounts on its front (Bugbot on #236: a reset in an
      effect ran after the paint, and the bare card mounted on its back, then turned). On Today
      this also means a word shows its scene when the player comes back to it.
    - **Reduced motion:** the sides swap at once, with no turn, and the focus moves to the new
      side's button a frame later, once that side can take it (Bugbot on #236).
    - **A finger turns it only with a move more sideways than up-and-down;** the other is the
      page scrolling. A mouse also tilts it. A press on its button, or a mouse that comes back
      with no button held, turns nothing.
    - **Narrow cards** (found while fitting the case; measured in WebKit at 320 px). A card
      under 340 px wide, bare or cased, cut its ledger off at the card's edge ("Yours since …
      20 Nov 20"): a bare card on a 320 px phone is 276 px, and that was so on main. There the
      ledger now takes the wider share, sits low and clear of the corner button, and a long
      value breaks onto a second line. The three buttons under an opened card (with Case) put
      the third on its own row there.
    - **How it turns** (measured in WebKit). Every angle is written straight to the element, a
      frame at a time, with no CSS transition and no loop. Which side shows is decided from the
      angle on every frame, never by `backface-visibility`: WebKit drew the back mirrored over
      the front mid-turn. A let-go case rests on the side that is showing, so settling never
      passes edge-on. At rest a cased card costs what a bare one does (7 to 11% of a core on
      Today, the same four words measured both ways); a continuous drag is about 41%.
    - **Not built:** the live light on a cased card's back (the back is still under the
      plastic); the case on the share picture and the share video (they draw the bare card);
      more than one style of case (the stored value names the style, so another can follow).

43. **A finished tile's moving light is drawn as layers, in WebKit only** (the "Built light"
    section of the cards proposal, #34: "the letters' rarity light moments are the largest cost at
    rest. Put the passing light on a layer over the tile").
    - **What was wrong.** WebKit redraws a whole `<svg>` on every frame that anything moves
      inside it, and a moment's light moved inside the letter's own drawing. Measured in headless
      WebKit, one five-letter word over 40 s: a Common word about 9% of a processor core, an
      Uncommon one 21%, Rare 23%, Legendary 35%, Mythic 40%. One glint moving alone cost 27%.
      A tile is in a moment for about five seconds of every seven to ten.
    - **What changed.** On a finished tile whose light moves, the body is cut where the light
      sits (`TileCharacter`, `splitBody`), and every moving piece of the light is its own
      `<svg>` with the moment's animation on that `<svg>` (`TileFinish`, `momentPieces`). The
      body's idle loop moves to one wrapper round the pieces. Every piece keeps its place in the
      paint order: the glow under the letter, the streak over it and under the eyes.
    - **The result, same measure:** Uncommon 10%, Rare 11 to 12%, Legendary 17 to 18%, Mythic
      31%. On the real Today screen a fed Legendary word went from 36% to 20%, and from 54% to
      29% with the pointer moving over it.
    - **Only in WebKit** (`useWebKit`: by the engine's maker, so Chrome on an iPhone counts).
      Headless Chrome, slowed four times, measured the other way: it draws only what changed,
      and pays for each layer. A Legendary word cost 99% in one drawing and 106% as layers, a
      Mythic one 104% and 119%. So every other engine keeps exactly the drawing it had.
      Measure BOTH engines before changing either path.
    - **The picture.** Compared in WebKit at eight frozen times, nineteen cases (every rarity,
      both cases, gilded, Holographic, peckish, hungry, a phone's size): at rest all nineteen are
      pixel for pixel the same. While the light moves, at most a few hundred pixels of half a
      million differ by more than 8 levels of 255 (at most 13 by more than 32): the twinkling
      glints and the light's edge, which a layer turns as a picture where the drawing redrew them.
    - **A glint rises with the tile as a layer outside its own turn** (Bugbot on #237). The
      hover's rise was inside the glint's layer at first, and the layer's quarter turn swung the
      risen glint six units to the side of its point. A piece that turns keeps the lean inside
      its drawing and takes the rise from a layer round it. Checked hovered, against main, at
      the quarter turn: the glints sit on their points.
    - **What stays one drawing:** a still tile, a hungry one, a small one, reduced motion, a slow
      device, and a picture in a single file. `npm run docs:art` gives no change.
    - **Tried and dropped, with the numbers:** the moving pieces left as shapes inside small
      drawings of their own (34%: no better than one drawing); layers only as big as their piece
      (no cheaper, and the glints moved a fraction of a pixel at rest); the animation on a plain
      element holding the drawing (no cheaper).
    - **Not done: the Holographic foil.** It drifts by a loop on a gradient inside the drawing,
      for as long as the tile is in focus: a Holographic Mythic word measured 58%, against 40%
      at stage 4, and layers don't help it (56%). No layer reproduces a drifting gradient
      exactly, and whether the foil should drift at all, or only in moments, is the owner's to
      say. A still tile doesn't run it.
    - **Not checked:** a real iPhone or a real GPU. Every number here is headless.

44. **The server finishes ascension attempts, as it does rolls** (starl3xx, 2026-11-26: "yes,
    have the server finish ascension like rolls"; #14 named it as a later case, and #36 as its
    follow-up). An attempt was two wallet confirmations, and the second arrived while the word's
    letters stood with their eyes shut. Now the player confirms the paid attempt only.
    - **How.** The game posts `{ commitId, relay: true }` to `/api/prestige/reveal`. The route
      signs the outcome as before, sends `Prestige.reveal` from the relayer key (the same
      `RELAYER_PRIVATE_KEY` as rolls, builder code on the write), waits up to 20 s for the
      block, and answers with what the chain did. `Prestige.reveal` is permissionless, so no
      contract change. Without the key, or when nothing was broadcast, the answer is the
      signature and the player's wallet sends it, as before. Without the flag the route answers
      exactly as it always did, so a client bundle from before this keeps working.
    - **The answer is the chain's, never the signed outcome.** A signed success no longer counts
      if the word was unstaked or moved before the reveal, and Prestige then emits "failed" with
      the pity unchanged. So the result is read from the reveal's own event
      (`lib/onchain/relayOutcome.ts`): a hit names the new level; a miss names the pity but not
      the level, which the relayer reads at the reveal's own block. That pin matters: the real
      miss used as a test fixture left its word at stage 3, and the same word stands at 5 now. A
      level that can't be read is null, and the game reads the chain itself; nothing is filled
      in. An attempt that was already revealed, or broadcast and not seen to land, claims no
      outcome at all: the game reads it from the chain.
    - **One send a commit, by contract.** The relayer remembers a commit's send for a minute so
      a repeat request gets the first answer. Rolls and Prestige each count their own commits,
      so the memory is keyed `roll:7` and `prestige:7`: under one key an ascension would have
      been answered with a roll's result.
    - **Only "nothing broadcast" reaches the wallet** (`revealPlan`). Once the server has
      broadcast a reveal, a second one from the wallet would revert when the first lands, for a
      prompt and a fee that bought nothing.
    - **A lost answer.** The route holds the request while the reveal mines, so "the server
      finished it and the game never heard" becomes the usual way a try ends unfinished. Three
      things answer it. On a failed fetch or a 5xx the game asks the chain before it calls
      anything unfinished (`answerLost`). The unfinished mark keeps the attempt's commit id, so
      "Finish your attempt" asks the server about that commit and says its result, measured
      from the stage the try was made at, where it could only have said "nothing is open". And a
      marked attempt whose reveal lands later on its own has its result said in a toast when the
      words read shows it, where the mark used to vanish without a word.
    - **Cost.** One more transaction from the relayer per attempt: under a cent on Base, free on
      the test network. Bounded by paid attempts: each needs a fee paid to exist, and can be
      revealed once.
    - **Not changed:** packs and the daily letter still reveal from the wallet (#14).
    - **Seen and not seen.** The log reader was run on two real Base Sepolia reveals (a hit and a
      miss) and is tested on those logs; the pinned level read was run against the test network;
      the route's own handler was called against it for a finished attempt (it answers
      "already", and 409 without the flag). **No attempt was driven end to end with a wallet**:
      the first relayed reveal on the test game is the real test of the send.

45. **A sale tells its seller, and a browser that opts in gets one push at once** (starl3xx,
    2026-11-26: "can you get started on the plumbing and implementation for opt-in browser
    notifications? and if possible, push notifications (if saved as a PWA, for example), Farcaster
    notifications, and any other suggestions you might have").
    - **The plumbing was already built** (#93 and after): Farcaster notifications through Neynar,
      browser push with VAPID and a service worker (the Home Screen app on an iPhone), and email,
      each behind its own switch, with three reminders wired (hunger, the daily letter, a jackpot
      win). On this day email was on in production, and browser push and Farcaster were dark only
      for want of settings (the public VAPID key was unset: `/api/push/subscribe` answered
      "disabled"). So the first deliverable is the switch-on order, in
      `docs/web3-runtime-plan.md`: keys first, flag last, because each sender stops at import
      when armed without its keys and the daily keeper imports both.
    - **A sale tells its seller** (#30 left it "not done"; `lib/notify/sold.ts`, templates
      `marketSold`). A receipt: one per fill. It hangs on the sales recorder, which hands a new row
      only to the caller that inserted it, so a seller is told once however many servers read the
      sale. Recent sales only: thirty hours, wider than the daily keeper's cadence, so a sale only
      the keeper finds is still told (the rule `triggers.ts` states for hunger); the recorder also runs as
      a backfill, and a seller must never hear today about last week. The reader hands out each new
      row AS it records it, and its callers start the send at once, because a row is new only
      once and a pass can fail, or be stopped, part way (Bugbot on #239); a dry keeper run reads no
      sales, for the same reason. What is left: a server stopped in the second between recording
      a sale and sending loses that one message, and closing that needs a stored "told" mark per
      sale. One message per seller for the sales of one transaction. The id is the FILL's
      (transaction and log index), never the order's: a letter listing fills in parts, and a
      repeated id is dropped for a day. Farcaster first, else the seller's browsers. **Not by
      email:** email is live, and its players agreed to three named reminders; a fourth waits for
      the owner's word. The body says what it sold for and that the seller's SHARE arrived (they
      keep 90%).
    - **It can't hurt the Market.** The sales route is public and the Market depends on it, so
      the notifier runs after the answer (`lib/afterResponse.ts`) and is imported at the moment of
      use, inside a catch. Nothing is loaded while both channels are dark, and when Farcaster is on
      only the sellers' own wallets are looked up (one cached request), never every player.
    - **One push on opt-in** ("Reminders are on", once per browser, to that browser only). No
      reminder can be sent outside production, so this is the proof the channel works, for the
      player and for the owner on the day it is switched on.
    - **Asked where the reason is:** the Sell page offers "Tell me when something sells" under the
      player's listings, as Home's hunger card offers its reminder.
    - **Not built, and my suggestions** (in the order I would do them): a choice per kind of
      reminder, stored with the profile (one switch for everything gets switched off; it needs a
      migration); the sold receipt by email, once the profile says which reminders it covers;
      payday ("your words earned X", the template exists) only after the per-kind choice, because
      it would be a second daily message; a deal alert ("a q is for sale, and it finishes
      QUICK"); a bounty result; a weekly digest by email in place of daily ones.
    - **Seen and not seen:** every rule by test, with injected senders. No real push has been
      seen: none can be sent until the owner sets the keys.
    - **Switched on 2026-11-26** (starl3xx, the same day: "I'm pretty sure you can do 1-4 for
      me", the switch-on steps). The VAPID pair was made on the owner's machine and piped to
      Vercel without being shown (its backup is the gitignored `.env.vapid.local`); the two flags
      went in after the keys, Production only; the docs' "aren't switched on yet" notes came out
      in the PR that deployed them. First sends: "Reminders are on" to a browser that opts in,
      then the keeper's hunger warnings (00:05 UTC) and the daily-letter reminder (13:00 UTC) to
      players who added the mini app.

46. **Today's pots: three equal tiles across the bottom** (starl3xx, 2026-11-26: "jackpot,
    Bounty, and (new) Rewards pool should be 3 equal sized tiles across the bottom. Bounty should
    show WORD amount (all 3 should), and all 3 should show appx. USD as well").
    - **Where.** One row under both columns, above "Do something", three across at every width
      (`TodayPots` in `screens/HomeScreen.tsx`, the rules in `components/game/todayPots.ts`, pure
      and tested). The jackpot left the column under the words and the bounty left the column
      under next steps. On a desktop a tall right column can now leave room under the words.
    - **What each tile says.** Its name, its $WORD amount, "about $X", and one line of its own:
      the jackpot's countdown and the player's place in it (the old card's cases, in its order:
      "how to get in" always says staked and fed, and nothing is said while the words load), the
      bounty's theme, and the Rewards Pool's daily share (`dailyDistributionRate`, the keeper's
      own rate). Each tile is one button: the Jackpot page, its bounty half, and the Earnings
      sheet (which explains earning to a player who has earned nothing).
    - **The Rewards Pool amount** is FeeRouter's pool bucket, already read with the other two
      (`readFeeBuckets`). A pot not read yet shows a dash, never 0 (`potsKnown`).
    - **Dollars, an exception to #24.** The messaging guide said never a dollar figure for
      $WORD or the jackpot; the owner asked for one here. The exception is these three tiles
      only: share text, reminders, the landing page, the docs, and bot posts keep the rule. The
      figure is "about", in the $WORD page's short format (`fmtUsdShort`, now shared).
    - **Still no dollars for test $WORD** (`showsUsd`, #172: a dollar figure beside test $WORD
      made a tester expect their real $WORD to count). So the live test game shows three amounts
      in "test $WORD" and no dollars; practice mode and mainnet show the dollars.
    - **Seen:** practice mode in Chromium and WebKit at 360, 390, 768, 820, 1024, and 1280 px,
      also with the longest likely text ("888.88M", "about $888.8K", the longest theme; the test
      game's Rewards Pool read 776.74M that day): equal tiles, nothing under 12 px, nothing
      overflowing, the three amounts level. For that, the amount is 18 px under 380 px, 20 px on
      phones, 24 px from md, and 30 px from lg, and the icon sits above the name until lg. **Not
      seen:** the chain game's Today in a browser (its pots were read from Base Sepolia by a
      script, and the tiles were drawn from fake state in jsdom).

47. **Reminders: a choice per kind, then the kinds a choice makes room for** (starl3xx,
    2026-11-26, agreeing to five suggestions made under #45: "A choice per kind of reminder,
    stored with the profile. One switch for everything gets switched off"; "The sold message by
    email"; "Payday"; "A deal alert"; "A bounty result, and a weekly email digest in place of
    daily emails"; and "just make sure the email design is minimal and follows our most recent
    design language"). One entry: each part is added here as it ships.
    - **Part 1, the choices** (`lib/notify/kinds.ts`, `lib/db/reminderPrefs.ts`, migration 0018).
      A player's ACCOUNT chooses which kinds of reminder it gets, in the profile ("What to tell
      me"), for email, browsers, and Farcaster at once: how a player is reached stays each
      channel's own switch. Only what a player CHANGED is stored, so a player who changes nothing
      gets exactly what they got before, and a kind added later starts at its own default for
      everyone. The four kinds that exist (hunger, the daily letter, a jackpot win, a sale) start
      on; a kind that would add a daily message will start off.
    - **Two kinds of "couldn't read", never confused.** No table (the migration hasn't run):
      nobody has chosen, everybody gets the defaults. A read that FAILED: somebody may have turned
      a kind off and we can't see it, so that pass sends nothing. A choice is a promise.
    - **Every sender asks first:** the keeper's hunger pass (the words of a player who turned it
      off leave before any channel groups them), the jackpot winner's, a sale's seller, and the
      daily-letter cron. Farcaster is reached by FID and a choice is kept by account, so the cron
      looks up the FIDs of the accounts that turned the daily letter OFF (usually nobody), never
      every player's.
    - **A table of its own** (`reminder_prefs`), not columns on `profiles`: `getProfile` selects
      every profiles column, so a column the database lacked would break every profile read until
      the migration ran. The same migration adds `reminder_marks`, the send-once mark for every
      later kind, so those need no new column each.
    - **Part 2, the email's look, and a sale by email.** The email is the card, as little of it
      as says "this is from the game" (#34, #35, #37): the card's own paper on the game's page;
      the frame as two fine lines in the card's ink, a rule and a dotted line just inside it; the
      wordmark in the card's serif capitals; a receipt's facts as the back's ledger (a name, a row
      of dots, a value in the serif); one button, in ink. Sentences stay in the sans, as words do
      on a card. No picture and no shipped font (stacks only: Iowan Old Style where the device has
      it, then Palatino, then Georgia), and it says "light only". The code email shares it.
    - **A sale is emailed** to a seller who confirmed an address, kept email on, and didn't turn
      the kind off, whatever else reached them. Marked in `reminder_marks` BEFORE it is sent and
      unmarked if the send fails; with no mark table nothing is sent (a kind that can't keep its
      mark waits, the opposite of the choices' missing table, where "nobody chose" is a true
      reading). Unsubscribe stops this kind with the rest: it reads the same list of opted-in
      addresses. The footer says where to choose kinds, and how to stop them all.
    - **Seen and not seen (part 2):** the three emails as pictures at phone and desktop widths. No
      real mail client was seen, and no test email was sent.
    - **Part 3, payday and the bounty result** (`lib/notify/paid.ts`). Both hang on the keeper's
      `payout` job, which already runs (a new job name would never run where `KEEPER_JOBS` is
      set), and both say "paid" only of what LANDED: they are fed the `RewardClaimed` events of
      the keeper's own transactions, never the shares it meant to pay (the payout has a time
      budget, and a player may have collected a share themselves). **A day or a week is told
      ONCE, by the run that pays the first of it, and it states the player's whole share**
      (`toldShares`; Bugbot on #244, twice). A message's id is the day or the week, so there can
      be only one: it says the whole share, which the epoch's tree fixes, and "paid" of all of it
      only when all of it landed; when part still waits it says "part is paid, the rest follows".
      Stating only what landed made a part read as the whole; holding the message until all of it
      landed never told a player who collected the rest themselves. A failed batch doesn't skip
      the message for the batches before it, and the run re-reads every share it didn't see land
      (the player may have collected it meanwhile). **The rule's limit:** "told" is read from the
      chain (a share already paid when a run begins), so a set whose first payment no run saw
      before its message (a transaction that lands after the run's last read, a share claimed by
      someone before the keeper's first payment) is never told. Rare, and one courtesy message;
      the full answer is a recorded "told" mark, not built. **Payday is OFF unless a player
      turns it on,** because it comes every day a word earns; its message doesn't say "today's
      payout", since a run also pays an earlier day's leftovers. **The bounty result is on** (once
      a week at most), and says the player's words' SHARE with the week's theme, never "the
      bounty is yours". One message per player per kind for a run, linked wallets as one player,
      whole $WORD rounded down, nothing under one.
    - **Part 4, the deal alert** (`lib/notify/deals.ts`): "A q is for sale on the Market, from
      2.40M $WORD. It finishes QUICK, a word nobody owns." OFF unless a player turns it on. It is
      worked out the way the Market's own "For you" is (`oneLetterShort`), so it is true when it
      arrives and names the Market's word: one wallet's letters (a claim spends from one wallet),
      never a letter the player holds in another wallet (a move, not a purchase), only a word
      nobody owns, only a letter the checked book says can be bought now from someone else. One
      alert a day at most, and the same letter and word once a week at most: both are marks in
      `reminder_marks` (`claimMarkEvery`; no table, no alert), so both hold across keeper runs. A
      mark is taken before the send and **given back when the alert reached nobody** (`tellDeals`;
      Bugbot on #248): no channel reaches the player, the send failed, or the choices couldn't be
      read. An alert that never went out must not stand as told for a week. The alert is the best deal the
      player wasn't told of this week (the rarest word, then the lowest ask), so a deal already
      told never hides a new one. It runs
      in the keeper's `notify` job, after the hunger warnings, and reads the chain only when
      somebody opted in.
    - **One sender for every receipt** (`lib/notify/players.ts` `notifyPlayers`): the kind is asked
      first, Farcaster or else the account's browsers, and email with its send-once mark. A sale,
      a payday, and a bounty each only say who and what.

48. **Letters and cards, round two: nine notes, built in parts** (starl3xx, 2026-11-26, on the
    review page "Card and Letter Review", which runs the game's own letter and card code beside a
    changed copy; every point was decided there, then: "you can build your way through all of
    this"). One entry: each part is added here as it ships.
    - **Two rules, in the owner's words.** "However the tiles are animated, their *size* should
      never change in animation; it breaks the character illusion in a weird way." And: "anything
      on the letter/body should be its existing colorful / flat design; anything NOT on the
      letter/body should be in the card style", the engraved line of the cards (#34).
    - **Part 1, the rules in the letter.**
      - **No size change.** A raised letter pulsed 13% bigger every 0.9 s: it now hops twice and
        stands in the hero pose (a hand on the hip, a wave), which the rig had and nothing used. A
        letter arriving (an opened pack, bought letters), the card of a bought word, and a step of
        the intro grew in from 40% to 112%: they drop in (`drop`; `pop` stays for a toast and an
        icon). The breath swelled the body by under 1% and sleep by 1.2%: the breath only rises,
        and sleep is a slow rock about the feet. A pressed letter or word row squashed to 94% and
        97%: it pushes down 2 px.
      - **What may still change size,** by the owner's word ("the tile size stays consistent"):
        the legs, whose stretch keeps the feet down while the body rises; a whole card's 3.5% lift
        as it turns; and what flies off a letter (sweat, a z, a twinkle, confetti).
      - **`tests/tile-size.test.tsx` holds it.** Every `tc*` loop must be listed there as body,
        legs, or off the tile, so a new loop can't be added unsorted; a body loop with a scale
        fails; `animate-pop` may be used only in the two files with no letter in them; a `.tile-
        press` or `.word-press` rule with a scale fails.
      - **The ground shadow is ruled lines** in the shape of the shadow, heavier toward the middle
        (`tileShapes`, `SHADOW_LINES`, typed out so the server and the browser can't differ in a
        digit), in the rig and in the share letter. It was a grey oval. The owner: "ruled lines
        for shadows is fantastic." `CARD_LOOK` is 5.
      - **A raised letter's rays are engraved, and a layer.** A "glory", as engravers draw light:
        fine ruled rays of three lengths, twelve wedges with pale light inside, a ring of beads, in
        the game's bright gold (the owner, of a first version in dark gold ink: "lighter, sunnier
        color"). A box that stands still cuts them off just above the ground ("the rays shouldn't
        be visible behind the lined shadow"), and only the drawing inside it turns. The flat star
        they replace turned inside the floor's drawing, which the rig's own rule forbids: a raised
        letter cost 11% to 20% of a processor core in WebKit for it (three runs), and under 2% now.
        Headless Chrome is about the same either way (20% to 24% before, 23% to 26% after).
      - **Measured on the way, not changed here.** A cheering word costs 48% of a core in WebKit
        and 3% with its confetti hidden (it loops inside a drawing). A word's random life (blinks,
        glances, twinkles) is most of what it costs at rest: 2% with it off, 6% to 17% with it on.
      - **Seen and not seen (part 1):** the tile lab in headless WebKit, against the review page;
        the docs' pictures rebuilt. No real iPhone, and no real graphics chip.
    - **Part 2, the gilding** (the owner's four picks; the shapes are in `tileShapes`, for the rig
      and the share letter).
      - **Slim.** "The gilded and holographic borders look good visually, but they're too thick."
        Gold outside the blue border is 8, 9, 10, 13.5, 13.5 units by stage, where it was 13, 15,
        17, 22, 22 (`GILD`, `ringParts`). The ring stopped trying to count: stages 1 to 3 differed
        by 2 units, which nobody could read. It says gilded, doubled from Gilded 4, and foil at
        Holographic. Thinner rings also bring the eyes down (they ride the ring's outer edge) and
        part the letters of a word (at Gilded 4 each was as wide as the step to the next).
      - **Legs in front of the ring, as a layer.** "In the same way that arms come out in front of
        gilding, could we do the same for legs?" The ring was part of the body, and the body is
        over the legs, so at Gilded 4 only 16 of a leg's 52 units showed and the tile sat on its
        shoes. Where a letter has legs, its rings (and the glow behind them) are a layer of their
        own under the legs: floor, rings, legs, body. A shortcut (the top of each leg drawn again
        inside the body) was ruled out by the owner: "legs in front has to be a layer in front of
        the gilding... otherwise it doesn't work", for "every uppercase", so a plain UPPERCASE
        letter's legs come over its pale ring too.
      - **What the layer costs,** measured on its own (a five-letter Gilded 4 word with the random
        blinks and twinkles off; headless; share of one core): WebKit 1.9% and 2.2% before, 2.0%
        and 3.3% after; Chrome at full speed 38% both ways; Chrome slowed four times 91% before,
        95% and 96% after (it draws every layer on the processor and is at full load already). If
        a real phone shows a cost: give the layer to gilded letters only, or cut it to the ring's
        own size.
      - **Black diamond pips.** "Black diamonds... let's make all of them like that, including
        holographic." An earned pip is solid ink at every stage; one not yet reached is a faint
        outline, which reads on white, gold, and purple, so the white plate under them is gone.
        They were gold squares, grey-lined white ones, and one foil. On the card's back they are
        the same diamonds in the back's own ink (the material's line colour): black would not show
        on a dark back. That last part is my reading, not the owner's word.
      - **Laurels, for now.** "The crown on gilded/holographic letters looks bad, small, and
        cheesy." It was 36 units wide and sat between the eyes, which hid all but its peak. From
        Gilded 4 a whole character wears two laurel sprigs arching over its head from the top
        corners (gold, foil at Holographic), in place of the twinkle that sat there. The owner
        picked them over a halo, a worn crown, and a tipped crown, "for now". Worn by the letter,
        so flat and outlined like the rest of it.
      - **The share letter** draws an UPPERCASE letter's legs over its ring too (`CARD_LOOK` 6). It
        still draws no gilding at all, in any picture: that is the next part.
      - **Seen and not seen (part 2):** the tile lab's ladder in headless WebKit, against the
        review page. No real iPhone.
    - **Part 3, the gilding in the server's pictures.** No link picture, saved picture, or share
      video ever showed a word's gilding: the server's letter (`app/_og/tile.tsx`) had no gilding
      code at all.
      - **The share letter wears it:** the rings, the pips, the laurels, and the foil, from the
        same shapes as the rig (`tileShapes`), on the card's front and on the back's rack; the
        back's Ascension row shows the pips. `CARD_LOOK` is 7.
      - **The stage is the chain's, as the number is** (`lib/onchain/cardLevel`: `Words.
        prestigeLevel`, kept five minutes, waited for a second and a half at most). Nothing in the
        query is drawn.
      - **The address names the stage** (`g`, 1 to 5, in the link and in every picture's address),
        only so that a word's link and pictures get NEW addresses when its stage changes: X and
        Farcaster keep a picture by its address, for good. The game passes the stage it knows; the
        share page reads it from the chain.
      - **A picture is kept for a week only when its address names the stage it shows**
        (`cardPictureCache`). An old link to a word that has since ascended, an address that names
        a stage the word isn't at, and a stage that couldn't be read are asked again in five
        minutes, so nobody can park a wrong picture at an address for a week.
      - **An address that names another stage is a reason to read the chain again** (Bugbot on
        #247). The stage is kept in memory for five minutes; a word shared the moment after it
        ascended arrived with its new stage in its address, and drawing the kept stage would have
        put the OLD gilding at the NEW address, for good. A stage in the address that differs from
        the kept one now reads again, at most every ten seconds for a word, so a made-up address
        can't turn every request into a chain read. The share page passes its own link's stage
        the same way. The address is still never drawn.
      - **The share page** draws the word with its gilding too.
      - **Not yet:** the earnings share picture reads no chain by design (#38), so the card on it
        shows no gilding. The stage would have to ride in its signed snapshot.
      - **Seen and not seen (part 3):** VIVID at Gilded 4 and JAZZY at Holographic, drawn by the
        server's own drawing code from a script. The routes were not run against a chain here (the
        practice game has none), and no word on the test game is ascended yet, so the first real
        one is the first real test.

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
  (2026-11-25, #30: the swap is retired; letters sell for $WORD on the Market, each at its seller's
  price, so the market itself prices scarce letters higher.)
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
