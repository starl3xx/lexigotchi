"use client";
/**
 * The front door for a web player: connect a wallet, and you're playing.
 *
 * Lexigotchi is a standalone onchain game — the WALLET is the account. Letters, words, stakes and
 * snacks all live on it, and every contract call acts on it. Farcaster is an optional LINK on top:
 * it (or a Coinbase-verified wallet) proves you're one person, which is the one thing a wallet can't
 * do, and that proof is what unlocks the free daily. Nothing else in the game needs it.
 *
 * So the panel has one required action and one optional one, and says which is which. An earlier
 * version showed three peer buttons, which read as "pick one" — the first live tester signed in with
 * Farcaster, the gate stayed shut, and nothing explained that the wallet was the required half.
 *
 * Two ways in, separated by "or": the RainbowKit modal for any wallet, and "Sign in with Coinbase
 * Wallet" (SignInWithCoinbaseWallet), which connects a Coinbase Wallet (formerly Base Account)
 * directly. Both end in the same place, a connected wallet; the second is the one-tap door for
 * players who already have that wallet.
 *
 * The wallet button opens the RainbowKit modal (lib/onchain/wagmi lists the wallets). The modal
 * carries its own "confirm in your wallet" state and a retry, which covers the live failure the old
 * hand-rolled hint answered: Rabby queues a connection request inside the extension, and every
 * further click queued silently behind it.
 *
 * Inside a Farcaster host the host's own wallet is the way in. wagmi's silent reconnect only picks it
 * up when the host already reports an account, which not every host does (the panel showed up inside
 * Farcaster on 2026-11-24 with no wallet), so the panel asks for it explicitly, once, and says why
 * when it can't: on a test network the host wallet may not support the chain at all (Base's list of
 * mini-app chains leaves out Base Sepolia), and then another wallet is the only way. After the wallet
 * connects, DailyUnlock (Home + Mint) keeps offering the optional link where the daily lives.
 */
import { useEffect, useRef, useState } from "react";
import { useConnect } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { NETWORK } from "@/lib/onchain/network";
import { useViewer } from "./useViewer";
import { usePublicProfile } from "./useProfile";
import { OrDivider, SignInWithCoinbaseWallet } from "./SignInWithCoinbaseWallet";
import { Check, Wallet } from "./ui/icons";

export function ConnectPanel() {
  const { openConnectModal, connectModalOpen } = useConnectModal();
  const viewer = useViewer();
  const { xEnabled } = usePublicProfile();

  // ── Inside a Farcaster host: the host's wallet ───────────────────────────────────────────────
  const inHost = viewer.environment === "farcaster";
  const { connect, connectors, isPending, variables } = useConnect();
  const farcasterWallet = connectors.find((c) => c.id === "farcaster");
  // Pending for THIS connector only: "Sign in with Coinbase Wallet" connecting must not grey out the
  // Farcaster button (Bugbot on #156; SignInWithCoinbaseWallet scopes it the same way).
  const hostPending = isPending && (variables?.connector as { id?: string } | undefined)?.id === "farcaster";
  const [hostError, setHostError] = useState<string | null>(null);
  // The CAIP-2 chains the host's wallet supports: undefined while asking, null if the host couldn't say.
  const [hostChains, setHostChains] = useState<string[] | null | undefined>(undefined);
  useEffect(() => {
    if (!inHost) return;
    let alive = true;
    void import("@farcaster/miniapp-sdk")
      .then(({ default: sdk }) => sdk.getChains())
      .then((chains) => alive && setHostChains(chains))
      .catch(() => alive && setHostChains(null));
    return () => {
      alive = false;
    };
  }, [inHost]);
  // The host's own list decides. Only when it couldn't give one does the wallet's error speak, and
  // then only the specific "unrecognized chain" (EIP-1193 4902), never a generic switch failure
  // (Bugbot on #156).
  const chainRefused = Array.isArray(hostChains)
    ? !hostChains.includes(`eip155:${NETWORK.id}`)
    : hostChains === null && hostError !== null && /4902|unrecognized chain/i.test(hostError);
  const connectHostWallet = () => {
    if (!farcasterWallet) return;
    setHostError(null);
    connect({ connector: farcasterWallet }, { onError: (e) => setHostError((e as { shortMessage?: string }).shortMessage ?? e.message) });
  };
  const asked = useRef(false);
  useEffect(() => {
    // Wait for the host's chain list first, so a wallet without the chain gets the explanation, not
    // a refused switch (Bugbot on #156).
    if (!inHost || !farcasterWallet || asked.current || hostChains === undefined || chainRefused) return;
    asked.current = true;
    connectHostWallet();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount, when the host is known
  }, [inHost, farcasterWallet, hostChains, chainRefused]);

  return (
    <div className="cel mx-auto mt-8 max-w-sm rounded-2xl bg-card p-5">
      {/* Farcaster linked but no wallet yet: a tester read the green "@name" as being done and
          asked whether they still needed a wallet (2026-11-24). Say it's the one step left. */}
      <div className="text-center font-display text-lg font-extrabold">{viewer.isAuthed ? "One more step" : "Start playing"}</div>
      <p className="mt-1 text-center text-sm text-ink/60">
        {viewer.isAuthed
          ? `${viewer.username ? `@${viewer.username}` : "Your Farcaster account"} is linked. Now connect a wallet: your letters and words live in it, and it’s your Lexigotchi account.`
          : "Your wallet is your Lexigotchi account. Your letters and words live in it."}
      </p>

      {inHost && (
        <div className="mt-4">
          {chainRefused ? (
            <p className="rounded-xl border-2 border-ink/20 bg-paper-dark/40 p-3 text-sm text-ink/75">
              Your Farcaster wallet doesn’t support {NETWORK.name}, the test network this beta runs on. Connect another wallet
              below. When the game launches on Base, your Farcaster wallet connects on its own.
            </p>
          ) : (
            <>
              <button
                onClick={connectHostWallet}
                disabled={!farcasterWallet || hostPending || hostChains === undefined}
                className="cel flex w-full items-center justify-center gap-2 rounded-xl bg-[#855DCD] px-4 py-3 font-display text-base font-extrabold text-white press disabled:opacity-50"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/fc-arch-icon.png" alt="" className="h-3.5 w-auto" />
                {hostPending ? "Check your Farcaster wallet…" : hostError ? "Try my Farcaster wallet again" : "Use my Farcaster wallet"}
              </button>
              {hostError && (
                <p role="status" className="mt-2 text-xs text-ink/60">
                  Your Farcaster wallet didn’t connect ({hostError.slice(0, 90)}). Try again, or connect another wallet below.
                </p>
              )}
            </>
          )}
          <OrDivider />
        </div>
      )}

      <button
        onClick={openConnectModal}
        // Undefined until RainbowKit has mounted — never a dead button that looks alive.
        disabled={!openConnectModal}
        className="cel mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-candy-deep px-4 py-3 font-display text-base font-extrabold text-paper press disabled:opacity-50"
      >
        <Wallet weight="bold" size={18} />
        {connectModalOpen ? "Pick a wallet…" : "Connect wallet"}
      </button>

      <OrDivider />
      <SignInWithCoinbaseWallet />

      {/* ── OPTIONAL · LINK ──────────────────────────────────────────────────────────────── */}
      <div className="mt-5 border-t-2 border-dashed border-ink/15 pt-4">
        <div className="flex items-center gap-2">
          <span className="font-display text-sm font-extrabold">Link Farcaster</span>
          <span className="text-xs font-bold text-ink/50">Optional</span>
        </div>
        {viewer.isAuthed ? (
          <div className="mt-2 flex items-center justify-center gap-1.5 rounded-xl border-2 border-teal/40 bg-teal/10 px-4 py-2 text-xs font-bold text-teal-ink">
            <Check weight="bold" size={13} /> {viewer.username ? `@${viewer.username}` : `fid ${viewer.fid}`}
          </div>
        ) : (
          <>
            <p className="mt-1 text-xs text-ink/55">
              Proves you’re one person, which unlocks one free letter a day.{" "}
              {xEnabled
                ? "A linked X account or a Coinbase-verified wallet does the same, so you can skip this and link one later in your profile."
                : "A Coinbase-verified wallet does the same, so you can skip this and verify later."}
            </p>
            <button
              onClick={viewer.signIn}
              className="cel press mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[#855DCD] px-4 py-2.5 text-sm font-extrabold text-white"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/fc-arch-icon.png" alt="" className="h-3.5 w-auto" />
              Sign in with Farcaster
            </button>
          </>
        )}
      </div>
    </div>
  );
}
