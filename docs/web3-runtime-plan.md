# Web3 runtime — foundation & build plan

How the mock game becomes a real on-chain app. The game today runs on a mock store
(`src/components/game/state.tsx`) — every action mutates local state, nothing touches the chain
(`package.json` has no web3 deps; the only wallet touch is a read in `BalanceSheet.tsx`). This is the
foundation already shipped plus the sequenced plan for the rest.

## Decisions that shape it
(from `docs/decisions.md` → "Launch decisions — LOCKED")

- **Mini-app AND general web wallet** — two connector paths (the Farcaster/Base mini-app wallet + web wallets).
- **$WORD-only at launch** — no in-app ETH→$WORD swap UI; ETH-only players use the Buy-$WORD redirect.
- **Reads** via a custom **Neon/Drizzle indexer + viem `multicall`** (no subgraph).
- **No multisig** — owner is a single hardware-wallet EOA; recurring work runs from hot keys
  (`signer`, `keeper`, and the distinct `priceKeeper`).
- **Builder code** — every on-chain action carries the ERC-8021 attribution (`bc_bu1cyzms`).

## Shipped foundation (stack-agnostic, done + tested)

- **`src/lib/onchain/builderCode.ts`** — the attribution primitive: `bc_bu1cyzms` → the ERC-8021
  `dataSuffix` (via `ox`). Round-trip tested.
- **`src/lib/onchain/sendCalls.ts`** — **the write chokepoint**, `sendCallsAttributed(provider, from, calls)`.
  Prefers ERC-5792 `wallet_sendCalls` (atomic batch + the `dataSuffix` capability); falls back to
  per-call `eth_sendTransaction` with the suffix appended. Provider-level, so it works with the
  mini-app wallet and web connectors alike. **Every contract write routes through this** — attribution
  can't be skipped. Mock-provider tested (`tests/send-calls.test.ts`).

## To build (sequenced)

Legend: 🟢 unblocked · 🟠 blocked on the deployed contracts (addresses/ABIs) · 🔴 blocked on a live keeper wallet.

1. 🟢 **Connectors / wagmi config** (`src/lib/onchain/wagmi.ts`) — wagmi v2 + viem, Base (8453).
   Connectors: `@farcaster/miniapp-wagmi-connector` (mini app) + `injected` / `coinbaseWallet` /
   `walletConnect` (web). Mount `WagmiProvider` + `QueryClientProvider` in
   `src/components/game/Providers.tsx` beside the existing Neynar provider. *Additive — mount only when
   writes go live, so the still-mock game isn't disrupted.*
2. 🟢 **Wallet binding** — resolve the identity-vs-wallet split: `useViewer` gives the FID; the
   connected wallet is the on-chain identity. Bind + persist the active address; reads/writes key on
   the **wallet**, not the FID. The free daily still gates on a Neynar-proven FID.
3. 🟠 **ABIs + addresses** — generate typed ABIs from the Foundry artifacts; populate
   `config/deployments.json` (today all addresses + roles are null) after deploy.
4. 🟠 **Action helpers** — one per game action (daily/pack mint + reveal, roll commit+reveal, claim,
   stake/unstake/feed, prestige, the free-daily + free-pack vouchers). Each builds calldata
   (`encodeFunctionData`) and sends via `sendCallsAttributed`. Two-tx **commit→reveal UX**: pending
   states that survive a real signed tx + the reveal round-trip, plus rejection/revert/resume handling
   (today Roll/Mint fake outcomes with `setTimeout`).
5. 🟠 **Reveal-signer service** — the off-chain backend key (the contracts' `signer` role) that signs:
   the commit→reveal draw outcomes (Letters/Rolls/Prestige), the FID-gated daily allowance, **and the
   free-daily + free-pack vouchers** (KIND-tagged digests — see `contracts/src/Letters.sol`). Needs the
   deployed `signer` address + the exact digest layouts (which the contracts pin).
6. 🔴 **Keeper service** — the always-on hot-key runtime: daily `Jackpot.resolve` (word reveal),
   `YieldDistributor`/`Bounty` epoch opens + Merkle roots, and the **`priceKeeper` repeg** (reads the
   $WORD price — same token LHAW already prices — and submits clamped `repeg*` calls within the
   `maxMoveBps` band). Vercel crons + a keeper wallet on a Base RPC. See `docs/decisions.md` (the peg
   reuses LHAW's price-fetch, not its one-value model).
7. 🟠 **Read layer** — a custom indexer on the existing Neon/Drizzle DB watching contract events
   (mints, claims, rolls, stakes, prestige, jackpot) → the collection/leaderboard views; viem
   `multicall` for hot per-wallet reads (balances, hunger, pity, prestige level). Replaces the mock
   store's reads. Enumerating 1-of-1 word NFTs (`keccak256(word)`) + per-`(owner,letter)` pity is the
   reason an index beats raw reads.
8. 🟢 **Strip prototype affordances** — remove the "Skip a day" + "add demo balance" buttons + the
   seeded starter inventory before the real economy goes live (they'd mint free $WORD / advance time).
   Do at cutover.
9. 🟠 **Airdrop fulfillment** — claim-on-first-open: an eligible FID connects → the signer issues a
   free-pack voucher bound to their wallet → `commitPackFree` + reveal → write `tx_hash` back to the
   `pack_grants` ledger (the on-chain `freePackClaimed` is the authoritative backstop).

## Why the foundation stops here

The write chokepoint + attribution are the stack-agnostic core and are done + tested. The connector
mount, action helpers, signer/keeper services, and indexer all need either the deployed contract
addresses/ABIs or a live keeper wallet — so they're specified above and built once the audited suite
is deployed. Mounting wagmi into the live provider tree now would add weight + risk to the still-mock
game for zero functional gain.
