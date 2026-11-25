"use client";
/**
 * Says so when the connected wallet is on a network this screen can't use, with a Switch button and
 * a Disconnect that always works (lib/onchain/walletNetwork says why). Above every screen: the game's
 * network for the game (Base Sepolia now, Base at launch), Base for the $WORD page's swap.
 *
 * Switch uses sendCalls' `ensureChain`, the same guard every send runs, because wagmi's own
 * `switchChain` never returns from a wallet that accepts the switch and stays put. Disconnect is
 * wagmi's, the call RainbowKit's account modal makes, since that modal isn't offered on a network
 * RainbowKit doesn't know. Inside a Farcaster host the wallet is the host's, so there's no Disconnect.
 */
import { useEffect, useState } from "react";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { Button, Card } from "./primitives";
import { CircleNotch, Warning } from "./ui/icons";
import { useGame } from "./state";
import { useViewer } from "./useViewer";
import { BASE, NETWORK } from "@/lib/onchain/network";
import { ensureChain, type Eip1193Provider } from "@/lib/onchain/sendCalls";
import {
  MAINNET_VIEWS,
  keepMove,
  knownWalletChain,
  networkToSwitchTo,
  switchRefusal,
  walletNetworkName,
  type ConfirmedMove,
  type SwitchRefusal,
} from "@/lib/onchain/walletNetwork";

export function WalletNetworkNotice() {
  const { state } = useGame();
  const viewer = useViewer();
  const { address, chainId, connector } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const [busy, setBusy] = useState(false);
  // Remembered with the network it happened on and the one it asked for, so a refusal follows neither
  // the wallet to another network nor the player to a screen that wants another one (Bugbot on #202).
  const [refused, setRefused] = useState<{ on: number; to: number; why: SwitchRefusal } | null>(null);
  // The last switch ensureChain confirmed, for a wallet that never tells wagmi (knownWalletChain),
  // forgotten once wagmi reports another network or wallet (keepMove).
  const [moved, setMoved] = useState<ConfirmedMove | null>(null);
  const live = keepMove(moved, chainId, address);
  useEffect(() => {
    if (moved && !live) setMoved(null);
  }, [moved, live]);
  const walletChainId = knownWalletChain(chainId, live);
  const want = networkToSwitchTo({ chainBacked: state.chainBacked, address, walletChainId, view: state.view });
  if (!want) return null;
  const from = walletChainId!;
  const swapping = MAINNET_VIEWS.has(state.view);
  const why = refused?.on === from && refused.to === want.id ? refused.why : null;

  const doSwitch = async () => {
    if (!connector?.getProvider) return;
    setBusy(true);
    setRefused(null);
    try {
      await ensureChain((await connector.getProvider()) as Eip1193Provider, want);
      // The wallet is there now (ensureChain read it back), so the notice believes it even if wagmi
      // never hears. Tell wagmi too where it can be told: it knows only the game's network, and the
      // wallet is already there, so this asks nothing of the player.
      if (chainId !== undefined && address) setMoved({ address, from: chainId, to: want.id });
      if (want.id === NETWORK.id) {
        await Promise.race([switchChainAsync({ chainId: want.id }), new Promise((r) => setTimeout(r, 3000))]).catch(() => {});
      }
    } catch (err) {
      setRefused({ on: from, to: want.id, why: switchRefusal(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-3 border-candy bg-candy/10 text-sm">
      <div className="mb-1 flex items-center gap-1.5 font-display font-extrabold">
        <Warning weight="fill" className="text-candy-ink" /> Your wallet is on {walletNetworkName(from)}
      </div>
      <p className="text-ink/75">
        {why === "declined" ? (
          <>You said no in your wallet. Tap Switch to try again.</>
        ) : why === "unavailable" ? (
          want.isTestnet ? (
            <>
              Your wallet didn’t switch to {want.name}. A wallet that can’t use {want.name} can’t play the test game:
              connect one that can, like MetaMask or Coinbase Wallet.
              {/* Said only of a wallet on Base, the one network we know it has. Rainbow refuses Base
                  Sepolia outright (starl3xx, 2026-11-25), but plays on Base. */}
              {from === BASE.id && <> It can play on Base once the game launches there.</>}
            </>
          ) : (
            <>Your wallet didn’t switch to {want.name}. Switch it in your wallet app, or connect another wallet.</>
          )
        ) : swapping ? (
          <>$WORD trades on {want.name}. Switch now, or the game asks your wallet when you swap.</>
        ) : (
          <>
            The game plays on {want.name}
            {want.isTestnet ? ", Base’s test network" : ""}. Switch now, or the game asks your wallet when you send
            something.
          </>
        )}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void doSwitch()}>
          {busy ? (
            <>
              <CircleNotch className="animate-spin" /> Check your wallet…
            </>
          ) : (
            <>Switch to {want.name}</>
          )}
        </Button>
        {viewer.environment !== "farcaster" && (
          <Button size="sm" variant="ghost" onClick={() => disconnect()}>
            Disconnect
          </Button>
        )}
      </div>
    </Card>
  );
}
