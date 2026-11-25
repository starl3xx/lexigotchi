# Launch runbook: from the Sepolia rehearsal to mainnet

How Lexigotchi goes from today's state to real play on Base. Steps marked **(owner)** need starl3xx:
keys, money, a deploy, or a production database. Everything else is code and lands by PR.

## Where things stand (2026-11-21)

- **The game already runs on real contracts** on Base Sepolia (play-money $WORD). Production runs the
  practice game, and flips by itself when the mainnet addresses are committed (`gameMode.ts`).
- **Contracts:** code-complete. No external audit and no legal review (decisions.md #12). The
  second internal audit (`contracts/AUDIT.md`) found four issues, and all are fixed (PRs #96 and #101). 65
  forge tests.
- **App, done:**

  | PR | What |
  |---|---|
  | #94 | Any wallet plays the whole loop: paid packs, and rolls and ascension without Farcaster. |
  | #95 | Reward claims read the database. |
  | #97 | Letter draws are sticky: one valid draw per commit. |
  | #98 | The jackpot schedule comes from one 64-hex seed. |
  | #99 | The keeper runs itself (a daily cron), and the price keeper keeps prices on their USD peg. |
  | Cutover PR | Prototype buttons gone in the chain game; ascension hides while it is off. |

- **Decisions that shape launch:** $WORD only (no ETH swap). Ascension is ON at launch as the word
  ladder (#19, reversing #11); the weekly bounty is on (#11). The owner is one hardware-wallet EOA, with four separate hot keys
  (signer, keeper, price keeper, roll relayer) and no multisig.

## 1. Rehearse on Sepolia

**Done 2026-11-21** (the second rehearsal, with the owner's go-ahead). The suite was redeployed from
`main` with the throwaway Sepolia keys: 41 transactions from block 61,798,778, carrying the audit fixes
and the 4,584-word dictionary (`config/deployments.base-sepolia.json`). Then a scripted wallet-only
player, with no Farcaster session, ran the loop against it, sending real transactions and calling the
real API routes:

| Step | Result |
|---|---|
| Paid pack | revealed; asking twice gave the same letters (sticky draws) |
| Roll | revealed; a second roll on the same letter was refused (`RollOpen`) |
| Claim a word | ENROL claimed; the proof route's root check passed |
| Unstake and restake | the hunger clock didn't move; then a feed |
| Keeper | revealed jackpot day 1, correctly opened no yield epoch (no UPPERCASE word staked), and the price keeper moved all seven prices about 10% toward their USD targets |

The whole keeper run took 7 seconds, and its writes carry the builder code.

**Browser-wallet test, 2026-11-23.** starl3xx played against this suite from a local server, with
a Coinbase Wallet (formerly Base Account) and a plain wallet. The faucet, packs, claims, staking,
feeding, and rolls all worked. The batched sends carry the builder code, and Coinbase Wallet paid
Sepolia gas itself. The test drove PRs #106–#116: the status pill, Dictionary, the X-first
Showcase, the Coinbase Wallet button, the claim fee shown up front, instant pity, server-finished
rolls, honest stake and feed copy, the bounty on at launch, the cheat sheet, popup scrolling, and
the WalletConnect QR fix. The same day, the Sepolia FeeRouter's bounty carve was set to 1500. The
first week settles Thursday, 2026-11-26, at 00:05 UTC. Sepolia has no cron, so run
`npm run keeper -- --bounty` by hand then.

Still to do on Sepolia:
1. A public test deployment: a Vercel environment with `NEXT_PUBLIC_CHAIN_ID=84532`, the signer key
   and draw secret, the keeper key, the roll relayer key, and a database with migrations 0003–0005.
   It is the only place gas sponsorship can be tested. A wallet can't reach a `localhost`
   paymaster URL, and Coinbase Wallet then fails the whole send ("Something went wrong") instead of
   paying its own gas. Until it's proven, keep `NEXT_PUBLIC_PAYMASTER_ENABLED` off in production.
   Sponsorship is asked PER CALL (`sendCallsAttributed(…, { sponsored: true })`, default off), so
   turning the flag on sponsors only calls that ask: today, Move here (Letters `safeBatchTransferFrom`,
   Words `safeTransferFrom`, $WORD `transfer`). The CDP policy must allow those before the flag goes
   on; add an action to the policy before it asks.
2. Watch a payout land by itself (decisions.md #16): the keeper's `payout` job pays every share the
   morning its epoch opens. The bounty week that settles on 2026-11-26 gives one; a yield epoch needs a
   fully UPPERCASE staked word (testers had three on 2026-11-25). Proven on a fork of Base Sepolia
   (2026-11-25): three shares in one Multicall3 transaction, 171,089 gas, builder code attached, and a
   rerun paid nothing twice. The scheduled run hadn't opened a single yield epoch on Base Sepolia by
   then, and the jackpot hadn't resolved since 2026-11-21: check `/api/cron/keeper`'s logs and
   `KEEPER_PRIVATE_KEY` / `KEEPER_JOBS` in Vercel first.
3. Time a keeper run once many words exist. The word scan grows with every claim.

## 2. Keys and secrets (owner)

| What | Where it lives | Notes |
|---|---|---|
| Owner and treasury | A hardware wallet | Used rarely: ownership, `setPriceKeeper`, parameter ceilings |
| Signer key | Vercel `SIGNER_PRIVATE_KEY` | The mint authority: it can sign free packs. Never reuse Sepolia's. |
| Draw secret | Vercel `SIGNER_DRAW_SECRET` | Random and permanent. Changing it re-rolls every unrevealed commit. |
| Keeper key | Vercel `KEEPER_PRIVATE_KEY` | Fund it with a little ETH for gas |
| Price-keeper key | Vercel `PRICE_KEEPER_PRIVATE_KEY` | A third key. Fund it with a little ETH. |
| Roll relayer key | Vercel `RELAYER_PRIVATE_KEY` | A fourth key. It sends each roll's result, so players confirm once per roll and the wallet never previews the outcome (decisions.md #14). Fund it with a little ETH; each roll costs it under a cent. Never the keeper's key. |
| Answer seed | Vercel `ANSWER_CHAIN_SEED`, `ANSWER_CHAIN_DAYS` | From `npm run answerchain:generate -- --new-seed`: every pool word once by default (4,584 days; leave `ANSWER_CHAIN_DAYS` empty or set it to 4584). Back up the file offline and the seed on paper. |

The seed is never printed. It is the `seed` field of the generated file. Whoever holds it wins
every future jackpot, and losing it ends the jackpot (`setHead` reverts once the chain is live).

## 3. Database (owner, from a terminal with production access)

Apply migrations `0003` (browser push), `0004` (reward claims), `0005` (sticky draws), `0006`
(profiles: the X link, name and picture choice, email codes), `0007` (send-once markers for
email reminders), `0008` (linked wallets), `0009` (how a linked wallet joined), `0010` (the game
wallet), `0011` (saved word scenes), and `0012` (wallet sightings, for the console's Players tab) with `npm run db:migrate`. All of them only add tables or columns. Until 0004 exists, the keeper refuses to open a
yield epoch, so the bucket rolls over and nothing is lost. The console's System tab lists which
migrations production has applied.

## 4. Deploy (owner approves: about 17.2M gas over 38 transactions)

1. `npm run derive:contracts`. Then fill the deploy environment from the admin console's **Launch**
   tab, which converts the USD price ladder to $WORD at the live price. Set `TREASURY`, `SIGNER`,
   `KEEPER`, `PRICE_KEEPER`, `ANSWERCHAIN_HEAD`, and `PRESTIGE_MAX_LEVEL=5` (the word ladder, on at
   launch, decisions.md #19; `PRESTIGE_FEE` is the $0.50 base), and `BOUNTY_CARVE_BPS=1500` (the bounty is on at launch: 15% of the
   pool's cut funds it). The Launch tab fills both by default. The keeper settles each week's bounty
   on the first day of the next week.
2. `cd contracts && forge script script/Deploy.s.sol:Deploy --rpc-url $BASE_RPC --broadcast --verify`.
   `$BASE_RPC` is Lexigotchi's own Alchemy app (`BASE_MAINNET_RPC_URL` in `.env.local`).
   `--verify` uses the Etherscan key in LHAW's `contracts/.env` (`BASESCAN_API_KEY`). Etherscan's
   free plan refuses raw RPC calls on Base, but its contract endpoints (verification) answer it.
3. Move ownership of all ten owned contracts to the hardware wallet: `transferOwnership` from the
   deployer, then `acceptOwnership` from the hardware wallet. Rolls and Prestige included: like
   every contract, they start owned by the deployer. The eleventh, `SaleFees` (the word-sale fee),
   has no owner. Check that the FeeRouter lists it (`isCollector(saleFees)` is true) and that
   `splits(6)` (ROYALTY) is 100% pool before the first word sells (decisions.md #18).
4. Optional: register the EAS achievements schema on mainnet and add it to the registry. The
   `achievements` keeper job is opt-in.

## 5. Vercel settings (owner)

Already set in Production (2026-11-23): `NEXT_PUBLIC_RPC_URL` (Lexigotchi's Alchemy app, Base
mainnet) and `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`. Still to add: the keys above, plus the rest of
this list.
- `NEXT_PUBLIC_RPC_URL`: a dedicated Base RPC. Public ones disagree about nonces under load.
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`: Reown, for mobile wallets. Lexigotchi shares the Griddle
  Reown project, whose allowlist has `lexigotchi.fun` and `localhost`. Set it for Production only:
  preview domains aren't allowlisted, so WalletConnect would answer 403 there.
- Optional: the paymaster (gas sponsorship) and the VAPID pair (browser push).

`CRON_SECRET` is already used by the other crons. The keeper cron runs at 00:05 UTC.

**The price keeper follows `params.ts`.** Each day it moves every onchain price back toward the USD
ladder in `src/lib/params.ts`. To change a price for good, change `params.ts` in a PR. A manual
`setPrices` from the owner wallet gets pulled back by the next run, unless `repeg` is left out of
`KEEPER_JOBS` while the owner's price stands.

## 6. Cutover (by PR)

Commit `config/deployments.json` with the addresses and the deploy block. The merge deploys, and
production becomes the real game: the landing page's practice note disappears, and the keeper cron
starts working. Then smoke-test with a small wallet.

## Updating the word list later

Lexigotchi's dictionary is Let's Have A Word's (`data/guess_words_clean.ts`, byte-for-byte). When
theirs grows:
1. Copy the file over, run `npm test`, and update the pinned numbers in `tests/economy.test.ts` (word
   count, letter caps, tiers, Legendaries). Then run `npm run derive` and `npm run derive:contracts`.
2. Merge, then send `Words.setDictionaryRoot(<new root>)` from the owner wallet right away. Until it
   lands, the claim route answers "the word list was just updated" instead of serving proofs the
   contract would reject.
3. The letter supply caps live onchain (`Letters.cap`) and have no setter, so new words don't add
   letters after deploy. Their letters come from the existing supply.
4. The jackpot schedule doesn't move: it shuffles the frozen `src/lib/answerPool.ts`, never the
   live list.

## Known follow-ups (not blockers)

- **Stale-commit sweep.** A paid commit nobody reveals keeps its letters reserved forever. A keeper
  job that reveals commits older than a day would release them. It only matters near sell-out.
- **The chain game shows no streak, and no jackpot word on Home yet** (those fields are zeroed in
  `ChainGameProvider`).
- **Yield is not time-weighted.** A word staked for minutes around the 00:05 snapshot earns a full
  day's share. The hunger clock already stops this from being free (#101), and the keeper's scan
  could weight shares by staked time. No contract change is needed.
- **The word scan reads every claim since deploy, on each keeper run.** This is fine for months.
  Later it needs the event indexer (decisions.md #10).

## Player docs at launch

The player docs live in `docs-site/` (Mintlify, served at lexigotchi.fun/docs through the
`vercel.json` rewrites). Two pages say the game runs on Base Sepolia with test $WORD (production
has run the testnet game since 2026-11-24, `NEXT_PUBLIC_CHAIN_ID=84532`, at starl3xx's request,
so he can test everything on the live site): the note on `docs-site/index.mdx` and "Is the game
live?" in `docs-site/faq.mdx`. The game header shows a "Testnet" badge and the landing page a
"Testnet" note while `NETWORK.isTestnet`, so those follow the setting by themselves. In the same PR
that commits the mainnet addresses (and sets `NEXT_PUBLIC_CHAIN_ID` back to 8453 or unsets it),
remove both docs notes, and replace the Base Sepolia table in `docs-site/contracts.mdx` with the mainnet addresses (and its "Right now the game runs on Base Sepolia" paragraph). The Words and Letters pages' token facts (ERC-721 "Lexigotchi Word"/`WORD-NFT`, ERC-1155 ids 0–51, the 2.5% ERC-2981 signal) come from the contracts: change them with the contracts.

Two more notes come out when a switch flips, not with the launch PR:

- **Reminders.** The note under "Reminders" in `docs-site/care.mdx` and the matching sentence in
  the FAQ's hunger answer say email reminders are on and the Farcaster and browser ones aren't.
  They come out once web push (`WEB_PUSH_ENABLED`, the VAPID keys) and Farcaster notifications
  (`NOTIFICATIONS_ENABLED`) are on in production.
- **Profiles, X linking, and email reminders: switched on 2026-11-24.** Migrations 0003–0007 ran in
  production that day, and the docs PR added `docs-site/profile.mdx` and X and email to the letters,
  FAQ, quickstart, and reminders pages. The landing page follows the switches on its own
  (`xEnabled()`/`emailEnabled()` in `src/app/page.tsx`). If X or email is ever switched off again,
  change those docs pages back in the same step. X's callback is
  `https://lexigotchi.fun/api/x/callback`, and X bills each link from prepaid credits.
- **Ascension.** On at launch (#19), and the docs describe it as on. If it is ever switched off
  (`PRESTIGE_MAX_LEVEL=0`), put a note back at the top of `docs-site/ascension.mdx` and in the FAQ.
  If the stage prices, odds, or multipliers change in `params.ts`, update that page too.

The docs' pictures (`docs-site/images/*.svg`) are drawn from the game's character rig and the fee
splits by `npm run docs:art` (`scripts/docs-art.tsx`). Rerun it after changing either. The
screenshots (`docs-site/images/screen-*.jpg`) come from `npm run docs:shots` against a practice-mode
dev server (`scripts/docs-shots.mjs`); retake them after a visible change to Today, Bag, Showcase,
the Jackpot page (its bounty half), or the $WORD page, and at launch, when practice mode ends.
