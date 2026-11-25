"use client";
/**
 * Your $WORD — balance + buy + wallet connect. Models the Let's Have A Word! integration:
 * "Buy $WORD" opens the Farcaster native swap MODAL (sdk.actions.swapToken, USDC→WORD
 * pre-populated) and falls back to the
 * clanker.world token page on the web — Clanker's own swap UI for this exact token (it routes
 * the v4 hooked pool with no unlisted-token import warning; DexScreener was a chart, not a
 * swap). When the sheet was opened from a price-blocked action (`need`), a shortfall banner
 * shows exactly how much more $WORD that action takes. Farcaster players are auto-connected
 * via the mini-app wallet; web players connect through the shared RainbowKit modal. The address
 * comes from wagmi in BOTH contexts — an earlier version read `window.ethereum` directly, so a web
 * player connected over WalletConnect or Base Account saw "Connect wallet" here while the rest of
 * the game was already playing on their wallet. The SDK is imported dynamically so the
 * statically-prerendered /play route never touches it during SSR.
 */
import { useAccount } from "wagmi";
import { useAccountModal, useConnectModal } from "@rainbow-me/rainbowkit";
import { Button, Card, Sheet, TweenNumber } from "../primitives";
import { ArrowsLeftRight, CaretRight, Check, CircleNotch, Coins, Plus, Smiley, Wallet } from "../ui/icons";
import { fmtUsd, fmtWord, useGame } from "../state";
import { useViewer } from "../useViewer";
import { useBuyWord } from "../useBuyWord";
import { OrDivider, SignInWithCoinbaseWallet } from "../SignInWithCoinbaseWallet";
import { useDailyEligibility } from "../DailyUnlock";
import { resolveIdentity, useProfile } from "../useProfile";
// Only to tell the testnet faucet apart; the Buy funnel above stays pinned to mainnet on purpose.
import { NETWORK } from "@/lib/onchain/network";
import { BASE_SEPOLIA_FAUCETS_URL } from "@/lib/site";
import { useOpenUrl } from "../useShare";

// "Buy $WORD" (pinned to Base mainnet, Farcaster's swap or Matcha) lives in useBuyWord.
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function BalanceSheet() {
  const g = useGame();
  const { state } = g;
  const viewer = useViewer();
  const { address } = useAccount();
  const { openConnectModal, connectModalOpen } = useConnectModal();
  const { openAccountModal } = useAccountModal();
  const profile = useProfile();
  const me = resolveIdentity(viewer, profile.profile);
  const daily = useDailyEligibility();
  const { buy, env } = useBuyWord();
  const openUrl = useOpenUrl();
  // The chain game on Base Sepolia. Its balance is TEST $WORD: a tester holding the real token on
  // Base read "$WORD on Base" under a 0 and asked where theirs went (2026-11-24).
  const testnet = state.chainBacked && NETWORK.isTestnet;

  const need = state.sheet?.kind === "balance" ? state.sheet.need : undefined;
  const shortfall = need ? Math.max(0, need.amount - state.balance) : 0;

  return (
    <Sheet open onClose={g.closeSheet} title="Your $WORD">
      {/* what just got blocked — the reason this sheet opened */}
      {need && shortfall > 0 && (
        <Card className="mb-3 border-candy bg-candy/10 text-center text-sm">
          {/* No dollar figure for test $WORD: it has no value, and the card below says so. */}
          You need <strong>{fmtWord(shortfall)} more $WORD</strong>
          {testnet ? "" : ` (${fmtUsd(shortfall)})`} for {need.action}.
        </Card>
      )}

      {/* Who you are, your linked accounts, and the free daily letter live on the Profile sheet (the
          PFP in the header). One row here points there, so a player who came to buy still sees it. */}
      <button
        onClick={() => g.openSheet({ kind: "profile" })}
        className="cel-sm press mb-3 flex w-full items-center gap-2.5 rounded-xl bg-card px-3 py-2 text-left"
      >
        {me.pfpUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={me.pfpUrl} alt="" className="h-9 w-9 rounded-full border-2 border-ink object-cover" />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-ink bg-paper-dark text-ink/60">
            <Smiley weight="fill" size={18} />
          </span>
        )}
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate font-display font-extrabold">{me.name ?? "Your profile"}</span>
          <span className="block text-xs text-ink/60">
            {daily.eligible
              ? "Free daily letter: on"
              : daily.checking && (address || viewer.environment === "loading")
                ? "Checking your accounts…"
                : "Link an account for a free daily letter"}
          </span>
        </span>
        <CaretRight weight="bold" className="text-ink/45" />
      </button>

      <Card className="bg-gradient-to-b from-card to-gold/15 text-center">
        <div className="flex items-center justify-center gap-1.5 text-ink/60">
          <Coins weight="fill" />
          <span className="text-sm font-bold">Balance</span>
        </div>
        <div className="mt-1 font-display text-4xl font-extrabold text-gold-deep">
          <TweenNumber value={state.balance} format={fmtWord} />
        </div>
        {testnet ? (
          <>
            <div className="text-sm text-ink/60">Test $WORD on {NETWORK.name}</div>
            <div className="mt-1 text-xs text-ink/55">Your real $WORD stays on Base. It doesn’t count in the test game.</div>
          </>
        ) : (
          <div className="text-sm text-ink/60">{fmtUsd(state.balance)} · $WORD on Base</div>
        )}
      </Card>

      {testnet ? (
        <>
          {/* The test game's way to get $WORD, so it is the main action. Buy stays pinned to mainnet
              on purpose (it buys the real token), and as the main button under "You need X more
              $WORD" it pointed a tester short of TEST $WORD at spending real money. The faucet is a
              transaction like any other: a plain wallet pays its gas, a sponsored one doesn't. */}
          <Button full size="lg" variant="teal" className="mt-3" onClick={g.addDemoBalance}>
            <Plus weight="bold" /> Get test $WORD
          </Button>
          <p className="mt-1.5 text-center text-xs text-ink/55">
            Free from the testnet faucet. If your wallet pays its own gas, it needs a little {NETWORK.name} ETH.{" "}
            <button onClick={() => void openUrl(BASE_SEPOLIA_FAUCETS_URL)} className="font-bold underline">
              Get some free
            </button>
          </p>
          <Button full variant="ghost" className="mt-3" disabled={env === "loading"} onClick={buy}>
            <ArrowsLeftRight weight="bold" /> Buy real $WORD
          </Button>
          <p className="mt-1.5 text-center text-xs text-ink/55">The real token on Base, for when the game launches there.</p>
        </>
      ) : (
        <>
          <Button full size="lg" variant="primary" className="mt-3" disabled={env === "loading"} onClick={buy}>
            <ArrowsLeftRight weight="bold" /> Buy $WORD
          </Button>
          <p className="mt-1.5 text-center text-xs text-ink/55">
            Opens your wallet’s swap in Farcaster, or the $WORD swap page on the web.
          </p>
        </>
      )}

      <Card className="mt-3">
        <div className="mb-2 flex items-center gap-1.5 font-display font-extrabold">
          <Wallet weight="bold" /> Wallet
        </div>
        {env === "loading" ? (
          <div className="flex items-center gap-1.5 text-sm text-ink/55">
            <CircleNotch className="animate-spin" /> checking…
          </div>
        ) : env === "farcaster" ? (
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 font-bold text-teal-ink">
              <Check weight="bold" /> Connected via Farcaster
            </span>
            {address && <span className="font-mono text-xs text-ink/60">{short(address)}</span>}
          </div>
        ) : address ? (
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 font-bold text-teal-ink">
              <Check weight="bold" /> Connected
            </span>
            {/* The only way OUT of a wallet on the web. An extension wallet can be disconnected from
                the extension, but a Base Account popup session or a WalletConnect phone session has
                nothing in the browser to click — without this, a player who connected the wrong
                wallet is stuck with it. RainbowKit's account modal carries copy + disconnect. */}
            <button
              onClick={openAccountModal}
              disabled={!openAccountModal}
              className="flex items-center gap-1.5 text-xs text-ink/60"
            >
              <span className="font-mono">{short(address)}</span>
              <span className="font-bold text-ink/45 underline">Switch</span>
            </button>
          </div>
        ) : (
          <>
            <Button full variant="teal" disabled={!openConnectModal || connectModalOpen} onClick={openConnectModal}>
              {connectModalOpen ? (
                <>
                  <CircleNotch className="animate-spin" /> Pick a wallet…
                </>
              ) : (
                <>
                  <Wallet weight="bold" /> Connect wallet
                </>
              )}
            </Button>
            <OrDivider />
            <SignInWithCoinbaseWallet />
            <p className="mt-2 text-xs text-ink/55">Any wallet works. $WORD lives on Base.</p>
          </>
        )}
      </Card>

      {/* Practice game: a demo top-up. Testnet: the faucet is the main button above. Mainnet:
          nothing, because real $WORD comes from the Buy button, never from a button that mints it. */}
      {!g.state.chainBacked && (
        <button
          onClick={g.addDemoBalance}
          className="mx-auto mt-3 flex items-center gap-1 text-xs font-bold text-ink/45 underline"
        >
          <Plus /> add demo balance (practice)
        </button>
      )}
    </Sheet>
  );
}
