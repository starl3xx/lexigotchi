---
name: run-sepolia
description: Run and drive the Lexigotchi mini app against the Base Sepolia rehearsal deployment — dev server, headless browser, mock wallet. Use when asked to run the app, screenshot /play, verify a change in the real UI, or check chain-backed state end to end.
---

# Running Lexigotchi against Base Sepolia

Hand-authored from the session that first got this working (2026-08-12), not
generated from a clean-container cold start. The commands below were all run and
verified on this machine; they have **not** been re-verified from a fresh clone,
so treat the setup steps as "known to work here" rather than "known to be
complete".

## What "running it" means here

`/play` is a client-rendered mini app. Its chain layer can be verified with
direct calls from Node, but the wiring **between the provider and the screens**
cannot — that only shows up in a browser. Running the app is what caught
`ChainGate` being mounted in zero screens while its own nine tests passed.

## 1. Environment

`.env.local` (gitignored) needs these beyond the normal app vars:

```
NEXT_PUBLIC_CHAIN_ID=84532          # Base Sepolia. Unset = mainnet, where nothing is deployed.
SIGNER_PRIVATE_KEY=<contracts/sepolia-signer.secret.json>
SIGNER_DRAW_SECRET=rehearsal-only-secret
```

Without `NEXT_PUBLIC_CHAIN_ID` the app resolves to mainnet, every address is
null, and the symptom is **not** an error — it's a game that looks like you're
broke. See `src/lib/onchain/network.ts`.

The two secret files are gitignored throwaway testnet keys created during the
rehearsal:
- `contracts/sepolia-deployer.secret.json` — the "player" wallet, holds mock $WORD
- `contracts/sepolia-signer.secret.json` — the contracts' `signer` role

## 2. Dev server

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill 2>/dev/null   # free the port first
npm run dev > /tmp/devserver.log 2>&1 &
until curl -sf http://localhost:3000/play >/dev/null 2>&1; do sleep 1; done
```

Poll the port; don't `sleep`. Next compiles `/play` on demand and the first load
takes ~10s. macOS has no `timeout(1)` — don't reach for it.

## 3. Drive it

```bash
node scripts/drive-sepolia.mjs
```

That script is the working driver. There is **no `chromium-cli`** on this
machine, so it uses `playwright` directly (`npm i -D playwright && npx playwright
install chromium` — already done).

Four things in it are non-obvious and were each learned the hard way:

1. **The wallet is a mock EIP-1193 provider bridged to Node.** The page gets a
   `window.ethereum` whose `request()` forwards through
   `page.exposeFunction("__walletRpc", …)`, where viem signs with the throwaway
   deployer key and proxies everything else to `https://sepolia.base.org`. It
   also announces itself over EIP-6963 or wagmi's injected connector won't find it.

2. **The mock must answer `wallet_sendCalls` with "unsupported"** (code 4200).
   That forces `sendCallsAttributed` down its `eth_sendTransaction` fallback —
   the path that appends the ERC-8021 builder suffix, which is the one worth
   exercising.

3. **Onboarding covers the app.** Click `Skip` before anything else, or the
   Connect button isn't reachable.

4. **Quick Auth cannot be driven headlessly.** `/api/mint/free-pack` and the
   daily require a verified Farcaster JWT, and a plain browser has no host
   context. Connect, reads, and rendering are drivable; the in-UI mint is not.

## 4. What a good run looks like

With the rehearsal wallet connected, the header shows a real balance and the Bag
shows real letters:

```
HEADER: "LEXIGOTCHI\n90.67M\n$21.37 · $WORD"
errors: 0
```

**Check the error count.** The page renders fine while throwing — the web path
used to emit an unhandled pageerror from the Farcaster SDK on every load, and
nothing about the rendered page hinted at it.

## 5. RPC read-after-write lag (the recurring trap)

The public Base Sepolia RPC is **not** read-after-write consistent. A read issued
the instant a transaction mines routinely hits a node that hasn't caught up. This
produced three separate false results during the rehearsal — balances that
"didn't change", logs that "weren't there", a commit that "didn't exist" — every
one a stale read of a change that had in fact landed, and every one
indistinguishable from failure.

If something looks like it didn't work, **re-read it a few seconds later before
believing it.** `useOnchain.send` already re-reads on a stagger for this reason,
and `waitForNewCommit` exists because a single empty log query means nothing.

## 6. Contract-level checks without a browser

Faster than the browser for anything below the UI:

```bash
NEXT_PUBLIC_CHAIN_ID=84532 npx tsx <script.mts>   # import from src/lib/onchain/*
```

`readGameParams`, `readPlayerState`, `readOwnedWords`, `readPendingCommits` all
run standalone. Note `tsx -e` can't do top-level await — write a `.mts` file.

Live deployment addresses: `config/deployments.base-sepolia.json`.
