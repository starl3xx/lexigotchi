---
name: run-lexigotchi
description: Build, run, and drive the Lexigotchi mini app — dev server, headless browser, screenshots, and chain-backed state against Base Sepolia. Use when asked to run or start the app, screenshot /play, verify a UI change in the real app, drive a wallet flow, or check on-chain reads end to end.
---

# Running Lexigotchi

Next.js App Router mini app. The game lives at `/play` (`/` redirects there) and is
**client-rendered**, so `curl` only ever returns the shell — driving it needs a browser.

Paths below are relative to the repo root. The agent path is
`.claude/skills/run-lexigotchi/driver.mjs`.

Two modes, and which one you get is decided by one env var:

| `NEXT_PUBLIC_CHAIN_ID` | Store | What you see |
|---|---|---|
| unset / empty | mock reducer | Seeded inventory, instant fake outcomes. No wallet needed. |
| `84532` | chain-backed | Real Base Sepolia balance, letters, and words. |

Mainnet (`8453`, the default) has **no deployed contracts**, so `isSuiteDeployed()` is false and the
app stays on the mock. That is deliberate.

## Prerequisites

```bash
npm ci                              # or npm install
npx playwright install chromium     # no chromium-cli on this machine; the driver uses playwright
```

`playwright` is already a devDependency. Foundry (`forge`, `cast`) is only needed for contract work,
not for running the app.

## Run: mock mode (no wallet, no chain)

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill 2>/dev/null
NEXT_PUBLIC_CHAIN_ID= npm run dev > /tmp/dev.log 2>&1 &
until curl -sf http://localhost:3000/play >/dev/null 2>&1; do sleep 1; done
node .claude/skills/run-lexigotchi/driver.mjs --shot mock --goto Bag
```

Verified output:

```
HEADER     : "LEXIGOTCHI\n6\n32.00M\n$7.54 · $WORD"
--- CONSOLE ERRORS: 0 ---
NaN in DOM : false
```

The Bag shows the seeded mock letters (`i l n o r s t u×2`, UPPERCASE `E R`). Screenshot at
`/tmp/lexi-shots/mock.png`.

**Quickest way to tell the modes apart:** the header's leading `6` is the daily streak chip, which
only the mock renders — the chain store has no streak concept, so it hides the chip rather than show
a hardcoded `0` that reads as a streak you just lost.

Poll the port — don't `sleep`. Next compiles `/play` on demand and the first load takes ~10s.
**macOS has no `timeout(1)`**; an `until` loop is the portable wait.

## Run: chain-backed against Base Sepolia

`.env.local` (gitignored) needs:

```
NEXT_PUBLIC_CHAIN_ID=84532
SIGNER_PRIVATE_KEY=<from contracts/sepolia-signer.secret.json>
SIGNER_DRAW_SECRET=rehearsal-only-secret
```

Then:

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill 2>/dev/null
npm run dev > /tmp/dev.log 2>&1 &
until curl -sf http://localhost:3000/play >/dev/null 2>&1; do sleep 1; done

node .claude/skills/run-lexigotchi/driver.mjs --shot nowallet
node .claude/skills/run-lexigotchi/driver.mjs --wallet --goto Bag --shot bag
```

Verified output:

```
# no wallet
HEADER     : "LEXIGOTCHI\n—\n$WORD"        ← "—", never 0. See Gotchas.
"Connect to play"
--- CONSOLE ERRORS: 0 ---

# --wallet
wallet     : 0x51E29Ba3Ff9ebdb5e6d32f6AB52F2FD3b21Ae1E3
HEADER     : "LEXIGOTCHI\n90.67M\n$21.37 · $WORD"
--- CONSOLE ERRORS: 0 ---
```

The driver exits non-zero if any console error fired, so it works in a check.

### Driver options

| Flag | Effect |
|---|---|
| `--wallet` | Inject a mock EIP-1193 wallet and click Connect |
| `--goto <screen>` | Bottom-nav target: `Today` `Bag` `Mint` `Win` `More` |
| `--shot <name>` | `/tmp/lexi-shots/<name>.png` (default `play`) |
| `--url <url>` | Default `http://localhost:3000/play` |

`--wallet` signs with `contracts/sepolia-deployer.secret.json` — a throwaway testnet key.
**Never point it at anything but Sepolia.**

## Direct invocation (no browser)

Most changes here touch `src/lib/onchain/*`, and those are faster to check directly:

```bash
cat > probe.mts <<'TS'
import { readGameParams, readPlayerState } from "./src/lib/onchain/reads";
const p = await readGameParams();
console.log("pack:", p.word.pack, "roll:", p.word.roll, "claim:", p.word.claim);
const s = await readPlayerState("0x51E29Ba3Ff9ebdb5e6d32f6AB52F2FD3b21Ae1E3");
console.log("balance:", s.balance, "| letters:", s.letters.reduce((a,b)=>a+b,0));
TS
NEXT_PUBLIC_CHAIN_ID=84532 npx tsx probe.mts && rm probe.mts
```

Verified output: `pack: 4242861 roll: 1060715 claim: 2121431` /
`balance: 90665705.85 | letters: 10`.

**Use a `.mts` file, not `tsx -e`** — `tsx -e` fails with
`Top-level await is currently not supported with the "cjs" output format`.

## Test / build

```bash
npm test        # 176 tests, 19 files (vitest; component tests opt into jsdom per file)
npm run typecheck
npm run build   # completes WITH WARNINGS — see Gotchas
```

## Gotchas

- **A missing `NEXT_PUBLIC_CHAIN_ID` doesn't error — it looks like poverty.** Unset resolves to
  mainnet, where no contract is deployed. Chain reads then yield `undefined`, `fmtWord(undefined)`
  renders `"NaN"`, and `undefined >= n` is false, so the game disables itself and routes a solvent
  player to the Buy sheet. That's why the driver prints `NaN in DOM` — treat `true` as a failure.
- **The header shows `—`, not `0`, when the balance is unknown.** If you ever see `0 $WORD` before a
  wallet connects, `ChainGate` has been unmounted. That exact regression shipped once while nine
  passing tests covered the component in isolation.
- **Onboarding covers the whole app** on a fresh browser profile. The driver clicks `Skip`; doing
  this by hand means the Connect button is unreachable until you do.
- **wagmi's injected connector needs an EIP-6963 announcement.** Setting `window.ethereum` alone is
  not enough — the connector finds nothing. The driver dispatches `eip6963:announceProvider`.
- **The mock wallet refuses `wallet_sendCalls` on purpose** (code 4200). That forces
  `sendCallsAttributed` down its `eth_sendTransaction` fallback, which is the path that appends the
  ERC-8021 builder suffix. Answering it would skip the code worth testing.
- **Quick Auth cannot be driven headlessly.** `/api/mint/free-pack` and the daily need a verified
  Farcaster JWT and return 401 in a plain browser. Connect, reads, and rendering are drivable; the
  in-UI mint is not. Verify mint flows from Node instead (see `contracts/` scripts and the reveal
  routes).
- **The public Sepolia RPC is not read-after-write consistent.** A read issued the instant a
  transaction mines routinely hits a node that hasn't caught up. This produced three separate false
  results in one session — balances that "didn't change", logs that "weren't there", a commit that
  "didn't exist" — each a stale read of a change that had landed, each indistinguishable from
  failure. **Re-read a few seconds later before believing a negative result.** `useOnchain.send`
  re-reads on a stagger and `waitForNewCommit` polls for exactly this reason.
- **`npm run build` prints warnings and succeeds.** `@metamask/sdk` can't resolve
  `@react-native-async-storage/async-storage`, and `pino` can't resolve `pino-pretty`. Both are
  optional deps of wallet libraries. Not a failure — don't "fix" them.
- **`@x402/*` is aliased to `false` in `next.config.mjs`.** Importing any connector pulls wagmi's
  barrel → `baseAccount` → `@coinbase/cdp-sdk` → four optional `@x402` peers that aren't installed.
  Without the alias the production build fails outright.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `EADDRINUSE` on 3000 | `lsof -ti:3000 -sTCP:LISTEN \| xargs -r kill`. `npm run dev &` leaves the server behind — `$!` is only the npm wrapper. |
| Driver: `Timeout waiting for selector "header"` | Dev server not up yet, or `/play` still compiling. Poll the port first; first compile is ~10s. |
| Driver exits 1 with a `quickAuth`/`getTokenInner` error | Regression in `campaignClient` — `sdk.isInMiniApp()` must be checked BEFORE touching `quickAuth`. A try/catch is not enough: the SDK rejects a second promise internally that nothing awaits. |
| `--wallet` → `needs contracts/sepolia-deployer.secret.json` | The throwaway key file is gitignored and local-only. Run without `--wallet` for read-only, or regenerate a key and fund it. |
| `MissingDeploymentError: letters is not deployed on Base` | `NEXT_PUBLIC_CHAIN_ID` isn't `84532`. Mainnet has no deployment. |
| `Top-level await is currently not supported` | You used `tsx -e`. Write a `.mts` file. |
| Bag empty with a wallet connected | Possibly RPC read lag — re-run the driver before investigating. |
