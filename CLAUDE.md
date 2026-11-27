# CLAUDE.md — Lexigotchi

Working notes for future sessions. Read `docs/spec/v0.2-changelog.md` first (it overrides
`docs/spec/v0.1.md` on any conflict), then `docs/decisions.md`.

## What this is

Phase 0 prototype of Lexigotchi — a standalone onchain $WORD collection game on Base: any wallet
plays on the web, and the same app runs as a Farcaster mini app. This repo de-risks fun +
solvency, ships the playable game, and now carries the full **Foundry contract suite** (code-complete + tested, not yet deployed/audited — `contracts/`).
Stack: Next.js App Router + TS + Tailwind + recharts; `@neynar/react` + `@farcaster/miniapp-sdk`
for the mini app; sim/economy core is **zero-runtime-dependency TS** (runs via `tsx`/`vitest`).
`/` is the landing page (`src/components/landing/LandingPage.tsx`, a server page with no wallet code); the game is **`/play`**, which is also the mini app's `homeUrl`. `/play` is responsive by width only (`GameApp.tsx`): the portrait app below `md` (phones, and every mini-app host, which renders ~424px wide), and a desktop page from `md` (a side rail with every destination, the page title in the header, screens in `lg` two-column grids, sheets as centered dialogs). Never branch the layout on `useViewer().environment`: it reads "loading" first. The four how-it-works steps live in `src/lib/howItWorks.ts`, shared by the landing page and the in-game onboarding. Their pictures are letters acting the step out, with no icon between letters and no letter shown at its snack (decisions.md #50, part 5; `tests/step-pictures.test.ts`); "Keep them fed" still has its trophy until the owner picks a picture.

## Commands

- `npm run dev` — the app; `/` is the landing page, `/play` is the game (and the mini app).
- `npm run sim -- --days 365 --population 1500 --seed 7` — economy/solvency report
- `npm run derive` — regenerate `docs/economy.md`; `npm run derive:contracts` — `contracts/config/economy.json`
- `npm test` — the vitest suite: economy + solvency invariants, the game, the routes
- `npm run build` / `npm run typecheck`
- `npm run contracts:setup` (vendor deps) → `npm run contracts:build` / `npm run contracts:test` (forge)
- `npm run keeper -- [--resolve] [--fees] [--yield] [--bounty] [--payout] [--achievements] [--notify] [--dry]` — the
  daily operator pass, by hand. **Scheduled** by `/api/cron/keeper` (vercel.json, 00:05 UTC): same
  jobs (`src/lib/keeper/jobs.ts`, `createKeeper({ dry })`), the ones listed in `KEEPER_JOBS` (default
  `resolve,fees,yield,bounty,payout,repeg,notify`; `fees` flushes SaleFees into the pool just before
  `yield`; a KEEPER_JOBS that lists jobs must name `payout` and `fees` too;
  achievements opt-in; the bounty settles each week on the first
  day of the next, `bountyPeriodToSettle`), strictly one at a time (one key, one
  nonce), and a failed job doesn't skip the rest. It needs `KEEPER_PRIVATE_KEY` and
  `ANSWER_CHAIN_SEED`/`ANSWER_CHAIN_DAYS` in Vercel; without a deployment or a key it does nothing.
  **All three are set in production since 2026-11-25** (the Sepolia keeper key; a seeded answer list
  committed with `AnswerChain.setHead` at block 63,341,138, before any reveal, and re-committed at the
  full pool's 4,584 days at block 63,523,610, still before any reveal, so `ANSWER_CHAIN_DAYS=4584`; the seed is in the
  gitignored `contracts/answer-chain.sepolia-seed.secret.json`, so a local `--resolve` needs
  `ANSWER_CHAIN_SEED` from it). The rehearsal schedule FILE no longer matches the Sepolia chain, and
  the keeper refuses it.
  **`repeg`** is the price keeper (`src/lib/keeper/repeg.ts`, its own key `PRICE_KEEPER_PRIVATE_KEY`):
  moves each onchain price toward its USD target at the live GeckoTerminal price when it drifts
  ≥5%, clamped one bps inside the contract's `maxMoveBps` (and a 25%/run cap); never on the
  fallback price, never below $5K of $WORD in the pool (the oracle's `reserveUsd` is the $WORD side, about half the pool: so a ~$10K pool), never a zero price. A no-op until the owner wires the
  key with `setPriceKeeper` on all five contracts. Loads `.env.local` itself (`--env-file-if-exists`); without it the chain
  defaults to mainnet and dies on a missing deployment. `--notify` sends the hunger warning (Farcaster,
  then browser push for wallets Farcaster can't reach) and rides the same world scan as
  `--yield`/`--bounty`.
  `--yield`/`--bounty` store each epoch's claim proofs in the `reward_leaves` table (so they need
  `DATABASE_URL`, and never open an epoch without them) BEFORE `openEpoch`; `/api/rewards/claimable`
  serves a stored leaf only while the chain says its epoch is open with that same root. Rows are
  never deleted: a rerun's rebuilt tree is stored BESIDE the first (the root is in the key), because
  an openEpoch sent but unconfirmed may still land. The rows can't be rebuilt later (the scan reads
  the latest state), so back them up like operational data.
  **`payout`** pays every opened, unpaid share itself (decisions.md #16; `src/lib/keeper/payout.ts`):
  `claim` is permissionless and pays the leaf's account, so the keeper batches claims through
  Multicall3 (150 a transaction, per-call failure allowed, 90 s budget; the rest wait a run). Players
  never collect; earnings are SHOWN instead (`/api/rewards/earnings`, `src/lib/rewards/`, the
  Earnings sheet, `components/game/earnings.ts`). "Collect" (never "Claim") is the fallback for a
  share the keeper missed. Test it on an Anvil fork with a throwaway database, never on the real
  chain: run `scripts/keeper.ts` with `tsx` directly and explicit env, so `.env.local` stays out.
- `npm run answerchain:generate` — the pre-committed jackpot answer schedule + `ANSWERCHAIN_HEAD`.
  Output is SECRET + irreplaceable (gitignored `*.secret.json`) — back it up offline; the keeper reads it daily.
  **Mainnet uses `--new-seed`**: the whole schedule re-derives from one 64-hex secret
  (`src/lib/answerChain.ts`), which the hosted keeper holds as `ANSWER_CHAIN_SEED` (+
  `ANSWER_CHAIN_DAYS`). **Every list covers the whole frozen pool by default** (`FULL_SCHEDULE_DAYS`
  = 4,584, about 12.5 years): each word is drawn exactly once, so a drawn word is never drawn again
  (starl3xx, 2026-11-25). A shorter list would run out and need a new chain, which could repeat an old
  answer. The same seed lengthened keeps its first days' answers (a partial shuffle), which is how
  Sepolia went from 730 to the full pool before its first reveal. **The contract enforces it too**
  (mainnet's AnswerChain; Sepolia's predates it): `wasRevealed` remembers every revealed word, and
  `reveal` reverts `AlreadyRevealed` on a repeat, so a list rotated in after exhaustion must leave
  out every revealed word or the jackpot stalls at the repeat (decisions.md #20). The keeper checks each derived link against the onchain `currentCommit`
  before revealing (`src/lib/keeper/answerSchedule.ts`), so a wrong seed or a re-vendored dictionary
  stops the run. The seed is printed nowhere; it is in the file's `seed` field.
- `npm run db:generate` (schema → `drizzle/` migration) → `npm run db:migrate` (apply to Neon). Needs `DATABASE_URL*` in `.env.local`.
  Pull main first: a stale checkout stops at its own last migration. Jake runs production migrations.
  **A new migration must be dated after the last one** (its `when` in `drizzle/meta/_journal.json`):
  `migrate` skips an older-dated one and still says "applied successfully". Main's dates run ahead of
  the clock, so when `generate` stamps an earlier time, set `when` by hand just past the last entry.
  `tests/migrations.test.ts` fails on it. After a merge that renumbers one, check the table exists.
- **Redeploying production after a Vercel setting changes:** merge a PR to main (every merge builds;
  `vercel.json` skips nothing). The dashboard's Redeploy hasn't worked for the owner. A setting
  takes effect only in the NEXT build, so turning a switch off needs a merge too (or a rollback to
  a deployment built without it: `npx vercel rollback <deployment>`). **This Mac reaches Vercel
  through `npx vercel`** (no installed binary; a stored login as starl3xx, and `.vercel/project.json`
  links the repo): `npx vercel env ls production` lists setting NAMES, and a value is added on
  standard input, never `--value` (`printf %s "$v" | npx vercel env add NAME production`).
  Production only: a Preview build also runs with `NODE_ENV=production`, so a flag set there would
  send from a preview. Check the result at `/api/profile/config` and similar switch endpoints.
  **To see what a cron run did, read its log, never call the cron route:**
  `npx vercel logs -e production --since <ISO time> --until <ISO time> --json` (the keeper logs at
  00:05 UTC, the daily reminder at 13:00 UTC; each line's `data.message` is the text).
- The operator console is at **`/admin`** (no separate command; part of the app).

## Architecture

- `data/guess_words_clean.ts` — vendored dictionary (source of truth). Do not edit; if it
  updates upstream, re-vendor and re-run tests.
- `src/lib/dictionary.ts` → canonical **4,584** deduped words (Let's Have A Word's list, re-vendored
  2026-11-21). A re-vendor moves the derived economy (`npm test` pins every number), the Merkle root
  (`npm run derive:contracts`), and, after a deploy, needs the owner's `Words.setDictionaryRoot`.
  The jackpot schedule does NOT move: it shuffles the frozen `src/lib/answerPool.ts`.
- `src/lib/economy.ts` → letter slots/odds/caps + rarity tiers. **Derived, never hardcoded.**
  Formulas: caps = `floor(slots × DEMAND_MULTIPLE)` (3.0 since decisions.md #21 → 68,760; Sepolia's
  deployed Letters keeps 2.5× → 57,294 until a redeploy); tiers = `floor` percentile cuts + alphabetical
  tiebreak. Tested against the spec.
- **Collab sets** (decisions.md #53, built in parts; part 1 is the data): a set is `standard` or
  `collab` (a partner's name and link, two colors, a stamp; exactly five words). A collab's look is
  its identity: a draft's to edit, locked at the reveal (`rules.ts` `IDENTITY_KEYS`,
  `revealProblems`), and **nothing of it reaches a browser before the reveal**, not even that the
  set is a collab. **No real partner, name, logo, or color ever ships in this repository**, and
  "Test collab" is made only by the owner's button on a test network. **No collab set can be
  revealed until its card ships** (`rules.ts` `COLLAB_LIVE`; the PR that ships the card flips it).
  The stamp is a raster picture in the database (`set_stamps`; PNG or JPEG, never an SVG, and
  typed by its own first bytes both ways); `/api/sets/{id}/stamp` answers only for a revealed set.
  **A set's first day has a rule** (`gate_rule`: every verified player, an allowlist, or a token's
  holders on Base MAINNET): `lib/sets/firstDay.ts` checks it AFTER verification, of the wallet that
  CLAIMS (never the whole profile: a listed wallet would let in every profile it is linked into),
  and it fails closed (unreadable = "try again", never "yes"). **A deploy never waits for a migration:**
  the sets must read and plain sets must save before 0023 has run (`listSets` falls back to
  0021's columns; `insertSet` uses a raw insert, because Drizzle's insert names EVERY column of
  the table). A new column on `word_sets` needs the same care, and `scripts/sets-db-check.ts`
  must pass on a database with and without the newest migration.
- **A collab word's LOOK is chosen by the word, never by its tier** (decisions.md #53, part 3;
  `lib/collabLook.ts`). `collabLooksOf` is the one lookup (word → the two colors, the stamp, the
  partner), and it is the same object as the rarity layer's collab words. In the game the
  components that draw a word (`WordTiles`, `MiniTiles`, `SceneFrame`, `SceneThumb`) look it up by
  the word (`components/game/collabLooks.tsx`), so a new screen needs nothing; a page outside the
  game passes `look` / `collab`. A tile takes the two colors where its tier goes (`TileTier`).
  **The two colors are any two colors: never draw in them as given.** Use `collabFinish` (the
  tint is thinned until the letter reads), `collabCardLook` (the ink is darkened until it reads on
  paper), `collabBack` (deepened until cream reads); `tests/collab-look.test.ts` sweeps the color
  cube. A back is drawn by three renderers (the game's CSS, the server's picture, the video's
  shader): a collab's ground is painted in the first two with the same gradient, INTO the server's
  picture, and gets no live material. The stamp stands on a paper plate (it is any picture). The server's pictures get the stamp as bytes (`stampDataOf`), never by fetching the stamp
  route. **Every card picture's address names the look (`c`)**, as it names the stage: a reveal
  changes a card without changing the word, and a picture is kept a week. Never give a draft's
  word a different address or cache header (it would tell which words are in a draft).
- **Token metadata** is `GET /api/word/{tokenId}` (`lib/wordMetadata.ts`; decisions.md #53):
  `Words.tokenURI` = base URI + decimal id. It follows the chain's live state (case, ascension)
  and says of a set only what any visitor may see: "Set" once released, "Collab" from the reveal,
  nothing of a draft. A new trait goes in `wordMetadata` with a test. (`/api/word` with no id is
  the $WORD token's numbers, a different route.)
- **A word's rarity has two names; use the right one** (decisions.md #53, part 2; `lib/rarity.ts`).
  `wordTier(word)` is the DERIVED tier (the full dictionary's; supply, odds, the simulator).
  `tierWith(word, collab)` is the tier the game TREATS it as: a collab word is Legendary from its
  set's reveal, a higher own tier is kept. **Anything a player reads, sorts, filters, or is paid
  by asks the second:** a component calls `useTierOf()` / `useTierCounts()`
  (`components/game/useRarity.ts`), a server render that only shows a rarity `collabSoon()`
  (`lib/raritySoon.ts`, falls back to derived), and the keeper `epochTiers()`
  (`lib/keeper/tiers.ts`), which reads with `collabStrict()` (this run's own read, never the sets
  loader's kept copy) and THROWS when the sets can't be read: no epoch is opened on guessed
  rarities. **`loadSets()` answers `known: true` from a kept copy after a failure**: right for
  holding words back, wrong for anything that pays; a paying caller passes `{ strict: true }`. `tests/rarity-override.test.tsx` lists the files that may still name `wordTier`; a new
  one fails it, so add the file there with its reason or use the game's tier. The collab words
  are passed in, never read inside `rarity.ts`, and never reach `lib/economy.ts` or the sim.
- **Reserved word sets** (decisions.md #51; `src/lib/sets/`, `lib/db/sets.ts`, tables `word_sets` /
  `set_words` / `dictionary_roots`, migration 0021): themed groups of dictionary words held back
  and released later. A reserved word is one `Words.dictionaryRoot` leaves out; a release is a
  root that includes the set's words. **The lists are PRIVATE and live only in the database** (the
  repository is public): never commit, log, or paste a set's name or words, and never log a
  driver's error from a sets query whole (its text carries the statement's parameters: log
  `codeOf(err)`). `publicSets` (`rules.ts`, pure) is the ONE place a set's contents become public:
  a draft is a locked slot with nothing in it. What can't be hidden is WHICH words are held back
  (the dictionary is public and the game says "not available yet"), so that is only kept slow: one
  word a request, and `allow("proof", ip)`. **Proofs follow the chain** (`lib/sets/server.ts`
  `serving`): every root the server builds is stored with the words it leaves out BEFORE its
  transaction is shown, and `/api/dictionary/proof` serves from the tree behind the root the chain
  holds now; a word is offered only when it is in that tree AND in no unreleased set, so a draft
  edit never stops a claim (the admin says "root out of date"). `planReserve` moves the chain to
  what the sets hold back; `planRelease` adds exactly one revealed set's words, never removes one,
  refuses a set not fully held back on the chain, and puts `setGate` BEFORE `setDictionaryRoot`
  where the network's Words has the gate (`hasGate` asks the contract). A set is marked released
  from the chain (`reconcile`), never by hand. Admin: the **Sets** tab (`/api/admin/sets`, gated
  on the server and `no-store`, like Players); `npm run sets -- status | commitment | reserve |
  release <id> | confirm` prints the same plans and sends nothing. **Full dictionary, always:**
  caps, mint odds, tiers, token ids, the answer pool (`tests/sets-derivations.test.ts` fails if one
  of those modules imports `lib/sets`). **Released words only:** anything that says "of the
  dictionary" to a player (`releasedWordCount` / `releasedWords`: the free-letter stop, the deal
  alert, the dictionary-share achievement, the admin's numbers). No tables or no database = no
  sets and the old behavior; a failed read with nothing kept answers `try_again`, never the full
  tree. `scripts/sets-db-check.ts` proves the SQL on a throwaway local Postgres (rerun it after
  touching `lib/db/sets.ts` or `lib/db/setVouchers.ts`). The jackpot needs no special case: a
  held-back answer rolls over like any unowned word.
  **The first-day gate** (`Words.sol`: `gatedUntil`, `setGate`, `claimSigner`, and a second `claim`
  that takes a voucher; `contracts/AUDIT.md`, fifth pass): for a set's first day a claim of one of
  its words needs the server's voucher. **Built, merged, and NOT deployed: Base Sepolia's Words
  predates it, and Words can't change after deploy.** Everything asks `hasGate()` first, which reads
  the REGISTRY (`"wordsGate"` in `config/deployments*.json`, set true by the PR that records a
  redeploy with the gate), never the contract: a failed read can't tell "no gate" from an RPC
  hiccup, and reading a hiccup as "no gate" would plan a release with no gate. For the same reason
  a gate that can't be read is never "no gate": no release plan, and no mark of a release. Until
  the redeploy the voucher route answers `not_gated`, the proof route never says `gate`, and a
  release is the root alone. The redeploy is
  the whole suite and resets the test build: never run it without the owner's word on the plan and
  the date (`docs/web3-runtime-plan.md`, "rehearsal #5"). `POST /api/sets/voucher`
  (`lib/sets/voucher.ts` pure, `lib/db/setVouchers.ts`, table `set_vouchers`, migration 0022): a
  verified profile (`resolveFreeIdentity`) that PROVES the wallet is its own (its profile session,
  or a Farcaster sign-in Farcaster ties to the profile: unlike the free snack, this voucher spends
  a scarce slot on a word the caller names), at most `per_player_limit` different words of a set
  per profile across linked wallets. **Count vouchers issued, never words held** (a voucher has no
  nonce: the audit's one note); a slot comes back only when the chain's `Claimed` history shows it
  expired unused, asked about EVERY wallet the row's vouchers named (`named`) and the profile's
  wallets, never only the latest (a renewal from a linked wallet leaves the first wallet's voucher
  spendable). One row per profile per word: the same word again renews or revives that row. The game's claim asks for the voucher when the proof route says `gate`
  (`claimCalls(..., voucher)`; without one it is the old call, byte for byte), and every refusal
  has its own sentence (`components/game/setGate.ts`). A release leaves words somebody already
  holds out of its gate (`setGate` reverts on one).
  **In the game** (`GET /api/dictionary/sets`, `components/game/useSets.ts`, `sets.ts` pure,
  `SetsSection.tsx` at the top of the Dictionary): the route gives `publicSets` and two counts, so
  the app itself knows nothing of a draft's name, grouping, or dates. It also carries `held`: the
  words held back now as ONE UNLABELED LIST (the owner's choice, 2026-11-26: the screens must leave
  them out, and which words are held back can't be secret). **One rule hides them:**
  `lib/dictionaryList` `entryStatus` answers `held` (after the owners, never `open`), so Spell, the
  Dictionary, the word view, the Market's picks, and Today's next steps (`useTakenWords`) all leave
  a held word out through the status they share; use `cantClaim(status)` where a claim is offered,
  never a list of your own. Unknown is not "none": no section while the read is loading or failed,
  and nothing is called held until the list is known. A released set's words carry its name on the card's back
  (`useCardFacts().set`, `backFoot`), a RELEASED set's only. **Reminders** (`lib/notify/sets.ts`,
  the hourly `/api/cron/sets`, kind `sets` = "A new set of words", on by default): revealed,
  unlocked, first day over; one mark per set and moment in `reminder_marks` (account "all"),
  claimed first and given back when it reached nobody; nothing older than six hours is announced;
  `SET_REMINDERS=off` mutes them. The same route reveals what is due and marks releases. The
  "A new set of words" choice shows in the profile only once a set exists. Never name a reserved
  word in public copy.
- `src/lib/db/` → Drizzle + Neon Postgres — the **server-side** campaign / add-tracking backend
  (replaces the client's optimistic localStorage flags). `schema.ts` (users by FID, campaign cast
  proofs, the idempotent pack-grant ledger), `client.ts` (lazy pooled `getDb()`), `queries.ts`
  (write-once add/onboard, cast proof, status). Migrations in `drizzle/`; liveness `/api/health/db`.
- `src/app/api/campaign/` (`record-add` / `verify-cast` / `status` / `onboarded`) → the campaign API.
  Every route derives the FID from a **verified Quick Auth JWT** (`src/lib/auth/quickAuth.ts`,
  domain-pinned — never trusts a client-supplied fid). `verify-cast` confirms the share via Neynar
  (`src/lib/neynar.ts`, raw REST + `NEYNAR_API_KEY`). The client calls these through
  `src/components/game/campaignClient.ts` (`sdk.quickAuth.fetch`), wired into `useAddMiniApp` (add),
  `PreLaunchScreen` (status + share), and onboarding. The verified-share path needs `NEXT_PUBLIC_URL`'s
  host to match the manifest domain (the Quick Auth `aud`).
- `src/lib/notify/` → **Farcaster/Base push notifications**, Neynar-managed. `send.ts` (transport +
  the three guards: non-production hard-stops, `NOTIFICATIONS_ENABLED` must be `"true"`, missing key
  throws at import; an empty `targetFids` is `no-recipients`, NEVER a broadcast), `templates.ts`
  (copy — titles never interpolate so the 32-char cap is provable; variants rotate by epoch-day;
  ids are day-keyed for NUDGES and event-keyed for RECEIPTS), `triggers.ts` (pure targeting).
  `webhookUrl` in the manifest points at Neynar, **derived** from `NEXT_PUBLIC_NEYNAR_CLIENT_ID` —
  Neynar owns the whole token lifecycle, we store no tokens and send by FID. Nothing sends without
  `NOTIFICATIONS_ENABLED=true` in production: **set 2026-11-26, with the owner's word**.
  **The service's `uuid` must be a real UUID** (`notificationUuid` in `send.ts`: made from our id
  and the PLAYER, and a send with an id goes out one player a request, so a retry to a changed
  audience never tells a player twice; revisit that at some thousands of players). Our ids are words ("paid-20784"), the service refused every request with
  "Invalid body parameters", and so NO Farcaster notification went out from the day the channel
  was armed until the first armed keeper run showed it (2026-11-27). No test spoke to the service.
  To check a body against the service without notifying anyone, send it to a FID that doesn't
  exist: a good body answers 422 `NoNotificationTokens` (which the sender reads as "nobody to
  tell", never as ok).
  **A receipt to a player goes through `notifyPlayers`** (`lib/notify/players.ts`): a kind, and a
  `PlayerNote` per account (who, what, an email ledger). It asks the choices, sends to Farcaster or
  else the account's browsers, and emails under a send-once mark. A sale (`sold.ts`), a payday and
  a bounty share (`paid.ts`, fed the payout's `RewardClaimed` events and every share of the epochs
  it worked through: `toldShares` tells of a day or a week ONCE, in the run that pays the first of
  it, with the player's whole share, and says "paid" of all of it only when all of it is; its
  header names the rule's limit and the two rules dropped before it)
  use it, and the deal alert (`deals.ts`, in the keeper's `notify` job: the Market's own
  `oneLetterShort`; one alert a day and the same letter and word once a rolling week, both marks
  (`claimMarkEvery`) that `tellDeals` gives back when the alert reached nobody: `notifyPlayers`
  reports whom it reached through `onReached`). Payday and the deal alert are
  opt-in (`KIND_INFO[kind].on` is false). **One email a week** (`digest.ts`,
  `reminder_prefs.email_cadence`): a player's choice, in place of the EMAILS of `DIGESTED_KINDS`
  (daily, payday, deal); every email sender asks `prefs.emailsNow(account, kind)`, and a new kind
  that can come every day joins `DIGESTED_KINDS`. Hunger and a jackpot win never wait for it. It
  goes out in the keeper's `notify` job on a week's first day, after `payout`. New sends hang on keeper jobs that
  already run: a new job name never runs where `KEEPER_JOBS` is set.
  **A choice per kind** (decisions.md #47; `lib/notify/kinds.ts` pure, `lib/db/reminderPrefs.ts`, table
  `reminder_prefs`, migration 0018, `/api/profile/reminders`, the profile's "What to tell me"
  card): a player's ACCOUNT chooses which kinds it gets, for every channel at once. Only what was
  CHANGED is stored; the rest follows `KIND_INFO[kind].on`, so a player who changes nothing gets
  what they got before. **Migration 0018 ran in production (the Sepolia build) on 2026-11-26**
  (both tables checked with a read-only query: `migrate` can say "applied" and skip one), so the
  choices save, the new email kinds send, and the weekly email can be chosen. **Every sender asks `loadPrefs()` first**: a missing table is the defaults
  (the migration hasn't run), but a FAILED read is `known: false` and that pass sends nothing,
  because someone may have turned the kind off. A new kind is added to `REMINDER_KINDS` with its
  default (off, if it would be another daily message) and its sender asks the book. `reminder_marks`
  (same migration) is the send-once mark for any kind that has no column of its own.
  **A sale tells its seller** (decisions.md #45; `lib/notify/sold.ts`): a receipt hung on the sales
  recorder (`recordNewSales` hands a new row to the one caller that inserted it), sent by the
  Market's sales route after it answers (`lib/afterResponse.ts`) and by the keeper's `fees` job, to
  Farcaster or else the seller's browsers, and by email to a seller who keeps email on
  (`emailSold`). Recent sales only (`SOLD_TELL_WINDOW_MS`, 30 h: a backfill tells nobody, and it must
  stay wider than the keeper's daily cadence), one message per seller for a transaction's sales,
  the id per FILL (`sold-<tx>-<log index>`: a letter listing fills in parts). A row is new only
  ONCE: the reader hands rows out as it records them (`catchUpSales({ onNew })`), its callers
  start the send at once (never at the end of a pass), and a dry keeper run reads none.
  **A public route never imports a sender at its top** (each throws at import when armed without
  its keys): import it at the moment of use, inside a catch, as the sales and subscribe routes do.
  A browser's first subscribe gets one "Reminders are on" push (`remindersOn`), the channel's
  end-to-end proof. The switch-on order is in `docs/web3-runtime-plan.md` (keys first, flag last).
  **Browser push** reaches wallet-only web players: `webPush.ts` (VAPID sender, its OWN switch
  `WEB_PUSH_ENABLED`, same three guards; prunes 404/410 endpoints), `webPushSubscription.ts`
  (validation: the endpoint must be a known push-service host, or the route is an SSRF hole),
  `src/lib/db/webPush.ts` + table `web_push_subscriptions` (one row per browser, keyed by wallet,
  ≤5 per wallet; a full wallet REFUSES a new browser, never evicts, since subscribing is unsigned), `/api/push/{subscribe,unsubscribe}`, `public/sw.js` (push + click only, no
  `fetch` handler), `useWebPush.ts` + `ReminderToggle.tsx` (More, and Home's hunger card). The
  `triggers.ts` `webPush*` helpers skip anyone Farcaster already reaches. iPhone needs the Home
  Screen app (`src/app/manifest.ts`). Dark without `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (no toggle
  without it, nor in the mock game) and `WEB_PUSH_ENABLED=true` in production (no sends without it).
  **Both set 2026-11-26.** A failed turn-on says which step failed and shows the browser's own
  words (`enableFailure` in `webPushSubscription.ts`, pure, tested): the first real tap failed in
  the browser's own `pushManager.subscribe`, before any request to us, behind a generic "try
  again". Headless Chrome can't reproduce it (it refuses every push subscription); the request log
  (`npx vercel logs requests`) shows whether a POST to `/api/push/subscribe` ever arrived.
  **Proven end to end on 2026-11-26:** a real Firefox subscription on the live origin, stored
  through the live route under a made-up wallet, got production's "Reminders are on" and the live
  service worker showed it (headless Firefox with `dom.push.connection.enabled` and
  `dom.push.serverURL` set does real pushes; headless Chrome does none). The same day the owner's
  Brave failed twice over: `pushManager.subscribe` threw "push service error" until he turned on
  "Use Google services for push messaging", and then Google's push service answered **410** to the
  confirmation, twice, four seconds apart, for a subscription Brave had just made. So: the sender
  logs the status and the HOST of every push that didn't go out (never the endpoint); the
  confirmation (`lib/notify/confirmPush.ts`) drops a new row only after a second "gone"; and **the
  subscribe route WAITS for the confirmation** and answers 502 `push_refused` when it is refused,
  so "Reminders are on" means a reminder reached that browser. A browser whose row a LATER send
  drops still says "on" until its own subscription ends: nothing reconciles that yet. The VAPID pair's only copy outside Vercel is the gitignored
  `.env.vapid.local` in the owner's checkout: never make a new pair, which orphans every subscribed
  browser.
  **Profile** (`sheets/ProfileSheet.tsx`, opened by the header picture; the balance pill keeps
  "Your $WORD"): linked accounts (Farcaster, Coinbase verification, X once switched on), the free
  daily letter, and the name and picture, which come ONLY from a linked account (`useProfile`'s
  `resolveIdentity`: the player's choice, else Farcaster, else X). Edits need a wallet session:
  `lib/profile/session.ts` (a SIWE challenge with an HMAC nonce, checked for contract wallets too,
  then a 30-day HMAC token in the `x-lexigotchi-session` header, never a cookie, because a host
  frame drops third-party cookies), `/api/profile/{config,challenge,session,me}`, `lib/db/profiles.ts`
  + tables `profiles`, `x_link_states`, `email_codes` (migration 0006). Dark until
  `PROFILES_ENABLED=true` + `PROFILE_SESSION_SECRET` (32+ chars); a missing table answers
  `not_configured`. The email is never public; no X token is kept.
  **Link X** (`lib/profile/x.ts`): OAuth 2.0 + PKCE; `/api/x/start` (session → a single-use state row
  with the verifier → X's consent URL), `/api/x/callback` (exchange within X's 30 s, read
  /2/users/me once, drop the token; lands on `/play?x=…`, or a "go back to the game" page when a
  Farcaster host opened X in another browser), `/api/x/unlink`. One X account names one wallet: a
  new link moves it. `/api/world` merges each wallet's chosen face (`mergePublicFaces`). Dark until
  `X_CLIENT_ID` + `X_CLIENT_SECRET`; callbacks must match the console exactly (127.0.0.1 locally).
  **Linked wallets** (`lib/db/walletLinks.ts`, tables `wallet_links` + `wallet_link_codes`, migration
  0008): several wallets as one account, named by its first wallet (≤5). One bag, one profile (the
  profile routes act on `sessionAccountOf`, the session wallet's account), one free daily letter
  (`relatedDailyKeys` walks the account's wallets; the daily is always signed under a FID, X, or a
  Coinbase-verified wallet's own key, so linking never adds a letter). Link: the account's session
  makes a single-use code (`/api/profile/wallets/code`), the joining wallet signs a link message
  naming the account with the code as its nonce (`…/message`, then `…/link`; a sign-in message never
  passes for a link or the reverse). Refused: a wallet in another account or heading one, a full
  account, a wallet with its own X or email (nothing is merged). Unlink (`DELETE /api/profile/wallets`)
  waits for tomorrow on a day the account took its letter (`accountClaimedToday`, fails closed).
  Links are public (the public view carries `wallets`), like X. Every read treats a missing table as
  "no links". Letters stay in the wallet that holds them: only the connected wallet acts. **Move
  here** (`lib/onchain/move.ts`, `moveToWallet` in the game API): the HOLDING wallet sends its loose
  letters (one `safeBatchTransferFrom`, all 52 ids) and held words (`safeTransferFrom` each) to a
  wallet in its account, the account read fresh at click time (never from a link or stored value);
  staked words stay; it waits while a loose roll on a moved letter is open (`readOpenRolls`). Account
  wide: the leaderboard sums an account into one row (`buildLeaderboards(…, accountOf)`), and
  reminders resolve by account (`loadLinkMap` reads every link once; `accountFidLookup`; the daily
  cron uses `relatedDailyKeysMany`, the same walk the daily route refuses on). **"You" is the
  player, everywhere** (starl3xx, 2026-11-24: "everything should be profile-based"): read
  `usePlayerWallets()` (connected + Farcaster-verified + profile wallets) for any "yours", total, or
  list; name a single wallet only for a verb only that wallet can do (sign, cancel, fill, move).
  Server lists of players resolve faces with `playerFaces` (lib/profile/faces.ts). **Farcaster
  wallets join on their own** (`lib/profile/farcasterWallets.ts`, migration 0009 `via`/`fid`;
  `POST /api/profile/farcaster` once per page load with a wallet session or Quick Auth): a wallet
  joins when one FID verified it AND a seed (the first wallet or a signature link); Farcaster rows
  never vouch (no chaining), never merge accounts, prune only on a positive Neynar answer and never
  on a claimed day; one advisory lock serializes writes. The core link reads never select `via`/`fid`,
  so a database without 0009 still resolves accounts. **Game wallet** (`lib/db/gameWallet.ts`, table
  `game_wallets`, migration 0010; its own table because `getProfile` selects every profiles column):
  the wallet the player keeps everything in; a stored wallet that left the account reads as none.
  `gameWalletAdvice` (pure, tested) decides the notice on Today and the Bag (GameWalletNotice);
  `useWalletHoldings` reads each wallet's letters and $WORD; Move can carry $WORD (opt-in).
  **Caretakers** (contracts: `Staking.setCaretaker`, design `docs/linked-wallets-onchain.md`): a
  staker names its other wallets, which may feed, roll, and ascend its STAKED words (the caller pays;
  the free snack is the staker's profile's; commits name the staker; only the staker unstakes). Game words carry
  `care` (the connected wallet cares for the staker); word rolls and ascensions look up commits by the
  staker; the Wallets card sets them per wallet (`readCaretakers`, `setCaretakerCalls`).
  **Free things, once per PROFILE** (`lib/db/freeClaims.ts`, table `free_claims`, migration 0013;
  starl3xx: "only one wallet per profile should get a free anything"): the free daily (kind "daily",
  per chain day) and the free pack (kind "pack", once) record the account and the key they sign
  under, first key wins, before signing; another key is refused unless the first voucher expired
  unused; a DB error refuses; no table = the onchain checks alone. daily-status adds the recorded key
  to its walk. **The free-letter policy** (decisions.md #21; `lib/freeLetters.ts` pure + tested,
  `lib/onchain/freeLedger.ts`, `lib/onchain/freeIdentity.ts`): every verified profile gets a free pack
  of 5 plus 10 free daily letters (params `freeLetters.freeDailyLimit`), all from one budget
  (`FREE_LETTER_BUDGET`, else params 30,000), and free grants stop at `freeStopClaimedFraction` 0.95
  of the dictionary claimed (`claimedWordCount`, the Claimed scan, cached 5 minutes). `free_claims`
  is the LEDGER (migration 0015: `letters`, `expires_at`, `used`): a grant counts from signing; once
  its voucher expires it is settled against the chain (`freePackClaimed` / `dailyUsed`), and an unused
  one gives its letters back and its day stops counting. Settle BEFORE reading the profile's own grant
  (a re-issue is only of a grant that still counts). **A FID counts only for a profile it belongs to**
  (`resolveFreeIdentity`): it verified one of the profile's wallets (Neynar; an outage counts), or the
  request carries that wallet's profile session (`x-lexigotchi-session`, sent by `openPostJson`).
  Otherwise the request falls through to the profile's X and Coinbase keys, then is refused
  `farcaster_wallet_unverified`. So every grant lives on the profile: no stranger can record on or hold
  someone else's letters, and nobody gets a second set under a key the profile never sees (Bugbot on
  #178 and #199; an `fid:` ledger with cross-wallet counting was tried and dropped for this). Both
  routes share `resolveFreeIdentity` (FID,
  then X, then Coinbase); the pack takes any `uint256` key, so no contract change. daily-status
  returns `dailyTaken`/`done`/`packTaken`/`stop`/`packStop`/`dictionaryFull` (GameApi
  `freeLetters`); the daily reminder skips finished profiles (`dailiesDone`) and everyone once free
  letters stop. A missing 0015 reads as "can't count" and those rules are skipped: run it at merge. **The free snack, once per profile** (live since Sepolia rehearsal #4, block 63,309,448):
  `Staking.feedWithSnack(ids, staker, profile, deadline, sig)` frees `ids[0]` when the signer vouched
  for (caller, staker, profile = the staker's account, UTC day) and `freeSnackDayPlusOne[profile]`
  isn't today; otherwise it pays, no revert. Plain `feed`/`feedMany` always pay. No database record:
  the onchain key is the cap. App: `POST /api/care/free-snack {wallet, staker}` signs it (no sign-in:
  the voucher is the caller's only), refusing `used_today` when the profile OR any of its wallets as
  a key used today (a wallet that joined after spending its own), and `try_again` on a DB error
  (`accountWalletsStrict` throws; `accountWallets` would read the staker as its own profile). The
  feed flows ask first and feed paid on null; approvals are always sized as if nothing were free.
  `accountClaimedToday` also holds Unlink and the Farcaster prune on a snack day.
  **The Market** (the `swap` view; decisions.md #30; `screens/MarketScreen.tsx`, `components/game/market/`,
  `lib/market/`): words AND letters sell for $WORD, 10% to `SaleFees`. Four parts behind one switch
  (Words, Letters, Sell, Sold), "Just sold" and the player's picks above. Both stores feed it through
  `g.market` (the practice store from a seeded stall, `market/practiceMarket.ts`).
  **The Letters shelf's line is one element a row** (`.mk-rule`; decisions.md #50, part 3): the row's first slot
  draws it 7 slots wide on a phone and 13 from md, so the grid's column counts are written twice, in
  `LettersBoard` and in globals.css (`tests/market-shelf.test.ts` holds them equal). A piece under each
  letter showed a tick or a gap at every join at pixel ratios 1.25 and 1.5.
  **Letters for sale** (`lib/onchain/letterSale.ts`, `/api/market/letters`, table `letter_listings`,
  migration 0017): one Seaport order offers `qty` of one letter id at a price each, PARTIAL_OPEN,
  filled k of qty with `fulfillAdvancedOrder` (`fulfillPartCalls`). **Every amount is a per-letter
  amount × qty** (the fee is split per letter, then multiplied): Seaport reverts a part whose share
  isn't whole, and the route refuses such an order (`uneven_price`) and any price that isn't whole
  $WORD. Letters have only approve-for-all, which never clears, so a stale order would fill again at
  its old price when the seller next held that letter: one live order per seller per letter
  (`cancel_first`), a relist cancels the old one in the same send (`prepareLetterListingCalls`,
  `GET ?stale=maker:letterId`), and Sell shows the seller every order of theirs, paused ones too
  (`GET ?mine=`). What a row offers now = the order's unsold part (`unsoldLetters` from
  `getOrderStatus`) capped by the seller's balance, shared across that seller's rows cheapest first
  (`lib/market/letterBoard.ts`). The board reads only the cheapest `BOOK_DEPTH` rows of each letter
  (`letterBookTops`, a window over the numeric price index), keeps the answer 8 s, and carries no
  orders: `GET ?order=<hash>` serves one when the player buys or cancels (words the same,
  `/api/swap/words?order=`). **Recent sales** (`lib/market/sales.ts`, `/api/market/sales`, table
  `market_sales`): read from the chain, never from a client: $WORD `Transfer`s into SaleFees find
  each sale's transaction, and Seaport's `OrderFulfilled` in it says what sold (`saleOfFill`, pure,
  tested). The cursor is a row in `shop_index` under the SaleFees address; the route catches up at
  most every 20 s (`?fresh=1` after a purchase: 3 s), and the keeper's `fees` job does too.
  **Prices and picks** (`lib/market/deals.ts`, pure, tested): `letterMakeCost` (a pack's share,
  plus the average rolls for UPPERCASE), `letterPriceIdeas`/`wordPriceIdeas` for the sell forms,
  `oneLetterShort` (words nobody owns that the player is one letter short of, counted by the
  Dictionary's rule: see "The Market and the Dictionary" below), and `pickDeals` (a
  letter that finishes a word first; one place always kept for a price ≥10% under its cost).
  **A purchase celebrates** (`sheets/CelebrateSheet` with `bought`: the word in its scene, what was
  paid, Stake, "See its card"; `sheets/BoughtLettersSheet`: the letters, and the claim of the word
  they newly finish, `newlySpellable`, in `oneLetterShort`'s order so a pick ends on its own word;
  "newly" is measured from `had`, what the wallet held before, and nothing is named until the bag
  shows `had + count`, nor while the world's owners load).
  Both stores open it with the reducer's `arrive` action, only once the purchase shows: a sheet
  already open stays, and a toast says it instead. Send any new "it arrived" moment through `arrive`.
  **The letter swap is retired**: `/api/swap/orders` POST answers 410, and its GET serves only a
  maker's own old offers, for Sell's Cancel. Proofs to rerun after touching any of this:
  `scripts/market-fork-check.ts` (the order against Seaport on an Anvil fork) and
  `scripts/market-routes-check.ts` (the routes against that fork and a throwaway local database;
  it refuses any database or RPC not on this machine). Each needs a fresh fork. Migration 0017 ran in
  production (the Sepolia build) on 2026-11-25; before it, `/api/market/letters` answers `open: false`
  and Sell says letters open shortly (`marketTables`, asked again every 30 s while a table is missing).
  **Words for sale** (decisions.md #18; `lib/onchain/wordSale.ts`, `/api/swap/words`, table
  `word_listings`, migration 0014): Seaport orders offering one Word for $WORD, 90% to the seller and
  10% (`params.market.wordSaleFee`, rounded up) to `SaleFees`, which the keeper's `fees` job flushes
  into the pool before `yield`. The route checks the SHAPE (`checkWordSaleOrder`: kind from content,
  fee ≥ 10% to SaleFees), the SIGNATURE (`verifyTypedData`, smart wallets too), ownership, a per-token
  approval, and the counter, and allows one live listing per word per seller (`cancel_first`). Rows
  that can't fill right now are hidden, not pruned: a signed order would fill again if the word came
  back approved, so listing again cancels them onchain in the same send as the approval
  (`prepareListingCalls`, `GET ?stale=maker:tokenId`). Buying approves exactly the price. Staked
  words can't be listed. Word state on the board is read live, never from the listing. A listed word is
  `useForSale()` (the board ∩ the bag): Next steps skip it (`nextSteps({ forSale })`), the Today stage
  shows it last in mood `forSale` ("…is for sale in the Market."), and its Bag card shows the price.
  The Bag's filters and sorts are `bagView.ts` (pure, tested), remembered per browser
  (`useStoredChoice`). **Cost to make** (`lib/wordCost.ts`, pure, tested; `WordValue.tsx`): the sell
  form and every listing show about what the word costs to build now at the live prices and average
  tries (letters at `pack ÷ 5 ÷ (26 × odds)`, so a pack's draws average its price; raises; the claim;
  each ascension stage reached), price ideas (`market/SellWord.tsx`, the one sell form, under an opened word and on the Market), what it would earn a day
  (`/api/world`'s `yieldToday`: today's pot and the keeper's summed `yieldWeight`, the same weight
  `yieldLeaves` uses), and whether the jackpot already drew it (`drawn`, from `WordRevealed`). **Wallets sign
  `walletTypedDataJson(order)`, never `JSON.stringify(orderTypedData(order))`:** eth-sig-util wallets
  read a missing `EIP712Domain` as empty and sign another digest (every MetaMask listing failed
  bad_signature until #187); viem fills it in, so a viem-signed test can't catch this.
  **The Shop** (decisions.md #22; one real item on Base Sepolia since 2026-11-27, the Outer Space scene: see "The Shop's scenes"): cosmetics for USDC on
  Base, `contracts/src/Shop.sol` (registry EMPTY at deploy; a sale sends 80% straight to the revenue
  wallet and swaps the rest to $WORD through `adapters/UniV4UsdcWordAdapter` into ROYALTY, in the same
  transaction; a failed swap waits in the Shop for `sweep`, which the keeper's `fees` job runs; the
  floor reads Letters' `packPrice` peg; the adapter and the peg change only through `proposeRoute` →
  `acceptRoute` after 2 days; no withdraw path, pinned by `tests/shop-abi.test.ts`). Registry: the
  `shop` block of `config/deployments*.json` (`shopAddress`/`usdcAddress`), NOT in `contracts`, so
  `isSuiteDeployed` never waits on it; the admin keeps `SUITE_KEYS` apart from `CONTRACT_KEYS` the
  same way. App: **SHOP_ENABLED** = `NEXT_PUBLIC_SHOP_ENABLED=true` AND a test network AND the Shop
  deployed (`lib/shop/rules.ts` `shopOn`; mainnet is off whatever the setting says); `/api/shop` (the
  registry + `shop_items` metadata), `screens/ShopScreen` (the `shop` view: a screen of its own since
  decisions.md #55, in the rail's Collect group and under More on a phone, no entry while off; one of
  the `PUBLIC_VIEWS`, so anyone can look), `buyShopItem` (batched approve + buy where `wallet_getCapabilities` answers, else a USDC
  permit, typed data WITH `EIP712Domain`, else approve, wait, buy; never sponsored until the CDP policy
  covers the Shop). An item shows only with a `shop_items` row; on a test network one without shows as
  a plain "Test item" card (a rule about networks, never a stored name). **Wardrobe** = table
  `wardrobe` (migration 0016), one row per `Purchased` (idempotent on chain, tx, log index), read by
  profile: `/api/shop/record` right after a buy, and `lib/shop/indexer.ts` `catchUp` (wardrobe reads,
  the keeper) from `shop_index`'s cursor, halving its range when an RPC refuses a wide `getLogs` (the
  public Base RPCs allow 200 blocks). **Picks are per profile** (`word_picks`, `lib/db/wordPicks.ts`,
  migration 0016 copies `word_scenes` in under each wallet's account; `kind` "scene" today, a slot
  for "costume"): `/api/scenes` still speaks wallets and maps them to profiles; before 0016 it falls
  back to `word_scenes`; the keeper clears picks off words that left the profile (staking and Move
  keep them). The Market says "Card faces, cases, and costumes stay with the seller" only while SHOP_ENABLED.
  **Test USDC** (Base Sepolia only): `MockUSDC` (Circle's permit domain "USD Coin" / "2", 6 decimals),
  25 a profile a UTC day through a signer voucher (`/api/faucet/usdc`, `usdcFaucetDigest`, the free
  snack's pattern), "Get test USDC" beside "Get test $WORD" (`TestFaucets`: Your $WORD and the $WORD
  page), and on the Shop's screen when a tester can't afford an item; it never shows as dollars. The
  Sepolia route is `MockUsdcWordAdapter` (the peg's rate; it mints test $WORD, so it needs no
  funding; its owner can `setBroken` to exercise a deferred swap). Admin: the Shop tab (revenue to
  date, $WORD to the pool, waiting USDC, sales per item, settings, the transaction builders;
  `/api/admin/shop`) and the System switch list. **Switched on in production (the Sepolia build) by
  #208**, with `NEXT_PUBLIC_SHOP_ENABLED=true` in Vercel Production; unset it and merge to hide it.
  **The email's look is the card's** (decisions.md #47; `layout` in `lib/notify/email.ts`): the card's
  paper, a rule and a dotted line for the frame, the game's lockup, facts as a ledger
  (`reminderEmail(..., facts)`), one ink button; tables and inline styles, ONE picture (the lockup,
  decisions.md #56 part 2: a file the site serves, `public/brand/lockup-email.png`, with the card's
  paper in it, its size given, and the name as its alt text lettered as the old header was), font stacks
  only, "light only". A new email kind uses `reminderEmail`, asks the choices, and takes its
  send-once mark first (`lib/db/reminderMarks.ts` `claimMark`, released if the send fails; no mark
  table = no send).
  **Email** (`lib/notify/email.ts`, Resend REST, no SDK; a User-Agent is required): a 6-digit code
  (HMAC stored, 10 min, 5 tries, 5 codes an hour per wallet) confirms the address
  (`/api/profile/email{,/verify}`), then hunger (keeper), daily-letter (notify-daily cron), and
  jackpot-win reminders go by email to opted-in wallets, each with RFC 8058 one-click unsubscribe
  (`/api/email/unsubscribe`, an HMAC of the wallet; GET shows a button, POST unsubscribes). The
  address is never public or logged. Dark until `EMAIL_ENABLED=true` + `RESEND_API_KEY` +
  `EMAIL_FROM`. Switched on in production 2026-11-24 with profiles and X; the landing page reads
  `xEnabled()`/`emailEnabled()` on the server, so its X door and "email optional" copy follow the
  switches, while `docs-site/` describes them as on.
- **Letter draws are sticky** (`src/lib/onchain/stickyDraw.ts` + table `letter_draws`): the first draw
  served for a pack commit (`c:<letters>:<commitId>`, the Letters address lowercased) or an identity's
  daily (`d:<key>:<day>`) is served again while it can still be minted. Every draw's HMAC also names
  the issuing contract (`signer.ts`): commit ids restart on a redeploy, and old outcomes are public. A draw depends on which letters are uncapped, so without this a
  cap-out could hand one unrevealed commit two valid signed draws. `/api/mint/reveal` and the
  free-daily bundle share the daily key. Fails open (plain draw) on a DB outage, so paid commits
  stay revealable.
- `src/lib/{redis,ratelimit}.ts` → Upstash Redis sliding-window rate limits on the campaign routes,
  keyed by the verified FID (applied after auth). **Fails open** if Upstash is unset/unreachable.
  Creds resolve from `KV_REST_API_*` / `UPSTASH_REDIS_REST_*` / Vercel's prefixed `lexigotchi_KV_*`.
- `src/app/api/cron/reconcile-campaign` (hourly via `vercel.json`; auth `CRON_SECRET`, fails closed in
  prod) → re-runs `verify-cast` for recent share-attempters whose proof missed the Neynar-lag window
  (`reconcileShares` in `queries.ts`, gated by `users.share_attempted_at`, set on a verify-cast miss).
  The campaign's eligibility backstop so nobody who shared is dropped.
- `src/lib/params.ts` → the **only** place to tune economics (prices/splits/odds/pity/hunger).
  Prices are placeholders; mechanics are v0.2-decided. `WORD_USD_PRICE` is now the **fallback**
  peg only — the live price comes from `src/lib/oracle/wordPrice.ts` (GeckoTerminal token
  endpoint, 60s cache) via `/api/oracle/word`, pushed into params' **call-time peg cell**
  (`currentWordUsd`/`setLiveWordUsd`, mounted via `useWordPrice` in GameApp + AdminConsole).
  USD↔$WORD conversions read the cell at call time; the **sim stays on the constant** for
  determinism. Never let the cell feed the sim.
- `src/lib/rng.ts` → seeded mulberry32 (determinism).
- `src/lib/sim/` → `ledger.ts` (4-bucket solvency core), `simulate.ts` (agents + day loop),
  `types.ts`. `runSim(config)` returns daily metrics + ROI + findings.
- `src/components/game/TileCharacter.tsx` → the vaudeville tile rig for all 52 characters (both cases + gild stages); its shapes are numbers in `tileShapes.ts`, which the share card's Satori letter (`src/app/_og/tile.tsx`) draws from too, so change a shape there, once (decisions.md #28).
  **The drawing is four stacked `<svg>` layers (floor, legs, body, top), and a loop goes on a LAYER, never on a shape inside one.** A transform inside an `<svg>` makes WebKit (every iPhone browser and mini-app host) redraw the whole letter each frame: one word at rest cost 47% of a core that way and 6.5% on layers. The loops are the `tc-*` keyframes in `tailwind.config.ts`, with distances in the drawing's units through `--ux` / `--uy`. Anything inside a layer moves in a MOMENT (a blink, a glance, a twinkle: `useWordLife`, one timer for a word; the classes are in globals.css), never forever. A sleeping (hungry) letter's three z's are a layer each for that reason: looping inside the top layer they cost 44% of a core on Today, where a hungry word shows first, and 5% as layers. A nervous (rolling) letter's two beads of sweat are a layer each too (a bead's point is at its bottom, toward the tile, and its round end leads: starl3xx, 2026-11-27, "so it looks like its coming from the tile, not from above"): five letters wait together in the ascend sheet, and the beads inside their top layers were 27 of a nervous word's 45 points (about 20% as layers). The peeking eye stays inside the body layer: it swaps in steps and costs nothing. `tests/tile-character.test.tsx` holds the rule. **A tile's size never changes in an animation** (decisions.md #48; starl3xx: "it breaks the character illusion"): a letter is moved and turned, never scaled, by its loops, by a press, or by a box around it as it arrives (`animate-drop`, never `animate-pop`, on anything with a letter in it). The legs may stretch (that keeps the feet down), and a card may lift as it turns. `tests/tile-size.test.tsx` holds it, and makes every new `tc*` loop be sorted as body, legs, or off the tile. **A cheering letter's confetti is sixteen small drawings of their own** (`Confetti`: each piece an `<svg>` its own size, placed by percent over the letter, its fall in percent of its own box): looping inside the top layer they cost a cheering word 47% of a core in WebKit, and 13% this way. A whole-letter layer for each piece would keep sixteen letters' worth of store: never make an off-the-tile piece a full-size layer when there are many. **The cards' style is called "neo-Victorian engraving illustration" or "vintage ornamental illustration", and no artist's name is ever written** (starl3xx, 2026-11-26): not in the docs, the code, a comment, a test, a pull request, or a page. **What is on a letter is flat and colourful; what is around a letter is drawn like the cards** (the same decision): the ground shadow is ruled lines (`tileShapes`, `SHADOW_LINES`, shared with the share letter), the rack on a card's back is ruled line work in the material's line colour (`lib/cardArt/rack`, one set of shapes for the game and the server's picture), the table under a card in a link picture is engraved (`lib/cardArt/table`), the shadow under the video's card is ruled lines (the shader in `loop/loopRenderer`), the glow behind a Legendary or Mythic tile is an engraved halo of fine rays (`tileShapes` `haloPath`, 3 units off whatever the tile wears and never past 28, so two letters' halos never cross in a word), confetti is engraved in ink and gold, the ascend sheet's rays are an engraved picture (`lib/cardArt/glory`, turned as one element), and a raised letter's rays are an engraved "glory" on a layer of their own, cut off at the ground by a box that stands still (turning inside the floor's drawing, the old star cost 11% to 20% of a core in WebKit; under 2% now). **The gilding** (the same decision, part 2; shapes in `tileShapes`): slim rings (`GILD`: 8 to 13.5 units outside the blue border; the ring says gilded, doubled from Gilded 4, and foil at Holographic, and no longer counts the stage), black diamond pips (solid ink where earned at every stage, Holographic too; a faint outline where not; no plate), and laurels from Gilded 4 on a whole character. **An UPPERCASE letter with legs draws its rings on a layer of their own under the legs** (floor, rings, legs, body), so the legs come over the gilding as the arms do; the owner ruled out any shortcut ("has to be a layer in front of the gilding"). Measured alone, the layer costs about nothing in WebKit. `tests/gilding.test.tsx` holds all four. In a word the letters hold hands (`linkLeft` / `linkRight`: one clasp a pair, drawn by the letter on the right, on the still top layer) and each leans up to 2° (`leanFor`). `flat` draws one `<svg>` for a picture in a single file (`scripts/docs-art.tsx`). On the Today stage the word perks up and looks at the pointer (`.tc-perks`): no glow (a `filter` over moving drawings is redone every frame).
- `src/components/game/` → the playable mini app: `GameApp.tsx` (shell), `state.tsx` (mock store +
  reducer + seeded RNG), `Providers.tsx` (`MiniAppHost` + wagmi + RainbowKit; the
  connect modal is themed in `walletTheme.ts`). **A Farcaster host is one that answers**
  (`lib/miniAppHost.ts`): React Native wallet browsers (Rainbow, MetaMask Mobile) have the same
  `window.ReactNativeWebView` the SDK uses to reach the Farcaster and Base apps, but nobody answers
  there, and Neynar's MiniAppProvider rendered nothing while it waited, so /play was blank
  (2026-11-25). `MiniAppHost` waits 1 s, then plays as the web; a late answer still switches to the
  host. It mounts Neynar's provider only in a host, so read `useMiniApp()` from `./MiniAppHost`,
  never from `@neynar/react` (that one throws on the web). The Farcaster wallet connector has no
  provider outside a host (`farcasterWhereHosted`), or wagmi's reconnect waits on it forever.
  **A wallet on a network the screen can't use** gets `WalletNetworkNotice` above every screen
  (`lib/onchain/walletNetwork.ts`: the game's network, Base Sepolia now and Base at launch; on the
  $WORD page, whose swap is on Base mainnet, Base or the game's; the Market is the game's). Its Switch runs sendCalls' `ensureChain` (wagmi's `switchChain`
  never returns from a wallet that stays put); its Disconnect is wagmi's. RainbowKit's account
  modal, which held the only Disconnect, isn't offered on a network RainbowKit doesn't know, so
  Rainbow's browser on Base had no way out (2026-11-25). Disconnect also sits in the profile
  header and in Your $WORD. Known gap: RainbowKit asks for the switch during connect, and a wallet
  that accepts it and stays put never finishes connecting (wagmi waits for a change event).
  `ConnectPanel.tsx` (the web front door: wallet required,
  via the RainbowKit modal or "Sign in with Coinbase Wallet" in `SignInWithCoinbaseWallet.tsx`, our own button for the Base Account connector under Coinbase's new name, decisions.md #13; Farcaster an optional
  link — decisions.md #9), `useViewer.ts` (FID/identity),
  `useShare.ts` (`usePostToX` first, then composeCast), `screens/`, `sheets/` (incl. `BalanceSheet.tsx` and `CheatSheet.tsx`: the core loop on one screen, behind the rail's "Cheat sheet" on desktop and the header's "?" on phones; the docs and the intro replay are one tap inside it). The old in-game FAQ is gone: the player docs at lexigotchi.fun/docs (`docs-site/`) replace it, opened with `useOpenUrl` (`useShare.ts`; `DOCS_URL` in `site.ts`) so a mini-app host keeps the game.
- `/api/word` + `WordScreen` → the in-game **$WORD** page (rail: "$WORD universe", above LHAW): the
  real token on Base mainnet whatever NETWORK is (`lib/onchain/mainnet.ts`). Price and market cap from
  the app's oracle (one price source per page), supply and both kinds of burn (`lib/wordStats.ts`:
  destroyed = 100B minted − totalSupply; the dead address holds LHAW's old V2 "burns"), the deepest
  pool from GeckoTerminal (its token-level `total_reserve_in_usd` is only the $WORD side; the pool's
  `reserve_in_usd` is both), and LHAW's staked total and burn counter. `useBuyWord` is the shared Buy.
  **Swap** (`SwapCard`, web only; Farcaster uses the host's swapToken): KyberSwap quotes and calldata
  via `/api/swap/{quote,build,balances}` with the rules in `lib/swap/kyber.ts` (ETH/USDC ⇄ $WORD
  only, router pinned to `KYBER_ROUTER` and refused otherwise, recipient = sender, exact-amount
  approvals, no paymaster). Sent through `sendCallsAttributed(..., { network: BASE, sponsored: false })`
  so it carries the builder suffix and must be on Base mainnet even on a testnet build.
- `/api/lhaw` + `LhawScreen` → the in-game **Let's Have A Word!** page (rail: "$WORD universe"): LHAW's
  live round, last round, rounds played, and $WORD supply, read server-side from LHAW's public API
  (cached a minute), plus how to play (from LHAW's FAQ.md; keep in step if LHAW changes a rule).
  It, the Leaderboard, the Dictionary, More, and the Shop are `PUBLIC_VIEWS` in GameApp: no wallet needed.
- **The Dictionary** (decisions.md #31; `screens/DictionaryScreen.tsx`, `useDictionary.ts`): each
  word is a card (flat `MiniTiles`, never the rig: 80 words a page) showing the word as it would
  be claimed, with a dashed slot for a letter the player lacks, and one line: "You can spell it",
  "Needs a q", or who has it. **That line is a promise** (`lib/wordNeed.ts`, pure, tested against
  Spell's `canSpell` for every word): only the connected wallet's letters count (`mineLower` /
  `mineUpper`, as on Spell), a linked wallet's letter is "away" (move it, don't mint it), doubles
  count, and nothing is counted until the owners are known (`ownersKnown`) or for a player with no
  letters. A word someone else holds and isn't selling is faded; unclaimed and for-sale words are
  not. A tap opens `sheets/LookupSheet` (sheet kind `lookup`): the letter characters, still, with a
  slot per missing letter, what's needed, how to get it, and the word's facts; the player's own
  words open their card. **It claims nothing:** "Spell X" queues the word (`spellHandoff.ts`) and
  navigates to Spell, which loads it on the rack. "Mint a pack" hides when the chain says the
  letter is minted out (`readLetterSupply`, read by the sheet). "Closest first" and the quick
  filters are `lib/dictionaryList.ts` (pure, tested; "Can spell" is exactly Spell's list).
  **The Market and the Dictionary think alike** (decisions.md #32). (1) *One rule* for "this
  letter finishes this word": `lib/wordNeed` `finishingLetter` (exactly one letter held nowhere,
  nothing to move). The Market's picks (`oneLetterShort`), the Dictionary's "Only needs a q" filter
  (`listDictionary`'s `letter`), and the word view's "would also finish" (`finishedBy`) all read
  it, so the Market's "and 45 more words" is the number of cards its link shows; tests hold them
  equal. Never count the connected wallet alone: a letter in a linked wallet is a move, and the
  Market once offered to sell it. (2) *One wording*: `finishTokens` ("An x finishes UNBOX"; "One
  more o…" only when one is held). (3) *One word view*: any word in a list opens with
  `useOpenWord` (the player's own → its card, any other → `LookupSheet`), and a word for sale is
  bought there (Buy closes the sheet; no Buy without a wallet or on the player's own listing).
  (4) *A listed word has an owner, its seller* (`lib/dictionaryList` `entryStatus`, pure, tested;
  `useDictionary` `statusOf`): the board is live and the world read is a minute old, and the
  practice stall's sellers are in no world read. Spell filters with the same `statusOf`
  (`isTaken`), which is what keeps "Can spell" exactly Spell's list: never test `owners[w]` alone.
  Today's next steps and the bought-letters sheet read `useTakenWords`, which counts the board's
  words too. Every list that names "the word a letter finishes" sorts with `rarestFirst`
  (lib/market/deals), or two screens name different words for one letter.
  (5) *Links are state*: `nav(view, section)` with `letter:q` (the Market's Letters shelf, q's
  sellers open), `needs:q` (the Dictionary on the words a q finishes), `words`, `letters`; read
  the letter with `sectionLetter` (state.tsx). Not a take-once handoff like `spellHandoff`: the
  word view can be open on the screen the link points at. A screen that acts on a section keys
  its effect on `state.navSeq` too, or the same link followed twice does nothing. Rarity chips read rarest first on Spell,
  the Dictionary, and the Market. Two chip shapes remain (the Dictionary's and Spell's pill; the
  Bag's and the Market's taller press chip): one chip for all four is its own change.
- `src/lib/world.ts` + `/api/world` → **the shared world** for the Leaderboard and the Dictionary's
  owners: every claimed word's beneficial owner (the keeper's scan), each wallet's loose letters
  rebuilt from the Letters transfer events (the game's own contracts excluded), jackpot wins
  (`JackpotWon`), and Farcaster names and pictures by address (`profilesByAddress`). Cached for a
  minute in memory and at the edge; it reads every event since deploy, so it moves to the indexer
  later (decisions.md #10). Client: `useWorld()` / `useMyWallets()` / `PlayerChip`.
- `docs-site/` → **the player docs** (Mintlify project `lexigotchi`, synced from this folder), served
  at **lexigotchi.fun/docs** by the Mintlify rewrites in `vercel.json` (proxy target
  `lexigotchi.mintlify.site`; `/_mintlify/*`, `/api/request`, and `/mintlify-assets/*` must stay at the
  root). They replace the old in-game FAQ and `FAQ.md`. Keep every number in step with `params.ts`
  and `economy.ts` (prices, odds, hunger days, splits, tier counts); the copy-rules test covers
  the pages, including the rule that a dollar sign in body text is written `\$` (Mintlify reads
  `$…$` as math). Pictures in `docs-site/images/` come from `npm run docs:art` (`tests/docs-art.test.ts` fails when one
  no longer matches what the rig draws: a change to the rig, the rig's keyframes, or the fee splits
  needs the script rerun in the same PR)
  (`scripts/docs-art.tsx`, the real character rig and `params.ts` splits): rerun it after changing
  either. Screenshots (`screen-*.jpg`) come from `npm run docs:shots` against a practice-mode dev
  server: never a wallet, so no real address is pictured. Separate from `docs/`, which is internal.
- `src/lib/showcase.ts` + `src/app/s/[text]/` → **Word shares, X first** (decisions.md #13; still named "showcase" in the code, though the Showcase screen folded into the word cards): a
  share links to `/s/<word>?scene=<id>` (the case in the path is each tile's case), whose `og:image`
  is `/s/<word>/card`: the word's card on a dark table (1200×630 for X; `?ratio=3x2` for the
  `fc:miniapp` embed; `?face=1` is the card's front alone, 1200×675, which the share video turns
  over). **A link with no `scene` means the Stage** (`LINK_DEFAULT_SCENE`: links made before the stock
  card existed are posted for good), so every other scene is named in its link, the stock card too
  (`parseLinkScene`). The ribbon's number on the picture is the chain's (`lib/onchain/cardNumbers`),
  never the link's. **The letters on every picture wear the word's gilding, and the stage is the chain's too** (decisions.md #48; `lib/onchain/cardLevel`). A link and every picture's address name the stage (`g`), only so that they change when the stage does (X and Farcaster keep a picture by its address for good): nothing in the query is drawn, and `cardPictureCache` keeps a picture for long only when its address names the stage it shows. Pass the stage to `showcaseUrl` / `showcaseCardPath` / `showcaseFacePath` / `showcaseBackPath` wherever the game knows it. Its lettering is the card's serif, Source Serif 4, as in the game (`public/fonts/sourceserif4-bold.ttf`, SIL Open Font License beside it):
  the server has no fonts, so each picture route loads that file. **Only the player's
  own words** (decisions.md #15): the page and card draw dictionary words only (`parseShowcase`), plus
  `HOUSE_CARDS` (the Telegram HEYOO welcome); anything else is a 404, so a link can't put free text
  on the game's card. **Raise `CARD_LOOK` (lib/showcase.ts) whenever the card picture's look changes**
  (the letters, a scene, the frame): it is the `v` in every card picture's address, and the picture
  is cached for a day in browsers, a week at the edge, and for good by X and Farcaster. Without it
  the share video drew the old letters for a day after #215. **X's composer shows no card for a link X hasn't read yet** (tested 2026-11-24:
  a never-posted link with a fast static image showed none either; a second paste later did). It is
  not our card's speed, so Share (under an opened word's card, `cards/WordSheetCard.tsx`) says "X adds the picture once it reads the link." **Save
  image** (`useSaveImage` in `useShare.ts`, the same-origin `showcaseCardPath`) keeps the X card: the
  share sheet on phones (bytes fetched ahead, since iOS opens the sheet only from the tap itself), a
  download on computers, the browser (press and hold) in a host with no share sheet.
- **The Shop is a screen with categories** (decisions.md #55; starl3xx, 2026-11-27: "the Shop should be
  its own tab instead of a popup, since we'll eventually add more things and categories (card faces
  and accessories for now)"). `screens/ShopScreen.tsx` is the old sheet's body with its guards kept
  (nothing listed while `metaKnown` is false; a face sold only on a positive "you don't have it").
  The categories are a pure rule (`lib/shop/rules`: `SHOP_CATEGORIES`, `categoryOf`, `byCategory`,
  tested): kind `scene` is Card faces, everything else (a case, a costume) is Accessories, and the
  test network's placeholder is in neither (it sits under "Try paying"; Base Sepolia's own, item 1,
  is switched off since 2026-11-27 with the owner's word, so that section shows only if an item is
  ever listed again with no `shop_items` row). A NEW kind needs its
  category chosen in `categoryOf`. One switch for the categories, as the Market has for its parts;
  a link lands on one with `nav("shop", "faces")` (the face picker's tile for a face on sale) or
  `nav("shop", "accessories")` (an opened word's Case button). There is no `shop` sheet any more:
  `nav` closes whatever sheet the link was in. On a phone the Shop is under More (the bottom bar
  has no free place: my reading). **A limited edition** is an item with a supply limit
  (`Shop.maxSupply`, set with `addItem` or later with `updateItem`, which RESENDS the price and
  the dates with it): its card says "Limited edition of 25. 24 left." (`edition`, `editionLine`),
  the contract refuses a purchase past it (`SoldOut`), and the picker stops offering a sold-out
  face. Three things the words never promise: the owner can raise a limit later, the limit counts
  purchases and not players (the game sells a face once to a profile; the contract would sell it
  twice), and a sold-out item stays with everyone who has it. The player docs have a Shop page
  (`docs-site/shop.mdx`): when an accessory is listed, its "None are in the Shop yet" goes.
- **A card's words: front, face, back** (decisions.md #54; starl3xx, 2026-11-27: "the *front* of the
  card is its front regardless of the scene/face... the *face* (not scene) is the background on the
  front of the card. the back is the back"). The FRONT is the side with the word on it, whatever it
  wears. The FACE (a "card face" where the sentence needs it) is the picture on the front, behind
  the word: the thing a player picks, unlocks, or buys. The BACK is the back. Every surface a player
  reads says so, and `tests/copy-rules.test.ts` fails on "scene" in the app and the player docs.
  The two stock faces are "Stock (light)" and "Stock (dark)" in the picker (the owner's names,
  2026-11-27), and a sentence a player reads names them the same way ("its new owner gets it on
  Stock (light)"). **The code still
  says "scene" for a face** (`SceneId`, `lib/scenes.ts`, `SceneFrame`, `useWordScene`, the `scene`
  sheet, and these notes below), and so does everything stored or posted, which can never change:
  `?scene=` in share links, kind `scene` in `shop_items` and `word_picks`, `/api/scenes`, the
  `lexigotchi:scene:` key in a browser. **Two older code names use "face" for something else:**
  `?face=1` and `showcaseFacePath` are the card's FRONT alone, and `playerFaces` /
  `mergePublicFaces` are a player's name and picture. "Face down" (the jackpot's secret card)
  stays: it is plain English for a card lying on its front. Never write a new player-facing
  "scene", and name a new thing in code by the player's word.
- **Scenes and the card's front** (decisions.md #15 and #34; `src/lib/scenes.ts` = the list and the
  unlock; `src/lib/cardArt/` = the pictures; `src/components/scenes/`): a word's card front is
  `SceneFrame` (`TodayStage` → `SceneCard` → `SceneFrame`, 16:9; also the Bag, the scene sheet, the
  purchase celebration, the share page). **A card's corner is 2.6% of its width, everywhere** (decisions.md #48; `lib/cardArt/looks` `CARD_CORNER` says where the number comes from): in the game, `--card-r` / `.card-corner` (two percentages of the box itself, so no container is needed); in the server's pictures and the video's shader, `CARD_CORNER`. Anything that clips a card takes it, never a pixel radius or a `rounded-*` class, and the back's frame lines run parallel to it (`tests/card-corner.test.ts`). **A card that stands on the page takes `.card-stand` for its block shadow, never a `box-shadow` or `shadow-[…]` of its own** (decisions.md #50). A `box-shadow` is hollow under the box that casts it, and Today's card leans toward the pointer: its edge pulled in and the page showed between the card and the shadow ("two borders, one for the card and one underneath it"). `.card-stand` puts a SOLID shadow under the card, a shape of its own (the card's size and corner, moved 4 and 5 px), and makes it hollow only while the card turns over (`.is-flipping`), when a solid shape would stand as a dark slab. So everything on a `.card-stand` must be opaque to its edge, and the class goes on a box of its own around the card: never on one that clips or carries the border (`tests/card-stand.test.ts`). **To judge a report about the card, put the pointer where the player's was:** my first fix (#272) looked at the card at rest and closed a corner hairline, which was not what the owner saw. `.cel` boxes and buttons still use a `box-shadow` (none of them leans): not changed yet. The ink outline stays the game's own 3 px (2 px on a thumbnail). **The card is an object:** its own paper, the scene's art in
  a window, a frame in the rarity's ink with the rarity's mark in its corners, and a ribbon ("one of
  one", the card's number from `cards/useCardNumber` and `/api/words/numbers`, the rarity; no ribbon
  on a `small` card). **Words are only ever set in Söhne** (starl3xx, 2026-11-25): the card's serif
  (`--font-card`: **Source Serif 4, shipped**, the same face for every player and on the server's pictures: decisions.md #52; `public/fonts/sourceserif4-*`, two variable web files for the game and one plain bold file for the picture routes, named once in `app/_og/wordCard.tsx` as `CARD_SERIF` / `CARD_SERIF_FILE`; `tests/card-serif.test.ts`) letters what a card says
  ABOUT a word, never the word. **Scenes:** every word starts on the stock card (`DEFAULT_SCENE`:
  grey, the rarity as an overtone); the dark stock face and the Stage are free too (`FREE_SCENES`).
  **The dark stock face** (decisions.md #57; id `darkstock`, never to change: links and saved picks
  carry it) is the light stock's own engraving (`stockPlan`, shared, so the two can't drift) on the
  pewter plate (`PEWTER` in `lib/cardArt/scenes.ts`). The owner chose pewter after calling the first,
  near-black plate "way too dark": **when drawing something dark for him, start lighter than seems
  right.** **A dark face needs two things** (`DARK_SCENES`: the dark stock face and Outer Space):
  (1) light where the word stands, on the wall behind it and the floor under it, because a letter's
  arms, legs, and shoes are dark ink and vanish on a dark plate; (2) thinner fog for a hungry word
  (globals.css, `.cf-dark .scene-fog`: 0.42 hungry, 0.2 peckish), because the fog is pale and at full
  strength it turns the plate white. A new dark face joins `DARK_SCENES` and is looked at hungry.
  The other faces: the Trophy Case and Spring
  open at `SCENE_UNLOCK_WORDS` = 3 words ever held (`state.wordsEverHeld`, so it stays open after a
  dissolve). Picture Day, Summer, Fall, and Winter are retired: a pick or link that names one reads
  as the stock card. **A scene is a still picture and never moves** (starl3xx: "the only animation
  for still scenes should be something that makes the card itself look cool"). Its art and the frame
  are SVG documents built as strings (`lib/cardArt/engrave.ts` = the kit and its rules,
  `scenes.ts` = the art; `tests/scenes.test.tsx` holds the rules: no text, filters, or fetches, every
  number finite, ids unique), shown as background images in the game and placed as `<img>` on the
  share picture: no shapes in the page (a scene was 1,000 elements; Today at rest with a fed word
  on stage went from about 53% of a core to 8% in WebKit). **The letters stand on `FEET_Y`** (two thirds down), sized by
  `scenes/layout.ts` (`wordLayout`, shared with the share picture). **The Shop's scenes** (decisions.md #41): the Bookshelf and Outer Space (`SHOP_SCENES`) are a
  player's only when their profile's wardrobe holds an item whose `shop_items` row is kind "scene"
  with `art` = the scene id (`lib/shop/scenes.ts`; nothing else grants one). `useShopScenes`
  (`game/useShop.ts`) gives `bought`, `onSale`, and `known`: **unknown is not "no"** (a saved Shop scene
  keeps showing while the wardrobe is loading, failed, or the Shop is off), and the picker offers one
  only on a positive answer, and for sale only when `known` (`shopSceneOffer`; the Shop screen's Buy
  for a scene the same, `sceneSale`: a scene is bought once). `/api/shop`'s `metaKnown: false` (the
  database couldn't say what the items are) is "unknown" too, and the Shop screen lists nothing then.
  `/api/scenes` won't save one for a profile that hasn't bought it. Listing
  is the owner's (`Shop.addItem`, then the `shop_items` row). **Outer Space is listed on Base Sepolia**
  (starl3xx, 2026-11-27: "i want to introduce it as a Shop item on Testnet for $5 USDC"): item 2,
  5 test USDC, no end, its row `kind` "scene", `art` "space". **It is a limited edition of 5** since
  the same day (the owner: "cap outer space at 5"; `updateItem(2, 5000000, 0, 0, 5)`, the price and
  dates resent unchanged, read from the chain first). The Bookshelf is
  not listed. **List an item in three steps, so it never shows as a "Test item" card:** `addItem`
  with `active` false (take the id from `ItemAdded`), then the `shop_items` row (`shop` in
  LOWERCASE: the reader matches on it), then `setActive(id, true)`; check `/api/shop` after each.
  **A scene is the buyer's profile's, never the word's** (the same day: "it doesn't travel with a
  card"): one purchase is for every word they hold, a pick comes off when the word leaves the
  profile, and a buyer's card starts on the stock card. Nothing a buyer sees draws a seller's
  scene: the Market and the word view show letters. The seller's own Today, Bag, and opened card
  keep their scene while the word is for sale (asked, and the owner chose to change nothing).
  **The plastic case** (decisions.md #42;
  `cards/CardCase.tsx`, `lib/shop/cases.ts`, `lib/db/wordCases.ts`, `/api/cases`): a Shop item of
  kind "case". **One case holds one word** (my reading; the strict one, loosened later at no
  buyer's cost), and the server is the one place that counts: a cased word is a `word_picks` row of
  kind "case", written only by `PUT /api/cases` under a profile session after counting the wardrobe.
  The game shows a case only for a word the server lists (`useWordCases`), and **a read that is
  missing is never read as zero** (`casesState` / `caseOffer`, pure, tested: an unknown list offers
  nothing, an unknown count keeps every listed case and offers none); once the count is known a case
  shows for at most that many words, the oldest first (`casesShown`). `scripts/case-db-check.ts`
  proves the SQL on a throwaway local Postgres (rerun it after touching `wordCases.ts`). The case stands in for
  `SceneCard` on an opened word (turned by a drag too) and on Today (the button only), and it is
  the card's one turn (a host keeps "turned over" with `cards/useFlipOf`, derived while rendering,
  never reset in an effect: that showed a back for a frame). **Every angle is written straight to the element, a frame at a time, and
  the side that shows is chosen from the angle, never by `backface-visibility`** (WebKit drew the
  back mirrored); `tests/card-case.test.tsx` holds it, and that the label never names the word. Not
  listed yet (the owner's: `Shop.addItem`, then a `shop_items` row of kind "case"). **Curved ground is one rule:** a
  scene gives its ground's height across the card (`GROUND` in `cardArt/scenes.ts`) and each letter
  is lowered to it and turned to its slope (`wordFootings`); keep a slope under about 12° so hands
  stay joined. **The card's own light** (`cards/useCardLight`, `.sc-sheen`/`.sc-glare`/`.sc-lean`) is
  the only motion: a faint band of light in moments, and a lean toward a mouse pointer, on the card in
  focus only, never for a hungry word; the lean's transform is written directly with no transition
  while it follows (a transition restarted each frame cost a third of a core). Keep such effects
  faint (the owner: "much more subtle/transparent"). The Today stage walks the player's words with
  ← and → (and swipe and arrow keys; `stageLineup`, staked neediest first, then unstaked), with the
  next three as cards and a My Bag tile. The scene greys and fogs as its word gets hungry (`toneOf`,
  `.scene-tone`/`.scene-fog` in globals.css), inside the window only: the frame keeps its ink.
  **A pick is saved** in the browser always, and in table `word_scenes` (migration
  0011, `/api/scenes`, `lib/db/wordScenes.ts`, `lib/sceneSaves.ts`) under a profile session the
  player already has: keyed by the wallet holding the word, writable by any wallet in the session's
  profile account, never prompting a sign-in (`useWordScene`, `useSceneSync` uploads waiting picks);
  the newer pick wins. Dark with profiles; until migration 0011 runs, everything stays in the browser.
- **Rarity finishes** (decisions.md #23): tiers are Common, Uncommon, Rare, **Legendary** (was Epic),
  **Mythic** (was Legendary); `MYTHICS` replaced `LEGENDARIES`. Each tier above Common wears a
  material on its tiles (`lib/rarityFinish.ts` = the table; `components/game/TileFinish.tsx` = the
  layers; pass `tier` to `TileCharacter`/`TileWord`/`WordTiles`/`SceneFrame`). **Motion is moments,
  never loops** (`useFinishMoment` adds `.rf-moment` to the word's row every tier period; globals.css
  `rf-*`; `tests/rarity-finish.test.tsx` fails on an `rf-` animation outside `.rf-moment`, on
  `infinite`, or on a dash-offset animation): only full-size words, on screen, not hungry, not under
  reduced motion, Save-Data, or 2 GB memory. **In WebKit a moving tile's light is drawn as layers**
  (decisions.md #43; `TileCharacter` `splitBody` + `useWebKit`, `TileFinish` `momentPieces`): the
  body is cut where the light sits and each moving piece is its own `<svg>`, its moment on that
  `<svg>` (a Legendary word at rest: 35% of a core with the light inside the drawing, 17% as layers).
  Every other engine keeps the one drawing, because slowed headless Chrome measured the layers
  dearer: measure BOTH engines before touching either path, and compare pictures at frozen times
  (the at-rest picture must stay pixel for pixel the same). `tests/tile-character.test.tsx` holds
  the two paths to the same pieces at the same times. Never gate motion on `hardwareConcurrency` (iOS reports
  2). Measure a change with CPU throttled 4× before shipping it (looping finishes hit 99%). The share
  card draws the still in `app/_og/tile.tsx` with Satori's rules (plain elements, shared geometry
  from TileFinish). **No name on link cards; `?saved=1` adds the game's lockup in the corner** (`app/_og/wordCard.tsx` `cornerMark`, for a word's card and the earnings picture; Save image, the
  Telegram welcome). The share loop is built (decisions.md #27; see Word cards).
  **Each tier also has a mark** (decisions.md #29; `lib/tierMark.ts` = the paths, colours, and
  corner counts; `components/game/TierMark.tsx`): a round bead for Common, then a cut stone with
  three, four, five, and six corners, so a player orders them by counting. It sits beside the tier's
  name everywhere: the card back's plate, the Bag badge, `TierBadge` pills and the tier filters, the
  landing page, and the share loop's back picture, which draws the same paths (`tierMarkPaths`, every
  attribute given, for Satori). Three flat paths, no motion. A new mark must not be a star, a tilted
  diamond, a crown, or a sparkle: those mean ascension, a raised letter, and Mint. The player docs'
  picture is `marks.svg` (`npm run docs:art`).
- **Word cards** (decisions.md #25; `src/components/cards/`): every owned word is a `SceneCard`, its
  front (`SceneFrame`: the word in its scene, in the card's frame) and its story on the back (`CardBack`, deep materials per tier in globals.css
  `.cb.m-*`), turned by the corner button. The flip belongs to the word (a host showing another word
  gets its scene), the back mounts on the first turn, and a host holds its scene still while the
  back is up or a sheet covers it. **Only the card in focus moves** (the Today stage, an opened
  word: `WordSheetCard`); the Bag's grid (`BagWordCard`) is still and draws each card only as it
  nears the screen. **At rest the face turned away is `visibility: hidden`** (`.sc:not(.is-flipping)`):
  WebKit kept drawing the back, mirrored, over the front after a turn home. `TileCharacter`'s `still` stops the whole
  character (idle bounce too), and a still `SceneFrame` stops its fog; lists pass `still`
  (`WordTiles still`), and the Dictionary's 80 rows use flat `MiniTiles` (the rig there made each
  keystroke 2–4× slower). **The back's lettering** (decisions.md #35): the card's number is the
  headline in the card's serif (`cardDigits`; none while unknown), the facts are a ledger (a name in
  Söhne, a row of dots, a value in the serif), and **the game's seal is pressed into the material in
  one ink** behind them (`lib/cardArt/seal.ts`, one picture for the game's back and the server's; its
  lines stop at the eyes, and in one ink the eyeball is ink and the pupil clear with its pie cut:
  the owner's three notes, held by `tests/card-seal.test.ts`). **The holder's picture is stamped on the back** (decisions.md #48; `cards/stamp.ts`, `cards/CardStamp.tsx`, `.cb-stamp`): the player's own picture in ONE INK (the material's line colour) in an engraved ring, beside the number (in the number's own line, so it follows the digits), the top left corner on a card with no number, over the seal on a thumbnail. "Show my picture on my cards" in the profile turns it off, and the choice is kept on the device (`useCardStamp`): only the player's own browser ever draws a stamp, so no server holds the choice and none fetches a picture. The video draws it onto the back's picture itself (`makeLoop`, `stampedBack`). **One back at every size**
  (decisions.md #37; globals.css `.cb`, by container width): two columns (the rarity over the
  number, "One of one", the count, the rack; the ledger) with a line along the bottom, all of it from
  470 px; the first four facts under 470 px (an opened card's `CardMore` lists the rest: keep the two
  widths equal, `tests/scene-card.test.tsx`); a thumbnail (`mini`) is the left column alone. The
  server's back picture is laid out the same. **Both pictures of a card carry `CARD_LOOK` in their
  address** (`showcaseBackPath` too: the video drew a cached old back without it). **When a proposal
  is approved, build from its own CSS and compare the two at every size before merging** (#35 kept the
  old skeleton and didn't match). The back's facts are `lib/cardFacts.ts` (pure, tested) via
  `useCardFacts`: unknown is a dash, never "you" or "never"; the card number (`#0001`) is the order
  words were first claimed (`madeOrder`, served as `/api/world`'s `numbers`), never A to Z; "Found by" and "Yours since" read
  `/api/words/story` (the word's own Claimed and Transfer logs, staking's moves left out) only
  while a back shows; practice words carry `OwnedWord.since`. The Bag opens on Words; the Showcase
  screen is gone (Share and Face sit under an opened card; badges moved to the profile; a scene
  picked from an opened word returns to it). **Live backs** (decisions.md #26; `cards/live/`, the `ogl`
  package, loaded on the first live back): WebGL draws a showing back's material on the card in focus only, on demand (a frame per
  change, nothing at rest: `tests/live-back.test.ts` counts them), one context, lost when the back
  leaves, each mount its own canvas (a lost context never draws again), at most 1.25× the CSS size.
  The light sweeps in once, then follows the pointer, a sideways drag, or the tilt (iOS asks on the
  flip tap, `askForTilt`, only when that back will draw live). A held phone tilts all the time:
  `makeTiltFilter` draws only real moves (about a degree, ~30 a second), never off screen. The Today
  stage passes `live={!state.sheet}`, and an evicted back steps aside (`onEvicted`). CSS is the
  fallback everywhere else. A back under 470 px shows four
  stats; an opened card lists the rest under it (`CardMore`). **The share loop** (decisions.md #27;
  `cards/loop/`, `cards/ShareVideo.tsx`): Share → "Make a video of the card" draws six seconds of the
  card turning (OGL, the same `materialGlsl` as the live back, over `/s/<word>/back`, a transparent
  Satori picture of the back's words: no "you", nothing from the query) **The video's letters are alive** (decisions.md #48; `loop/liveFront.tsx`, `loop/score.ts`): the front is put together again for every frame from the server's picture of the card WITHOUT its letters (`showcaseStagePath`, `?face=1&letters=0`) and the game's own rig, drawn once as one drawing (`flat still`) and cut into its layers by name (`data-layer`), each kept as a picture. The life is WRITTEN in `score.ts`, never random or clocked: every motion's time divides the six seconds, and nothing is scored while the front faces away. **A piece is a picture of its own** (`pieceOf`): it carries the drawing's definitions (a paint that points at another layer's gradient draws nothing alone: the Holographic rings), names its font outright, and takes nothing from the page; `tests/living-video.test.tsx` checks every rarity, stage, and case, and lists the classes a piece may carry, so sort a new class in the rig's drawing there. The front's letters wear the stage the GAME shows (which reads the chain); the back's picture reads the chain itself, so the back may say less (practice, a failed read), never something else. If the living front can't be drawn (a piece or the font inside it doesn't load), the still picture is used: a video is always made. **The back's picture says what the game's back says about the WORD** (decisions.md #48; `lib/backPicture` words it, `lib/backPictureFacts` reads it from the chain, the prices, and the shared world in `lib/worldSnapshot`): "Held since" for "Yours since", no earned amount, no "Staked", and a fact that can't be read is left out. It takes the world with `worldSoon`: a kept one up to a quarter of an hour old at once (a scan takes longer than a picture can wait), never `worldNow`, which waits for the scan. and encodes it in the
  browser (WebCodecs H.264 + `mp4-muxer`, deprecated but 9 kB: swap in `makeLoop.ts` only). It
  takes the one WebGL context (`releaseLive`) and loses it after; OGL and the muxer load on the tap.
  Two taps (make, then share or save), offered only where the file can leave; the preview plays
  twice (`tests/share-loop.test.ts` fails on a looping `<video>`); the game's lockup in the corner of every frame, its eyes on the video's written score (`score.ts` `markEyes`; the name in type if its pictures fail to load).
- **A word's status is three marks** (decisions.md #39; `components/game/stageMarks.ts` pure + tested,
  `StatusMarks.tsx`): **Fed, Jackpot, Earns**, always in that order, each in the colour of its meaning.
  In full on the Today placard and the word's sheet; as three icons beside the name in the Bag
  (`compact`). Add a status fact as a mark's wording, never as a new badge or a sentence on the art.
  **The Today stage is a clean card and a placard under it** (`.tt`, `.tt-plate`): the marks, the one
  thing to do, the earnings line, and a pager with the arrows. **The placard never names the word**
  (starl3xx: "seeing JAZZY immediately underneath the card is redundant"); the action's label does.
  Nothing is drawn over a card's art but its letters (and, on a collab word's card, its set's stamp in its one place: decisions.md #53). The Jackpot mark says "In the running", never a
  draw or a ticket (docs/messaging.md).
- **Today is the player's dashboard** (`screens/HomeScreen.tsx`; starl3xx, 2026-11-24): their words on
  stage (`TodayStage`) top left, their letters (`TodayLetters`: the free daily letter, loose letters
  UPPERCASE first to a limit, Spell, Mint) top right, next steps under the letters, then **the three
  pots** in one row of equal tiles across both columns (decisions.md #46; `TodayPots`, rules in
  `todayPots.ts`): the jackpot, the bounty, and the Rewards Pool, each its $WORD amount, "about $X"
  (only where `showsUsd`: never for test $WORD), and a line of its own; a pot not read yet is a dash
  (`potsKnown`). Then the quick actions. Two free-flowing columns on lg; a phone stacks them in that
  order, the pots still three across (two layouts picked by `useWide`, each in reading order). Every card speaks to the player in
  front of it: the empty stage per `emptyStageCase` (loading, words only in a linked wallet, can
  spell, needs more letters, brand new), one loud "get letters" button at a time, the jackpot saying
  how to get in, and `state.wordsLoading` (chain store) so a returning player never sees the
  newcomer's invitation while their words load (Today, Bag).
- **"Your earnings" shares like a word** (decisions.md #38; `lib/earningsShare.ts` pure,
  `lib/earningsShareToken.ts` server, `lib/rewards/share.ts`, `app/e/[token]/`): the Earnings sheet's
  Share posts `/e/<token>`, whose picture is the player's top word's card beside a tag with what
  their words have earned. **Every amount on that picture comes from the token,** a snapshot
  `/api/rewards/earnings` signs (for the first wallet's account only, and only above zero). Never add an
  amount, a name, or free text to that link's query: the word (`w`), its scene, and `tz` are the only
  unsigned parts, and cosmetic. The picture route reads no chain and no database. The key is
  `EARNINGS_SHARE_SECRET`, else derived from `PROFILE_SESSION_SECRET` (a read accepts either, so a
  posted link outlives the first; rotating the session secret ends the links it signed); with
  neither there is no Share. "test $WORD" on a test network, no Share in practice. **The token
  (version 2) also signs each named word's ascension stage and what the total was worth**
  (`usdCentsOf`: US cents at a LIVE, recent price; none on a test network): the pictured word wears
  its gilding at that stage, and the tag says "about $X" (the owner, 2026-11-26; the post's words
  still say no dollars). Neither is ever the link's, and the picture still reads no chain: X keeps
  what it fetches for good, so a read that timed out would leave it ungilded for ever. A version 1
  token still reads and draws without either. The tag is lettered as the card's back is: names in
  Söhne, figures in the card's serif, a WORD never in the serif. Raise
  `EARNINGS_CARD_LOOK` when the picture's own look changes (its address also carries `CARD_LOOK`). A word's card is drawn by
  `app/_og/wordCard.tsx` for both pictures: change the card there, once.
- **The Mint tab lists every letter's actual odds** (decisions.md #33; `components/game/LetterOdds.tsx`,
  `lib/letterOdds.ts`): the whole alphabet, A to Z, not a card. `letterWeights` is the ONE weight: the
  signer's `drawLetters` draws by it and the list shows it normalized, so never give the draw or the
  screen its own copy, and never change the draw's arithmetic (`tests/draw-pinned.test.ts` holds its
  letters for fixed seeds; a paid commit's letters depend on them). The chain game reads supply
  (`useLetterSupply`, shared with the lookup sheet): a sold-out letter shows "Sold out" and the rest
  rise; "N left" shows only at a tenth of the chain's cap or less (`LOW_SHARE`). The docs' odds table
  (`docs-site/letters.mdx`) is pinned to the code by `tests/letter-odds.test.ts`.
- **The jackpot's secret word is a card** (decisions.md #50, part 4; starl3xx: "a card has to be held, not
  individual letters"): face down until it is revealed (`cards/FaceDownCard`: a back's stock and the seal;
  it takes NO word and NO rarity, so nothing about the word can show, and its material is always
  Common's), then face up (the winner's own card, or the word in the plain scene). Never show a word as
  loose letters where a card would do. `tests/face-down-card.test.tsx` holds it.
- **The Jackpot page carries the bounty** (starl3xx, 2026-11-25): one tab (the phone's "Win", the
  rail's "Jackpot"), the daily jackpot then the weekly bounty (`screens/BountySection.tsx`), side by
  side from `lg`. There is no `bounty` view. Today keeps both cards; its bounty card links with
  `nav("jackpot", "bounty")`, and GameApp scrolls `main` to that `data-section` (a section already
  near the top, as in the second column, leaves the page at its top). A new link into part of a
  screen adds a `ViewSection` the same way.
- **The game's X account is [@lexigotchi](https://x.com/lexigotchi)** (`X_HANDLE`/`X_URL` in `site.ts`): the
  landing footer, the docs footer, More, and `twitter:site` point at it. Posts go out through
  **Typefully social set 372033**, never the X API, and only with starl3xx's go-ahead for each post.
  **Every X share tags @lexigotchi and carries a card of what's shared** (starl3xx, 2026-11-24): the
  text names `@lexigotchi` (`showcaseXText`; `xIntentUrl` appends it to any text that doesn't, and a
  test holds it), and the shared `url` is a page whose og:image pictures the thing (a showcase's own
  letter card at `/s/<letters>/card`), never just the generic game card. Cast text never says
  "@lexigotchi" (on Farcaster that's someone else). A share with no card of its own (a Market listing has none yet) stays
  Farcaster-only until it gets one.
- **Beta testers' updates** (a private Telegram group; never put its invite link anywhere public): a PR
  that changes something testers would notice adds a `## Tester note (KIND)` section right after
  Summary, one or two plain sentences in player language (house copy rules). Everything up to the next
  heading, rule, or code fence is posted, so nothing else goes in that section (#208 posted its
  diagram and file list). **KIND says what sort of
  update it is** (starl3xx, 2026-11-24), and the post opens with it: `new` (🆕 New feature), `fix`
  (🐛 Bug fix), `qol` (✨ Quality of life), `change` (🔄 Change, such as a price or a rule), or
  `heads-up` (⚠️ Heads up, such as a testnet reset). A note without a kind, or with one the formatter
  doesn't know, still posts, as 📣 Update, so always name one. The label says "New feature", so the
  note shouldn't open with "New:". It may use **bold**, `code`, and
  [links](https://…), which show as formatting in Telegram (`.github/scripts/tester-note.mjs` turns
  them into Telegram's HTML; anything else shows as typed, and a note Telegram can't read goes out as
  typed; notes too long for one message go out one by one). `.github/workflows/beta-updates.yml`
  posts it as @lexigotchi_bot when Vercel's Production deploy of that commit succeeds, then labels the
  PR `beta-posted` (no repost on a redeploy). No section, no post. Secrets `TELEGRAM_BOT_TOKEN` and
  `TELEGRAM_CHAT_ID`; "Run workflow" on it checks the bot can reach the group and the formatter
  loads, and never posts.
  **A PR can ask the testers a question** (starl3xx, 2026-11-26): a `## Tester poll` section, a
  question and then its answers as a list (2 to 12, each at most 100 characters; the question at
  most 300). It goes out as a Telegram poll, as a reply to the post that carries the PR's note, so
  no note, no poll. Anonymous unless the heading says `(named)`; `(multiple)` lets a tester pick
  several. `testerPoll` in `tester-note.mjs` reads it; a poll Telegram would refuse is a warning on
  the run with the reason, and a poll that fails NEVER stops its note being labelled (the note
  would post again on every deploy). The results are in the group; nothing is stored. **Once a
  week** (`.github/workflows/beta-pulse.yml`, Fridays 16:00 UTC) the bot asks "How was Lexigotchi
  this week?" (`PULSE_POLL`, the same every week so the weeks compare; anonymous). Pause it by
  disabling the workflow in GitHub; a manual run only shows the poll unless "send" is ticked.
  `tests/beta-workflows.test.ts` runs both workflows' scripts as GitHub would, with Telegram replaced.
  **New members get a welcome**: Telegram calls `/api/telegram/webhook` (`src/lib/telegram.ts`), which
  greets anyone who joins by their @username (else their first name, as a mention of their account,
  so both notify) with the HEYOO card
  (`/s/HEYOO/card`, uploaded by the route) and a caption pointing at the pinned message. Vercel needs `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and
  `TELEGRAM_WEBHOOK_SECRET` (dark without them; the secret header is checked in constant time); the
  "Telegram webhook" workflow registers the URL and secret with Telegram. Rerun it after the token or
  secret changes. A basic group upgraded to a supergroup gets a new id; the route logs it.
  **The bot answers commands** (`src/lib/telegramCommands.ts`; `commandOf` in `lib/telegram.ts`):
  `/help`, `/status`, `/jackpot`, `/bounty`, and `/word CRANE`, in the beta group or a private chat
  with the bot, as a reply to the message that asked (after the webhook's 200: Telegram resends a
  slow update). The list is `config/telegram-commands.json`, which `/help` reads and the "Telegram
  webhook" workflow sends as the "/" menu: rerun it after adding a command. **The bot is a group
  administrator, so Telegram sends it every message there.** Only a join and a command are acted
  on; never read, store, or log a message's words anywhere else. Answers are public game facts only
  (`/status` is not the System tab), sent with no parse mode, a fact that couldn't be read is left
  out (never zero or "nobody"), and a player's name is never written with an "@" (in Telegram that
  mentions someone else). 10 commands a minute per person (`allow("telegram", …)`).
  **`/bug what went wrong` files a report** (`lib/telegramReports.ts`, table `tester_reports`,
  migration 0019, `lib/db/testerReports.ts`): the words after the command, the reporter's Telegram
  name (never with an "@"), and Telegram's id of the screenshot it was typed under, if any. It is
  the one command that keeps what was typed. **Reports are PRIVATE: the repository is public, so
  they never go to GitHub by themselves.** They show in the console's **Reports** tab
  (`/api/admin/reports`, gated like Players; `lib/admin/reportRows.ts`), where "Mark fixed and tell
  them" makes the bot reply to the report where it was filed, ONCE (`setReportStatus` is one
  statement that only the first caller wins), with an optional note; "Close quietly" tells nobody;
  the screenshot is fetched through the bot (`/api/admin/reports/photo`, never a public address);
  and "Open as a public GitHub issue" fills in the report's words and number and never the
  reporter's name. In a private chat only someone in the beta group now may file one
  (`inBetaGroup`); 6 reports per 10 minutes per person; a report's words are never logged. Before
  0019 runs the bot answers that it couldn't save the report, and the tab says the migration is owed.
  **A player can link Telegram to their profile, and get reminders there** (`lib/telegramLink.ts`,
  `lib/db/telegramLinks.ts`, tables `telegram_links` + `telegram_link_codes`, migration 0020;
  `components/game/TelegramCard.tsx` in the profile sheet). "Link Telegram" makes a single-use code
  under the profile's session (`POST /api/profile/telegram`, 15 minutes) and shows "Open Telegram",
  its OWN tap (a browser opens another app only from the tap itself); the link is
  `t.me/<bot>?start=<code>`, and the bot's `/start <code>` links whoever presses Start. The code is
  the proof, so GET never returns one. One Telegram account names one profile and a profile has
  one: a new link replaces the old on both sides, in one transaction. `/unlink` (or Unlink in the
  profile) stops it. Never public. **Telegram is a fourth reminder channel**
  (`lib/notify/telegram.ts`): like email it goes to a linked player whatever else reached them,
  under a send-once mark of its own (`telegram:<kind>` in `reminder_marks`, claimed BEFORE the send,
  given back only on Telegram's clear refusal). Wired into `notifyPlayers` (sold, payday, bounty,
  deal), the keeper's hunger warning and jackpot win, and the daily-letter cron; every caller has
  already dropped players who turned the kind off. A player who blocked the bot is unlinked.
  Armed on the production deployment with the bot's token; `TELEGRAM_REMINDERS=off` mutes it. The
  profile offers the card only where the bot is set up AND the tables exist
  (`/api/profile/config` `telegram`, `telegramLinksReady`), so nothing shows before 0020 runs. The
  Players tab says WHETHER a wallet's account linked Telegram, never which account.
  **Migrations 0019 and 0020 ran in production (the Sepolia build) on 2026-11-27** (all three
  tables checked with a read-only query, and drizzle's own table holds 21 entries, as the journal
  does: `migrate` can say "applied" and skip one), so `/bug` saves reports and the profile offers
  Link Telegram (`/api/profile/config` says `"telegram": true`).
  **The operator can post as the bot** from the console's Broadcast tab (`tabs/TelegramBroadcast.tsx`,
  `POST /api/admin/telegram`, gated on the server like Players): the composer's text as a message,
  or a poll. Every send is typed-to-confirm, goes out as typed (no parse mode, no link preview),
  and is tried once (after a timeout it may be in the group). `pollError` in `lib/telegram.ts` is
  the app's twin of the workflows' `pollProblem` (plain JavaScript, so they can't share code):
  `tests/telegram-broadcast.test.ts` holds the two to the same answers.
  **The bot posts game news by itself**, from two Vercel crons (vercel.json):
  the **daily recap** (`lib/telegramRecap.ts`, `/api/cron/telegram-recap`, 00:20 UTC and again at
  02:20 for a late draw): how the day's jackpot draw went, the pot now, the words made the day
  before, and a new bounty theme on a week's first day; and the **Mythic-word alert** (starl3xx,
  2026-11-26; `lib/telegramAlerts.ts`, `/api/cron/telegram-alerts`, every five minutes): a post
  with the word's card when someone makes a Mythic word (`ALERT_TIERS`), only while the claim is
  under half an hour old, so nothing is announced late. Both post to real people unasked, so both:
  run on the production deployment only (`mayPostUnasked` in `lib/telegram.ts`: a Vercel preview
  build has NODE_ENV "production" too, so VERCEL_ENV must agree), CLAIM a send-once mark in
  `reminder_marks` before sending (the chain day; the claim's own event) and post nothing when no
  mark can be kept, give the mark back only on Telegram's clear refusal, and are muted by
  `TELEGRAM_RECAP=off` / `TELEGRAM_ALERTS=off` (a setting needs a deploy to take effect). The alert
  claims its mark LAST, after the name and the card are fetched (`hasMark` skips what was told), so
  a run that dies mid-fetch loses nothing. The
  recap waits for the day's draw (no draw, no recap). `lib/onchain/claims.ts` reads the words made
  in a stretch of time (a log has a block number, not a time: it measures the chain's pace, checks
  its start block, and times each claim's block exactly). A heading is bold by an entity
  (`SendOptions.bold`), never a parse mode, over a line of hyphens measured as the update posts' are.
- **The lockup** (decisions.md #56; `lib/cardArt/logo` `lockup`, `components/brand/Lockup.tsx`): A's
  tile standing where the name's L would, then EXIGOTCHI, as outlines (no font). **No seal in a
  lockup** (starl3xx, 2026-11-27). It is ALIVE where it is drawn live (the rail, the phone header,
  the intro, pre-launch, the landing header; the landing footer is still, and so is the game's own
  while the intro is up: one living mark at a time): the eyes blink and glance in MOMENTS from one timer (a class on the drawing for a moment,
  `.lk` in globals.css), never a loop inside the drawing, and never for a lockup nobody sees, under
  reduced motion, or on a low-power device. A blink is the letters' own swap of two drawings.
  **Each drawing on a page has its own ids** (`prefix`): the rail's and the header's are both in the
  page, and a gradient named twice can resolve to the hidden one and paint nothing. **The phone
  header's lockup gives way** (down to 91 px wide, the old plain name's width): at full size it
  pushed the profile button off a 390 px screen, so check the header at 320 to 424 px after
  touching it, in the practice game (its header is the fullest). **The eyes never invert** (the same
  day): on any ground an eye is a light eyeball with a dark pupil, so one ink has a drawing for a
  light ground and one for a dark ground, and what is clear is CUT OUT with a mask, never painted
  in a ground's colour. Where a mark must be square, use A. `tests/lockup.test.tsx` holds it.
  **It is also everywhere the name was set in type** (part 2; `tests/lockup-everywhere.test.ts`): the
  share video's corner (four still pictures, `lockup({ pose })`, picked by `score.ts` `markEyes`),
  a SAVED picture's corner (`cornerMark`; a link card still carries no name), the game's link
  picture (`/embed-image`: the lockup alone, since under the LEXI letters the L tile showed twice),
  the emails' header (a picture, see the email notes), and the docs' logo (`docs-site/logo`, still
  files). `npm run brand:art` makes the email's picture and the docs' files too. **A file is never
  alive:** no looping SVG, no animated picture in email, unless the owner asks and it can be checked.
  A new place that names the game draws the lockup: never set LEXIGOTCHI in type again.
- **The logos** (decisions.md #40): **A** is the primary logo and the app icon (the tile on paper,
  with the letters' eyes); **B** is the seal (a gilded tile on engraved blue; in one ink it is pressed
  into every card's back). One source draws them: `src/lib/cardArt/logo.ts` (`logoA`, `logoB`) and
  `seal.ts`. **`npm run brand:art`** (`scripts/brand-art.tsx`) makes `public/icon*.png`,
  `docs-site/favicon.png`, and the exports in `docs/brand/` (the lockup's too) from it. Never edit those files by hand:
  change the source and run the script (`tests/logo.test.ts` fails when they differ, and holds the
  grain mask in `docs/icon/make_grain.py` to the logo's measures). The letter is Söhne Fett's "L" as
  an outline, so no font is needed.
- `src/lib/site.ts` → mini-app manifest + `fc:miniapp` embed (served at `/.well-known/farcaster.json`,
  `/embed-image`, `/icon-image`). Identity/keys via env (`NEXT_PUBLIC_NEYNAR_CLIENT_ID`, `NEYNAR_API_KEY`).
- `contracts/` → Foundry suite mirroring the sim's 4-bucket ledger: `FeeRouter` (solvency hub),
  `Letters`/`Words`/`Rolls`/`Staking`/`Prestige`/`Jackpot`/`AnswerChain`/`YieldDistributor`/`Bounty`.
  Deps are gitignored — run `npm run contracts:setup`. Trust seams (signer/keeper) documented in
  `contracts/README.md`. Full mechanics reference: `GAME_DOCUMENTATION.md`; player docs: `docs-site/`.
- `src/app/admin/` + `src/components/admin/` → the **operator console** (`/admin`), modeled on the
  Griddle admin UI in Lexigotchi's design language. Shell: `AdminConsole.tsx` (sectioned tabs) gated by
  `AdminGate.tsx`. Lib in `src/lib/admin/`: `metrics.ts` (memoized `runSim` → Pulse/Economy API payloads,
  served by `src/app/api/admin/{pulse,economy}`), `contracts.ts` (the typed operator surface — every
  owner/keeper fn + ctor, drives Parameters/Keeper/Access/Launch), `tx.ts` (`TxIntent` → `cast` cmd +
  Safe batch; **no wagmi/viem** — execution is plan-only in Phase 0), `deployments.ts` (address registry,
  baseline `config/deployments.json` + localStorage overrides), `auth.ts` (allowlist via
  `NEXT_PUBLIC_ADMIN_*`, dev-open when unset), `format.ts` (USD↔$WORD-wei peg). Tabs in
  `src/components/admin/tabs/`.
  **Live tabs.** Pulse and Treasury read the live game first (`/api/admin/live`: the FeeRouter's pots,
  the treasury, letters minted, words claimed, holders; public chain data, open and edge-cached) and
  label the sim below as "Projection"; Broadcast's templates quote the same live numbers and this
  week's bounty theme (`lib/themes.ts`), never the sim. **Players** (`/api/admin/players`, `lib/admin/playersData.ts`
  → pure `playerRows.ts`): every wallet seen, from the contracts' events since deploy (faucet on
  testnet only; packs and dailies from `Committed`'s count; reveals, claims, rolls, stakes, feeds),
  `scanWorld` holdings, and the database (sightings, profile flags, push browsers, swap listings,
  Farcaster users), plus the beta group's Telegram member count; a funnel and new-wallet counts that
  leave out the TEAM's wallets (the allowlist, `TEAM_WALLETS`, registry roles, server keys, and any
  wallet linked into a team account). **System** (`/api/admin/system`, `systemStatus.ts`): game mode,
  every server key as its public address (`serverKeys.ts`, never the key) with gas and onchain wiring,
  the keeper's last resolve, every feature switch with the setting NAMES it still needs
  (`switches.ts`, shared with Notifications), and applied migrations (drizzle's own table against the
  journal). Notifications shows all three reminder channels. **Players and System are GATED on the
  server** (`lib/admin/serverAuth.ts`): a wallet session (the profile's SIWE token) for a wallet in
  `NEXT_PUBLIC_ADMIN_WALLETS`, or a Quick Auth FID in `NEXT_PUBLIC_ADMIN_FIDS`; `NEXT_PUBLIC_ADMIN_OPEN`
  does NOT open them in production, and they're `no-store`. The client sends the session through
  `useAdminApi` and offers a sign-in on 401. Never import a server module (db, `systemStatus`) VALUE
  into a tab: types only, or the Postgres driver lands in the browser bundle.
- **Wallet sightings** (`lib/sightings.ts`, `lib/db/sightings.ts`, table `wallet_sightings`, migration
  0012): the game posts `/api/players/seen` once per wallet per UTC day (`useWalletSighting`, mounted
  in GameApp) so Players can count wallets that connect and do nothing onchain. Unsigned by design, so
  the count is labelled unverified; rate-limited by IP; a FID only from a verified Quick Auth token.
  Dark (503, no client retry storm: the day is marked only on success) until 0012 is applied.
- **`FeeRouter.seed(uint8 bucket, uint256 amount)`** (owner-only) was added so the admin can fund the
  Rewards Pool (bucket 0) / Bounty (bucket 2) — pulls $WORD from the owner, credits the bucket, solvency
  invariant intact. Jackpot (bucket 1) reverts (`JackpotNotSeedable`) — it self-funds (lottery
  compliance, `params.ts`). The only non-`route` way $WORD enters a bucket.
- `src/lib/onchain/network.ts` → **the chain single-source-of-truth** (id / hex / explorer / CAIP-2),
  selected by `NEXT_PUBLIC_CHAIN_ID`: Base mainnet (8453) when unset, Base Sepolia (84532) opt-in. An
  unrecognised id **throws at boot** rather than falling back — a silent fallback would point a signed
  tx at a chain nobody chose. Nothing may hardcode a chain id or explorer again. The deployment
  registry follows it (`config/deployments.json` / `config/deployments.base-sepolia.json`) and the
  admin's localStorage overrides are namespaced per chain. Deliberate exception: `BalanceSheet.tsx`
  stays pinned to mainnet — it's the buy funnel for the real $WORD token.
- `src/lib/onchain/builderCode.ts` → **Base Builder Code attribution (ERC-8021)**. Our code
  `bc_bu1cyzms` (base.dev) → `Attribution.toDataSuffix` (the `ox` lib) → a calldata suffix that credits
  our txs on Base. **Every on-chain write the app originates MUST carry it**: ERC-5792 wallets via
  `builderCapabilities()` on `wallet_sendCalls` (wagmi `useSendCalls` or the mini-app EIP-1193
  provider), raw `eth_sendTransaction` via `appendBuilderSuffix(data)`. The single write chokepoint that
  injects it is `src/lib/onchain/sendCalls.ts` (`sendCallsAttributed`) — every contract write routes
  through it. **Every player action also runs through the action gate**
  (`src/lib/onchain/actionGate.ts`, `track()` in `ChainGameProvider`): the BusyPill shows it from the
  tap (preparing → confirm in your wallet → waiting for the chain), and a second tap while one is in
  flight sends nothing. Wrap any new action in `track`, or its tap looks ignored during the
  proof/voucher/read work before the wallet opens, and send with the `run` it hands the flow (each
  action's own, so an action abandoned with Hide can't drive a newer one's status). Claim, stake, unstake, and feed then **re-read the words until the change shows** (`sendAndSettle`, `src/lib/onchain/settle.ts`: reads at 0, 2, 5, 10, and 20 s) and announce it with the word; one read right after a send misses it, because a send returns when the wallet accepts and the words are a log scan. The testnet **faucet**
  settles on the mint's OWN result, on the same schedule (`settleSend` in `src/lib/onchain/traceSend.ts`:
  the receipt on Base Sepolia, or `wallet_getCallsStatus` for a batch, whose "failed" beats a
  bundler receipt that succeeded), and names any other outcome: never reached Base Sepolia, another
  network, reverted, or pending. The balance is only the fallback for a send nobody can trace, from a
  fresh read (a cached baseline both missed real mints and passed off earlier ones). Every read is
  capped, since the action gate waits on them. "Sent" proved nothing: a tester's wallet said sent
  and broadcast nothing (2026-11-24). **Rolls (and ascension attempts, see the word ladder below) are
  finished by the server** (decisions.md #14): `revealRoll` posts `{ relay: true }` and
  `/api/roll/reveal` sends `Rolls.reveal` from `RELAYER_PRIVATE_KEY` (`src/lib/onchain/relayer.ts`),
  so the wallet never previews the result; the answer's `relayed` field says what happened, and only
  "nothing broadcast" returns a signature for the wallet to send. **The server opens packs too**
  (decisions.md #49; `revealCommit`, `/api/mint/reveal` with `{ relay: true }`, `relayLettersReveal`):
  a pack, a free pack, and a daily letter whose reveal didn't ride its commit are ONE wallet
  confirmation. What the game does with each answer is `lib/onchain/packReveal.ts` (pure, tested):
  **only an answer with no `relayed` field reaches the wallet**; "mined" and "already" name the
  letters the CHAIN minted (the reveal's own `Revealed` event, `relayOutcome`), never the stored draw
  (which is served again only while it can still mint, so it can name different letters for a pack
  long since opened); "pending" and "reverted" name none, and the game waits for
  `commits(id).revealed`, then asks once more. A lost answer is "ask the chain" (`answerLost`). A
  commit seen revealed goes in `revealedPacks` and is skipped by every search for an open pack
  (`openPacks`): a lagging node would hand the old pack back as the new one. The free daily's bundle
  (commit + reveal in one send) is NOT relayed, and a paid pack can never be bundled: a pre-signed
  reveal would show the letters before the price is paid. Without `relay: true` the route answers
  exactly as before (`tests/mint-relay-route.test.ts`). `scripts/pack-relay-fork-check.ts` proves it
  against the deployed Letters on an Anvil fork (no real keys, no `DATABASE_URL`): rerun it after
  touching the route, the relayer, or `Letters.reveal`. **A pack comes by mail** (decisions.md #49,
  part 2; `sheets/MailSheet.tsx`, sheet kind `mail`; rules in `mail/mailFlow.ts`, pure, tested; art
  in `lib/cardArt/mail.ts`, the cards' engraving, each piece a still picture moved whole): a paid
  pack, the free pack, and the daily letter (one letter: "Contents: 1 letter", never "Paid"). The
  piece in hand is `g.mail` (both stores), because the purchase outlives the sheet. **The daily
  letter is NOT the pack's flow with a count of one** (part 3): its commit and reveal ride one send
  with a PREDICTED commit id, and the wallet's "sent" can't say which of them landed. Its marks
  follow `lib/onchain/dailySend` (`dailyPlan`, pure, tested): the number only once the chain says
  that id is this wallet's one-letter commit (never print the predicted id), the tear only once
  the chain says "revealed", the letter from the route's "already" answer (the chain's), the
  server asked to open it only when the wallet's own reveal can no longer land (two reveals for
  one commit means one reverts), and the envelope leaves only when `dailyUsed` says nothing was
  committed AND the send is known to have failed (a send that is only slow is "unsure": the note
  stays). **Hiding the daily's letter is a DISPLAY rule** (`lib/dailyNote` `dailySealed`, pure,
  tested): the letter goes on the stored note at the send, and the tile beside "claimed" is
  hidden only while a sealed one-letter envelope stands in this browser (in hand, kept as mail,
  or a one-letter commit still to be opened). Never bring back "a note with no letter must find
  its envelope": it took five rounds of fixes and was removed. An envelope lost to a reload costs
  the ceremony only. **Mail opened late says
  less** (`Mail.plain`, `hadFor`): a commit that was already revealed when the card opened it, or
  letters that went to a linked wallet, get no tags, no "new", and no word named. **Sound**
  (part 4; `lib/sound.ts`, `mail/mailCues.ts`, `useSound.ts`, `SoundToggle.tsx`): off until the
  player turns it on (More, the profile, since the desktop rail has no More, or the small switch
  under an envelope), kept per browser, and off
  means off (no file fetched, no AudioContext). **The eight files are in the repository**
  (`public/sfx/mail/`; starl3xx, 2026-11-27: "you can incorporate the sounds"), each the take he
  chose, held to its hash by `tests/sound-files.test.ts`: a changed or new cue changes that test
  in the same PR. `SOUND_READY` is worked out at build time (next.config.mjs:
  `public/sfx/mail/drop.mp3` exists, or `NEXT_PUBLIC_SOUND_BASE` is set), so a build without
  them is dark. **A new sound is the owner's to hear and approve first**, and its terms are read
  before it is committed (the sound-effects terms forbid making output available as isolated audio
  files, and this repository is public: he accepted that for these eight). A cue comes from a
  STEP (`cuesForStep`, pure),
  never from what the envelope shows when it appears, and letters make one cue a step. A new
  sound goes through `play` from a step function like that one. A browser plays only after a
  tap: `useSoundGestures` wakes the context on every tap while sound is on, and anything that
  plays cues by itself later (an envelope: its stamp lands when the chain says so) keeps it
  awake with `holdSound` while it is on screen, then lets it rest. To check sound without ears,
  record `AudioBufferSourceNode.start` in Playwright, naming each buffer by the file it was
  decoded from (two cues are the same length).
  **Each mark on the envelope is a true step:** the sheet opens with the wallet, the stamp when the
  commit is sent, the postmark and its number (`mailNumber`: the commit id plus one, one series for
  packs, free packs, and daily letters) when the commit is on chain, and the strip tears only when
  the chain says the pack is revealed. Never show a mark early, and never print a predicted number.
  The best letter comes out last (`revealOrder`); the count names newly spellable words with
  `newlySpellableWith` (the bought-letters rule: nothing named until the bag shows every letter).
  **Unopened mail is two things** (`pendingReveals`, the "Your mail is waiting" card on Today and
  Mint): a commit the server still has to open, and an envelope that arrived and was never torn,
  which is a record in the browser only (`lib/mailbox`, per chain, Letters address, and wallet):
  ceremony, never state, since those letters are in the bag. `settleMail` takes each pack's own
  `had` and `mine` (another envelope may be in hand when it lands) and writes to the box of the
  wallet that bought it. **Every flow that opens an envelope runs inside `mailGuard`**: a throw
  before the commit is sent drops the envelope ("nothing was spent"); after, the envelope says the
  pack is safe and waits, and the open commits are re-read on a stagger so the card shows it. An
  envelope left on "Minting your letters…" is the bug it prevents. **The bag's read lags a reveal
  by seconds**, so the order and tags come from `bagWithMail` (what the bag held plus the piece's
  letters), the next piece's `had` from `bagBefore` (never less than the last piece left, for
  60 s), and only the count's claim waits for the bag itself. To run the real-wallet path with no
  real key or database: an Anvil fork, the fork's Letters told to trust a test signer (as
  `scripts/pack-relay-fork-check.ts` does), a dev server with `NEXT_PUBLIC_RPC_URL` at the fork and
  every `.env.local` secret overridden EMPTY on the command line (`/api/health/db` must answer
  `ok: false`), and a browser wallet that forwards to the fork; `evm_setIntervalMining` makes
  the steps slow enough to see. Say "mail", never "post" (docs/messaging.md). Letters from the Market
  never come by mail. Its styles sit ABOVE the cards' section in globals.css (a card test reads the
  file's tail), and `tests/mail-sheet.test.tsx` fails on a scale, on travel outside the
  no-preference block, and on any loop but the pull tab's nudge and the blink. **Which game runs** (`src/lib/onchain/gameMode.ts`): the chain store wherever this
  network's registry has the whole suite, the practice (mock) store otherwise. Mainnet's registry is
  empty until the deploy, so production flips to the real game in the same deploy that commits the
  mainnet addresses; `NEXT_PUBLIC_CHAIN_GAME=0` is the emergency brake back to practice. In the
  chain game the prototype buttons are gone (no skip-a-day; the faucet only on testnet), and
  ascension hides while `Prestige.maxLevel` is 0. **`docs/web3-runtime-plan.md`** is the launch runbook.

## v0.2 mechanics (the ones easy to get wrong)

- Mints are **100% lowercase**; uppercase exists **only** via rolls. Daily single is gated on
  a Farcaster FID, a linked X account older than 90 days (while X is switched on), **or** a
  Coinbase-Verified wallet (EAS attestation on Base mainnet), checked server-side in that order
  (`src/lib/onchain/verifications.ts`, `/api/mint/free-daily`). Key ranges in the one on-chain
  `dailyUsed` mapping (the contract never interprets the key; the offsets keep them apart): FIDs
  < 2^32, verified wallets `2^160 | uint160(address)`, Base Verify reserved at 2^161, X
  `2^162 | xUserId` — **always bigint, never a JS number**. **One letter a day per player**:
  `dailyKeysFor` lists every key a request can see, and the server refuses (and the client shows
  "claimed") if any was used today. 10 free dailies per profile in all (decisions.md #21), so a
  skipped day isn't lost. The free pack signs under the same three key namespaces (X and Coinbase keys
  reach `freePackClaimed`, which never reads the key). Packs of 5 for everyone. ETH accepted via
  auto-swap → all accounting in $WORD.
- Rolls: **40% base, +15pp pity, cap 85%** (decisions.md #19), reset on success. Pity per
  `(owner, letterId)`. Failure never burns/downgrades the asset.
- **Rewards first** (decisions.md #19): every paid action (pack, daily, roll, claim, ascension)
  splits **75% pool / 10% jackpot / 10% burn / 5% treasury**; snacks stay 100% burned. The admin
  console's split table derives from `params.ts`, and `Deploy.s.sol` sets the same table.
- **Ascension is the word ladder, ON at launch** (#19): Gilded 1–4, then **Holographic** (stage 5,
  iridescent foil in the tile rig). A stage-N attempt costs N × `prestigeFee` (`Prestige.stageFee`;
  `params.prestigeStageFeeUsd`) and draws at `prestige.baseByLevel[level]` (40/35/30/25/20%) + 10pp
  per miss; each commit records its `level`, which `/api/prestige/reveal` reads. Stage names and the
  fee multiple live in `src/lib/ascension.ts`; never write "Gilded L4"-style copy by hand.
  **A try is made in the ascend sheet** (decisions.md #36; `sheets/AscendSheet.tsx`, sheet kind
  `ascend`, rules in `components/game/ascendFlow.ts`, pure, tested): the word at full size, its
  letters nervous while a try is out (the rig's `rolling` state, out of step), then the result
  passing along the word letter by letter (`TileWord`'s `states` / `gilds`), and "Try again" or
  "Try for" the next stage on the result. **A try in flight is "Attempting ascension", never
  "Ascending"** (starl3xx, 2026-11-25: it may miss), and the act is a "try"; `tests/ascend-sheet.test.tsx`
  holds it. The button's price is the stage's fee plus the snack the try burns: what the wallet pays.
  **The server finishes the attempt** (decisions.md #44, as it does rolls, #14): the game posts
  `{ commitId, relay: true }` to `/api/prestige/reveal`, which sends `Prestige.reveal` from
  `RELAYER_PRIVATE_KEY` (`lib/onchain/relayer.ts`, `relayPrestigeReveal`) and answers with what
  the CHAIN did, read from the reveal's own event (`lib/onchain/relayOutcome.ts`, tested on real
  Sepolia logs): a hit's new level, or a miss's pity plus the level read AT the reveal's block (the
  event doesn't carry it; the same word may stand stages higher later). One wallet confirmation an
  attempt. `revealPlan` (`lib/onchain/ascendResult.ts`) says what the game does with each answer:
  **only an answer with no `relayed` field ever reaches the wallet** (no relayer key, or its send
  was refused); once anything is broadcast (`pending`, `reverted`), or was done already
  (`already`), the game reads the chain and never sends a second reveal. The route without
  `relay: true` answers exactly as before (an old client bundle keeps working through a deploy).
  The relayer's in-flight sends are keyed by contract AND commit (`roll:7`, `prestige:7`): each
  contract counts its own commits. **A lost answer is the usual way to end unfinished now** (the
  route holds the request up to 20 s for the block): on a failed fetch or a 5xx the game asks the
  chain before calling anything unfinished (`answerLost`), the unfinished mark keeps its commit
  id so "Finish your attempt" asks the server about THAT commit and says its result, and a mark
  whose reveal lands later on its own is dropped with its result said in a toast (the words
  effect; a word with an action in flight is left to that action).
  **The result is the chain's, not the signature's:** when the game reads it itself,
  `settleAscension` waits for `commits(id).revealed` and reads the word's stage and pity in the
  same multicall (`readPrestigeAttempt`); `lib/onchain/ascendResult.ts` decides what that is (a
  result, a "foreign" earlier attempt → ready again, or unfinished → stranded, no try offered);
  and `lib/onchain/stageOverlay.ts` shows the new stage over the slower words read (60 s at most).
  Every path that learns a reveal landed ends in `noteAscension` (never open again, stage noted,
  mark cleared, words re-read). Attempts read as revealed are skipped by every later search for an
  open one (`revealedAttempts`), as `revealedRolls` are. The outcome carries the chain's own
  `stage` (level, pity), and the sheet shows that, never one worked out from hit or miss. **How a
  try ends is said once, and always:** by the sheet it was made in, or, if that sheet has gone
  (the same sheet OBJECT, not any ascend sheet), by a toast (`resultToast`, `strandedToast`); a try
  that ended unfinished also marks its word for the session (`unfinishedAscents`, cleared by
  `pruneUnfinished` or the next reveal read back), which the word sheet and the ascend sheet say.
  **A paid, unfinished attempt is finished with no price and no gate:** the ascend sheet's button
  becomes "Finish your attempt" (`prestige(word, { finishOnly: true })`: sends that attempt's
  reveal, never pays for a new one, and says so when none is open), and it never checks the
  balance or the stake; the word sheet's button into the sheet always opens for such a word
  (`ascendDoor`). Any new gate on trying must leave finishing alone.
- Staking split: **yield is UPPERCASE-only**; **any** staked non-hungry word (any case) is
  **jackpot-eligible**. Hunger gates both: peckish (1–2d) halves yield; hungry (3+d) zeroes
  yield AND drops jackpot eligibility.
- One word = one NFT, `tokenId = keccak256(word)`, case **derived** from escrow (never stored).
- **A claim may mix cases** (decisions.md #17): `Words.claim(word, uint8 upperMask, proof)` names
  each letter's case (bit k ⇒ position k UPPERCASE); in the app, `claim(word, cases)` with
  `claimCase` / `canSpellAs` / `caseMask` (`state.tsx`). Spell has one tray and no case switch: the
  rack claims exactly the tiles picked, and the word list and Today's next steps claim UPPERCASE
  first. The `Claimed` event that the bag (`onchain/reads.ts`) and the keeper (`keeper/scan.ts`)
  scan comes from the generated ABI (`getAbiItem`), never a hand copy: a copy kept the old `bool`
  shape, and a log filter on a changed signature silently matches nothing.
- Snacks 100% burn. The `ROYALTY` FeeSource is the word-sale fee (10%, `SaleFees.flush()`) → 100%
  Rewards Pool (decisions.md #18; the bounty carve applies); both token
  contracts also carry an ERC-2981 royalty **signal** (2.5% → Treasury, unenforced — open
  composability, decisions.md "Royalty & marketplace architecture").

## Copy and messaging

**`docs/messaging.md` is the source of truth for every word a player reads** (decisions.md #24):
Lexigotchi is a word-pet game: collect living letters, raise them, and spell words nobody else can
own. Read it before writing any copy (the app, the landing page, the docs, reminders, share text,
bot posts). The hard rules:

- **Never name Tamagotchi or Pokémon** in player-facing copy, nor near-quote them ("gotta spell 'em
  all", "Pokédex"). The comparison stays internal.
- **Say / instead of:** letters, words (not NFTs, tokens, assets); yours, one owner, onchain (not
  Web3, decentralized); raise, roll (not gamble, bet, upgrade); spell, claim a word (not mint a
  word); feed, snack, hungry (not maintain, upkeep); the daily word, the jackpot, in the running (not
  lottery, draw as a noun, ticket); earns $WORD every day (not yield, APR, returns, passive income);
  Dictionary (not Lexidex); the Market (not marketplace, exchange); a card's front, its face or
  card face, and its back (never scene: see "A card's words" above).
- **Never write:** price, pump, moon, invest, investment, "number go up", or a dollar figure for
  $WORD or the jackpot. USD prices of game actions ("a pack is $1") are fine, and so are the
  functional uses: a word's sale price on the Market and the $WORD page's own data. One exception
  (decisions.md #46): Today's three pot tiles show "about $X" beside each pot, never for test
  $WORD. A second (decisions.md #38, amended): the earnings share PICTURE says "about $X" under
  the player's total, signed by the server at a live price, never for test $WORD. Nowhere else
  (a post's own words, reminders, landing, docs, bot posts) gets a dollar figure for $WORD.
- **The jackpot always carries "staked and fed".**
- **Lead with a pet, a word, or a rare letter, never with earning.** Letters are characters, written
  in their case ("your q is hungry"); a reminder names the letter or word ("FUNKY is peckish").
- **Numbers are derived, never typed** (`src/lib/howItWorks.ts`: `WORDS`, `TOP_TIER`,
  `RAREST_LETTER`, `FREE_PACK`/`FREE_DAILIES`/`FREE_TO_START`, `LADDER`, `days`). The top tier's name
  comes from `TIERS`, so a tier rename flows through on its own (it reads Mythic since #23).
- **`tests/copy-rules.test.ts` guards it**: the banned words fail the build in player-facing code
  (`src/components` except the operator console, `src/app`, and the copy-bearing `src/lib` files) and
  the player docs (except `contracts.mdx` and `fairness.mdx`, which keep token standards). An
  exception goes in `VOCAB_ALLOW` with its reason.

## Gotchas / conventions

- **`package.json` `overrides: { cuer: "0.0.4" }` is load-bearing.** RainbowKit 2.2.11 pins `cuer`
  0.0.3, which asks the `qr` library for `border: 0`. `qr` ≥ 0.6 (cuer allows `~0`) throws on that,
  so tapping WalletConnect crashed the page (`RangeError: invalid border=0`). cuer 0.0.4 asks for
  `border: 1` and trims it. Drop the override only once RainbowKit ships cuer ≥ 0.0.4.

- The sim's **absolute** numbers depend on placeholder budgets — trust the **relative**
  dynamics (see `docs/decisions.md` findings). Key insight: the mint sink is finite; the
  durable economy runs on rolls + snacks.
- The sim now models secondary letter trading as a **default-off lever** (enable it to study
  low-budget players' options); a rarity-tiered letter floor is still owed (`docs/decisions.md`).
  Don't draw casual-retention conclusions with the lever left off.
- Match the surrounding style; keep the economy derivation pure + tested. If you touch
  `economy.ts`, run `npm test` — the spec assertions are the guardrail.
- **Before adding code, ask whether it needs to exist.** In order: does the codebase already do
  this? the stdlib? the platform? a dependency we already ship? Prefer deleting over adding, and
  boring over clever. Jake gates builds on evidence, not enthusiasm — see `docs/decisions.md` on
  the swap primitive, which started as "build a marketplace" and ended as a swap escrow.
  **Two things this does NOT license cutting**, because both looked like surplus structure right
  up until they weren't: (1) guards, validation, and the tests that prove them — the empty-audience
  check in `src/lib/notify/send.ts` is three lines standing between us and pushing "your words are
  hungry" to every player; (2) the explanatory comments. In `contracts/` the NatSpec is an audit
  deliverable someone pays to read, and elsewhere the comment carrying the *why* is usually the
  part that stops the next person reintroducing the bug.
- **A feature change updates every surface that describes it, in the same PR** (starl3xx,
  2026-11-24: "update FAQ, cheat sheet, in-app UI, docs, etc on any feature changes"). #140 switched
  X on and updated the docs and the landing page but missed the cheat sheet and the connect panel.
  Search for the claim's words (e.g. `Coinbase`, `daily letter`, `no email`), not for files, across:
  `docs-site/` (every page, and `faq.mdx`), `sheets/CheatSheet.tsx`, `src/lib/howItWorks.ts` and
  `Onboarding.tsx`, the feature's own cards and sheets (`DailyUnlock`, `ProfileSheet`,
  `BalanceSheet`, `ConnectPanel`, `MoreScreen`, `NextSteps`, locked and empty states),
  `src/components/landing/LandingPage.tsx` (and its FAQ), `src/lib/notify/templates.ts` and
  `src/lib/notify/email.ts`, share/OG copy (`src/lib/showcase.ts`, `src/lib/site.ts`), and
  `CLAUDE.md`/`docs/web3-runtime-plan.md`. Copy about a switchable feature reads the switch
  (`usePublicProfile().xEnabled`/`emailEnabled` in the app, `xEnabled()`/`emailEnabled()` on the
  server) so it can't run ahead of production; `docs-site/` can't, so change it with the switch.
  Say in the PR which surfaces you checked. Refresh the screenshots (`npm run docs:shots -- <names>`)
  when a pictured screen changes.
- **Player-facing copy follows the house rules, and `tests/copy-rules.test.ts` enforces them** on
  every rendered string in `src/components/game`, `src/components/landing`, `howItWorks.ts`, and the
  notification templates: no em dashes (pick the mark the sentence needs: colon, comma, period, or
  brackets; a missing value shows an en dash "–"), curly apostrophes and quotes, and "onchain" as one
  word. Code comments are exempt.
- **The game's visual system (UI proposal, Nov 2026).** One meaning per color: teal = grow and care
  (claim, stake, feed), gold = chance (roll, jackpot), candy = spend (packs, Buy $WORD, connect),
  ink = "you are here" (active tab, switches, filters). Colored text uses the `-ink` shades and
  cream-labeled fills use `candy.deep` (tailwind.config.ts says why: contrast). `.cel` is for the one
  main card on a screen and for the player's own item in a list; repeated list items use `.cel-sm`.
  No decorative all-caps labels: capitals mean a raised letter in this game. Text floor is 12 px
  (`text-xs`), except compact chips and the header's balance line.
  Raised surfaces (cards, list tiles, ghost buttons, chips, inputs) use `bg-card`, a shade lighter
  than the paper page; the page, sheets, and full-screen overlays stay `bg-paper`.
- **Interaction and motion (globals.css).** Anything clickable answers the pointer: `.press` (a cel
  that lifts on hover and pushes into its shadow on press; `--sh` is its shadow size),
  `.press-icon`, `.tile-press` (letter characters hop), `.round-btn`, and `<Segmented>` (a sliding
  ink thumb). Sheets animate in and out (`SheetHost` keeps a closed sheet mounted for
  `SHEET_EXIT_MS`; Escape closes), screens cascade in (`.view-in`, not on first load), toasts have
  icons, hold on hover, and dismiss on click, and balances and pots count (`TweenNumber`). Hover
  styles are gated to real pointers (`hoverOnlyWhenSupported`), and all movement sits behind
  `prefers-reduced-motion: no-preference`: never cancel a transform under `reduce`, because that
  also clears resting transforms (the Segmented thumb's position, a selected tile's lift).
- **Builder-code attribution is mandatory**: every on-chain action routes through
  `src/lib/onchain/builderCode.ts` (ERC-8021 suffix) or we silently forfeit Base builder rewards —
  the tx still sends, it's just uncredited. `tests/builder-code.test.ts` is the round-trip guardrail.

This codebase is yours: what it's for and how it's built are your call, and you'll keep building on it.
