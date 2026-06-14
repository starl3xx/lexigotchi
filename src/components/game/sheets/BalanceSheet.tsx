"use client";
/**
 * Your $WORD — balance + buy + wallet connect. Models the Let's Have A Word! integration:
 * "Buy $WORD" opens the Farcaster native swap (sdk.actions.viewToken) and falls back to
 * DexScreener on the web. Farcaster players are auto-connected via the mini-app wallet; web
 * players get a Connect-wallet flow (injected provider). The SDK is imported dynamically so
 * the statically-prerendered /play route never touches it during SSR.
 */
import { useEffect, useState } from "react";
import { Button, Card, Sheet } from "../primitives";
import { ArrowsLeftRight, Check, CircleNotch, Coins, Plus, Wallet } from "../ui/icons";
import { fmtUsd, fmtWord, useGame } from "../state";

const WORD_TOKEN = "0x304e649e69979298bd1aee63e175adf07885fb4b"; // $WORD on Base (the LHAW token)
const CAIP_WORD = `eip155:8453/erc20:${WORD_TOKEN}`;
const DEX_URL = `https://dexscreener.com/base/${WORD_TOKEN}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const openDex = () => window.open(DEX_URL, "_blank", "noopener,noreferrer");

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

export function BalanceSheet() {
  const g = useGame();
  const { state } = g;
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
    // web (and the not-yet-resolved case) goes straight to DexScreener. The Buy button is also
    // disabled while env === "loading", so this branch is the belt to that suspenders.
    if (env !== "farcaster") {
      openDex();
      return;
    }
    try {
      const sdk = (await import("@farcaster/miniapp-sdk")).default;
      await sdk.actions.viewToken({ token: CAIP_WORD }); // Farcaster native swap UI
    } catch {
      openDex();
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

  return (
    <Sheet open onClose={g.closeSheet} title="Your $WORD">
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
        Opens your wallet&apos;s swap in Farcaster, or DexScreener on the web.
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
