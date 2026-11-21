# Launch runbook: from the Sepolia rehearsal to mainnet

How Lexigotchi goes from today's state to real play on Base. Steps marked **(owner)** need starl3xx:
keys, money, a deploy, or a production database. Everything else is code and lands by PR.

## Where things stand (2026-11-21)

- **The game already runs on real contracts** on Base Sepolia (play-money $WORD). Production runs the
  practice game, and flips by itself when the mainnet addresses are committed (`gameMode.ts`).
- **Contracts:** code-complete. No external audit and no legal review (decisions.md #12). The
  second internal audit (`contracts/AUDIT.md`) found four issues, and all are fixed (PR #96). 62
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

- **Decisions that shape launch:** $WORD only (no ETH swap). Prestige and bounty are off at launch
  (#11). The owner is one hardware-wallet EOA, with three separate hot keys and no multisig.

## 1. Rehearse on Sepolia (owner approves each deploy)

The Sepolia suite is from 2026-08-12. It predates the audit fixes (#96) and the Words ERC-4906
change (#80), so a rehearsal needs a fresh deploy:

1. Redeploy from current `main` with the throwaway Sepolia keys (`contracts/*.secret.json`, gitignored),
   then commit the new `config/deployments.base-sepolia.json`.
2. Run a Vercel environment with `NEXT_PUBLIC_CHAIN_ID=84532`, the signer key and draw secret, the
   keeper key, and a database with migrations 0003–0005.
3. Play the loop with a wallet and no Farcaster account: buy test $WORD from the faucet, open a
   pack, roll a letter, claim and stake a word, feed it, and unstake and restake it (hunger must
   carry over). Then run the keeper and claim a reward.

## 2. Keys and secrets (owner)

| What | Where it lives | Notes |
|---|---|---|
| Owner and treasury | A hardware wallet | Used rarely: ownership, `setPriceKeeper`, parameter ceilings |
| Signer key | Vercel `SIGNER_PRIVATE_KEY` | The mint authority: it can sign free packs. Never reuse Sepolia's. |
| Draw secret | Vercel `SIGNER_DRAW_SECRET` | Random and permanent. Changing it re-rolls every unrevealed commit. |
| Keeper key | Vercel `KEEPER_PRIVATE_KEY` | Fund it with a little ETH for gas |
| Price-keeper key | Vercel `PRICE_KEEPER_PRIVATE_KEY` | A third key. Fund it with a little ETH. |
| Answer seed | Vercel `ANSWER_CHAIN_SEED`, `ANSWER_CHAIN_DAYS` | From `npm run answerchain:generate -- --new-seed`. Back up the file offline and the seed on paper. |

The seed is never printed. It is the `seed` field of the generated file. Whoever holds it wins
every future jackpot, and losing it ends the jackpot (`setHead` reverts once the chain is live).

## 3. Database (owner, from a terminal with production access)

Apply migrations `0003` (browser push), `0004` (reward claims), and `0005` (sticky draws) with
`npm run db:migrate`. All three only add tables. Until 0004 exists, the keeper refuses to open a
yield epoch, so the bucket rolls over and nothing is lost.

## 4. Deploy (owner approves: about 17.2M gas over 38 transactions)

1. `npm run derive:contracts`. Then fill the deploy environment from the admin console's **Launch**
   tab, which converts the USD price ladder to $WORD at the live price. Set `TREASURY`, `SIGNER`,
   `KEEPER`, `PRICE_KEEPER`, `ANSWERCHAIN_HEAD`, and `PRESTIGE_MAX_LEVEL=0` (ascension off at
   launch; the game hides it). Leave `BOUNTY_CARVE_BPS` at its default of 0, which keeps the bounty
   off: nothing flows into its bucket.
2. `cd contracts && forge script script/Deploy.s.sol:Deploy --rpc-url $BASE_RPC --broadcast --verify`.
3. Move ownership of all ten contracts to the hardware wallet: `transferOwnership` from the deployer,
   then `acceptOwnership` from the hardware wallet. Rolls and Prestige included: like every
   contract, they start owned by the deployer.
4. Optional: register the EAS achievements schema on mainnet and add it to the registry. The
   `achievements` keeper job is opt-in.

## 5. Vercel settings (owner)

The keys above, plus:
- `NEXT_PUBLIC_RPC_URL`: a dedicated Base RPC. Public ones disagree about nonces under load.
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`: Reown, for mobile wallets.
- Optional: the paymaster (gas sponsorship) and the VAPID pair (browser push).

`CRON_SECRET` is already used by the other crons. The keeper cron runs at 00:05 UTC.

## 6. Cutover (by PR)

Commit `config/deployments.json` with the addresses and the deploy block. The merge deploys, and
production becomes the real game: the landing page's practice note disappears, and the keeper cron
starts working. Then smoke-test with a small wallet.

## Known follow-ups (not blockers)

- **Stale-commit sweep.** A paid commit nobody reveals keeps its letters reserved forever. A keeper
  job that reveals commits older than a day would release them. It only matters near sell-out.
- **The chain game shows no streak, and no jackpot word on Home yet** (those fields are zeroed in
  `ChainGameProvider`).
- **The word scan reads every claim since deploy, on each keeper run.** This is fine for months.
  Later it needs the event indexer (decisions.md #10).
