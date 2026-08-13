"use client";
/**
 * Your $WORD — balance + buy + wallet connect. Models the Let's Have A Word! integration:
 * "Buy $WORD" opens the Farcaster native swap MODAL (sdk.actions.swapToken, USDC→WORD
 * pre-populated) and falls back to the
 * clanker.world token page on the web — Clanker's own swap UI for this exact token (it routes
 * the v4 hooked pool with no unlisted-token import warning; DexScreener was a chart, not a
 * swap). When the sheet was opened from a price-blocked action (`need`), a shortfall banner
 * shows exactly how much more $WORD that action takes. Farcaster players are auto-connected
 * via the mini-app wallet; web players get a Connect-wallet flow (injected provider). The SDK
 * is imported dynamically so the statically-prerendered /play route never touches it during SSR.
 */
import { useEffect, useState } from "react";
import { useConnect } from "wagmi";
import { Button, Card, Sheet } from "../primitives";
import { ArrowsLeftRight, Check, CircleNotch, Coins, Plus, Smiley, Wallet } from "../ui/icons";
import { fmtUsd, fmtWord, useGame } from "../state";
import { useViewer } from "../useViewer";

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

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

export function BalanceSheet() {
  const g = useGame();
  const { state } = g;
  const viewer = useViewer();
  const { connect, connectors } = useConnect();
  const connectBase = () => {
    const target = connectors.find((c) => /coinbase|base/i.test(c.id) || /coinbase/i.test(c.name));
    if (target) connect({ connector: target });
  };
  const [env, setEnv] = useState<"loading" | "farcaster" | "web">("loading");
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // detect environment + reflect any already-authorized wallet (no prompt) on open
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sdk = (await import("@farcaster/miniapp-sdk")).default;
        // isInMiniApp resolves a definitive boolean (it has its own internal timeout); awaiting it
        // directly avoids a race that could discard a slow-but-real "yes" and mislabel FC as web.
        const inMini = await sdk.isInMiniApp();
        if (!alive) return;
        if (inMini) {
          setEnv("farcaster");
          try {
            const provider = await sdk.wallet.getEthereumProvider();
            const accts = (await provider?.request({ method: "eth_accounts" })) as string[] | undefined;
            if (alive && accts?.[0]) setAddress(accts[0]);
          } catch {
            /* wallet not ready — fine */
          }
        } else {
          setEnv("web");
          const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
          if (eth) {
            try {
              const accts = (await eth.request({ method: "eth_accounts" })) as string[];
              if (alive && accts?.[0]) setAddress(accts[0]);
            } catch {
              /* not authorized yet — fine */
            }
          }
        }
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

  const connectWeb = async () => {
    const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    if (!eth) {
      g.toast("No wallet found — open in Farcaster or install a wallet", "bad");
      return;
    }
    setConnecting(true);
    try {
      const accts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      if (accts?.[0]) {
        setAddress(accts[0]);
        g.toast("Wallet connected", "good");
      }
    } catch {
      g.toast("Connection cancelled", "info");
    } finally {
      setConnecting(false);
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
            <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-teal">
              <Check weight="bold" size={15} /> Wallet connected
              <span className="font-mono text-xs font-normal text-ink/55">{short(address)}</span>
              <span className="ml-auto text-xs font-normal text-ink/55">buy · hold · play</span>
            </div>
          )}
          <div className="text-sm text-ink/70">
            Want the <strong>free daily letter</strong>? Sign in with Farcaster — or switch to a
            Coinbase-verified wallet.
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={viewer.signIn}
              className="cel flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#855DCD] px-3 py-2 text-sm font-extrabold text-white"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/fc-arch-icon.png" alt="" className="h-3 w-auto" />
              Farcaster
            </button>
            {/* The card's "Coinbase-verified wallet" clause finally gets its affordance: switch the
                connected wallet to a Base Account. Not an identity credential by itself (SIWE
                proves an address, and addresses are free) — but if THAT wallet carries the
                attestation, the daily unlocks the moment it connects. */}
            <button
              onClick={connectBase}
              className="cel flex flex-1 items-center justify-center gap-2 rounded-xl bg-black px-3 py-2 text-sm font-extrabold text-white"
            >
              <span aria-hidden className="h-3 w-3 rounded-[2px] bg-white" />
              Base
            </button>
          </div>
        </Card>
      ) : null}

      <Card className="bg-gradient-to-b from-paper to-gold/15 text-center">
        <div className="flex items-center justify-center gap-1.5 text-ink/60">
          <Coins weight="fill" />
          <span className="text-xs font-bold uppercase tracking-wide">balance</span>
        </div>
        <div className="mt-1 font-display text-4xl font-extrabold text-gold-deep">{fmtWord(state.balance)}</div>
        <div className="text-sm text-ink/60">{fmtUsd(state.balance)} · $WORD on Base</div>
      </Card>

      <Button full size="lg" variant="primary" className="mt-3" disabled={env === "loading"} onClick={buy}>
        <ArrowsLeftRight weight="bold" /> Buy $WORD
      </Button>
      <p className="mt-1.5 text-center text-xs text-ink/55">
        Opens your wallet&apos;s swap in Farcaster, or the $WORD swap page on the web.
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
            <span className="flex items-center gap-1.5 font-bold text-teal">
              <Check weight="bold" /> Connected via Farcaster
            </span>
            {address && <span className="font-mono text-xs text-ink/60">{short(address)}</span>}
          </div>
        ) : address ? (
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 font-bold text-teal">
              <Check weight="bold" /> Connected
            </span>
            <span className="font-mono text-xs text-ink/60">{short(address)}</span>
          </div>
        ) : (
          <>
            <Button full variant="teal" disabled={connecting} onClick={connectWeb}>
              {connecting ? (
                <>
                  <CircleNotch className="animate-spin" /> Connecting…
                </>
              ) : (
                <>
                  <Wallet weight="bold" /> Connect wallet
                </>
              )}
            </Button>
            <p className="mt-1.5 text-xs text-ink/55">Not on Farcaster? Connect a Base wallet to buy &amp; hold $WORD.</p>
          </>
        )}
      </Card>

      <button
        onClick={g.addDemoBalance}
        className="mx-auto mt-3 flex items-center gap-1 text-xs font-bold text-ink/45 underline"
      >
        <Plus /> add demo balance (prototype)
      </button>
    </Sheet>
  );
}
