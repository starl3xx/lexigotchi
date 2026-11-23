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
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useAccountModal, useConnectModal } from "@rainbow-me/rainbowkit";
import { Button, Card, Sheet } from "../primitives";
import { ArrowsLeftRight, Check, CircleNotch, Coins, Plus, SealCheck, Smiley, Wallet } from "../ui/icons";
import { fmtUsd, fmtWord, useGame } from "../state";
import { useViewer } from "../useViewer";
import { OrDivider, SignInWithCoinbaseWallet } from "../SignInWithCoinbaseWallet";
import { useVerifiedWallet } from "../useVerifiedWallet";
import { VERIFY_URL } from "@/lib/onchain/verifications";
// Only to tell the testnet faucet apart; the Buy funnel above stays pinned to mainnet on purpose.
import { NETWORK } from "@/lib/onchain/network";

const WORD_TOKEN = "0x304e649e69979298bd1aee63e175adf07885fb4b"; // $WORD on Base (the LHAW token)
// Deliberately pinned to Base MAINNET, not the active network (lib/onchain/network). This is the buy
// funnel: it points a wallet at the real $WORD token and Clanker's swap page, both of which exist
// only on mainnet. On a testnet build it would otherwise offer to add an asset that isn't there.
const CAIP_WORD = `eip155:8453/erc20:${WORD_TOKEN}`;
/** USDC on Base — the default sell side of the pre-populated swap. */
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const CAIP_USDC = `eip155:8453/erc20:${USDC}`;
// Matcha's swap page, USDC→WORD pre-populated — it routes the v4 hooked pool and aggregates
// anything else that lists, which Clanker's single-pool page (the old target) can't.
const BUY_URL = `https://matcha.xyz/tokens/base/${WORD_TOKEN}?buyAddress=${WORD_TOKEN}&buyChain=8453&sellAddress=${USDC}&sellChain=8453`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const openBuy = () => window.open(BUY_URL, "_blank", "noopener,noreferrer");

export function BalanceSheet() {
  const g = useGame();
  const { state } = g;
  const viewer = useViewer();
  const { address } = useAccount();
  const { openConnectModal, connectModalOpen } = useConnectModal();
  const { openAccountModal } = useAccountModal();
  const { verified, recheck } = useVerifiedWallet();
  const [env, setEnv] = useState<"loading" | "farcaster" | "web">("loading");

  // Detect the environment — it decides where "Buy $WORD" goes. The wallet itself comes from wagmi.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sdk = (await import("@farcaster/miniapp-sdk")).default;
        // isInMiniApp resolves a definitive boolean (it has its own internal timeout); awaiting it
        // directly avoids a race that could discard a slow-but-real "yes" and mislabel FC as web.
        const inMini = await sdk.isInMiniApp();
        if (alive) setEnv(inMini ? "farcaster" : "web");
      } catch {
        if (alive) setEnv("web");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const buy = async () => {
    // Only use the Farcaster native swap when we've DEFINITELY detected a mini-app context;
    // web (and the not-yet-resolved case) goes to the clanker.world swap. The Buy button is
    // also disabled while env === "loading", so this branch is the belt to that suspenders.
    if (env !== "farcaster") {
      openBuy();
      return;
    }
    try {
      const sdk = (await import("@farcaster/miniapp-sdk")).default;
      // The actual swap MODAL, USDC→WORD pre-populated — viewToken (the old call) lands on the
      // token page and makes the player find the swap themselves.
      await sdk.actions.swapToken({ sellToken: CAIP_USDC, buyToken: CAIP_WORD });
    } catch {
      try {
        const sdk = (await import("@farcaster/miniapp-sdk")).default;
        await sdk.actions.viewToken({ token: CAIP_WORD }); // older hosts: at least the token page
      } catch {
        openBuy();
      }
    }
  };

  const need = state.sheet?.kind === "balance" ? state.sheet.need : undefined;
  const shortfall = need ? Math.max(0, need.amount - state.balance) : 0;

  return (
    <Sheet open onClose={g.closeSheet} title="Your $WORD">
      {/* what just got blocked — the reason this sheet opened */}
      {need && shortfall > 0 && (
        <Card className="mb-3 border-candy bg-candy/10 text-center text-sm">
          You need <strong>{fmtWord(shortfall)} more $WORD</strong> ({fmtUsd(shortfall)}) for {need.action}.
        </Card>
      )}

      {/* Farcaster identity */}
      {viewer.isAuthed ? (
        <div className="mb-3 flex items-center gap-2.5">
          {viewer.pfpUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={viewer.pfpUrl} alt="" className="h-10 w-10 rounded-full border-2 border-ink object-cover" />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-paper-dark text-ink/60">
              <Smiley weight="fill" size={20} />
            </span>
          )}
          <div className="flex-1 leading-tight">
            <div className="font-display font-extrabold">@{viewer.username ?? viewer.fid}</div>
            <div className="text-xs text-ink/55">
              {viewer.environment === "farcaster" ? "Connected via Farcaster" : "Signed in with Farcaster"}
              {viewer.fid ? ` · FID ${viewer.fid}` : ""}
            </div>
          </div>
          {/* Sign-out exists only on the web: inside a Farcaster host the identity IS the host's,
              and there is nothing of ours to clear. Also the only way to test the non-Farcaster
              (Coinbase-verified) daily without hunting for a fresh tab — the session lives in
              sessionStorage, so a new tab is the accidental version of this button. */}
          {viewer.environment === "web" && (
            <button
              onClick={viewer.signOut}
              className="shrink-0 text-xs font-bold text-ink/45 underline"
            >
              Sign out
            </button>
          )}
        </div>
      ) : viewer.environment === "web" ? (
        // Signed out on the web. The old card just said "Not on Farcaster?" — with a wallet already
        // connected that read as "something is missing", when the truth is two-part: the wallet is
        // DONE (buy, hold, play), and identity is the optional upgrade that unlocks the daily.
        <Card className="mb-3 bg-paper-dark/30">
          {address && (
            <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-teal-ink">
              <Check weight="bold" size={15} /> Wallet connected
              <span className="font-mono text-xs font-normal text-ink/55">{short(address)}</span>
              <span className="ml-auto text-xs font-normal text-ink/55">buy · hold · play</span>
            </div>
          )}
          {/* Three states, never two. useVerifiedWallet's `null` is UNKNOWN (still checking, or the
              check failed) — rendering it as "not verified" told a verified player to verify again
              during every fetch and every /api/verify/status outage. */}
          <div className="text-sm text-ink/70">
            {verified === true ? (
              <>
                This wallet is <strong>Coinbase-verified</strong>, so the free daily letter is yours.
                Link Farcaster too if you like.
              </>
            ) : address && verified === null ? (
              <>
                The <strong>free daily letter</strong> needs Farcaster or a Coinbase-verified wallet.
                Checking this wallet…
              </>
            ) : (
              <>
                Want the <strong>free daily letter</strong>? Link Farcaster, or{" "}
                {address ? "verify this wallet with Coinbase" : "connect a Coinbase-verified wallet"}.
                Either one proves you’re one person.
              </>
            )}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={viewer.signIn}
              className="cel press flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#855DCD] px-3 py-2 text-sm font-extrabold text-white"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/fc-arch-icon.png" alt="" className="h-3 w-auto" />
              Farcaster
            </button>
            {/* The second door to the daily, the same one DailyUnlock offers. This used to switch
                the connected wallet to a Base Account, which only helped a player whose Base
                Account happened to be attested; verifying works on the wallet they already use.
                Coming back attested changes nothing until we re-ask the chain, so the tap that
                sends them out also schedules the re-check. */}
            {verified !== true && (
              <a
                href={VERIFY_URL}
                target="_blank"
                rel="noreferrer"
                onClick={() => setTimeout(recheck, 4000)}
                className="cel press flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-paper-dark px-3 py-2 text-sm font-extrabold"
              >
                <SealCheck weight="fill" size={15} /> Coinbase
              </a>
            )}
          </div>
          {/* Verification usually outlasts the 4-second auto re-check, and a "no" gets cached — so
              the player who finishes on coinbase.com needs a way to ask again, as DailyUnlock has. */}
          {verified === false && (
            <button onClick={recheck} className="mt-2 text-xs font-bold text-ink/45 underline">
              I’ve verified. Check again
            </button>
          )}
        </Card>
      ) : null}

      <Card className="bg-gradient-to-b from-paper to-gold/15 text-center">
        <div className="flex items-center justify-center gap-1.5 text-ink/60">
          <Coins weight="fill" />
          <span className="text-sm font-bold">Balance</span>
        </div>
        <div className="mt-1 font-display text-4xl font-extrabold text-gold-deep">{fmtWord(state.balance)}</div>
        <div className="text-sm text-ink/60">{fmtUsd(state.balance)} · $WORD on Base</div>
      </Card>

      <Button full size="lg" variant="primary" className="mt-3" disabled={env === "loading"} onClick={buy}>
        <ArrowsLeftRight weight="bold" /> Buy $WORD
      </Button>
      <p className="mt-1.5 text-center text-xs text-ink/55">
        Opens your wallet’s swap in Farcaster, or the $WORD swap page on the web.
      </p>

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

      {/* Practice game: a demo top-up. Testnet: the test-token faucet. Mainnet: nothing — real
          $WORD comes from the Buy button above, never from a button that mints it. */}
      {(!g.state.chainBacked || NETWORK.isTestnet) && (
        <button
          onClick={g.addDemoBalance}
          className="mx-auto mt-3 flex items-center gap-1 text-xs font-bold text-ink/45 underline"
        >
          <Plus /> {g.state.chainBacked ? "get test $WORD (testnet faucet)" : "add demo balance (practice)"}
        </button>
      )}
    </Sheet>
  );
}
