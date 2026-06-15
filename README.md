# Lexigotchi

> **Raise your letters. Spell your words. Own the dictionary.**

A tamagotchi-style **$WORD** collection game on **Base** — a Farcaster Mini App and web app in the
_Let's Have A Word!_ ecosystem. Mint animated rubber-hose **letter characters**, gamble them from
lowercase to **UPPERCASE**, spell words from a 4,438-word dictionary to claim them as NFTs, then
**stake and feed** them to earn $WORD and chase a daily jackpot.

<p align="center"><em>Mint → Raise → Claim → Stake &amp; Snack → Win</em></p>

---

## Play it

The game is a portrait Farcaster Mini App. The repo serves it at **`/play`** (the bare domain
redirects there); the marketing/reference pages live under `/about`, `/characters`, `/lexidex`, and
`/economy`.

```bash
npm install
npm run dev          # http://localhost:3000  → redirects to /play
```

Players in a Farcaster client are auto-connected; on the open web they sign in with Neynar or connect
a Base wallet. Every button is wired to the (mock) game state, so the full loop is explorable end to
end. See **[FAQ.md](./FAQ.md)** for how the game works, and **[GAME_DOCUMENTATION.md](./GAME_DOCUMENTATION.md)**
for the complete mechanics, odds, and economy reference.

### Environment

Copy `.env.example` → `.env.local` and set:

- `NEXT_PUBLIC_NEYNAR_CLIENT_ID` — Neynar client ID (public; powers web Sign In With Neynar)
- `NEYNAR_API_KEY` — Neynar app API key (server-side only, never exposed)
- `NEXT_PUBLIC_URL` — the deployed origin (used for the mini-app manifest + share-embed images)

For production, also generate the `accountAssociation` proof for your domain (Farcaster Manifest Tool)
and supply it via `FARCASTER_HEADER` / `FARCASTER_PAYLOAD` / `FARCASTER_SIGNATURE`. The manifest is
served at `/.well-known/farcaster.json`.

---

## What's in the box

| Area | Path | What |
|---|---|---|
| **Playable app** | `src/app/play`, `src/components/game/` | The portrait mini-app UI on a faithful mock store, wired to real Farcaster identity, wallet, buy, and cast flows. |
| **Operator console** | `src/app/admin`, `src/components/admin/` | The owner/operator dashboard at `/admin` — sim-backed metrics, economy health, a contract-launch walkthrough, reward-pool funding, parameter/keeper transaction builders, and ownership handoff. |
| **Smart contracts** | `contracts/` | The full Solidity suite (Foundry) — letters, words, rolls, staking, jackpot, bounty, prestige — code-complete and unit-tested. |
| **Economy core** | `src/lib/economy.ts`, `params.ts`, `dictionary.ts` | The 4,438-word set, demand-mirrored letter odds, rarity tiers, and every tunable parameter — derived in code, asserted against the spec. |
| **Solvency sim** | `src/lib/sim/` | A deterministic agent-based simulation + the four-bucket ledger that proves solvency before mainnet. |
| **Characters** | `src/components/characters/Rig.tsx` | The shared 1930s rubber-hose rig driving all 52 letter characters. |
| **Specs & decisions** | `docs/` | Product specs (v0.1 + v0.2), the decisions log, the pricing/Phase-0 reviews, and the EGGS commit/reveal reference. |

---

## The loop

1. **Mint** lowercase letters — a discounted daily single (1 per Farcaster FID) or packs of 5. Odds
   mirror the dictionary; capitals are never pulled.
2. **Raise** a letter to UPPERCASE with a roll — 45% base, climbing to 85% on a pity streak. A failed
   roll never harms your letter.
3. **Claim** a word by escrowing 5 uniform-case letters → one ERC-721 per word
   (`tokenId = keccak256(word)`); case is derived from the escrow.
4. **Stake & Snack** — UPPERCASE words draw yield; any staked, fed word is a jackpot ticket. Feed
   snacks or they get hungry.
5. **Win** — Lexigotchi reveals a secret word daily from its own pre-committed hash-chain; hold it
   staked and fed and you take the whole pot.

Two renewable late-game loops sit on top: a **weekly theme bounty** (broad) and **prestige/ascension**
(deep). Plus **showcases** (cast any letters you own), **swaps** (two-sided letter escrow), and
**dissolution** (recover a word's letters, free the name).

---

## Smart contracts

Foundry + OpenZeppelin, Solidity 0.8.28, targeting Base. The architecture mirrors the off-chain sim's
four-bucket ledger and the EGGS commit/reveal pattern, with **solvency by construction** (bucket
payouts are capped at balance) and **failed rolls that provably never harm an asset**.

```bash
npm run contracts:setup    # vendor forge-std + OpenZeppelin into contracts/lib
npm run derive:contracts   # write contracts/config/economy.json (caps, weights, dictionary root)
npm run contracts:build
npm run contracts:test     # 27 tests
```

> **Phase 0 — code-complete and unit-tested, not yet audited or deployed.** See
> [`contracts/README.md`](./contracts/README.md) for the architecture, the documented trust model, the
> deploy script, and the pre-mainnet checklist.

---

## Economy & simulation

The economy is **derived in code** and asserted against the spec, so the published tables can never
drift from the data. A deterministic agent-based sim de-risks solvency and the day-70 completion cliff
before any contracts ship.

```bash
npm run sim                # economy/solvency report (try: -- --days 365 --population 1500 --seed 7)
npm run derive             # regenerate docs/economy.md from the dictionary
npm run loop-exp           # renewable late-game loop experiment (prestige + theme bounty)
npm test                   # economy reproduces spec Appendix A/B + solvency invariants hold
npm run typecheck && npm run build
```

What the sim shows: solvency is structural; the mint sink is finite (letters mint out ~day 69), so the
durable economy runs on rolls + snacks; the Rewards Pool finds an equilibrium; and the renewable
loops are what keep the late game alive. Full findings in [`docs/decisions.md`](./docs/decisions.md).

---

## Operator console (`/admin`)

The owner/operator dashboard, modeled on the Griddle admin UI in Lexigotchi's own design language.
Sectioned tabs:

- **Analytics** — _Pulse_ (bucket levels, collection, demand, solvency), _Economy_ (health
  scorecard, fee splits, price table, per-archetype ROI, sink durability), _Supply_ (per-letter caps
  vs demand, rarity tiers). Metrics are served by the deterministic economy sim (Phase 0); the
  shapes match the on-chain reads that will fill them once the suite is live.
- **Operations** — _Launch_ (assembles the `forge script Deploy` command + walks the deploy order
  and post-launch checklist), _Treasury & Pools_ (**add $WORD to the Rewards Pool / Bounty bucket**),
  _Parameters_ (every owner setter, as a transaction builder), _Keeper_ (resolve the daily jackpot,
  open yield/bounty epochs), _Access & Safety_ (Ownable2Step handoff to the multisig, wiring
  checklist, emergency levers).
- **Settings** — _Deployments_ (the contract address registry) and _Broadcast_ (operator
  announcements).

Because the contracts aren't deployed yet, every on-chain action is built into a **transaction plan**
— a copy-pasteable `cast send` command **and** a Gnosis Safe Transaction Builder batch — rather than
signed in the browser (the right model for a multisig owner). Funding the pools uses an owner-only
`FeeRouter.seed(bucket, amount)` added for this purpose (Pool + Bounty only; the jackpot self-funds
from fees, never operator-seeded — the lottery-compliance stance from `params.ts`).

Access is allowlisted via `NEXT_PUBLIC_ADMIN_FIDS` (dev-open locally; **fail-closed in production**
when unset — set it to your FID, or `NEXT_PUBLIC_ADMIN_OPEN=1` to open deliberately). The real
security boundary for any action is the owner's wallet signature, not the route gate.

---

## Status

Phase 0 prototype → Phase 1 Mint &amp; Claim → Phase 2 Roll &amp; Shine (+ Showcase) → Phase 3 Stake
&amp; Snack (+ jackpot) → Phase 4 Deepen. The app and the contract suite are built; deployment,
audit, and the production keeper/signer infrastructure are the next milestones. Prices in `params.ts`
are USD-pegged placeholders the tokenomics sim exists to set.

## License

Prototype — not yet licensed for reuse. © the Lexigotchi authors.
