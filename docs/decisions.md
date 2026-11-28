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
    engraved cards and labels for the manner, and asked that the letters "retain their current
    style but ... live on top of" such card scenes. **The style has a name, and no artist's name
    is ever written** (starl3xx, 2026-11-26): "neo-Victorian engraving illustration or vintage
    ornamental illustration". Not in the docs, the code, a comment, a test, a pull request, or a
    page. Nothing of anyone's is copied.
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
      and the post says "CRANE and my other words have earned…". No name, handle, or wallet in
      the link or the picture. ~~No dollars, ever, on mainnet either, though the sheet shows them
      there.~~ Amended below.
    - **Amended 2026-11-26: the gilding, the card's serif, and "about $X"** (starl3xx: "earnings
      share card image doesn't use gilding/ pips/laurels, but it should... and can also use the
      game's serif font(s) tastefully... and should also include an appx. USD amount").
      - **The pictured word wears its gilding** (#48: rings, pips, laurels, foil), at the stage
        the TOKEN signed for it. The route that signs reads each named word's stage from the
        chain (it waits 1.2 s; a stage not known is drawn without gilding). The picture still
        reads no chain: X fetches a posted picture once and keeps it for good, so a read that
        timed out there would leave it ungilded for ever, and a link must not be able to claim a
        gilding. A word the token doesn't name gets none, as it gets no amount (the game pictures
        the top earner the player HOLDS, which the token names unless five words since sold
        out-earned it).
      - **"about $X" under the total**, which reverses "no dollars" for this picture and is the
        second exception to #24 (the first is #46's pot tiles). The figure is the server's:
        whole cents at a LIVE price not older than 15 minutes, signed into the token; never the
        oracle's stand-in constant or an old copy, never the link's. In the $WORD page's short
        format (`fmtUsdShort`), for the total only. **Never for test $WORD** (#46), so the live
        test build's picture shows none. The post's own words still say no dollars.
      - **The tag is lettered as the card's back is** (#35): names in Söhne, figures in the
        card's serif (the big number, the dollars, the ledger's values), a row of dashes between
        a name and its value. The pictured WORD is a name, so it stays in Söhne. The tag's two
        notes became a ledger: the payout's date and what it brought, the word and what it earned.
      - **Token version 2** carries the stages and the cents; a version 1 token (a link already
        posted) still verifies and draws, without either. `EARNINGS_CARD_LOOK` is 2.
      - **Seen:** all three shapes at each stage from 0 to 5, the longest figures ("999.99B",
        "about $888.8M"), a version 1 link, and a test-network token (no dollars). Rendered
        locally with invented words and amounts. Not seen: the picture on X or in a cast.
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
    - **Outer Space is listed on the test network** (starl3xx, 2026-11-27: "i want to introduce
      it as a Shop item on Testnet for $5 USDC"). Item 2 of Base Sepolia's Shop: 5 test USDC, no
      supply limit (until it was capped at 5 the same day: #55), no end date. Sent with the owner's word, in three steps so that it never
      showed as a "Test item" card: `addItem` switched off
      (`0x3bf3fcdadb6e5643c87b0e50e1befefa47a8ea3dd52ce458d02cafad4eea52db`), the `shop_items`
      row, then `setActive`
      (`0xf951290d976b45dd923fb3d7a3c3b5ae4e9fe9cbfa67bed51e0fde55ec27c8a3`). The Bookshelf is
      still not listed.
    - **A scene is the player's, never the word's** (the same message: "users will be able to
      select it as a card face on any of their words... it doesn't travel with a card though
      (when it's for sale in the shop, it shows the stock face)"). That is how it was built:
      one purchase is for every word the profile holds; a pick is kept by profile and comes off
      when the word leaves it; a Shop scene shows only for a profile that bought it; so a buyer's
      card starts on the stock card. Nothing a buyer sees draws the seller's scene: the Market's
      rows and the word view show the letters, never a card. The one place a word for sale still
      shows its scene is the seller's own Today, Bag, and opened card. Asked whether that should
      change (stock for the seller too, or the Market drawing stock cards), the owner chose to
      change nothing.
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
      asking who owns the word and what their profile bought, on every card. (Still open now
      that Outer Space is sold: it costs test USDC only, so it waits for the owner.)
    - **My readings, not starl3xx's words:** the Shop scenes are not part of the 3-word unlock;
      the practice game has no Shop, so it has neither scene; the player docs say nothing of a
      Shop scene until it is listed (Outer Space is in them since its listing, without its cost:
      the docs can't read the Shop, and the owner can change what it costs).

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
    - **Part 5, one email a week** (`lib/notify/digest.ts`; `reminder_prefs.email_cadence`,
      "weekly" or null). A player with an email chooses "One email a week" under "What to tell
      me". It stands in for the EMAILS that can come every day (`DIGESTED_KINDS`: the daily
      letter, payday, the deal alert); a push is not changed. A word about to go hungry and a
      jackpot win still come at once (they can't wait a week), and so do a sale and a bounty share
      (rare, and the player's own business). The digest says the week: what the player's words
      earned (that week's seven days and that week's bounty, counted as the Earnings sheet counts:
      paid or still on its way, never a dead share, so a share the payout reaches a day late is
      not left out of every digest), what they sold, and which staked words are hungry or peckish now. A week with
      nothing in it sends nothing. A line for a reminder the player turned off (hunger, a sale)
      stays out. It goes out in the keeper's `notify` job on the first day of the next week,
      after `payout` (and the day after, for a failed run), once per week under a send-once mark,
      only to a confirmed address with email on: an unsubscribe stops it. My reading of "in place
      of daily emails": opt-in, default "each one as it happens", so nobody's email changes
      until they choose.
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
    - **Part 4, one corner for every card.** "Everywhere the cards are pictured in the app and
      downloads and *anywhere*, we need to make sure they have consistent round corner sizes...
      find the ideal corner radius for every size we use." Then: "2.6% is the way to go."
      - **What it was.** A fixed 16, 12, or 8 px, set by whatever box happened to clip the card, so
        a small card was far rounder than a big one. Measured in the running game, as a share of
        the card's width: 2.1% on the share page (computer), 2.3% in the scene sheet's preview,
        3.1% for an opened word, 3.3% on Today, 3.8% in the Bag, 4.5% on a phone's Today, 6.9% in a
        phone's Bag, 7.1% in the scene picker. The server's pictures drew 2.3%, the video 2.5%, a
        cased card 1.7%. No shared value existed anywhere.
      - **Why 2.6%.** The frame's own shapes give it (`lib/cardArt/looks`, `CARD_CORNER`). Its
        outer line is 13 units in from the edge with a corner of 18, on a card 1,200 wide: it runs
        parallel to an outer corner of 31 units, 2.6%. Its corner pieces (a corner of 8 at the same
        13) need 21 units, 1.75%. Between the two, everything in the frame keeps its room; above
        about 3% the corner crowds the pieces, and at 6.9% it cut into them.
      - **How.** In the game, `--card-r: 2.6% / 4.6222%` and `.card-corner`: two percentages of the
        box itself (its width, then its height; a card is 16:9), so it needs no container. Every
        box that clips a card takes it, never a pixel radius or a `rounded-*` class. The server's
        pictures and the video's shader read `CARD_CORNER`. The back's frame lines run parallel to
        the corner (the corner less each line's inset), in the game and on the back's picture;
        they had radii of their own, which stopped following the card under 364 px and over 636.
        `CARD_LOOK` is 8.
      - **Measured after,** in the running game on a computer and a phone: 2.6% in all eleven
        places (13.6 px on a 522 px card, 4.5 px on a 174 px one, 2.9 px on a 113 px one).
      - **The ink outline stays** 3 px (2 px on a thumbnail). The review page said it should
        scale too; it shouldn't: it is the game's own line weight, the same line as the placard
        under Today's card and the buttons'.
      - **Not cards, so not changed:** the placard, the ring round the Bag's "today's word" card
        and its caption, the video preview's box, the earnings picture's preview.
      - **`tests/card-corner.test.ts` holds it:** the number against the frame's shapes, the CSS
        value, each rule that takes it, the wrappers, the pictures, and the shader.
      - **Seen and not seen (part 4):** the game measured and looked at in headless Chromium at
        1280 and 390 px. No real phone. The pictures and the video were not drawn again here.
    - **Part 5, the video's back says what the card says.** "The downloaded video cards also
      don't include all the info that's on the card on the screen... is that intentional?" Partly.
      Then, of the back the review page proposed: "I like your proposed back."
      - **What was left out on purpose** (a stranger watches the video, so the back never says
        "you"): "Yours since" is now there as "Held since", the day the word reached its holder's
        profile. "Earned so far" stays out: an amount a player earned is only ever shown from a
        signed record (#38). "Staked" stays out: it changes by the day, and a posted video stays.
      - **What was missing for no reason is there:** about what it earns a day, what it costs to
        make, whether the jackpot drew it, its token, the stage's pips, and Legendary's corner
        scrollwork (and the gilding, part 3). `lib/backPicture` words them; a fact that couldn't be
        read is left out, never a dash: a picture can't be asked again.
      - **All of it is the chain's** (`lib/backPictureFacts`): the word's story, the game's prices,
        and the shared world. The world moved out of `/api/world` into `lib/worldSnapshot`, so the
        route and the picture share one minute-old scan. How many letters are UPPERCASE is the
        chain's count for the earning and cost lines, never the link's casing: a link can't make
        a lowercase word look like an earner. Every read has a short wait, and nothing holds the
        picture up.
      - **A kept world rather than none** (`worldSoon`; Bugbot on #255). The world is scanned at
        most once a minute, and a scan can take far longer than a picture can wait. A picture that
        waited for it lost, and was drawn without its facts, though a good world a few minutes
        old was in hand. So the picture takes a kept world up to a quarter of an hour old at once,
        and a new scan is started for whoever asks next. Older than that, or none: the scan, for
        four seconds, then the picture without those facts.
      - **Not changed:** the "Case" line still follows the link's casing, as the front does.
      - **Seen and not seen (part 5):** the back drawn by the real route with stand-in chain
        answers. Not seen against the test game's chain: check GLYPH's video after the merge.
    - **Part 6, the holder's picture, stamped on the back.** "How can we feature an owner's PFP on
      the back of the card (if they have a PFP)? ... maybe as a slightly rotated circular stamp
      somewhere? (UI and share video)". Then: "one ink, engraved ring beside the number, and yes
      they can turn it off."
      - **One ink, in an engraved ring.** The stamp is not part of a letter, so it is drawn like
        the card: the picture in the material's line colour (black stays black, white becomes the
        ink), in a rosette from the engraving kit, turned 8 degrees (`cards/stamp`,
        `cards/CardStamp`, `.cb-stamp`).
      - **Beside the number**, in the number's own line, so it follows the digits at every size.
        The right half of a full back is facts from top to bottom, and the card's turn button is
        in its top right corner, so the left half is the only free place. A card with no number
        yet takes the top left corner; a thumbnail sets it over the pressed seal.
      - **Always the player's own picture.** A back shows only for the player's own words, so the
        game draws the picture its profile shows (Farcaster's or X's). No picture, no stamp, and a
        picture that fails to load takes the whole stamp with it.
      - **Theirs to turn off:** "Show my picture on my cards", in the profile, shown only to a
        player with a picture. **Kept on the device, not on the server:** the stamp is only ever
        drawn by the player's own browser (their own backs, and a video they make themselves), so
        there is nothing for a server to obey, no table, and no migration to run. A player with two
        devices chooses on each.
      - **In the video,** the player's browser draws the stamp onto the back's picture before the
        card turns (`loop/makeLoop`, `stampedBack`), with the one ink worked out pixel by pixel,
        since a canvas has no blend a browser can be trusted to have. **No server fetches a
        picture.** The review page said the video would need a guarded server fetch; it doesn't:
        the picture is asked for openly from the player's browser, and a site that doesn't allow
        its pixels to be read gives no stamp in the video (the game's back still shows it).
      - **The video's stamp sits where the back's PICTURE says its number is** (Bugbot on #257).
        The picture reads the card's number itself (the chain, with a wait, kept for minutes; none
        where there is no chain), so the game and the picture can differ. The picture says in a
        header whether the number is on it (`x-card-numbered`), and the video reads that with the
        picture's bytes. A picture that doesn't say gets no stamp.
      - **The holder's picture can't hold a video up** (the same review). It is asked for beside the
        card's two faces, for at most four seconds, and stops when the sheet closes
        (`loop/loadImage`). Late, refused, or unreadable: the video is made without the stamp.
      - **Not built:** a "Held by" line on the video's back. The owner approved the back without it.
      - **Seen and not seen (part 6):** the stamp at every size on the review page, in the same
        styles. Not seen in the game with a real picture (the practice game has no linked account),
        and no video was made with one.
    - **Part 7, the letters live in the video.** "The eyes and blinking and subtle movement is
      *chef's kiss* BUT: this doesn't come across in the downloaded video, which I feel robs a
      little bit of the 'life' of the cards... can you fix that?" Then: "yes", and "i like 'a
      little deeper' for the videos".
      - **Why it was still.** The video turned two pictures, the front and the back, each drawn
        once by the server. A picture can't blink.
      - **Now the front is put together again for every frame** (`cards/loop/liveFront`): the
        server's picture of the card without its letters (`?face=1&letters=0`, the scene, the frame,
        the ribbon), and over it the letters, drawn by the game's own rig. The rig draws each
        letter once as one drawing (`flat`, held still); that drawing is cut into its layers by
        name (`data-layer`: floor, rings, legs, body, top), each kept as a picture, the body once
        for each thing its eyes can do. A frame only places pictures. So the video's letters are the
        game's, not the server's copy of them: a gilded word wears its gilding, a rarity its
        material.
      - **The life is written, not random** (`cards/loop/score`). The game's runs off a timer and
        a random number; a video must be the same on every device and must lead from its last frame
        into its first. Every motion takes a time that divides the six seconds: a breath takes 3 s
        (the game's 3.6 s doesn't fit). A letter blinks and the next one catches it; the last
        letter glances along the word; the card turns; and as the front comes home the word blinks
        along its length, a letter at a time. Nothing is scored for the time the front faces away.
      - **The breath is deeper than the game's** (4.8 units for 3): the video is small and gets
        compressed, and at its size the game's breath is under two pixels.
      - **A video is always made.** If the living front can't be drawn (a piece doesn't load, a
        browser can't read one back), the still picture of the front is used, as before.
      - **A piece stands alone, so it brings what it points at** (`pieceOf`). A piece is a
        picture of its own: no page around it, none of the drawing's other layers. In the page a
        layer may point at a gradient another layer defines (the Holographic foil and a rarity's
        glow are defined in the body's layer, and the rings point at them), because an id is the
        page's. Alone, a paint that points at nothing draws nothing: a Holographic UPPERCASE
        letter would have had no rings in the video. So every piece carries the drawing's
        definitions, names its font outright, and has nothing in it that runs on a clock.
        `tests/living-video.test.tsx` holds this for six rarities, four stages, and both cases:
        every paint, clip, and filter a piece names is inside it; no value comes from the page;
        every class it carries only MOVES things in the game (a list in the test: a new class in
        the rig's drawing must be sorted there).
      - **The font is asked for first.** A picture of a drawing can't see the page's fonts, so
        Söhne is put inside each piece. Before any letter is drawn, a line of text is drawn with
        the font and without: they must differ. It is asked a few times (older Safari drew a
        piece before its font was ready); if the font never comes there is no living front, and
        the still picture is used. A letter in the wrong font is worse than a still one.
      - **The front's letters wear the stage the GAME shows; the back's picture reads the chain.**
        The living letters are the ones on the player's card, so they take the word's stage from
        the game, which reads it from the chain. The server reads the same chain for the back
        (and the address names the stage, so a kept answer is read again). So the two faces agree
        in the real game. Two cases where the back says LESS than the front, never something
        else: the practice game (the server knows no chain, so a practice video's back has no
        ascension line and a plain rack), and a chain read that fails (a fact that couldn't be
        read is left out). Nothing a link says is drawn, as before: the letters come from the
        player's own game, and the file is the player's own.
      - **Is the video's letter the game's letter?** Drawn side by side at the same place and
        size (one letter at rest; the game's rig held still in a page with the game's styles),
        in Chromium and WebKit: a Mythic Holographic UPPERCASE letter, Legendary Gilded 4, Rare
        Gilded 1, Uncommon Holographic lowercase, a plain Common, a plain Mythic. Under 1.4% of
        the drawn pixels differ, all at soft edges (the piece is drawn at twice the size and
        scaled down); at most 0.08% differ strongly.
      - **Measured in the real game** (practice mode, this Mac, headless, the dev server's
        pictures warm): Chrome 3.3 s living and 3.9 s still; Chrome slowed four times, 3.8 to
        5.1 s living and 4.1 s still; WebKit 4.9 to 5.4 s living and 4.3 s still. Files: the
        same size in Chrome (3.1 MB), 2.2 MB against 1.7 MB in WebKit (moving letters take more
        bits). A five-letter word's pieces are drawn in under 0.1 s.
      - **Seen and not seen (part 7):** real videos made in the practice game in Chrome and in
        WebKit (VIVID, Gilded 1): a letter mid-blink at 0.54 s, the last letter glancing at
        1.2 s, the word blinking along its length at 5.4 s, the gilding and pips on its letters,
        no error, and the still front never asked for. With the letterless picture refused, the
        still front was asked for and the video was made. Not made in real Safari or on a
        phone, and not for a Holographic word in the game itself (the practice game has none):
        that one was compared letter by letter, above.
    - **Part 8, what is around a letter in the game: the confetti, the glow, and the ascend
      sheet's rays.** The rule (starl3xx): "anything on the letter/body should be its existing
      colorful / flat design; anything NOT on the letter/body should be in the card style". The
      review page listed these three as the next to change and pictured none of them, so **their
      drawing is my reading**, kept faint as the owner asked of every effect round a card.
      - **Confetti** (`TileCharacter`, `Confetti`): small engraved stars, beads, curls, and rings
        in the cards' two inks (ink and gold). It was sixteen flat chips in five colours.
        **Each piece is a small drawing of its own**, and its fall and turn run on that drawing.
        The chips looped inside the top layer, which made WebKit redraw the whole layer on every
        frame. A whole-letter layer for each piece would keep sixteen letters' worth of store, so
        a piece's box is its own size (16 units), placed by percent, and its fall is in percent
        of its own box. In one drawing (the docs' pictures, which move) there are no layers: each
        piece is a group, with an unseen square that gives it the same box.
      - **The glow behind a Legendary or Mythic tile** (`TileFinish`, `FinishAura`; shape in
        `tileShapes`, `haloPath`): an engraved halo of fine rays in three lengths, all the way
        round the tile. It was a rounded box filled with a soft radial gradient. It stands 3 units
        off whatever the tile wears (a lowercase tile's outline, the pale ring, the gilding), and
        never reaches past 28 units from the tile's edge: in a word two tiles' edges are 56.4 units
        apart, so two neighbours' halos never cross. A tile in wide gilding has less room, so its
        rays are shorter in the same proportions. Its ink is between the material's light and its
        engraving shade, so it reads on paper and on a dark scene. Still; no moment.
        **It is under the legs of any letter that has legs, lowercase too** (Bugbot on #263): as
        a soft blur the glow faded out before it reached the legs; as line work, drawn with the
        body, its rays lay across their tops. The layer under the legs (named "rings", which the
        share video cuts by) holds an UPPERCASE letter's rings and a rare letter's halo.
        **The server's own letter draws the same halo** (`app/_og/tile`, from the same shape and in
        the same ink; Bugbot on #263: it kept the soft glow, so link pictures and the video's still
        front no longer matched the game). A tile on a rack has none there, as in the game (the
        server drew a glow on those before). `CARD_LOOK` 9.
      - **The ascend sheet's rays** (`lib/cardArt/glory`, `.asc-rays`): an engraved glory, the
        drawing behind a raised letter sized for a whole word: fine rays in three lengths between
        twelve wedges. It was a flat gold fan (a conic gradient). One still picture, built as a
        string like every scene, given to the styles as `--asc-glory` and turned as one element,
        as before. Its middle hides behind the word, so it has no ring of beads (a ring showed as
        two odd arcs of dots between letters). Holographic: the foil's colours seen through the
        same lines, deeper than the foil's pastels, which a fine line loses on paper.
      - **The light behind the landing page's big letter** is the same glory, still, its far ends
        faded. It was a soft gold glow. The landing page's cheering letters take the new confetti
        from the letter's own code. **Not changed, and the owner's to decide** (the review page
        set these apart as bigger pieces): the landing page's hero stage (a flat curtain,
        spotlight, and floor, where the engraved Stage scene exists), the Market's letter shelf,
        the icon groups beside letters in the intro and on the landing page, and the jackpot's
        five flat "?" tiles. **Left as they are:** the docs' pictures' paper panel and line arrows,
        which are the game's interface style (the ink outline and offset shadow of every card and
        button), not scenery round a letter.
      - **Measured** (headless, this Mac, busy with other work; five letters holding hands, no
        random life). A cheering word in WebKit: 47%, 44%, and 33% of a processor core before
        (three runs), 13% after (three runs: 13.1, 13.0, 13.2). In Chromium: 49% before, 38%
        after; slowed four times, 109% and 113% before, 105% and 118% after (that measure is
        always near a whole core there). A Legendary and a Mythic word at rest, for the halo: in
        WebKit 4.7% and 3.8% before, 3.4% and 3.8% after; in Chromium a Mythic word alternated
        four times each way averaged 30.3% before and 29.9% after (single runs of one case there
        ranged from 19% to 50% today, so nothing under ten points can be told from one run).
      - **Seen and not seen (part 8):** the halo on paper and on dark, alone and in words, at 64
        to 190 px; the confetti on one letter and on a word, in Chromium and WebKit, in the
        running landing page (thirteen cheering letters), and in a docs picture, where it falls
        inside the one file. The rays behind a still word as the sheet lays them out, gold and
        Holographic, and in the real sheet after a try that landed (the practice game, WebKit:
        the third try). The halo where it is smallest: in card thumbnails 170 and 315 px wide
        and in rows of 16, 30, and 54 px, where it is a faint fuzz or nothing, and no two cross.
        Not seen: anything on a phone.
    - **Part 9, what is around a card and a letter in the pictures.** The same rule, for the
      pictures the server draws and the video. The review page listed these and pictured none,
      so **their drawing is my reading**, kept faint.
      - **The rack on a card's back** (`lib/cardArt/rack`): line work in the material's own line
        colour, like the frame and the seal. Its top face is ruled closer toward the back, the
        way a surface that runs away is ruled; its front is kept dark, under closer ruling; one
        bright line marks the edge the tiles stand behind. It was two flat tones with a drop
        shadow. One set of shapes: the game stretches the rack to the row and keeps every line
        one weight (`vector-effect`); the server's picture asks for the shapes in its own pixels,
        since its renderer is not asked to keep a stretched line's weight.
        The tiles on the game's rack lost their soft drop shadow too: the rack's ruling is their
        ground, and the server's picture never had one.
      - **The table a card lies on** (`lib/cardArt/table`; link pictures, saved pictures, the
        Telegram welcome, the earnings picture): a ruled ground, fine rays from behind the card,
        and two woven bands, in one lighter ink on the dark. It was a soft pool of light (a
        radial gradient). The old pool of light is kept the engraver's way: there is more line
        near the card and less toward the corners.
      - **The shadow under the video's card** (`loop/loopRenderer`, the shadow's shader): ruled
        lines in the shape of the shadow, each as heavy as the shadow is dark there, as under
        every letter. It was a soft blot. It is narrower than the blot was: a ruled line shows
        to its very end, and the blot's faint ends ran under the game's name in the corner. No
        derivative is asked of the device, so every device draws the same lines. **It is
        faint** (starl3xx, 2026-11-27, of the first one: "the shadow on the card video is way
        too dark"): its ink went from 0.5 to 0.16 and its heaviest line from 0.7 of a row to
        0.45 (`SHADOW_INK`, `SHADOW_WEIGHT`; a test holds them at or under 0.2 and 0.5). The
        numbers are my reading of "way too dark", looked at on the frame he sent and mid-turn.
      - `CARD_LOOK` 10. The earnings picture's address carries it too.
      - **Seen and not seen (part 9):** the game's back with the new rack (an opened Legendary
        word, WebKit); the server's back drawn by the real route; the link picture and the tall
        saved picture from the running routes; the video's shadow at rest and lifted, in Chrome
        and WebKit, from the game's own maker; the earnings picture, drawn by its real route from a
        made-up snapshot signed with a throwaway key; a Bag thumbnail's rack at 170 and 315 px.
        Not seen: anything on a phone.

49. **Packs come by mail, built in parts** (starl3xx, 2026-11-26: "the letter upgrade roll
    animation is amazing, as is the ascension upgrade. what's missing now is anything at all
    related to ripping packs: it's just click and wait until it's revealed"). The proposal page
    "Ripping Packs" showed three playable options with the game's own letters. The owner chose
    "By mail": letters arrive in an envelope, and each step the chain takes is a mark on it. One
    entry: each part is added here as it ships.
    - **Decided on the page, in the owner's words.** "'By post' is the clear winner", built "with
      one loan from each of the others (dozing and the nervous letter)". "We should use 'Mail'
      instead of Post." The envelope says "@username (with the @) if they have one", else "For
      you", then "from the Lexigotchi Mint", and under the stamp "Contents: 1 letter" or 5
      letters. The postmark's number is "one series for all mail". "Yes the server can send."
      "Yes, the pack looks great with serif lettering." Sound: "I like the Paper and ink sounds
      for everything but the letters popping up and the rare sound", then "wooden tile and
      typewriter's bell", and "sound off by default". "No, letters should not arrive in the same
      way via the Market."
    - **Part 1, the server opens the pack.** A pack was the last purchase with a second wallet
      prompt (rolls lost theirs in #14, ascension in #44), and that prompt's data named the five
      letters before the game had shown them. Now the game posts `{ commitId, relay: true }` to
      `/api/mint/reveal`, and the relayer key sends `Letters.reveal` (`relayLettersReveal`). The
      contract allows it: `reveal` checks the signer's signature and mints to the commit's stored
      buyer, whoever calls.
      - **Why not one send, as the free daily letter does.** The daily's commit and reveal ride one
        transaction because its draw is fixed per identity and day. A paid pack's draw is fixed per
        commit, and a commit's number isn't known until it lands: a pre-signed reveal would show
        the letters before the price was paid, and a buyer could decline the packs they didn't
        like. So the daily keeps its bundle and is not relayed; a pack, a free pack, and a daily
        whose reveal didn't ride its commit are.
      - **The answer is the chain's, never the draw's.** "mined" and "already" name the letters
        from the reveal's own `Revealed` event (`relayOutcome`, tested on a real Sepolia pack
        reveal). The stored draw can't answer for an opened pack: it is served again only while it
        can still be minted, so after a letter caps out it would name five different letters.
        "pending" and "reverted" name no letters and carry no signature.
      - **Only an answer with no `relayed` field reaches the wallet** (`lib/onchain/packReveal`,
        pure, tested): once a reveal is broadcast, a second from the wallet would only revert.
        A lost answer is "ask the chain", as for ascension (`answerLost`). A broadcast reveal is
        waited for (`commits(id).revealed`), then the route is asked once more.
      - **A commit seen revealed is never open again** (`revealedPacks`, `openPacks`): "Rip
        another" commits seconds after a reveal, and a node a block behind would hand the old pack
        back as the new one and leave the new, paid commit unopened. Rolls keep the same set.
      - **Without `relay: true` the route answers exactly as before,** so a client bundle from
        before the deploy keeps working, and a missing or unfunded relayer falls back to the
        wallet's own reveal.
      - **Cost:** the relayer pays each pack's reveal. It mints five letters, so it costs a few
        times a roll's reveal.
      - **Proven and not proven (part 1):** `scripts/pack-relay-fork-check.ts` buys packs on a
        local fork of Base Sepolia and asks the real route to open them: the deployed Letters
        accepted the relayer's reveal, the buyer held exactly the letters the answer named, the
        send carried the builder code, a second ask sent nothing, the old no-relay path still
        minted, and an unfunded relayer handed back the signature. Not proven there: "already"
        naming letters (the public RPC behind the fork refuses the log range; the production RPC
        serves the same range for the daily letter's lookup). Not tried: a real wallet in a
        browser. The sheet is unchanged in this part: "Fresh pull" still shows the letters.
        After the merge, production answered `relayed: "already"` for the fixture's pack (commit
        177) with its five letters from the chain, and sent nothing.
    - **Part 2, the envelope** (`sheets/MailSheet.tsx`, sheet kind `mail`; rules in
      `mail/mailFlow.ts`, pure, tested; art in `lib/cardArt/mail.ts`). A paid pack and the free
      pack come by mail. The daily letter keeps the old "Fresh pull" sheet until its own part (my
      order, not the owner's: the daily's commit and reveal ride one send, so its envelope needs
      its own waiting rule, and a predicted number must never be printed).
      - **The tap is answered by the envelope, and each mark on it is a true step.** The sheet
        opens when the wallet does. The stamp goes on when the commit is sent ("Paid. It's in the
        mail."; a free pack is never "Paid"). The postmark and its number land when the commit is
        on chain. The strip can be torn only when the chain says the pack is revealed, also when
        the wallet sent the reveal itself. If the wallet send fails, the envelope leaves.
      - **The number is the commit id plus one** (`mailNumber`): the contract counts packs, free
        packs, and daily letters in one list from zero, which is the owner's "one series for all
        mail". It starts again on a redeploy. Practice has no chain, so its number is the player's
        own count (my reading).
      - **The order letters come out in is the chain's, except that the best comes last**
        (`revealOrder`): plain letters as minted, then a letter that finishes a word, then a rare
        one (the six rarest letters, as the rig and the old sheet mark them; the rarest of them
        last). Only a rare best letter gets the shake, the shy
        peek in the rig's nervous state (the loan from option C), and sparkles. "Finishes a word"
        is the game's one rule (`lib/wordNeed`): the word was exactly one letter short before.
      - **The loan from option B:** on a long wait the eyes at the window close one by one ("They
        nodded off. Any second now.") and open when the letters exist.
      - **The count** names what came out, the rarity from the Mint's own odds (`letterOdds`,
        never claimed without supply), and the word the letters newly finish, with its claim.
        "Newly" is `newlySpellableWith`, the bought-letters rule for several letters at once:
        measured from what the bag held before, and nothing is named until the bag shows every
        letter, nor while the world's owners load.
      - **The purchase outlives the sheet.** Closed mid-way, the envelope opens again when it
        lands (the reducer's `arrive`), or a toast says "Your mail is here." when another sheet is
        open. A pack that lands while a different envelope is in hand is kept and said in a toast.
      - **Where unopened mail lives** (my reading; nothing depends on it). The server now reveals
        at once, so the chain has no "unopened" state for a pack that arrived. An envelope that
        was never torn is a record in the browser (`lib/mailbox`: the chain, the Letters address,
        the wallet; the newest 12), written when the pack can be torn and removed at the tear.
        Its letters are in the bag whatever the record says; another browser shows no envelope.
        The card on Today and Mint ("Your mail is waiting") counts these with the commits the
        server still has to open, and opens an envelope that only needs tearing first.
      - **The short version**: from the TENTH envelope torn in one sitting (`QUICK_AFTER`),
        plain letters come straight out, close together; the best one still gets its peek. A tap
        hurries any envelope. (It started at the fourth, my own reading of the proposal's "by the
        tenth pack". starl3xx, 2026-11-27: "how come the pack rip happens super quickly
        sometimes? in terms of the letters popping up". Measured in the practice game: about
        6.4 s for five letters on the first three envelopes of a sitting, about 1.2 s from the
        fourth. He chose the proposal's number: "yes, move it to the 10th pack". A sitting is a
        page load, and every piece of mail torn counts.)
      - **House rules kept.** A tile never changes size: the envelope's styles move and turn, and
        a test fails on a scale. The envelope is still pictures in the cards' engraving, each
        moved whole; the only loops are the pull tab's nudge and the blink (a swap in steps), each
        on a whole picture. All travel sits behind `prefers-reduced-motion: no-preference`; with
        reduced motion the letters are simply out. The drag writes straight to the element.
      - **Cost at rest, measured in the practice game** (a share of one core, my own browser's
        processes only): WebKit, the sealed envelope 3.6%, the count 7.7%, against 6.8% for Today
        with a word on stage. Headless Chromium (it draws in software): 11.5% and 36.6%, against
        41.9% for Today.
      - **The order and the tags come from what the chain minted, not from the bag's read**
        (`bagWithMail`): the game's read of the bag is often seconds behind a reveal, and the tear
        comes inside them, so "this k finishes FUNKY" is worked out from what the bag held plus the
        piece's letters. Only the count's claim waits for the bag itself (the claim checks it).
        For the same reason "Rip another" measures the next piece from a bag never smaller than
        what the last piece left in it (`hadWithOwed`, for 60 s or until the read shows it), or
        the next envelope would call the last one's letters new again. It errs high, and a high
        count names nothing as new.
      - **An envelope is never left mid-step** (`mailGuard`). If the flow throws before the commit
        is sent, the envelope leaves and a toast says nothing was spent. If it throws after, the
        envelope says the pack is paid for and safe, and the open commits are read again on a
        stagger so the card shows it (they were re-read only on focus). The RPC's own error goes to
        the console, never into a toast. No "Pack sent" toast: the stamp says it. A commit still on
        its way is not counted as waiting mail (the card's Open could only say "Still working on").
      - **Seen and not seen (part 2).** In the practice game, WebKit and Chromium, at 360, 424,
        768, and 1280 px: the tap, each mark, the tear by tap and by drag, closing mid-way, the
        waiting card, a claim at the count, reduced motion (nothing animates after the tear), and,
        with temporary local changes that were not committed, a long wait with the dozing, a pack
        with a q, the numbers 4,512 and 123,456 in the postmark, and a 30-letter handle (cut with
        an ellipsis, clear of the postmark). **With a real wallet path, on a local fork of Base
        Sepolia** (Anvil's public test keys, the game's server with no database; the browser's
        wallet sends through the game's own send path): a pack with one confirmation and the
        server's reveal (2 sends with the approval, 1 after), "Rip another" straight after a
        reveal, closing while "Paid" and seeing the sheet return by itself, closing untorn and
        opening from the card, a refused wallet prompt (the envelope leaves, "Cancelled"), and the
        page losing its chain reads right after the commit (the envelope said the pack waits, and
        the card then opened it through the server). It also showed the route answering "already"
        with a pack's letters on a fork, which part 1 could not. Not driven: the free pack (it
        needs a verified identity), a pack opened for a linked wallet, a wallet changed while a
        pack is on its way, a smart wallet's batched send, a real phone, and a mini-app host. The
        chain store's glue is still under no automated test; its rules are the tested pure parts.
    - **Part 3, the daily letter comes by mail** (the same sheet with one letter: a narrower
      window, "Contents: 1 letter", "Your letter"; it is free, so it is never "Paid"). The old
      "Fresh pull" sheet and its sheet kind are gone.
      - **It is not the pack's flow with a count of one.** The daily's commit and reveal ride ONE
        send, with the commit's id predicted by the server. After the wallet says "sent", both
        may have landed, or the commit alone (the second prompt refused, or another commit took
        the predicted id so the reveal named the wrong one), or nothing (a batch that goes all or
        nothing, reverted whole). The wallet can't tell them apart. So every mark follows the
        chain (`lib/onchain/dailySend`, `dailyPlan`, pure, tested):
        - **the number** is given only once the chain says that id is this wallet's one-letter
          commit. The predicted id is never printed: with a pack bought in between, the envelope
          got No. 193 where the prediction said 192;
        - **the tear** waits for the chain's "revealed", and the letter is the one the chain
          minted (the route's "already" answer), never the bundle's own copy;
        - **the server is asked to open the commit only when the wallet's reveal can no longer
          land:** it was refused, there was no bundle, it named another id, or 15 s passed. Two
          reveals for one commit means one reverts;
        - **the envelope leaves only when the chain says the daily was never used**
          (`dailyUsed`) AND the send itself is known to have failed (it mined and reverted, or
          the wallet says so: `traceSend`). Then the "claimed" note is taken back and Pull
          returns. The wallet accepting a send is not the chain including it: a send that is only
          slow is "unsure", the envelope says it is taking a while, and the note stays (Bugbot on
          #276);
        - **when the chain can't be read for a whole minute,** the envelope says the letter is
          safe and will be waiting, and that is kept: an unrevealed commit shows on the card by
          itself, and one the bundle already revealed is looked for again (10 s to 4 min later)
          and made mail to tear. After that its letter is simply in the bag, which is why the
          envelope's words say "in your bag, or waiting for you on Today".
      - **Which letter is the envelope's to say, as a display rule** (`lib/dailyNote`
        `dailySealed`, pure, tested). The letter goes on the stored note at the send, as it did
        before the mail. The tile beside "claimed" on Today and Mint is hidden only while a sealed
        one-letter envelope stands in this browser: in hand and on its way or waiting to be torn,
        kept as mail, or a one-letter commit the card still has to open. When the note names its
        envelope, only that one counts, so an older daily left unopened never keeps today's tile
        blank. No toast names the letter at the tap. The note may name its envelope, so its tear writes the letter the chain minted
        over the one the send was made with, and never stamps the note again (tearing an old
        envelope must not mark today as claimed).
      - **The rule I tried first, and why it is gone.** The note was written with NO letter, and
        the tile waited for the tear. Then a note with no letter had to find its envelope again
        after every reload, late open, or lost connection: first a link in memory, then a stored
        link, then a search of the chain, then retries, then a watch on unrevealed commits. Bugbot
        found a gap in each of five rounds, all in provider code that no test reaches. Hiding is a
        matter of what is on screen, so it is now worked out from what is on screen. An envelope
        lost to a reload costs the ceremony only, as it does for a pack; the tile and the letter
        are never lost with it.
      - **A daily's send that is still running after a wallet switch** writes nothing to the new
        wallet's note (it remembers the note it began under).
      - **Mail opened late says less** (`Mail.plain`, `hadFor`). When the card opens a commit
        that was already revealed, the bag read at that tap may count its letters already. Its
        letters then get no tags, none is called new, and no word is named: counted twice, a
        letter would be said to finish a word the player can't spell. The same holds for letters
        that went to a linked wallet.
      - **The card draws what waits:** one pair of eyes for a daily letter, five for a pack
        (`nextMail`).
      - **Seen and not seen (part 3).** Practice game: the one-letter envelope at 424 px, each
        step, the card, and the tile appearing only after the tear (with a temporary local switch
        for the Pull button, not committed: a plain browser has no linked identity). **Real-wallet
        path on a local fork**, with the daily route's answer made by the route's own signing
        code and the fork's test signer: both landing; the reveal prompt refused (the server
        opened it); a pack bought between the voucher and the send; no bundle; and the page
        losing its chain reads right after the send (the envelope said the letter waits, and ten
        seconds after the reads returned it could be torn). In every run the letter the envelope
        gave was the letter the chain minted. Also at 360 px (WebKit) and 768 px. And one run with
        everything together, after part 2's fixes were merged in: a pack left untorn, a second
        pack closed while "Paid" on a slow chain, the first opened from the card meanwhile (the
        card kept saying one piece waits until the second landed with "Your mail is here."), the
        daily letter pulled with two packs waiting, then both packs from the card, the older
        first: 11 letters on chain, five wallet sends, none of them a reveal. Not driven: the
        real `/api/mint/free-daily` (it needs a verified identity), an atomic batch that reverts
        whole (the test wallet sends two transactions, never a batch), a real phone, a mini-app
        host.
    - **Part 4, the mail's sounds** (`lib/sound.ts`, `mail/mailCues.ts`, `useSound.ts`,
      `SoundToggle.tsx`). The owner's picks: "Paper and ink" for the drop, the stamp, the
      postmark, the rustle, the tear, and the word; "A wooden tile" for a letter hopping out; "A
      typewriter's bell" for the rare one; and "sound off by default".
      - **Off until the player turns it on, and off means off.** The choice is kept per browser.
        With sound off no sound file is fetched and no AudioContext is made (tested, and checked
        in both engines).
      - **The files are in this repository, by the owner's word** (starl3xx, 2026-11-27: "you
        can incorporate the sounds"). They were held back first. ElevenLabs' sound-effects terms
        (read 2026-11-26; the account is on the paid Creator plan) allow commercial use built
        into a game, and forbid making the output available "as isolated audio files". A web
        game always serves its sound files, which is the ordinary case. But this repository is
        public, and eight mp3 files in it are files anyone can take. So the code shipped dark
        (#287) and he was given three ways: commit the eight files, said to be the simplest and
        public in the repository; serve them from a storage he would name
        (`NEXT_PUBLIC_SOUND_BASE`); or ask ElevenLabs in writing first. He answered with the
        words above and named no storage, and the game fetches the files from a public address
        on either route. **My reading: commit them.** That can't be undone (a public history
        keeps them), so it is written here as a reading. `SOUND_READY` is still worked out at
        build time (next.config.mjs): the files are in the build, or `NEXT_PUBLIC_SOUND_BASE`
        names where they are served from, and a build with neither shows no switch and runs
        nothing here. `tests/sound-files.test.ts` holds each file to the hash below and every
        cue to a file: `SOUND_READY` looks at one file only, and a missing one would be a cue
        that is silent with nothing said.
      - **The files are the takes the owner heard:** the bytes the proposal page played, taken
        from its `source/sounds.json` (kept with the artifact, with the originals as
        generated). 86 KB in all. First 12 hex digits of each file's SHA-256: drop
        `81d6dda2b38f`, stamp `9dd088eb3d7b`, postmark `d88493fade0a`, rustle `904d9bf8a324`,
        tear `01925566caec`, word `9b04df2872e3`, hop `88e143a9d884`, rare `5f0d76e1fc1a`.
      - **A cue comes from a step, never from what the envelope shows when it appears**
        (`cuesForStep`, pure, tested). The sheet's stage is made again for every piece; a stored
        envelope appears at "ready" and one that came back by itself appears mid-way. Read from
        the first look, each would press its stamp and postmark a second time. A piece being sent
        now drops in; a piece that appears further along is silent.
      - **One cue a step for letters.** A tap that hurries five letters out, or reduced motion
        showing them together, is one sound, not five at once.
      - **My readings, his to change:** a hop's pitch climbs 7% with each letter out (as on the
        proposal page); the bell rings ONCE, for the rare best letter that got the shake and the
        shy peek (the page rang for every rare letter, and the sheet marks only the best); and
        there is a second, small switch under the envelope, beside the one in More, because that
        is where the sounds are.
      - **The Sound card is in the profile too** (added with the files). The desktop rail has no
        More, and the small switch is there only while an envelope is open, so a player on a
        computer had nowhere to turn sound off. The browser reminders are in the profile for the
        same reason.
      - **A browser plays only after a tap,** and the cues fire later, from timers and the chain.
        So while sound is on, every tap and key press wakes the context (`useSoundGestures`). It
        is suspended 1.5 s after the last cue ends, except while an envelope is on screen
        (`holdSound`): its stamp and postmark land when the chain says so, seconds or a minute
        after the tap, and a browser (an iPhone's above all) may refuse to wake a rested context
        without a tap. It rests when the envelope goes. A context that is not running is woken
        whatever its state is called: WebKit's is "interrupted" after the app was in the
        background (Bugbot on #287), and coming back to the page tries to wake it too.
      - **A cue that is waiting its turn asks whether the envelope is still there** when its
        moment comes. It was first cancelled when the component went, and React's development
        double mount "goes" and comes back at once: the stamp, a beat after the drop, never
        sounded there (found in a real browser, held by a test).
      - **Checked without ears** (I cannot hear them): a recorder in the page noted every buffer
        started, named by the file it was decoded from. In Chromium and WebKit: with sound off, a
        whole pack made no context and fetched nothing; turned on in More, one context and eight
        files, then drop, stamp, postmark, tear, five hops at 1, 1.07, 1.14, 1.21, 1.28, and the
        word, each once and in order, with the context running, awake while the envelope was on
        screen and resting once it had gone; and after a reload
        with sound saved on, nothing until the first tap, then the same cues.
      - **Cost with the sound awake:** the sealed envelope with sound on (the context running)
        against off, two sittings: WebKit 3.7% against 3.7% and 4.7% against 14.0% of a core;
        Chromium 5.8% against 6.4% and 9.9% against 6.5%. Run to run varies by more than any
        difference between the two (this machine is shared): nothing measurable.
      - **The bell,** with a temporary local pack (not committed), in both engines: a pack with a
        q played four hops and then the bell, once, at the moment the q stood out of the envelope
        (all five out, none peeking), not at the shake or the peek; a pack with a z and a q rang
        once too, and the z hopped.
      - **The dark state, which is what shipped first (#287),** in both engines: with no sound
        files present, More shows no Sound card, the envelope shows no switch, and a whole pack
        asked for no sound file and made no AudioContext, even with "on" remembered from another
        build.
      - **A file that failed to load is asked for again,** 30 s later at the soonest: one bad
        moment on the network at the first tap does not silence a cue for the page's life, and a
        wrong address does not make every tap fetch all eight again.
      - **Not done:** nobody has listened to it in the game; a real phone and a mini-app host
        (their sound rules are the strictest).

50. **Four bigger pieces, built in parts** (starl3xx, 2026-11-26, on the review page "Four Bigger
    Pieces"). The card-and-letter review (#48) set four places apart: the landing page's hero
    stage, the Market's letter shelf, the icons beside letters, and the jackpot's five "?" tiles.
    The page drew each as it is beside card-style proposals. One entry: each part is added here as
    it ships.
    - **His answers, as he gave them:**
      - "Yes to 1A, but note that there's currently an issue where the card part draws two
        borders, one for the card and one underneath it (I think)". 1A: the hero is the word's
        own card.
      - "yes to 2C". The shelf has no plank: one fine double rule. (I had picked the ruled plank.)
      - "yes to 3A, although I don't like the static cookie/circle thing in this (or They get
        hungry)". The letters act the steps out, with no icons, and without the letter's eating
        look in those two pictures.
      - "I like 4B - it reinforces that a card has to be held, not individual letters". The
        jackpot's secret word is one card, face down. (I had picked five tiles. **His reason is the
        rule to keep: what a player holds is a card, so a word is shown as a card.**)
    - **Part 1, a card and its shadow are one object** (the "two borders"). Built twice: the
      first time I fixed another line than the one he meant.
      - **What he meant.** Today's card leans toward the pointer (up to 3.5 degrees,
        `cards/useCardLight`). The edge under the pointer pulls in: by 3.5 px on a 504 px card,
        and by 7 px on the widest Today shows (735 px). The shadow stays flat on the page. It was
        the card's own `box-shadow`, and a browser never draws a shadow under the box that casts
        it, so it was hollow under the card: the page showed between the card's ink edge and the
        shadow. Two outlines, "one for the card and one underneath it".
      - **What I fixed first (#272), and why it missed.** I looked at the card at rest, found a
        hairline of the page between the border and the shadow at the rounded corners, and moved
        the shadow's cut 1.5 px under the border. That hairline was real and is gone, but it was
        not what he saw. He said so with a screenshot, the pointer on the card's corner ("still
        doing it BTW"). **The lesson: put the pointer where his was before deciding what a
        picture shows.** That first fix also put the shadow half a pixel off the card in
        Chromium (a 1.5 px inset makes half-pixel edges, and they snap another way than the
        card's).
      - **Now** (`.card-stand`, globals.css): the shadow is a solid shape of its own under the
        card, the card's size and corner, moved 4 px right and 5 px down, filled with ink.
        Whatever a leaning edge uncovers is the shadow in its own outline. There is no hollow, so
        there is no hairline at rest either.
      - **While the card turns over** the shadow is hollow, as it always was mid-turn
        (`.card-stand.is-flipping`: a `box-shadow` cut away 2 px inside the edge, whole pixels).
        The faces are edge-on for a moment and the page shows where the card was: a solid shape
        would stand there as a dark slab. Its outline is the solid shape's, so nothing moves as
        the turn begins and ends. A card that is turning does not lean.
      - **Tried and dropped:** ink under the right and bottom edges only (a border on two sides,
        then a cut shape). It hid the gap, but on a wide card the ends of the bands showed as
        small square steps beside the leaning corner. The whole shape shows only its own smooth
        outline.
      - **One thing it adds.** On a card wider than about 545 px (Today between 835 and 1,023 px
        of window, where the card is up to 735 px), a lean toward the left pulls the left edge
        in by more than the shadow's 4 px, and up to 3 px of the shadow shows along that edge:
        the border looks a little heavier there. It is the shadow, and it touches the edge (no
        second outline). On the 504 px card of a wide window it never shows.
      - **Where:** Today's card and its blank, the celebrate sheet's card, and the share page's
        card. The last three have the border and the clip on one box and the shadow on a box of
        its own around it, because a box that clips would cut the shadow off.
      - **Not changed, and open:** every card-like box and button in the interface (`.cel`) has
        a border and a `box-shadow` of the same ink, so the corner hairline is there. None of
        them leans. `.press` moves that shadow, so changing it is its own piece of work.
      - **Measured** (the practice game, pixel ratio 2, the pointer resting on each corner and
        edge of Today's card; scan lines across the card's edge, beside the pointer, on which the
        page shows between the card and the shadow): as #272 left it, up to 118 lines with up to
        5.5 px of the page, at card widths 352, 504, 712, and 735 px, in headless Chromium and in
        Chrome drawing with the graphics card; now none at any width, in either. At rest the
        solid shadow and the turn's hollow one differ only by the softening of a few corner
        pixels.
      - **Seen and not seen (part 1):** enlarged pictures of all four corners, leaning, before
        and after, at 504 and 712 px; the card held edge-on and mid-turn; the three still cards'
        corners at pixel ratios 1, 1.5, and 2 in Chromium and WebKit (no line inside the border,
        which a solid shadow would show through any gap). **Not seen: the lean in WebKit.** The
        headless WebKit here draws a leaning card almost flat in its pictures (the browser
        reports the same lean as Chromium), so it shows no gap before or after. Not seen: real
        Safari, a real phone (a touch has no pointer to lean to), the celebrate sheet in the
        running game.
    - **Part 2, the landing page's hero is the word's own card** (1A; `LandingPage.tsx`,
      `Stage()`). JAZZY's card as its holder would see it: the engraved Stage scene, the Mythic
      frame, and the ribbon that says one of one, with two letters already UPPERCASE. It was a flat
      stage built in the page: a valance of half circles, a soft spotlight, and a tan floor.
      - **One render at every width.** The old stage drew the word three times, at 58, 78, and
        96 px a letter, and showed one by screen width. A card sizes its letters to itself.
      - **The label is under the card,** as the placard is under Today's: nothing is drawn over a
        card's art but its letters. Its words are unchanged.
      - **The shape.** A card is 16 to 9, so the hero is shorter: at 1,280 px it is 484 by 323
        with its label, where the box was 484 by 406; at 1,024 px, 424 by 289; on a phone
        (390 px), 350 by 244.
      - **It stands on `.card-stand`** (part 1), with a shadow of 8 px each way, as on the
        review page and as this page's other boxes have. The game's cards have 4 and 5.
      - **Measured** (headless, this Mac, three alternating runs of 15 s, the old stage against
        the card, both moving): WebKit 19.9%, 33.5%, 28.1% of a processor core against 15.1%,
        27.2%, 29.9%; Chromium 35.9%, 37.3%, 39.9% against 38.5%, 35.7%, 49.9%. No difference I can
        tell from the noise.
      - **Seen and not seen (part 2):** the running landing page at 390, 768, 1,024, and
        1,280 px in WebKit and Chromium: no error, no sideways scrolling, the card beside the
        headline from 1,024 px and under it below. Not seen: a real phone.
    - **Part 3, the Market's letters stand on a fine double rule** (2C; globals.css `.mk-rule`,
      `LettersBoard.tsx`). The shelf was a flat tan plank between two heavy ink lines. It is an
      ink line 1.5 px thick with a fainter line under it, 5 px in all, as a card's frame is
      ruled. The tags are as they were, and each tag's string still reaches the rule. The shelf
      is 6 px shorter a row.
      - **One line a row, not one piece a slot.** The plank was a piece under each letter, each
        a pixel wider than its slot so that no gap showed between neighbors. With thin lines that
        pixel showed: at pixel ratios 1.25 and 1.5 the softened edge of the line was drawn twice
        there, a darker tick at every join (about 53 of 255 darker). Pieces exactly a slot wide
        left gaps at those ratios in WebKit (the page showing through the line). So the first
        slot of each row draws the whole row's line (7 slots wide on a phone, 13 from md), and
        every other slot keeps its place and draws nothing. The line lets taps through
        (`pointer-events: none`): a tap on it goes to the letter above it.
      - **The column counts are written twice**, in the grid (`LettersBoard`) and in the rule's
        width (globals.css). `tests/market-shelf.test.ts` holds them equal.
      - **Solid colours.** The lower line is the page's paper with 45% ink, mixed (`#928b7c`),
        never a see-through ink: the page's dots would show through it.
      - **Measured** (the practice game; 1,280 px at pixel ratios 1, 1.5, and 2; 768 px at 1.25;
        390 px at 2 and 3; Chromium and WebKit): at every join between two slots the line is the
        same as beside it, to 1 of 255. A tap on the line under the 5th, 10th, and 17th letter
        opens that letter, on a phone and on a wide screen, in both.
      - **Seen and not seen (part 3):** the whole shelf before and after at 1,280 px and 390 px;
        the joins enlarged at all six settings. `screen-market.jpg` in the player docs is taken
        again. Not seen: a real phone.
    - **Part 4, the jackpot's secret word is a card** (4B; `cards/FaceDownCard.tsx`,
      `screens/JackpotScreen.tsx`). It was five dark tiles with a "?" on each, and after the
      reveal the word as loose letters. Now:
      - **Before the reveal, one card, face down:** a back's stock and frame with the game's
        seal in the middle, and no number, facts, or letters. 240 px wide at most.
      - **After, the card face up.** A player who held the word, staked and fed, sees THEIR card:
        their scene, their cases, their gilding, the letters cheering. Anyone else sees the word
        in the plain scene, in lowercase, in its rarity's frame.
      - **The face-down card is given no word and no rarity,** so it can show neither. Its
        material is always the plain one (Common's). A back in the word's own material would
        tell every player the word's rarity before the reveal. **Open for the owner:** Common's
        material is the stand-in he saw on the review page; which plain material a face-down
        card wears is his to decide.
      - **No turn.** The face-up card arrives with the game's drop (it moves, it never changes
        size). A real turn from back to front is its own piece of work: the back and the front
        would be one card, and the front must not be in the page before the reveal.
      - **Where it shows.** In the game onchain the page never reveals the word by itself, so
        players see the face-down card all day. The reveal, the win, and the loss are the
        practice game's.
      - **The room it takes:** the jackpot's box is 347 px tall with the card, where it was about
        260 px with the tiles. Beside the bounty from `lg` each column keeps its own height.
      - **Seen and not seen (part 4):** the practice game at 390 px, 1,024 px, and 1,280 px in
        Chromium and WebKit: face down, after a win (the first day's word is one the player
        holds), and after a loss (the next day). No error, no sideways scrolling.
        `screen-bounty.jpg` in the player docs is taken again. Not seen: a real phone; the page
        onchain (it shows only the face-down state, the same component).
    - **Part 5, letters act the steps out, with no icons between them** (3A, in part;
      `Onboarding.tsx`, `LandingPage.tsx`). Built:
      - **"Raise them"** (the intro and the landing page): a lowercase r, the r mid-roll (the
        rig's rolling look: it can't look), and the R it becomes. It was r, a dice icon, R.
      - **"They get hungry."** (the landing page): a hungry y and the y fed. It was a hungry y,
        a cookie icon, and a fed y. The review page drew a third letter between them, at its
        snack; he does not like that look held small ("the static cookie/circle thing"), so no
        letter is shown at its snack in these pictures. The rig's snack is not changed.
      - **Held: "Keep them fed"** (the intro and the landing page) still has its trophy, cookie,
        and confetti icons. The review page's picture for it was the word at its snacks, which
        he turned down, and he has seen no other. **Open for the owner:** candidates for it go
        on the design audit's pages (he also said, the same evening, that he hates the trophy).
      - **What it costs.** The letter mid-roll is the dear one. The "Raise them" picture alone,
        at the landing page's size, three alternating runs of 15 s, on this Mac under heavy
        load from other work: WebKit 1.5%, 1.5%, 3.1% of a processor core with the icon, and
        14.5%, 31.5%, 13.7% with the three letters; Chromium 8.9%, 13.3%, 13.1%, and 15.6%,
        19.9%, 21.4%. About 12 points more in WebKit and 7 in Chromium, while the picture is on
        screen. If that is too much for the landing page, the middle letter can stand still
        there (`still`) at no cost; the intro shows one step at a time.
      - **Seen and not seen (part 5):** the landing page's two pictures at 390 px and 1,280 px,
        and the intro's second step at both, in WebKit and Chromium: no error, nothing outside
        its box, no sideways scrolling. Not seen: a real phone.

51. **Reserved word sets: words held back at launch and released later, built in parts** (starl3xx,
    2026-11-26; he asked for this entry as #24, which the messaging guide already holds). In the
    owner's words: "we set aside a portion of the total dictionary into packs of themed words".
    "on launch (or ASAP in testnet) we'd make sure something like 200 words (not sure on the total
    number) are reserved and grouped into themes. then we can release these new words into the
    ecosystem at later points (sort of an anti-whale mechanism, in a way)". "I'll refine the actual
    words (for these lists and overall) in the coming days... most important rn is the plumbing and
    the ability to release them in the game". "I like the gated idea on #8". They are called
    **sets**. This is plumbing: the words and themes are placeholders, so everything about a set is
    editable data until the set is released. One entry: each part is added here as it ships.
    - **How a word is held back.** `Words.claim` checks a Merkle proof against `dictionaryRoot`,
      and the owner can call `setDictionaryRoot`. A reserved word is one the current root leaves
      out. Releasing a set is publishing a root that includes its words. No contract change is
      needed for that; the first-day gate (part 3) is the contract change.
    - **Where the lists live.** In the database, never in this repository, which is public:
      `word_sets` (name, status draft → revealed → released, `reveal_at`, `release_at`,
      `gate_hours` 24, `per_player_limit` 1, order) and `set_words` (the word is the key, so a
      word is in one set at most; a headliner flag). A draft is fully editable (add, remove, move,
      rename, reorder, delete). A revealed set's name and words are locked; its dates and gate
      settings can still move. A released set is permanent. The admin imports and exports the
      unreleased sets as JSON; an import replaces every draft, all or nothing. The lists are never
      committed and never logged.
    - **A limit on secrecy, stated plainly.** The full dictionary is public (this repository, and
      the app's own bundle), and the game answers "not available yet" for a held-back word. So
      anyone who asks about every word can work out WHICH words are held back. That can be made
      slow (one word a request, a limit per address on the proof route) and never secret. What does
      stay private until a set is revealed: its name, which words it groups, its headliners, and
      its dates. `publicSets` (lib/sets/rules.ts) is the one place that decides what a player's
      browser is told, and it gives a draft as a locked slot with nothing in it.
    - **Proofs follow the chain, not the sets table** (my design; the spec said only "build the
      Merkle tree from" the claimable dictionary). A draft edit changes the sets at once and the
      chain only when the owner sends a transaction. If proofs came from the sets table, every
      edit would stop every claim (`dictionary_mismatch`) until that transaction landed. So each
      root the server builds is stored with the words it leaves out (`dictionary_roots`, written
      before the transaction is shown, never deleted, as `reward_leaves` is), and a proof comes
      from the tree behind the root the chain holds now. A word is offered only when BOTH agree:
      it is in the chain's tree, and it is in no unreleased set. The admin says "root out of date"
      while the two differ.
    - **Two builders, where the spec named one.** RESERVE moves the chain's root to what the sets
      hold back (it removes words, and may let some go); it flags any word a player already owns,
      which matters on Sepolia. RELEASE adds exactly one revealed set's words to the tree the
      chain holds and can never remove a word, whatever draft edits are waiting. A release is
      refused until every word of the set is held back on the chain: otherwise it would be a root
      that changes nothing, and the set would be marked released with no transaction behind it. A
      set is marked released from the chain, never by hand: a release was built for it
      (`word_sets.release_root`), and the chain's root now holds none of its words back.
      `npm run sets -- status | commitment | reserve | release <id> | confirm` runs the same code
      and sends nothing: it prints the calls.
    - **The gate goes first.** Where the network's Words has the gate, a release is two calls:
      `setGate` on the set's words, THEN `setDictionaryRoot`, as one Safe batch or as two `cast`
      commands joined so the second runs only if the first succeeded. There is no moment when a set
      word is claimable without its gate. Until the redeploy that carries the gate, a release is
      the root alone and the set opens to everyone at once (the builder says so).
    - **The commitment.** keccak256 of the canonical JSON of every unreleased set: each set's name,
      words, and headliners; sets by name, words A to Z, fixed keys, no whitespace. Shown in the
      admin and printed by `npm run sets -- commitment`. I left the dates, the gate settings, and
      the order out of it (my choice): they can move without the lists changing, and a promise
      that breaks when a release slips a day is no use. It changes with any edit to a name, a
      word, or a headliner, and at every release.
    - **Derived from the FULL dictionary, and tested never to move** (`tests/sets-derivations`):
      letter supply caps, mint odds, rarity tiers and ranks, token ids, and the jackpot's frozen
      answer pool. A reserved word needs its letters to exist, and comes back with the tier and
      the token id it always had.
    - **Counted over RELEASED words only:** the free-letter stop at 95% and its
      `dictionaryFull` answer, the admin's "dictionary claimed" and Supply tab, the keeper's deal
      alert (a letter that "finishes" a held-back word is no deal), the dictionary-share
      achievement, and the bot's `/word` ("It isn't available yet."). Spell, the Dictionary, and
      the Market's picks follow in part 2. **No change was needed** for the leaderboard's totals
      or the bounty's theme matching: both count words players own, and a held-back word can't be
      owned. (One Sepolia-only exception: a word claimed before it was reserved stays owned and
      still counts; the admin flags it.)
    - **The jackpot needs no special case.** The daily answers were committed before launch and
      may include a held-back word. `Jackpot.resolve` pays only a word that exists, is staked, and
      is fed; a word nobody can claim doesn't exist, so the pot rolls over as it does for any
      unowned word (`test_Jackpot_rollsOverOnAWordHeldBackFromTheRoot`). The keeper reveals the
      next link whatever the word is. The answer chain is not changed. One consequence to say in
      the player docs: a word is drawn once, ever (#20), so a set word drawn before its release
      has had its draw.
    - **Part 1 (this entry's first PR): the server and the admin.** Migration 0021, the rules, the
      proof route, the builders and the script, the admin's Sets tab (gated on the server like
      Players, never cached), and the tests. It merges dark: with no tables, or no sets, every
      answer is what it was (checked against a real database that stops at migration 0020). A
      database that is there and fails refuses (`try_again`) only when nothing was read before AND
      the chain holds words back; while the chain holds the full dictionary's root nothing is held
      back there, so a claim is served as it always was, and after a good read the last read keeps
      holding back what it held.
    - **After a re-vendor.** A stored root's words no longer give that root once the bundled
      dictionary grows, so the server checks that the tree it would serve IS the chain's root and
      answers `dictionary_mismatch` otherwise, as a re-vendor always did. RESERVE is the way out:
      it is built from the sets and the dictionary alone, so it also works from a root nobody here
      built. The new root after a re-vendor is the reserve root, never `derive:contracts`'s, which
      holds nothing back and would release every set at once (the runbook says so).
    - **Owner steps after part 1:** run migration 0021; paste the JSON into Sets; send the reserve
      root (`setDictionaryRoot`) from the owner wallet.
    - **Part 3: the first-day gate, built and NOT deployed** (the owner: "I like the gated idea on
      #8"; "tell me the plan and the date before doing it. Until then, items 1–7 ship without the
      gate").
      - **The contract.** `Words.gatedUntil[tokenId]`, set by the owner in a batch
        (`setGate(tokenIds, until)`, event `Gated`), at most `MAX_GATE` = 7 days ahead, never on a
        word somebody holds. While a word is gated, `claim` needs a voucher signed by `claimSigner`
        (owner-set, as Staking's signer is; set at deploy) over (this contract, the chain id, a
        gated-claim kind, the caller, the token id, a deadline). **One claim path, two forms:** the
        old `claim(word, mask, proof)` is unchanged for an ungated word (the same selector,
        `0x527c5082`, checked by raw call in the tests) and reverts `VoucherRequired` on a gated
        one; `claim(word, mask, proof, deadline, sig)` takes the voucher and ignores it once the
        gate has lifted, so a claim sent as the gate lifts doesn't fail for it. Both share
        `_checkClaim` and `_finishClaim`.
      - **A voucher has no nonce, on purpose.** It names the caller and the word, so reused it is
        the same wallet claiming the same word again after dissolving it. A nonce would cost a
        storage write on every gated claim to enforce what the server's count already holds.
      - **The server counts vouchers ISSUED, never words held** (the audit's one note, at 70 of a
        threshold of 80): a count of words held would let a player claim, move the word to another
        wallet, and ask again. `POST /api/sets/voucher` signs only for a verified profile (the free
        letters' own check), at most `per_player_limit` different words of a set per profile
        across its linked wallets (table `set_vouchers`, migration 0022; one profile's requests
        run one at a time), with a 10-minute deadline. The row is written before the voucher is
        signed. A slot comes back only when the chain's `Claimed` history shows the voucher
        expired unused; a used one is spent for good, whoever holds the word now. The same word
        again is always a renewal, never a second word.
      - **The caller must prove the wallet is theirs** (my addition; the spec didn't ask for it):
        the wallet's profile session, or a Farcaster sign-in that Farcaster ties to the profile.
        The free snack's voucher needs no proof because asking for a stranger's spends nothing.
        This one spends the profile's one slot on a word the caller names, so without proof a
        stranger could name your wallet and a word you don't want, again each time it expired, for
        the whole first day. A web player with no session gets "sign in to your profile" and the
        profile opens.
      - **A release leaves out words somebody already holds** from its gate (`setGate` would revert
        the whole batch), and no release is planned when ownership can't be read. Sepolia matters
        here: words claimed before they were reserved.
      - **The audit** (`solidity-auditor` on `Words.sol`, four scanners, 170 vectors; decisions #12
        stands, no external audit): no finding at or above the threshold. `contracts/AUDIT.md` has
        the pass, what was checked and dropped, and one older, unrelated detail two scanners saw
        (`dissolve` logs the caller's word string unchecked; nothing reads it; the owner's call
        whether to close it in the redeploy).
      - **In the game:** a claim of a gated word asks for the voucher first; each refusal has its
        own sentence with when the word opens to everyone (`components/game/setGate.ts`).
      - **Dark until the redeploy.** Whether a network's Words has the gate is written in the
        deployment registry (`"wordsGate"`), never guessed from a contract read: a failed read
        can't tell "no gate" from an RPC hiccup, and a hiccup read as "no gate" would plan a
        release without its gate. Sepolia's is false, so the voucher route answers `not_gated`,
        the proof route never says a word is gated, and a release is the root alone. Nothing a
        player sees changes. Likewise a gate that can't be read is never "no gate": no release
        plan is built, and a release isn't marked until its gate can be read.
      - **Two bugs the second review found before merge, both fixed with tests on a real
        database.** Asking again for the same word after its voucher expired unused failed for
        good (the rule said "new", the table's one-row-per-word key refused the insert): the freed
        row is now revived. And a renewal from a linked wallet made the row name only that wallet,
        so the first wallet's claim went unseen and the slot was freed: a row now remembers every
        wallet it was signed for, and settling asks the chain about all of them.
      - **Three more from the last automated review, fixed before merge.** Settling read the
        chain from the set's release, a span a public RPC refuses within hours, so an unused
        voucher would have held its slot all day: it now reads from about when the row was first
        made, in spans that halve when refused. The game decided whether to ask for a voucher by
        the device's clock, and the server by its own, while the contract goes by the chain's: the
        game now asks whenever the server says a word is gated, the server says so until two
        minutes past the gate's end, and the voucher route decides by the chain's time. And the
        proof route took "gated" from the sets table, which a database outage hides: it now asks
        the chain for that word's `gatedUntil`, and serves no proof when that can't be read.
      - **The redeploy** is the whole suite (Staking, Rolls, Prestige, and the Jackpot hold the
        Words address for good), it resets the testers' test build, and it carries the 3.0× caps.
        `docs/web3-runtime-plan.md` has the plan and the proposed time (Thursday 2026-12-03, after
        the 00:05 UTC keeper run pays the bounty week); it waits for the owner's word. The same
        section lists what the mainnet deploy must include, since Words can't change afterwards:
        the gate, the reserve root (`DICTIONARY_ROOT`), and the claim signer.
    - **Part 2: the game, the reminders, and the player docs.**
      - **The Dictionary's Sets section** (`components/game/SetsSection.tsx`, `useSets`,
        `GET /api/dictionary/sets`). A draft is a locked slot ("A new set is coming") and nothing
        else: the route gives the game only `publicSets`, so the app itself doesn't know a
        draft's name, words, dates, or size. A revealed set shows its name and words, still (they
        aren't buttons: nothing can be claimed yet), and counts down to its unlock. A released
        set's words open like any word; in its first day it says "First day: one word per player"
        and counts down to when it opens to everyone. Nothing shows until the sets are known.
      - **A released set's words carry the set's name on the card's back** ("Set" on the bottom
        line, in the list under an opened card on a phone, and on the server's back picture).
      - **Reminders** (`lib/notify/sets.ts`, `/api/cron/sets`, hourly at ten past): a set is
        revealed, it unlocks, and its first day ends. Each is said once (one mark per set and
        moment, claimed before anything is sent, given back if it reached nobody), only within
        six hours of the moment (old news is never announced), never about a draft, and to
        everyone who keeps the new kind "A new set of words" on (on by default: it is rare and
        timed, my call). `SET_REMINDERS=off` mutes them all. Its own hourly route and not a keeper
        job: the keeper is daily, and a job name outside `KEEPER_JOBS` never runs. The same route
        reveals what is due and marks releases, as a backstop for a quiet hour.
      - **The app is told which words are held back, as one unlabeled list** (the owner's choice,
        2026-11-26, between that, small batches per screen, and one word at a time: "One unlabeled
        list"). Spell, the Dictionary's list, and the Market's picks must leave held-back words
        out, so the app has to know them, and they can't be kept secret anyway. So
        `GET /api/dictionary/sets` carries `held`: every word the game holds back now, A to Z, the
        words of every unreleased set together, with nothing that says which set a word is in.
        This amends "the unreleased list never reaches a client response": what never reaches a
        client is a set's NAME, its GROUPING, its headliners, and its dates (`publicSets`); the
        test now holds that a draft's words appear in `held` and nowhere else in the answer.
      - **One rule hides them everywhere** (`lib/dictionaryList` `entryStatus`): a held word's
        status is `held`, asked after the owners (a word somebody held before it was put in a set
        is still theirs) and never `open`. So Spell's list and rack ("X isn't available yet"), the
        Dictionary's list, counts, and search, the word view, the Market's picks, and Today's next
        steps all leave it out through the status they already shared, and the Dictionary's count
        is the words on offer. While what is held isn't known, nothing is called held, and the
        claim's own answer ("not available yet") is the backstop.
      - **The player docs and the first tester note wait for the switch-on.** Part 2's code does
        nothing a player can see until a set exists (no Sets section, no reminder choice, the same
        lists). So the public copy rides its own small PR, merged only once the owner has run the
        migrations, pasted the sets, and sent the reserve root: a docs page for sets
        (`docs-site/sets.mdx`: reserving, revealing, unlocking, the first day, and what a held-back
        word means for Spell, letters, and the jackpot; no reserved word named), a line each in the
        cheat sheet, the FAQ, the words page, the jackpot page, and the reminders list, and the
        tester note "Some words are now held back in sets that unlock later…". The docs' first-day
        section says the limit starts on the test build with its next reset; the redeploy's PR
        removes that sentence and carries the second tester note.
      - **A fully unlocked set folds to its name** in the Sets section (my call): its words are in
        the list below like any others, and the Dictionary's top would otherwise fill with every
        set there has ever been.
      - **A set is revealed only once the chain holds its words back** (mine, 2026-11-27, found
        when a review read my own runbook steps for the Test collab: "reveal, then send the
        reserve root"). A reveal names a set's words to everyone, and until the chain's root
        leaves a word out anyone can claim it straight from the contract with a proof made from
        the public dictionary; the server refusing the proof stops only the game. Nothing checked
        the order. Now every reveal is checked against what the chain holds back (`lib/sets/server`
        `heldOnChain`), inside the one function that reveals a set and under the set's row lock
        (`lib/db/sets` `revealSet`; the scheduled reveal now goes through it too, a set at a
        time), so a word added to a draft while a reveal runs can't ride along:
        **Reveal now** is refused with "send the reserve root first, then reveal", a set past its
        `revealAt` stays a draft and is revealed by the first read after the root lands, and a
        chain that can't be read (or a root this server never built) is "can't tell", never "held
        back". The cost: a reveal can be late by as long as the root or the chain is. The order
        is always draft, reserve root, reveal, release.

52. **The card's serif is Source Serif 4, shipped: one face for every player and every picture**
    (starl3xx, 2026-11-27, on the design audit page: "I like Source Serif 4", then "let's go 3H
    for consistency"). The first thing built from the audit ("Lexigotchi Design Language").
    - **What it was.** The serif that letters what a card says about a word (its ribbon, its
      number, its ledger) was asked for by name and never shipped: Iowan Old Style on Apple
      devices, Palatino Linotype or Book Antiqua on Windows, Noto Serif or Georgia on Android, and
      a fourth face, TeX Gyre Pagella, on the server's pictures (a server has no fonts). A tester
      on Windows never saw what a Mac shows.
    - **Now.** Source Serif 4 (SIL Open Font License) is in `public/fonts`, first in
      `--font-card`, for everyone, Apple devices too. The old faces stay behind it for the
      moment before the file loads. The three picture routes (a word's card, its back, the
      earnings share) load the same face, named once in `app/_og/wordCard.tsx` (`CARD_SERIF`,
      `CARD_SERIF_FILE`). TeX Gyre Pagella and its license are removed.
    - **The files.** Two web files hold every weight (200 to 900) and every optical size (8 to
      60), roman and italic, Latin only: 122 KB and 130 KB, from Google Fonts. The browser draws
      small lettering with a sturdier, wider cut and large lettering with a finer one, by itself.
      The picture renderer can't read those, so it has one plain bold file (195 KB), at the
      face's middle optical size: the game's number is a little finer than the picture's.
    - **Why Source Serif 4 and not the nearest face.** He asked what on Google Fonts is near
      Iowan. I set six beside it and measured: Newsreader was nearest and was my pick. He chose
      Source Serif 4 from the specimen, and then chose one face for all over "Iowan where a device
      has it": on a Mac he would otherwise never see the face he chose.
    - **Emails keep a device serif.** A mail program loads no font. The stack names Source Serif 4
      first, for a device that happens to have it.
    - **`CARD_LOOK` is 11:** the lettering on every card picture changed.
    - **The rule is unchanged:** a word is never set in the serif. Where else the serif goes in
      the interface (figures, status values) is the audit's part 3, and not decided here.
    - **Seen and not seen:** the practice game at 1,440 px and 390 px in Chromium and WebKit: the
      ribbon and the back are in Source Serif 4, loaded from the game's own files (no request
      leaves for Google), nothing is clipped or outside the card, and the phone's shorter ribbon
      fits. The three pictures draw in it. Not seen: a real phone, Windows, the earnings share
      picture (it needs a link the server signs; it loads the same file through the same code).
53. **Collab sets: a reserved set made with a partner, with its own card look, built in parts**
    (starl3xx, 2026-11-26; he asked for this entry as #25, which is taken, and he calls reserved
    sets "#24": they are #51). In the owner's words: "wait what if we offered crossover sets as
    collaborations with other entities". "5 words only". "the card would be unique to that collab".
    "maybe all collabs would have the same front like stock but slightly different colors or stamps
    or something for the logo". "Collab only changes how the card looks... the word is the same...
    and it's legendary rarity". This is plumbing: no real partner, name, logo, or color ships in
    this repository. One entry: each part is added here as it ships.
    - **The parts.** (1) The data, the first day's rule, and the admin fields: this part. (2) The
      rarity override: a collab word is Legendary from its set's reveal, as a layer on top of the
      derived tier. (3) The card: one collab stock tinted with the set's two colors, the stamp, the
      partner back, on every surface, and the admin's live preview. (4) Token metadata with a
      "Collab" trait, the player docs, the test set on Base Sepolia, and the tester note.
    - **Part 1: a set's type.** A set is `standard` or `collab` (`word_sets.type`; migration
      `0023_collab_sets`). A collab has a partner's name and https link, two colors (`#rrggbb`),
      and a stamp. They are the set's identity: a draft's to edit, locked at the reveal with its
      name (`rules.ts` `IDENTITY_KEYS`), and nothing of them reaches a browser before the reveal
      (`publicSets` still gives a draft as a locked slot: not even that it is a collab).
    - **A collab is revealed only when it is whole:** exactly five words, its partner's name, its
      two colors, and its stamp (`revealProblems`). The reveal by hand refuses with what is missing;
      the scheduled reveal leaves such a draft a draft, however late, and the admin says why. The
      spec asked for the five-word check; the rest is mine, because a reveal locks the look, and a
      card with no stamp could never get one. The rule is written twice (TypeScript, and SQL for
      the one-statement scheduled reveal); `scripts/sets-db-check.ts` holds the two together.
    - **No collab set can be revealed until its card ships** (`rules.ts` `COLLAB_LIVE`, false
      until part 3; mine). A collab word is Legendary "from the moment its set is revealed" and
      sits on its own card, and a set revealed before parts 2 and 3 would be neither. A draft can
      be made and edited now; the reveal by hand and the scheduled reveal both pass it by, and the
      admin says why.
    - **The stamp** is a small raster picture (PNG or JPEG, 256 KB at most), kept in the
      database (`set_stamps`). Never an SVG: an SVG can carry script, and this picture is drawn
      into every card of the set. Not WebP for now: the server's pictures must be able to draw
      it, and a revealed set's stamp can never be replaced. What it is comes from its own first bytes, on the way in and on
      the way out. `GET /api/sets/{id}/stamp` serves it only for a revealed or released set; a
      draft's answers as a set that doesn't exist. A file import carries no stamp and no
      allowlist, so a draft that comes back under the same name keeps the ones it had.
    - **The first day's rule** (item 4). `word_sets.gate_rule` is `verified` (every verified
      player, the default), `allowlist` (wallets the operator pastes; `set_allowlist`), or `token`
      (a contract on Base and a minimum balance, read when the voucher is asked for). It adds to
      "verified", never replaces it: the voucher route checks it after verification and after the
      proof of wallet control. **The wallet that claims must be the one the rule lets in** (mine):
      if any wallet of the profile counted, one listed wallet could be linked into one verified
      profile after another and let each of them in. The claiming wallet is also the one the
      voucher's row is counted under, so a wallet that moves to another profile brings its word
      with it. A player whose other wallet qualifies is told to claim with that one. It fails
      closed: a list or a balance that can't be read is "try again", and a rule that is missing a
      part lets nobody in (`lib/sets/firstDay.ts`). The token is read on Base MAINNET whatever network the
      game runs on, as Coinbase's attestations are. The rule can change until the release, and no
      release is built for a rule that can't be checked (`gate_rule`): an allowlist with nobody on
      it, a token rule with no contract or minimum, or a contract whose `balanceOf` doesn't answer
      on Base (a mistyped address would be "try again" for every player all day, and the rule is
      final once released). A token's contract and a list's wallets never leave
      the server; the Dictionary says who the day is open to in the operator's own words
      (`gate_label`, e.g. "holders of …") or in plain ones, and only on a network whose Words has
      the gate: where it doesn't, a set opens to everyone at once, so nothing is said of a first
      day. One limit, stated plainly: a token can be moved to another verified player's wallet
      during the day, and that player is then let in too.
    - **A deploy never waits for a migration** (the owner runs them by hand). Before 0023 has run,
      the sets read from 0021's columns as standard sets, plain sets are still made and imported
      (a raw insert that names only 0021's columns: Drizzle's insert names every column of the
      table), and anything a collab adds is refused with `not_migrated`. Proven on real Postgres
      three ways: `scripts/sets-db-check.ts` with 0023 and without it, and the app itself on a
      database with no sets tables at all (production's state on the day this merged): the sets
      answer, a proof, the daily status, the admin's read, and the hourly job all answer as before.
    - **"Test collab" (item 7) is the owner's button**, not something this code creates by
      itself: it is a write to the production database. The Sets tab has it on a test network
      only, and the server refuses it on mainnet. It makes a DRAFT (two arbitrary colors, a plain
      stamp drawn in code, "Test partner"), with five words picked then and there from words no
      set holds and nobody owns: one Mythic word when one is free, the rest from below Legendary,
      so the test set shows both "Legendary from reveal" and "a higher rarity is kept". The words
      are never written in this repository.
    - **Part 2: Legendary from the reveal, as a layer** (`lib/rarity.ts`). `wordTier` is still
      the tier derived from the full dictionary, and supply, mint odds, token ids, and the
      simulator still use it. `tierWith(word, collab)` is the tier the game TREATS a word as: a
      word of a revealed or released collab set is Legendary, unless its own tier is higher. The
      collab words are always passed in (the server reads them from the sets, the game from the
      sets answer), so a draft's words are never in them, on either side. Tier counts come from
      the same rule (`tierCountsWith`): "one of N Legendary words" counts a raised word in
      Legendary and no longer in its own tier.
      - **Where it applies:** what a card, a tile, a badge, and a share picture show; the
        Dictionary's, Spell's, and the Market's tier filters and counts; "rarest first"
        everywhere (the one word-by-word order now has the game's tier on top, so only a collab
        word moves); the keeper's daily yield and the bounty; the "earns about" estimates; the
        tier a sale is recorded at; the deal alert; the Telegram alert and `/word`.
      - **The keeper opens no epoch on guessed rarities** (mine). An epoch is money and can't be
        reopened, so it is weighed only with a read that run made itself (`collabStrict`: never
        the copy the sets loader keeps from before a failure, which it calls "known"). The read
        is tried three times; if it still fails the yield or bounty job throws
        (`lib/keeper/tiers.ts`). What that costs: the keeper runs once a day and each job fails
        alone, so a refused day has no yield epoch unless the job is run again that day (the pool
        keeps the funds and the next days pay from a larger pool), and a refused bounty week is
        retried daily. It adds no new way to lose a day: an epoch's proofs are stored in the same
        database before it opens. Everything that only SHOWS a rarity falls back to the derived
        tiers instead (`lib/raritySoon.ts`), which is what every word had before.
      - **Mid-epoch.** A reveal raises a word's weight from the next epoch the keeper opens: an
        open epoch's tree is never rebuilt. A sale is recorded at the tier in force when it is
        indexed (within moments of the sale), and a recorded sale is never rewritten.
      - **The orders didn't move for any other word.** A tier is a band of the rarity ranking
        (tested over the whole dictionary), so "tier, then rank" with the derived tiers is the
        ranking itself: the Dictionary's and the Market's orders are what they were.
      - **Held to it by a test** (`tests/rarity-override.test.tsx`): the list of files that may
        still read the derived tier, with a reason each, and a check that the game's own calls
        of the functions with a default pass a tier.
      - Not changed by a collab: letter supply caps, mint odds, the word's rank number ("the
        37th rarest word"), the practice game (it has no sets; its bag and its screens both show
        the derived tiers), and two admin tables that say so: the supply table ("Words
        (derived)") and the simulator's page. The spec asks for tier counts "anywhere" to come
        from the one function; those two show what the full dictionary derives, on purpose.
    - **Part 3, first piece: the tiles and the card's front** (`lib/collabLook.ts`,
      `lib/rarityFinish.ts` `collabFinish`). A collab is a look, not a rarity, so it is chosen by
      the WORD, never by the tier (a collab word is Legendary, and so are other words).
      - **One lookup.** `collabLooksOf` gives word → look (the two colors, the stamp's address,
        the partner). It is the same object the rarity layer asks "is this a collab word?", on
        the server (`collabNow`) and in the game (`useSets().collab`), so the two can't disagree.
        The components that draw a word (its tiles, its small tiles, its card) ask for the look
        by the word themselves, through one context for the whole game: no screen passes it
        along, which is how "everywhere a word is drawn" is kept. A page outside the game hands
        the look in (the share page).
      - **The tile** is given the two colors where its rarity would go (`TileTier`): one
        diagonal tint over the tile's own face, in place of the rarity's material. No metal,
        foil, facets, halo, or motes: it is a stock, not a material; a light still passes over
        it. The border is the case's and the rings and rainbow are ascension's, untouched.
      - **Any two colors** (an operator types them), so nothing is drawn in them as given. The
        tile keeps its own ink (the letter's color belongs to its case), so the TINT is thinned
        until the letter reads on both cases, at both ends and the middle. The frame and ribbon
        are printed on paper, so the INK is the darker color, darkened until it reads, graphite
        if it never does. Tested over a sweep of the color cube and the hard pairs (both black,
        both pale, mid greys, pure hues), at WCAG 4.5. Seen at 48 px in Chromium and WebKit.
      - **The front** is the stock card in the two colors (the first behind the word, the second
        toward the edges; the card stays grey first), the frame and ribbon in the look's ink, and
        the corners still the rarity's mark. Another scene keeps its own art, as for any word.
      - **The stamp** has ONE place on every collab card: the window's upper left (a 92-unit box,
        62 in and 60 down, of 1200 × 675), clear of the corner piece, the word, the ribbon, and
        the turn-over button. This is the one thing drawn over a card's art besides its letters
        (CLAUDE.md said nothing is): the owner's spec asks for it. It is a layer of its own, never
        inside the art's SVG. A thumbnail has none. The server's pictures are handed its BYTES
        (`lib/sets/stampData.ts`) and never fetch this site's own stamp route, whose failed
        fetch the renderer would keep for the life of the server.
      - **A reveal changes a card without changing the word**, and a card picture is kept a week
        at the edge. So every card picture's address names the word's look (`c`, the set and its
        stamp's time), as it names its stage: the link picture, the face, the video's stage, and
        the token metadata's `image` (which is what makes the owner's `refreshMetadata` worth
        sending). An address that doesn't name the look the word has is kept five minutes, not a
        week. A draft's word gets no `c` and the same caching as any word: nothing about a
        header tells a draft apart. A copy made before a reveal can still be shown for up to a
        week at its old address (X and Farcaster keep theirs for good); only a new address
        mends that, which is what sharing the word again gives.
      - **The stamp stands on a plate** of the card's own paper, ruled in the frame's ink, like
        the frame's corner pieces (mine, after seeing it): a stamp is any picture, and without a
        plate a dark one was lost on Outer Space and a pale one on the stock card. On paper, a
        mark made for a light ground always reads; the admin says to upload that version.
      - **The back** is the partner's colorway in place of the rarity's material: the two colors,
        each deepened until the back's cream type reads on it (`collabBack`), the frame, seal, and
        holder's stamp in the lighter color. It has none of a material's metal, glitter, facets,
        fire, or scrollwork, and no live shader. Under how many words share the rarity it says the
        partner and "1 of 5"; a phone-sized back leaves that line out, as it leaves the one above
        it, and the rows under an opened card carry it ("Collab"). Three renderers draw a back
        and must agree, so the colorway is painted the same way in two of them and the third is
        kept out: the game's CSS and the server's picture use one gradient of the same two
        grounds, and the server paints it INTO the picture (a rarity's back is drawn over a clear
        ground for the video's shader to fill), so the shader's material never shows under it.
      - **Seen moving** in Chromium and WebKit, where a moving tile's light is drawn as layers:
        the light passes over a collab tile, and at Holographic its rings, laurels, and rainbow
        are as on any word. `tests/living-video.test.tsx` now sweeps the collab look with every
        rarity, stage, and case, so the share video's letters stand alone in it too.
      - **The admin's live preview** (item 6) is the game's own card for the front, so it is the
        real drawing, and a plain drawing of the back in the same colors (the game's back needs a
        player's word). Both go through the functions the game uses, so a color that is hard to
        read shows there as it will in the game.
      - **`COLLAB_LIVE` is true** (flipped last, in a change of its own, once every surface drew
        the look): a collab set can be revealed. It stays a switch: false stops every collab
        reveal, by hand and on its date, and leaves drafts editable.
    - **Two things the spec assumed that weren't so.** There is no token metadata server in this
      repository yet (only the `WORDS_URI` setting), so the "Collab" trait and the tokenURI art
      mean building that route: part 4. And a metadata refresh "at release" needs an owner call in
      `Words`, which can't change after deploy; no token of a set exists at its release, so the
      call matters only if a card's look changes later.
    - **The owner's rulings, 2026-11-27.** The Base Sepolia redeploy for the gate: "Hold for now"
      (no date; the plan in web3-runtime-plan.md waits). Later the same day, with the claim fee by
      rarity (#60) added to it: "let's do it this coming tuesday" (Tuesday 2026-12-01). The free-letter ledger at that reset:
      "Clear them" (the owner deletes the `free_claims` rows of chain 84532 on the day). Extras for
      `Words` before it is redeployed: "Metadata refresh function" (an owner-only ERC-4906
      refresh for a list of words). The check on the word that `dissolve` logs was not chosen.
    - **Token metadata is served** (`GET /api/word/{tokenId}`, `lib/wordMetadata.ts`; part 4's
      first piece). There was none before, so this is the whole server, kept small: the word's
      name as its letters stand now, the card's front as its picture (the existing share
      picture, so one drawing serves both), and traits: Rarity (the tier the game treats it as),
      UPPERCASE letters, Ascension, Number, **Set** once its set is released (as the card's back
      says it), and **Collab** with the partner's name from its set's reveal. A draft set adds
      nothing, and a word nobody holds has no metadata (404, as `tokenURI` reverts for it). The
      chain's state decides the rest; when the chain can't be read the answer is 503, never a
      guess a marketplace would keep. The owner points Words at it with `setBaseURI` (a step in
      web3-runtime-plan.md); nothing calls it until he does.
    - **The metadata refresh is in `Words.sol`** (its own PR, ahead of part 4, because it is the
      one piece of the collab work that a contract must carry and Words can't change after
      deploy). `refreshMetadata(uint256[])` emits `MetadataUpdate` for each word named;
      `refreshAllMetadata()` emits `BatchMetadataUpdate(0, max)`, ERC-4906's "everything
      changed", which word ids need because they are hashes and never a run. The second is mine:
      he chose the list form, and a contract that says it speaks ERC-4906 should be able to say
      "all of them" (a new metadata server, a change to how every card is drawn). Both are
      owner-only and only emit events. Tests, and the audit's sixth pass (no finding at the
      threshold). Nothing is deployed: it rides the Base Sepolia redeploy, which is on hold.
    - **The share video's back has no rarity material under a collab's colorway.** The video is
      the back's third renderer: its shader draws a material and lays the server's picture over
      it by the picture's alpha. A collab's colorway is painted into that picture edge to edge,
      so the material can't show; the video is given the plain one for a collab word all the
      same, never Legendary's gold light, so the rule doesn't rest on a picture's corners.

54. **A card's words: front, face, back** (starl3xx, 2026-11-27: "let's standardize how we talk
    about cards... the *front* of the card is its front regardless of the scene/face... the *face*
    (not scene) is the background on the front of the card. the back is the back. standardize
    across all surfaces, docs, etc").
    - **The three words.** The FRONT is the side of a card with the word on it, whatever it
      wears. The FACE (a "card face" where a sentence needs the noun) is the picture on the
      front, behind the word: what a player picks, unlocks, or buys. The BACK is the other side,
      with the word's story.
    - **"Scene" had two meanings, and each got its own word.** Where it meant the side (the flip
      button's "Show the scene") it is "front". Where it meant the picture ("Pick a scene") it is
      "face". So the change was read line by line, never as a replace-all.
    - **Every surface a player reads:** the game (the button under an opened card is "Face"; the
      picker's title is "CRANE's card face"; the flip button says "Show the front"; the Market's
      "Card faces, cases, and costumes stay with the seller"), the Shop's wording, the player docs
      (the section is "Card faces", with the three words defined once, and an FAQ entry), and the
      messaging guide's word list. The mechanics reference follows.
    - **The guard.** `tests/copy-rules.test.ts` fails on "scene" in player-facing code and in the
      player docs. The operator console is excused: it names the stored kind.
    - **The code keeps "scene", and so does everything stored or posted** (my reading of "all
      surfaces, docs, etc": what a person reads, not what the code is called). A share link's
      `?scene=` is posted for good; kind `scene` is in `shop_items` and `word_picks`; `/api/scenes`
      and the browser's `lexigotchi:scene:` key hold players' picks. Renaming the code's own names
      (`SceneId`, `SceneFrame`, `useWordScene`) is a change to about a hundred files that other
      work is in the middle of, for no player's benefit. It can be done on its own if the owner
      wants it.
    - **Two older code names use "face" for something else:** `?face=1` and `showcaseFacePath`
      are the card's front alone, and `playerFaces` is a player's name and picture. They are
      listed in CLAUDE.md so nobody takes one for the other.
    - **My readings, not starl3xx's words:** the first face is named "Stock" in the picker and
      "the stock face" in a sentence (his phrase, from the listing: "it shows the stock face");
      the button under an opened card is "Face", not "Card face", because three buttons share a
      phone's width there; "face down", of the jackpot's secret card, stays as plain English for
      a card lying on its front.
    - **What a player buys in the Shop stays with the player** (the same day: "shop items staying
      with the player and not transferring on sale or dissolve or anything is something we should
      be clear about in the docs"). The docs say it in a section of its own, and again where a
      player reads about selling a word, buying one, and dissolving one. It was already how the
      game works (#41): a purchase is the profile's, a pick is kept by profile, and nothing from
      the Shop is a token that can move.

55. **The Shop is a screen of its own, with categories, and it can sell limited editions**
    (starl3xx, 2026-11-27: "the Shop should be its own tab instead of a popup, since we'll
    eventually add more things and categories (card faces and accessories for now)", and "I want to
    make sure that we can make limited edition Shop sales, too... like, say only 25 of the Outer
    Space face").
    - **A screen, not a sheet.** `screens/ShopScreen.tsx` is the `shop` view: in the rail's
      Collect group, with its title in the header, and under More on a phone. The sheet's body
      moved as it was, with the guards Bugbot asked for on #235: nothing is listed when the Shop
      couldn't say what its items are, and a face is sold only on a positive "you don't have it".
      There is no `shop` sheet any more; the three callers navigate.
    - **Anyone can look** (it is one of `PUBLIC_VIEWS`), as the sheet opened with no wallet. Buy
      then reads "Connect a wallet to buy" and leads to Today, where a wallet connects.
    - **Two categories, one switch:** Card faces and Accessories (`lib/shop/rules`, pure and
      tested). The stored kind `scene` is a card face; a case and a costume are accessories. The
      test network's placeholder is in neither: it is nothing a card wears, so it sits apart
      under "Try paying". An empty category says so plainly and promises nothing.
    - **Links land on a category:** the face picker's tile for a face on sale goes to Card
      faces (and, since the item's view below, opens that face there), and an opened word's Case
      button to Accessories.
    - **Limited editions already worked, and now they show.** The contract has always held a
      supply limit (`maxSupply`; `_buy` reverts `SoldOut`), and the face picker stops offering a
      sold-out face. What is new is the card's line: "Limited edition of 25. 24 left.", then
      "None left." beside "Sold out". Proven on a local fork of Base Sepolia: with the Outer
      Space item capped at what had sold, a purchase reverted `SoldOut(2)`; capped at 25, the
      supply check passed.
    - **What a limited edition does not promise** (so the words don't): the owner can raise a
      limit later (never below what has sold); the limit counts purchases, not players (the
      game sells a face once to a profile, but the contract would sell it to the same wallet
      twice); and `updateItem` resends the price and the dates with the limit.
    - **The live item was not capped by this change.** "Say only 25" was an example: capping
      Outer Space is an owner transaction, and it waited for his word. **He gave it the same
      day: "cap outer space at 5".** Sent as `updateItem(2, 5000000, 0, 0, 5)` (0x1382f701…0cc9),
      with the price and the dates read from the chain first and resent unchanged. One had
      sold (the owner's own), so the live Shop reads "Limited edition of 5. 4 left." When the
      last is sold it reads "Sold out", and the face picker stops offering it to anyone who
      doesn't have it.
    - **The player docs have a Shop page** (`docs-site/shop.mdx`): what is in it, limited
      editions, paying, and that what a player buys stays with the player.
    - **An item opens** (starl3xx, 2026-11-27, later the same day: "in the shop I should be able
      to click items and see more info about them, see them at higher size, etc").
      `sheets/ShopItemSheet.tsx`, sheet kind `shopItem` (the item's id, and optionally a word).
      One tap anywhere on an item's card opens it (the card's picture and words are one button,
      stretched over the card; Buy stays a button of its own above it). The view shows:
      - **the thing large**: a wide dialog on a computer (`Sheet`'s new `wide`: up to 720 px
        from md and 1,000 px from lg, where the picture and the facts stand side by side; the
        560 px default is unchanged), and "Look closer", the card at twice that width in a box
        that pans (a finger or a trackpad scrolls it; a mouse drags it). On a phone the dialog
        is no wider than the Shop's own card, so the closer look IS the phone's larger size.
        The change of size is a cut, never an animation (#48);
      - **a card face on the player's own word**: a row of their words under the picture, the
        first one showing (or the word the face picker was dressing), and "No word". It is a
        preview: it draws the face directly and saves nothing. No wallet or no words: the face
        alone, never a made-up word;
      - **what it is**: its kind, its price, the face's own line, the card's words, the limited
        edition line, when a sale ends or starts if the item has such a date
        (`lib/shop/offer` `saleWindow`: an item with no end says nothing, because the owner can
        set one later), "You have it", that it stays with the profile, where the money goes,
        and a link to the docs' Shop page;
      - **the same Buy as the card**; and, for a face the player has, **"Put it on WORD"**,
        the face picker's own save (`useWordScene`), offered only on a positive "you have it".
    - **One rule decides Buy for the card and the view** (`lib/shop/offer` `buyOffer`, pure,
      tested; drawn by `shop/ShopBuy`): have it, not known yet, not on sale, no wallet, then Buy
      (held back while paused or short). Two copies of that ladder would one day disagree, and
      the wrong one would sell a face to someone who has it. `useShopView` (game/useShop) is the
      one place both read the Shop from. **A purchase in flight is known to every Buy on the
      page** (`useShopBuy`, a shared mutation): the view is a sheet that can be closed
      mid-purchase, and the card behind it must not offer a second Buy. **"In flight" is the
      action gate's word** (`g.busy` with the purchase's label, `SHOP_BUY_LABEL`), never the
      purchase's own promise alone: a wallet that never answers leaves the promise pending for
      good, and after Hide on the status pill Buy must be live again. My first version counted
      the pending promise and would have left every Buy disabled until a reload (caught in
      review, before it shipped).
    - **A purchase runs at the tap or not at all** (`networkMode: "always"` on the shared
      purchase; caught in review, then seen). The purchase became a query-library mutation so
      that every Buy could know one was in flight, and by default such a mutation made OFFLINE
      is held and run when the network returns. Seen in a browser: a tap on Buy while offline
      showed nothing, and eight seconds after reconnecting the wallet was asked to sign, with
      no new tap. Now it runs at once, as the direct call did. Offline, its first read fails,
      and that is said ("Couldn’t reach the Shop. Check your connection and try again."): a
      purchase whose first read threw used to be silent, before this change too.
    - **A thing with no picture** (a costume with no art yet) opens in the usual dialog, one
      column: the wide dialog is for a picture.
    - **Only a button sits above the card's open button** (`lib/shop/offer` `offerIsButton`,
      Bugbot on #316). The card's foot is either a button (Buy, or the way to a wallet) or a line
      of words that says why there is no Buy. I had lifted the whole foot above the card's own
      button, so a tap on "Sold out" or "Not on sale yet" did nothing, on the very cards a
      player is most likely to tap for more. Now only a button is lifted. Checked with a mouse
      at each line's own place, in Chromium and WebKit, at 390 and 1,280 px.
    - **The view reads the Shop live, by id.** An item that has gone, or a Shop that couldn't
      say what its items are, says so; the view never falls back to a placeholder card, and the
      test network's placeholder opens nothing.
    - **My readings of "etc":** the preview on the player's words, the closer look, "Put it on
      WORD", the docs link, and that the face picker's tile now opens the item (on the word
      being dressed) instead of only the category. Not built: a case's or a costume's own
      larger view beyond its picture and words (none is listed).
    - **Seen and not seen (the item's view):** in Chromium and WebKit, on my own dev server
      against the live test Shop, with every write to the server blocked in the browser.
      At 390, 768, and 1,280 px: with no wallet (Connect a wallet to buy), and as a read-only
      pretend wallet at an address that has the face and 18 words (You have it, the words row,
      the closer look, and "Put it on NOVEL", which then read "NOVEL's card has this face":
      saved in that browser only). At 390 and 1,280 px, as a pretend wallet that has words and
      not the face: the face picker's tile landed on the Shop with the item open on the word
      being dressed, and Buy live; a mouse click on the card's edition line, its top padding,
      and its bottom padding each opened the view, and a click on Buy did not; and with a
      wallet that never answers the signature request, the card and the view both read
      "Buying…", and after Hide the card's Buy was live again. With a Shop answer MADE UP in
      the test browser (nothing listed anywhere): a sale with an end date ("On sale until
      November 30 at 3:31 PM."), a sold-out face, a case, and a costume not yet on sale.
      Not seen: a purchase that completes from the view, a finger on the closer look (a mouse
      and scripted scrolling only), a real phone.
    - **My readings, not starl3xx's words:** "tab" is a screen in the rail and under More (the
      phone's bottom bar has five places, all taken); the categories are one switch at the top
      of the screen; a costume, when one exists, is an accessory; the placeholder stays, under
      "Try paying", until the owner switches item 1 off. (He did, the same day: "you can switch off
      the test item". `setActive(1, false)`, 0x1b41049d…e3dd. It had sold 4. The live Shop now shows
      Outer Space alone, and no "Try paying" section.)
    - **Seen and not seen:** the screen with no wallet at 390, 768, and 1,280 px in Chromium,
      on a local chain build reading a local fork: both categories, the placeholder, a limited
      edition with some left, and one sold out. And with a read-only pretend wallet at the
      address that bought Outer Space (every write to the server blocked in the browser): the
      balance row, and "You have it" with no Buy. Not seen: a purchase made from the new screen,
      the two links from the picker and the Case button, a real phone.

56. **The lockup: the tile is the name's L, and its eyes are alive** (starl3xx, 2026-11-27: "we
    have the 2 square logos (the "plain" one and the seal) but we don't have a horizontal lockup
    with the LEXIGOTCHI wordmark... i feel like that's a major oversight"; then, of the candidates
    on the design audit page, "9E is amazing" and "let's not use the seal in the lockup").
    - **What it is.** Logo A's tile standing where the name's first letter would, then EXIGOTCHI:
      one word. A separate mark beside the full name read as two things. The name's letters are
      outlines of Söhne Fett, the face of the L inside the tile, so the lockup needs no font. One
      source draws it (`lockup()` in `src/lib/cardArt/logo.ts`, beside `logoA` and `logoB`); the
      measures are the approved drawing's (the capitals 100, the tile 172 and centred on them, 15
      between, the name set tight), and the built drawing matches it to within the rounding of a
      line's edge.
    - **No seal in a lockup.** B stays what it was: pressed into a card's back, and round marks.
    - **Alive where it is drawn live** (`src/components/brand/Lockup.tsx`): the eyes blink and
      glance, as a letter's do. A blink is the letters' own (the eye keeps its shape and its lashes
      come down: a swap of two drawings), not the squash the audit page showed: the mark is a
      letter, and it stands beside letters that blink this way. Both are MOMENTS set off by one
      timer, never a loop inside the drawing. A lockup nobody sees does nothing (a hidden tab, the
      copy this width hides), and reduced motion and a low-power device get a still one. Measured
      in WebKit on a still screen: about one point of a core (0.6 to 0.8% without it, 1.4 to 2.7%
      with it).
    - **Where.** The game's rail and its phone header, the intro, the pre-launch screen, and the
      landing page's header, alive; the landing page's footer, still (one living mark on a page that
      shows two). While the intro is up, the game's own lockup behind it is still.
      They set the name in plain type before, or (the landing page) a tile with no eyes beside
      live type in the heavier Extrafett; the name is Fett now, as the L in the mark is.
    - **The phone header's lockup gives way.** At its full 28 px it is 132 px wide, 41 more than
      the plain name was, and it pushed the profile button off a 390 px screen. It shrinks to no
      less than the old name's 91 px when the row is tight, so the header fits exactly as it did.
    - **The eyes never invert** (the same day, of a one-ink drawing set light on dark: "any time
      the colors are inverted like this, the colors of the eyes need to be inverted"). On any
      ground an eye is a light eyeball with a dark pupil. So one ink has two drawings, one for a
      light ground and one for a dark one, and what is clear in them is cut out, never painted in
      a ground's colour (as in the seal).
    - **The files** (`docs/brand`, by `npm run brand:art`): the lockup on a light ground, on a
      dark one, and in one ink for each, and the name alone; each as a drawing and as pictures 512
      and 128 px tall. `tests/lockup.test.tsx` holds the drawing, the eye rule, the moments, and
      the six places.
    - **Part 2, the same day: everywhere the name was still set in type** (starl3xx, of a share
      video whose corner still said LEXIGOTCHI in plain type: "the wordmark didn't make it onto
      the share cards... did you implement everywhere including email, share cards, OG
      images"). I had held these back for his word, and that was the wrong reading of "how many
      places can we incorporate 9E?".
      - **The share video's corner** is the lockup, alive on the video's written score
        (`loop/score.ts` `markEyes`): it keeps still while the word's letters act, and while
        the back is up it blinks, looks up at the card, and blinks. Open at 0 and at 6. The frame
        picks one of four still pictures (`lockup({ pose })`); if they fail to load the name is
        set in type as before, because a video is always made.
      - **A saved picture's corner** (a word's card and the earnings picture, `?saved=1`, and so
        the Telegram welcome card): the lockup on the dark table, drawn once for both
        (`app/_og/wordCard.tsx` `cornerMark`). `CARD_LOOK` is 12. **A link card still carries no
        name:** that rule (#23) is unchanged, and it is his to change.
      - **The game's own link picture** (`/embed-image`) is the lockup and the line under it.
        The lockup under the four letters that spelled LEXI showed the L tile twice, so the four
        letters went. My choice, and the picture's larger redesign (the audit's 8A) is still his
        to answer. Its address carries no version, so a host that kept the old picture keeps it.
      - **The emails' header** is a picture of the lockup. This ends #47's "no picture": the
        picture is a file the site serves (`public/brand/lockup-email.png`, made by
        `npm run brand:art`), with the card's paper IN it (a clear ground vanishes in a mail
        program that turns a page dark), its size given, and the name as its words, lettered as
        the old header was, for a mail program that shows no pictures. It is still: a mail
        program runs no drawing code. No real mail program has shown it yet.
      - **The docs' logo** is the lockup, light and dark (`docs-site/logo`, set in `docs.json`).
        Still files: a file is never alive.
    - **Part 3: the four pages a player lands on outside the game.** A word's share page and the
      earnings share page carry the lockup at their head, alive, linking home. On the share page
      it stands where a gold label in capitals said "A Lexigotchi showcase" (a decorative label
      in capitals, which the house rules already ruled out; the page's title keeps the word).
      The page after linking X and the unsubscribe page are written as strings and run no
      script, so theirs is still (`lockupTag`). Where it sits on all four is my choice.
      To let a page draw a living lockup without the letter rig, the two small motion hooks
      moved out of the rig into `components/game/motionPrefs.ts` (the rig still offers them).
    - **Still not built:** an animated picture in email and a moving logo in the docs: neither
      can be checked from here. The seal's own one-ink file is still the dark-ground drawing
      only.

57. **The dark stock face: Stock (dark), on a pewter plate, free for everyone** (starl3xx,
    2026-11-27: "a new dark version of the stock face... give me an artifact w/a proposal").
    - **How it was chosen.** The proposal showed three plates. Of plate A, graphite: "I like A
      for the dark stock, but it's way too dark" (it was close to black). A second round showed
      A in three lighter steps, and of the lightest: "i actually really like pewter". Then, asked:
      everyone gets it, and the fog is thinner on every dark face. Its name is his: "Maybe it
      should be Stock (light) and Stock (dark)". The two are named so in the picker, and a sentence
      a player reads uses the same names ("its new owner gets it on Stock (light)").
    - **What it is.** The light stock's own engraving (the sunburst, the woven medallion, the
      tiled floor) on a pewter plate in pale line. `stockPlan` in `lib/cardArt/scenes.ts` is the
      one drawing both faces share, so they can't drift apart. The rarity is an overtone and
      never the plate: a glow of its tint behind the word, and its tint on the medallion's beads
      and on the line where the wall meets the floor. Grey first, as he asked of the light stock.
    - **No picture that existed changed.** Every other face's drawing, in every rarity, and the
      frame, are the same to the last character (35 fingerprints taken before and after). So
      `CARD_LOOK` stays.
    - **Its id is `darkstock`, for good.** Share links (`?scene=darkstock`) and saved picks carry
      it. The name a player reads can change; the id can't.
    - **The word stands in light.** A letter's arms, legs, and shoes are dark ink. On the first,
      near-black plate they vanished and the tiles seemed to float. So the plate is lit where the
      word stands: on the wall behind it and on the floor under it. Pewter needs less of that
      than the darker plates did, and it has less shadow in its corners and a stronger line.
    - **Thinner fog on dark faces** (`.cf-dark .scene-fog`: 0.42 for a hungry word, 0.2 for a
      peckish one; 1 and 0.5 elsewhere). The fog is pale, so at full strength it turns a dark
      plate white. It applies to Outer Space too, which was checked first: a hungry word there
      went white the same way.
    - **What the owner did not see when he chose the fog, said to him after:** on the LIGHT
      stock a hungry word is hidden by the fog about as much as it was on pewter. The fog is
      meant to be thick (he asked for "much more foggy", 2026-11-24). What differs on a dark
      face is that the plate itself turns white. With the thinner fog, a hungry word on a dark
      face reads more easily than one on a light face. The grey tone, the sleeping letters, and
      the status marks still say hungry. The other way to keep the plate dark is a darker fog
      of full thickness; it was offered and not built.
    - **Seen and not seen.** The built face drawn by the real picture route in all five
      rarities: the same picture, byte for byte, as the proposal's pewter. In the practice game
      in Chromium at 1,280 px and 390 px: the picker's two stock tiles, the Bag, Today, and a
      hungry and a peckish word on the dark stock face and on Outer Space, with the fog as it
      was and thinned. Not seen: the card's moving light over pewter in WebKit, the share video
      with this face, a real phone.
    - **Bugbot on #303, a real bug:** the game keeps each face's picture, and the cache named
      only the light stock by rarity. Every dark stock card on a page took the colour of the
      first rarity drawn (in my own Bag pictures a Common word wore a Legendary word's gold,
      and I read it as the plate). `RARITY_FACES` now says which faces take the rarity; the
      cache reads it, and a test holds the list to the drawings and the cache to the list.
      The server's pictures were never wrong: they are drawn for each request.
    - **Set aside:** the rarity's own plate and black and gold, from the first round. Either
      could be a Shop face later. The proposal's drawings are on a local branch that is never
      pushed.

58. **The cards are matte** (starl3xx, 2026-11-27, opening a deep dive on the design audit's part
    2: "the cards have *reflections* but they shouldn't be super *shiny* -- the cards are matte
    finish in videos and all outputs and UI locations... and the effect(s) we use to achieve these
    should be, yes, “Neo-Victorian engraving illustration: ruled linework in ink, on paper.” with
    the additional notes that the "paper" is like a playing card, and playing card backs are
    another source of inspo, along with like US dollar bills, especially the engraving and filigree
    and stuff"). The review page is "Lexigotchi Matte Cards"; its parts are numbered 10 to 16.
    - **The rule, as four sentences.** A card is paper and ink: nothing on it is metal, glass, or
      a gem. Light is drawn in lines, and it is quiet: a band of fine ruled lines, or the card's
      own lines in a lighter ink; never a soft white wash, and never a line over a letter. No hot
      spot, no glitter. The same in the game, the video, and every picture.
    - **What it replaces.** #25 and #26 made each rarity's back a material (walnut, satin jade,
      sapphire foil, polished gold, cut amethyst) with a light that follows the pointer; #34 gave
      the front a soft white band and a round glare; #27 gave the video a glare. He approved
      those two days before. This rule is later, and it wins.
    - **What he chose, of the page's choices** (four messages the same day): the front's light is
      the ruled band, "but it's too strong rn... needs to be more subtle" (12D); "13A dark plate
      is definitely the way to go" (the back is an engraved plate in the rarity's ink, on a dark
      ground); "14A is good" (the video: no glare, a veil); "15A is good" (the stock's weave on
      the diagonal, no random grain).
    - **Part 1, the video (14A).** The light that crosses the turning card was white ADDED at
      0.55: the strongest light anywhere, and at 0.9 s it hid the word. It is a veil at 0.10
      (`loopRenderer` `VEIL`): it scales down what is left of the dark, so it lifts the inks a
      little and can never pass the paper. Where and when the light crosses is unchanged.
    - **Part 2, the backs (13A).** A back is an engraved PLATE (`lib/cardArt/plate`): printed
      solid in the rarity's dark ink, its engraving in the rarity's light ink. A rarity is told by
      its inks and by how much engraving its plate carries: Common has rules and a ruled ground;
      Uncommon adds a border of lace with a lathe medallion in each corner; Rare adds lathe work
      around the seal; Legendary adds a second ring and filigree in the border's corners, in a
      second ink; Mythic adds a third ring, and its ink changes from violet to magenta and back
      along the card (a banknote's "rainbow printing": printed, so it never moves). The drawings
      are the ones he approved, character for character.
      - **What went:** the five materials in the styles and in the shader, the live WebGL
        drawing of a back, the light under the pointer and under a tilted phone, the tilt
        prompt on iPhone, the back's own frame line, Legendary's corner scrolls, and Mythic's
        spectral frame line. A back is one still picture.
      - **What moved, to make room for the plate's border:** the seal is a fifth smaller and
        sits inside the lathe work; the lettering is set in from the edge; the line at the foot
        moved up. The styles, the server's picture, and the plate share these measures, and a
        test holds them equal.
      - **Everywhere:** the game (every size, and the Bag's thumbnail), the server's picture of
        a back (which is now the WHOLE back, plate and all, so the video draws nothing under
        it), the share video, and the jackpot's face-down card (Common's plate). `CARD_LOOK`
        is 13.
      - **A collab set's back** (#53) is Legendary's engraving printed in the set's two colors:
        the field in one and the border in the other, flat. It was a soft blend of the two. My
        translation of another session's design: the partner's two colors both stay.
      - **The holder's stamp moved with the lettering** (#48, part 6; Bugbot on #315, and my own
        review, found it left behind). With no number it stands in the top left of the plate's
        FIELD, never on the lace; on a thumbnail it stands inside the field too; in the video it
        stands right of the number by MEASUREMENT (`NUMBER_END`: the card's serif, #52, had
        already made the number wider than the stamp's old place allowed). On a back under
        340 px it is smaller and rides higher, clear of the ledger's first row; under 296 px (a
        320 px phone) nothing fits beside the number, and it is left off the opened back, where
        before it covered "Case". A test holds the styles, the video's arithmetic, and the
        plate's field together.
      - **A finding kept as a rule:** a line on a plate is never finer than about a pixel where
        it is shown. The first ruled ground (7 units apart) smeared into streaks in the video
        and read as brushed metal, the very thing the plate replaces.
      - **Mythic's blended ink was in the drawings he approved**, so it is built. Whether a
        printed spectrum is enough for the top rarity (13F) is still his to say.
    - **Part 2, amended the day it shipped: the emblem is standard.** The first plates turned
      lathe work round the seal for the rarer words: one ring for Rare, two for Legendary, three
      for Mythic. The owner, on seeing it live: "I don't like the Lexigotchi emblem on the back
      getting more rings for more rarity... I think that should look the same on all rarities,
      standard". So the plate draws nothing round the seal, and the seal stands alone on every
      back, as it always had before the plates. A rarity is told by its inks and its border.
      - **My reading:** "standard" is the seal with no ring, the emblem as every back had it
        before. One ring on every back is the other reading: it is a small change if he wants it.
      - **A consequence he has not ruled on:** Rare's own step WAS the ring, so a Rare plate
        now carries Uncommon's engraving in its own sapphire inks. The border still steps for
        Legendary (filigree, a second ink) and Mythic (the blended ink). If Rare should have a
        step of its own, it goes in the border, never on the emblem.
      - `CARD_LOOK` is 14.
    - **Part 2, amended again the same day: one border of lace.** The owner, on the built
      backs: "the 'border of lace' on uncommon and rare should be the border on the back of
      every one but common". So there are two borders and only two: Common's plain rules, and
      one border of lace, with a lathe medallion in each corner, on Uncommon, Rare, Legendary,
      Mythic, and a collab set's back. Legendary's and Mythic's filigree corners are gone, and
      so is Legendary's second ink. A rarity above Common is told by its inks alone; Mythic
      keeps its blended ink, which is an ink. This also answers what Rare's own step should
      be: none. With the emblem, that is twice in one day he has taken a per-rarity shape off
      the back: **the back is one design, and a rarity is its inks.** `CARD_LOOK` is 15.
    - **Part 3, the front's light (12D).** Of five ways to show a reflection without shine he
      chose the ruled band, and of the first drawing of it: "I love the ruled band, but it's too
      strong rn... needs to be more subtle (more opacity or whatever you choose to achieve it)".
      So the band of light that crosses the card in focus (#34) is DRAWN: a ground of fine
      leaning lines the size of the card stands still on it (`lib/cardArt/light`, a picture),
      and a soft-edged window crosses the front and shows the part under it. It was a soft
      white gradient over the whole front, letters and all.
      - **Quieter in three ways, which were mine to choose.** The lines are about a third as
        strong as first drawn, and the band is wider and softer at its edges. It passes UNDER
        the letters (the front draws it, not the card): never a line over a letter. And its
        strength follows the face, because one number can't serve: 0.36 on a face with colour,
        0.16 on a dark plate (Stock (dark), Outer Space), 0.79 on the pale stock card, where a
        light line shows only by breaking the grey engraving and is still the quietest of the
        three. A face nobody has sorted takes the middle.
      - **The rarity's ink is kept, as lines:** white for most, warm for Legendary, and for
        Mythic a spectrum printed across the card, of which the band shows the part it passes
        over. On the old band the spectrum travelled with the light. Nobody asked for either;
        it is today's behaviour carried over, and 13F (is a printed rainbow enough for Mythic)
        covers it.
      - **How it moves:** two elements slide, the window one way and the lines inside it the
        other way by the same amount, so the lines stay where they are on the card. Transforms
        only. Measured (the two captures' fine pattern at two moments of a pass agree, r 0.99,
        in Chromium and WebKit). A mask moved by its position would be painted on every frame.
      - **Cost, against the old band, each made to pass again and again:** WebKit 8 to 14% of a
        core against 7 to 10% (at rest 3 to 6% for both); with the card leaning, 24 to 28%
        against 29%; Chromium slowed four times, 105% against 101%. So a few points more while
        it passes, and it passes for 1.3 s every 6 to 11 s: under one point on average.
      - **Not changed:** the round glare under the pointer (12F, his to answer) still lies
        over the letters. When it shows, how often, and for whom (never a hungry word, a card
        in a grid, or a player who asked for less motion) are as they were.
    - **Part 4, the stock (15A).** A playing card's paper is pressed with a fine weave so the
      cards slide. The game's stock already had a faint SQUARE weave made of two gradients,
      under a random grain made by a noise filter. Now it is one small picture of two sets of
      DIAGONAL hairlines, three pixels a repeat, with no grain: the grain was the one part of
      the paper that was not drawn. On the front (`.cf-tex`) it is the drawing he saw, in the
      paper's own brown. On the back (`.cb-tex`, and the face-down card) it is the same weave
      with one set of lines light and one dark, at about the strength the back's weave had:
      his drawing was of the front's paper, so the back's inks are my translation.
      - As first built, only the game drew stock. That was wrong: see "the stock is everywhere" below.
    - **Part 4, amended the day it shipped: the weave must be seen.** The owner, an hour after
      it merged: "i can't see the weave on any cards". He was right, and the fault was mine:
      the swatch he chose was enlarged three times, and I built it at its true size, hairlines
      a third of a pixel wide at 7%. Nobody could see it, and it showed LESS than the square
      weave it replaced, which had visible light lines. So the weave is now a crosshatch six
      pixels a repeat, with lines about two thirds of a pixel wide, and each direction is a
      dark hairline with a light one beside it (a line pressed into paper has a shadow and a
      lit edge), so both directions show on dark art and on pale paper. It has about the
      presence the old square weave had. Its exact strength is my choice, picked from four
      tried on real cards at pixel ratios 1, 1.5, 2, and 3; he has not seen it.
      - **Kept as a rule:** when he approves something from an enlarged swatch, show it at
        real size too before building, and compare the build with what it replaces.
    - **Part 4, amended again: the stock is everywhere a card is drawn.** The owner, after
      the crosshatch reached the game ("the crosshatch looks so good"): "crosshatch isn't in
      the share cards images/videos, either... make sure those are all updated with the latest
      changes". I had left it out of the pictures because they had never carried stock, which
      was the wrong test: a card is one object wherever it is drawn. Now `lib/cardArt/stock`
      is the weave's one source. The game's styles hold its tile, and the server's picture of
      a front and of a back lay its sheet over the card, in card units, under the letters and
      the lettering. The share video is made of those two pictures, so it carries the
      crosshatch on both sides; checked in a real video at full size, with the card turning.
      In the front's picture the frame is now drawn before the letters, which is the game's
      own order (nine pictures compared before and after: none changed). `CARD_LOOK` is 16.
      - **Kept as a rule:** a change to how a card looks is not done until the game, the
        front picture, the back picture, and a real video all show it.
    - **All four parts he chose are built** (the video, the backs, the front's light, the
      stock), with the emblem made standard on the way.
    - **Still open, and unchanged until he answers:** the round glare under the pointer (12F), a
      light on the back drawn in its lines (13E: today a back has no light at all), Mythic's
      rainbow (13F), and whether matte reaches the letters' finishes, the Holographic stage, and
      the plastic case (part 16).

59. **A face change slides in, in the face picker** (starl3xx, 2026-11-27, with a picture of the
    picker: "when switching faces, the faces should have a nice swipe animation/transition rather
    than just appearing/disappearing").
    - **What it was.** A 450 ms cross-fade on the house ease-out, which is nearly all the way in
      after a third of its time: it read as the new face appearing.
    - **What it is.** In the face picker (`SceneFrame`'s new `change="slide"`, passed by
      `sheets/SceneSheet` only) the new face slides in over the old one, which holds still under
      it, from the side the face sits on in the picker (`lib/scenes` `swapSide`: a later face from
      the right, an earlier one from the left). 520 ms on a curve of its own (`--ease-swap`): the
      house ease-out covers nine tenths of the way in the first third, and the slide was over
      before it could be seen as one.
    - **The card's rules hold.** Each face is one still picture, moved whole; nothing moves
      inside a picture (a face never moves: #34). The word stays where it stands, and each
      letter glides to its place on the new ground (`.cf-stand`: a curved ground lowers and
      turns a letter). Nothing is scaled (#48). All travel sits behind
      `prefers-reduced-motion: no-preference`; under reduced motion the new face fades in as
      before.
    - **The card's border holds still** (found by enlarging a held frame's edge, after review
      asked whether I had looked there). A face's picture is drawn only inside the card's
      window; the paper border is the card's own ground, and the frame is line work over it.
      My first slide moved the picture alone, so it passed under the side border and a dark
      face showed through the ornaments. The moving picture is now clipped to the window, and
      the clip stands still while the picture moves (each frame's `clip-path` is the window as
      seen from the picture's own place; the numbers are `lib/cardArt/looks` `WINDOW`, and a test
      works them out from it). The shade at the new face's leading edge is a strip at the edge
      of its window, never a `box-shadow` (the box's edge is 3.5% further out).
    - **The letters glide only while a change is in flight** (`.cf-changing` on the card, for as
      long as the old face is kept; caught in review, then measured). A stance is written in
      units of the card's width. With the glide always on, any change of the card's size also
      ran it: narrowing the window set four of five letters on Spring's hill drifting for half
      a second, in both engines. It would also have run in the Shop's closer look, which
      doubles the card.
    - **A letter turns about its feet on level ground too** (Bugbot on #317). The turning point
      was set only together with a turn, so it was dropped the moment a word left a curved
      face for a level one, and the letter swung about its middle for the length of the glide.
      It is set always now. Checked in a browser mid-change, Outer Space to the Stage: all
      five letters turn about their feet.
    - **Why the new face covers the old instead of pushing it out** (my choice between two
      readings of "swipe"): the letters stand in front of the picture, and their ground is part
      of it. A push moves both pictures, so the ground slides under ten still feet for the whole
      change; with a cover only the incoming picture moves, and the ground under a letter changes
      once, as its edge passes.
    - **Tidied on the way.** Which face was showing was worked out in an effect, one render
      late: that render had the new face in place with nothing under it, and only the next one
      put the old face under it and started the change. I read this in the code and did not see
      it on a screen (React may run that effect before the first paint). With a slide, a frame
      of the new face in place would be a visible jump, so it is worked out while rendering now
      (as the word's own slide is) and the question does not arise.
    - **Everywhere else is unchanged:** a face that changes with the WORD (Today's arrows) or
      behind a sheet still fades in. My reading of "when switching faces": the place a player
      switches faces. If he wants the slide on Today's arrows too, it is the same prop.
    - **Seen and not seen.** Held still at chosen moments in Chromium and WebKit, in the practice
      game's picker at 1,280 px, with the card's own timer stalled in the test browser (a held
      frame takes longer to capture than the change lasts; my first frames, taken without that,
      showed the finished change and I nearly read them as the curve being too fast, and one
      showed a blank that was only the capture): the Stage to Spring and Stock (dark) to Spring
      from the right, the Stage to Stock (dark) from the left, the letters part way down
      Spring's hill as its edge passed, and the card's side border, enlarged, cream under its
      ornaments while a dark face passed inside the window. With a read-only pretend wallet in
      the live test game (every write to the server blocked in the browser): the Stage to
      Outer Space with a Mythic word, before the window clip. A window narrowed with Spring
      showing: no letter moved. Not seen: the motion itself by a person, a phone, Outer Space
      after the window clip.

60. **The claim fee follows the word's rarity: the "gentle ladder"** (starl3xx, 2026-11-27; asked
    for as "#26", a number already taken). His words: "as I play the testnet game, I'm wondering if
    the cost to claim words is high enough", and then, choosing the gentle ladder, "i like gentle
    fee... note that the prompt needs to include updates to the docs and everywhere else".
    - **Why.** A flat $0.50 priced a Mythic word the same as the cheapest Common, and claiming
      the whole dictionary once took in about $2,300 ($2,292). The fee is now the base claim fee
      times the tier's earning weight, so a new player's first word, a Common one, is still
      $0.50, and the dictionary takes about $4,200 ($4,195.50): claim revenue roughly doubles.
    - **The ladder** (USD targets, each DERIVED as the base × `TIERS`' weight over Common's,
      `CLAIM_MULTIPLE` in `lib/economy.ts`; never typed):

      | Tier | Multiple | Claim fee |
      |---|---|---|
      | Common | 1× | $0.50 |
      | Uncommon | 2× | $1.00 |
      | Rare | 3× | $1.50 |
      | Legendary | 5× | $2.50 |
      | Mythic | 8× | $4.00 |

      A collab set's words (#53) are Legendary from its reveal, so they pay the Legendary fee; a
      word whose own tier is higher keeps it (and its fee).
    - **The contract (`Words.sol`).** Each dictionary leaf is (word, tier), OpenZeppelin leaf types
      `["string","uint8"]`, tier 0 Common … 4 Mythic (`TIER_INDEX`). `claim(word, tier, upperMask,
      proof)` and the gated `claim(…, deadline, sig)` name the tier and the proof checks it, so a
      claimer can't understate it. `claimPrice` stays the base (Common's), owner-settable and
      still moved by the price keeper within its clamp; `tierMultiplierBps[tier]` is each tier's
      multiple in basis points of the base (deploy 10,000 / 20,000 / 30,000 / 50,000 / 80,000,
      read by `Deploy.s.sol` from `config/economy.json`); the fee is `claimFee(tier)` = base ×
      multiplier ÷ 10,000. The fee still routes through `FeeSource.CLAIM` with the 75/10/10/5
      split. The token id is still `keccak256(word)`. The voucher (#51) is unchanged: it names
      the caller and the word, and the proof already fixes the tier. A new event,
      `ClaimFeePaid(tokenId, payer, tier, fee)`, is emitted beside `Claimed`, which is unchanged:
      a changed `Claimed` would silently empty every scanner reading the older contract.
    - **My readings, for him to accept or strike:** a multiplier may be set between 1× and 20×
      (`MIN_TIER_MULTIPLIER`, `MAX_TIER_MULTIPLIER`; `TierMultiplierSet` on each change), so no
      tier costs less than the base and one mistaken call can't charge more than 20×; the order
      of the tiers isn't enforced (as the base itself isn't).
    - **One tree function for the chain and the game.** `lib/onchain/dictionaryTree` builds both
      formats, and `lib/sets/server` `treeFor` builds every tree it serves or plans in the
      network's format with the revealed collab words (`tierWith`), so a leaf's tier is the tier
      the game shows. A collab set's words are held back until its release (#51: the reserve root
      comes before the reveal), so its release root is the first to hold them, as Legendary. The
      plan builders read the sets strictly. `derive:contracts` uses the same module.
    - **Base Sepolia keeps the older Words until the held redeploy (rehearsal #5).** The registry's
      `"claimTiers"` says which contract a network has (never a contract read). False: word-only
      leaves, the older three-argument claim byte for byte, the flat base for every word, and copy
      that says so. The redeploy carries this with the gate, the 3.0× caps, and the metadata
      refresh, and the mainnet deploy must include it (`docs/web3-runtime-plan.md`). He set its
      date the same day: "let's do it this coming tuesday... and send a note to the TG group via
      the bot, with upgrades that will be included" (Tuesday 2026-12-01; the note is #326's).
    - **The simulation** (`npm run sim -- --days 365 --population 1500`, seeds 7 / 11 / 23; flat
      is `--claim-flat`; no other param changed). Flat → ladder:
      - Claim revenue: $2,292 → $4,180–4,188 (+82–83%). By tier: Common $1,146 → $1,146;
        Uncommon $688 → $1,375; Rare $344 → $1,031; Legendary $92 → $460; Mythic $22.50–23 →
        $168–176 (Mythic claims 45–46 → 42–44 of 46).
      - The dictionary reaches 99% on day 51–52 → 57–58 (about 6 days later, +10–12%).
      - Letters mint out on day 60 → 60–61. Solvency holds in every run. Burned +3–5%. The
        Rewards Pool on day 365: +0–4%; at its peak: +11–16%. $WORD bought to play: +0–3%.
      - Each group's share of the words held: casual 44–46% → 38–41% (−10 to −12%); collector
        53–55% → 55–58% (+4%); gambler about 1% → about 3.5–3.8%; whale 0% → 0.2%; staker 0%.
      - **With the bounty lever on, casual players' share of the weekly bounty falls by about
        60%:** from 30–36% to 12–13% at 365 days and 1,500 players (and 15–18% → 7–8% at 120
        days and 400). They still hold about as many words, but cheaper ones, and the bounty
        weighs a theme word by its tier. He asked "we're only changing the cost of claiming
        words, right?" (yes: nothing else changed), then: "accept it and note it... the cost
        isn't that substantive tbh". `tests/loop.test.ts`'s floor for that share went from 10% to
        5%; its check that casuals get more of the bounty than of the yield stays.
    - **Every place that states or uses the claim price** moved to the word's own fee: Spell (the
      intro, "Rare word: … to claim", each suggestion's button, "Need …" opening the balance sheet
      with that word's fee), Next steps, the bought-letters and mail sheets, the Dictionary card
      ("Unclaimed · … to claim"), the word view ("To claim"), a set's words, the cost to make
      (the Market, the sell form, the card back's picture), the cheat sheet, the how-it-works
      steps, the claim's allowance, and the console (the constructor, "Set a tier's claim
      multiple", the Treasury tab's fees by tier). The player docs change in a held PR that merges
      with the redeploy, with the tester note.
61. **A hungry word's card: the ink runs low. No fog.** (starl3xx, 2026-11-27: "Now that we have
    the cards mostly nailed down, how should we render when words are peckish and hungry? fog
    doesn't feel right anymore (esp. w/the new design language)".) Until now a card showed hunger
    in two ways, both his from 2026-11-24: its face went grey, and fog rolled in over the scene and
    the word. The fog no longer fits, for three reasons. It is not drawn: it was three drifting
    banks of random noise, on a face that is now a still picture in ruled linework. It covered
    the letters, so a hungry word faded from its own card when it most needed its player. And
    one strength could not serve every face: it turned the pale stock face white, and a dark
    face needed a special thinner fog and still went to grey.
    - **Three directions were drawn on real cards** (one Common word fed, peckish, and hungry,
      on the two stock faces first, in the Bag on a phone, and on Today): 19A, the colour goes
      and the drawing stays; 19B, the ink runs low; 19C, the face is left alone. I recommended
      19A. **He chose 19B: "19B!"**
    - **19B, as built.** A card is paper and ink, so a hungry word's face is printed with less
      ink: the art layer is shown fainter over the card's own paper, lines and colour together,
      and its colour drains with it. Peckish: 0.66 of its strength, at a little over half its
      colour. Hungry: 0.34, nearly no colour. On a dark face it fades less (0.82 and 0.6), so
      the plate stays dark. Feeding eases the ink back over 0.9 s; that is a change of colour
      and not a movement, so it plays under reduced motion too. These are the numbers he chose
      from: the proposal was drawn with the style rules that shipped.
    - **The tone is on the GROUP of the face's pictures, never on a picture** (Bugbot on #328).
      During a face change the old picture stays under the new one until it is in. A hungry
      face is see-through, so with the tone on each picture the two added up to more ink than
      one, and the card popped paler when the old one was dropped. As a group they are put
      together at full strength and faded once. Checked in the game: for the 65 frames two
      pictures were stacked, the group's strength eased smoothly and nothing added up.
    - **"agreed on frame and ribbon":** only the art takes it. The frame and the ribbon keep
      their ink in every state, so a hungry card still names its rarity. The letters keep their
      colour and are never covered; their own faces show the mood.
    - **"no hunger states in any share cards":** a share picture and a video never show hunger.
      A shared card is always drawn fed. Hunger changes every day, and X and Farcaster keep a
      picture for good. They never did show it; now a test holds that.
    - **What went:** the fog layer in the front, its style rules and keyframes, the dark faces'
      special fog strengths (#57), and the old grey filter.
    - **Also in this change, mine:** the ribbon at a card's foot still carried a random grain,
      which I missed when the stock's grain went (#58, part 4). It is gone, and the ribbon
      keeps its fine ruled lines. No noise filter is left in the stylesheet; a test holds that.
    - **Not measured:** the fog was three drifting layers and its replacement stands still, so
      a hungry card should cost less to show. I have not measured it.
    - **Not seen:** a dark face with colour (Outer Space) hungry, a collab card, a real phone.
62. **A set's moments in the game: Today's card, a notice that opens the set, and getting ready**
    (starl3xx, 2026-11-27: "btw did you think through *how* these sets are released in the game?
    where in the UI etc"; and, of the three additions I offered, "I like all 3..."). Until now a
    set (#51, #53) lived in one place, the Dictionary's Sets section, which a phone reaches
    through More. A player with notices off could miss a set completely, a notice opened Today
    and left the player to find the set, and a revealed word said only "not available yet", with
    no way to learn which letters to get before the unlock. No contract change, no migration, and
    nothing here reads more than the public sets answer, so nothing of a draft reaches a player.
    - **One rule says whether a set is still news** (`components/game/sets.ts` `setPhase`):
      `revealed` (named, counting down), `firstDay` (unlocked, its limit still up), `fresh`
      (unlocked within the last 24 hours with no first day running), and `old`. Today and the
      Dictionary read the same rule. **The 24 hours are mine, not the owner's words:** on a
      network whose Words has no gate a release records no first day at all (`gateUntil` is
      null), so without `fresh` an unlock there would be old news the moment it happened, and
      the test build would never show one. The Dictionary used to fold a set to its name as
      soon as it was simply unlocked; it now folds an `old` set only, so a tap from Today lands
      on the set's words. Its order is: a first day, then fresh, then revealed (the nearest
      unlock first), then old (`byNews`).
    - **Today's Sets card** (`TodaySets.tsx`, above the stage): one row per set that is news,
      two rows at most, then "and N more in the Dictionary". A row has one of the set's words in
      its own tiles, the set's name, "A collaboration with …" for a collab, and one line in the
      Dictionary's own words (`todayLine`): "Unlocks in 3 h 05 min.", "Unlocks soon." when no
      time is set, "First day: one word per player. Opens to everyone in 20 h 00 min.", or
      "Unlocked. Its words are open to claim." A tap opens the Dictionary at its Sets section.
      A locked slot never shows on Today (a draft can wait for weeks, and a standing "A new set
      is coming" there would be noise), and the card is absent while the sets aren't known.
    - **A notice opens the set** (`lib/gameLinks.ts`): the three set notices carry
      `/play?go=sets`. The game reads `go` once (`GoHost.tsx`), opens the screen and part that
      key names, and takes it out of the address. Only the keys in `GO` mean anything: a link is
      the outside world's text, and a part's name ends in a selector. Farcaster, the browser
      notice, and Telegram already carried a note's link; an email always opened Today, and now
      uses the note's link when it is on the game's own site (`ownLink`) and the front door
      otherwise. A browser notice tapped while the game is open reloads that tab at the link
      (`public/sw.js`, unchanged).
    - **Getting ready for a revealed word.** A revealed set's words are buttons now (still drawn
      with a dashed edge: they can't be claimed). The word view (`LookupSheet`) counts the
      player's letters against the word, as it does for an open one: the letters they hold and a
      slot for each one they lack, "You only need an e.", "Mint a pack", "Find an e in the
      Market", and "Move them here". Under the first line it says "CRANE is in the set <name>.
      Unlocks in 2 h 47 min." It offers no Spell, and with all five letters it says only "You
      have all five letters." Its facts add the set's name and the claim fee. **A held word of a
      set nobody has seen is unchanged:** "isn't available yet", no set named, no letters
      counted, nothing offered (`revealedSetOf` knows revealed sets only; a test holds it).
    - **Not done, on purpose.** No page for a set and no share card for one (to consider after
      the test sets show how players react). Nothing happens on screen at the instant of an
      unlock beyond the line changing. Spell still says "isn't available yet" for a held word.
      The card doesn't say how many of a set's words the player can already spell.
    - **Tests:** `tests/set-moments.test.tsx` (the rule, Today's card, the links on each
      channel, the link reader, the word view) and `tests/sets-game.test.tsx` (the Dictionary's
      order, fold, and buttons). **Seen:** the practice game in a headless browser at phone
      size: the card, the tap, the Dictionary, two revealed words, and `/play?go=sets`. The
      practice game has no collab looks, so the tiles there are in their own rarity colors.
      **Not seen:** the chain game's Today with a wallet, a real notice tapped on a phone, an
      email in a mail client.

63. **Care is sleep: a word falls asleep, and the player wakes it. There is no snack.** (starl3xx,
    2026-11-27, on a page of ways to make feeding a moment: "what if instead of *feeding* them, we
    need to *wake* them? they get sleepy and then asleep - then we don't need an image or anything
    to *give* them?"; "works for the earning too... they can't earn if they're asleep, and they
    earn less when they're sleepy"; "I suppose the icon for it could be an alarm clock"; then
    "Build it / 27B, 28A, 29A, 30A, 31B".) Until now a staked word got peckish, then hungry, and
    the player fed it a snack. The letters were never drawn that way: a peckish letter is
    heavy-lidded and sighs, and a hungry one sleeps, with z's rising from it. Only the words said
    food, and the one thing drawn for it, a cookie on the letter's face, was the look he had turned
    down ("the static cookie/circle thing").
    - **This is the words. No rule changes:** a day to sleepy, three days to asleep, half and
      nothing, $0.02, the first each day free, all of it burned.
      | Was | Is |
      |---|---|
      | fed, full | awake ("Wide awake"; "Awake again" just after) |
      | peckish | sleepy: still in the jackpot, half its earnings |
      | hungry | asleep: out of the jackpot, earns nothing |
      | feed, Feed all | wake, Wake all |
      | snack | nothing named |
      | staked and fed | staked and awake |
      | Keep them fed | Wake them every day |
      | "Your letters get hungry. Feed your words." | "Your letters nod off. Wake your words." |
    - **28A, nothing is named.** "Waking a word costs $0.02 in $WORD. The first word you wake each
      day is free. What you pay is burned." The other choice was a name that is not a thing ("a
      wake-up call"). So "wake" is never a noun ("a free wake" reads as a vigil), and a sentence
      that needed "a snack" now says what happens.
    - **29A, the snack an ascension try burned:** "A try also burns $0.02 in $WORD." It has nothing
      to do with sleep, and it is never free.
    - **30A, three phrases:** the jackpot's rule phrase is "staked and awake"; the pet line is "Your
      letters nod off. Wake your words."; the step is "Wake them every day". Mine, held as a rule:
      never "keep them awake", which reads as the opposite of care.
    - **The marks and the lines** (my drafts, shown to him in a playable frame before "Build it"):
      the first mark is "Awake" ("Wide awake", "Awake again", "Sleepy, day 1", "Asleep, day 3"),
      then "Out while asleep", "Half while sleepy", "Nothing while asleep".
    - **The icon is an alarm clock** (his), on every Wake button and the first mark, from the icon
      set the game has. The cookie is gone from the buttons, the marks, and the letters' faces: a
      woken word still rocks for a moment, with smiling eyes and nothing on its face, until the
      new act replaces that.
    - **Reminder titles, which reach testers' phones** (mine, each made from his words and under
      the 32-character limit): "Your words are getting sleepy", "Time to wake your words",
      "Someone’s getting sleepy", "Your words are nodding off". The reminder's name in the profile
      is "A word is about to fall asleep".
    - **The code and the contracts keep their names,** as the code says "scene" for a face
      (#54): `feed`, `feedAll`, `snack`, `hunger()`, the states "fed" / "peckish" / "hungry", the
      mark key `fed`, the reminder kind `hunger`, `Staking.feed`, `feedWithSnack`. Base Sepolia's
      contracts cannot be renamed, and a rename of the code is its own change.
    - **Held by a test:** `tests/copy-rules.test.ts` bans feed, fed, snack, hungry, hunger, and
      peckish in every string a player reads and in the player docs. The operator console keeps
      the contracts' words; what it posts (the Broadcast tab) does not.
    - **Where the words were:** 16 pages of the player docs (the care page is "Staking and waking",
      and three of its anchors moved: `#sleep`, `#waking`, and the profile's
      `#caretakers-wake-words-from-any-of-your-wallets`), the game's screens and sheets, the cheat
      sheet, the intro and the landing page, the reminders (push, email, Telegram, the weekly
      email), the Telegram bot's answers, the messaging guide, and two docs pictures (the moods
      picture is three rows now: its "Eating" row is gone).
    - **After this:** the act is #64. Still to come is 31B, the sad brow on the sleepy and asleep
      faces, which I said I would show him both ways before the letters change.
    - **Today's card look (#61) stays.** A sleeping word's card fades toward paper. Its story in
      the docs is now a card that fades while its word sleeps.

64. **Waking a word is an act: a wake, a stretch, and a bow.** (starl3xx, 2026-11-27, of three
    playable ways to make the daily care a moment: "okay we're onto something here, because I
    like A the most by far"; then, with the words settled as sleep (#63), "Build it". A was the
    one with no prop: nothing is given to the word, so nothing is drawn but the letters.) Until
    now a woken word rocked from side to side for 1.8 seconds, on Today's stage or in the opened
    word only, and a card anywhere else got its ink back and nothing more.
    - **The letters are vaudeville players, and a word already stands hand in hand.** So a woken
      word does what a cast does at the end of a show: the wake passes along the word, a letter
      every 85 ms, each rising onto its toes with smiling eyes as the card's ink comes back; then
      the word raises its joined hands, and bows, eyes shut. About 2.5 seconds, against 1.8.
    - **Four beats, because a wake is not instant** (the wallet asks, then the chain takes 2 to 20
      seconds), and **nothing looks awake before the chain says so:** the tap (one sleeper half
      opens its eyes); the wait (the letters do the waiting: about once a second another one
      peeks and dozes again, never two in step, and no spinner goes on the card); it lands (the
      act); it does not (the letters settle back as they were, and the action's own line says
      what happened).
    - **A card HOLDS the look it had while its wake is on its way,** whatever the words list says
      by then. The chain's read can show the word awake a moment before the card is told the
      wake landed, and a word that woke early would have nothing left to act.
    - **One, two, or all, on every screen.** The card in focus (Today's stage, an opened word)
      plays the whole act. A small card is a still picture, so its part is small: it keeps its
      look until its turn, then shows its word awake and its letters hop once, one card after
      another, 95 ms apart (the Bag's cards; Today's word chips, which have no card, hop their
      tiles). A card that is not on the screen when the wake lands simply shows its word awake.
    - **The wake outlives the screen it was started on,** as a piece of mail does: the wake in
      hand (`components/game/wake/wakeRun`) is outside any screen, so the player can turn to
      another word, close the opened word, or scroll the Bag. Today holds the woken word on
      stage from the tap until its bow ends, then the next sleepy word steps up.
    - **The hardest part was that a screen was never told how a wake ended.** The store's `feed`
      and `feedAll` answered nothing, and Today only stopped waiting after 30 seconds. They now
      answer `landed`, `pending` (sent, not seen yet), or `none` (nothing was sent). Every Wake
      button goes through `useWake`, never the store's `feed` on its own.
    - **The rules are one pure file with tests** (`wake/wakeFlow.ts`, `tests/wake-flow.test.ts`),
      as the mail's are: the order and the times of the act, what a card holds, which letter
      stirs, and each small card's turn.
    - **No tile is scaled.** A rise and a dip are moments on the box around a letter, taken up
      by its legs, in the hover's own way (globals.css, `.wk-rise`, `.wk-bow`; the bow shuts the
      eyes with the rig's own blink). The raised hands are a second drawing of the arms, swapped
      in for a moment as a blink swaps the eye (`armsUp`; `tileShapes`, `CLASP_UP`). A small
      card's hop is the `translate` property on the tile, never a `transform`: a letter's stance
      on curved ground is the transform of the box around it, and it stays through the hop.
    - **In the rig:** the state `glad` (smiling eyes, a breath) replaced `eating`, with its
      rocking loop, its timer (`useEatingFlash`), and Today's 1.8 s hold. The card's front takes
      a state, a moment's class, and the arm pose for each letter, as a plain word row already
      took a state.
    - **Less is asked for, less is given.** Under reduced motion the letters still wake one by
      one (a change of picture), and nothing rises, lifts, bows, or hops. A tap on the card in
      focus ends the act at once. No short version: a player wakes words once or twice a day,
      and "Wake all" is one moment however many words it wakes.
    - **No sound** (his 27B). No hook was built for one.
    - **Seen:** the practice game in Chromium at 390 and 1,280 px and in WebKit at 390 px: one
      word on Today, Wake all, an opened word, and the Bag. **Not seen:** a real chain wait in
      the game (the practice game wakes at once, so the wait is covered by the rules' tests and
      by the proposal page), a real phone, a wallet, a mini-app host. **Not measured:** its cost
      in WebKit under load. It adds no loop: every part is a moment.

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
