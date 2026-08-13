"use client";
/**
 * One sign-in surface, TWO SLOTS — and the panel says so out loud.
 *
 * The game needs two different things, and they answer different questions:
 *
 *   1. WALLET (required)  — where your letters and words live. The game cannot start without it.
 *   2. IDENTITY (daily)   — proof you're one person: a Farcaster account, or a Coinbase-verified
 *                           wallet (which covers both slots at once).
 *
 * The first version showed three peer buttons, which read as "pick one" — the first live tester
 * signed in with Farcaster, the gate stayed shut, and nothing explained that the wallet was the
 * required half. Now the slots are numbered, labeled required vs. what-it-unlocks, and each shows
 * its own done-state.
 *
 * Inside a Farcaster host none of this renders: the mini-app connector auto-connects the host
 * wallet and the SDK supplies the FID — this panel is only ever the open-web experience.
 */
import { useCallback } from "react";
import { useAccount, useConnect } from "wagmi";
import { useViewer } from "./useViewer";
import { useVerifiedWallet } from "./useVerifiedWallet";
import { shortAddr } from "@/lib/admin/format";
import { Check } from "./ui/icons";

export function ConnectPanel() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, error, isPending } = useConnect();
  const viewer = useViewer();
  const { verified } = useVerifiedWallet();

  const connectWith = useCallback(
    (match: (id: string, type: string) => boolean) => {
      const target = connectors.find((c) => match(c.id.toLowerCase(), c.type.toLowerCase()));
      if (target) connect({ connector: target });
    },
    [connect, connectors],
  );

  const hasBase = connectors.some((c) => /coinbase|base/i.test(c.id) || /coinbase/i.test(c.name));
  const hasInjected = connectors.some((c) => c.type === "injected" || c.id === "injected");

  // Surfaced, never swallowed. The live failure this answers: Rabby queues a connection request
  // inside the extension, every further click queues silently behind it, and the player reports
  // "nothing happens" — the truth ("check your wallet") was known the whole time, just not shown.
  const connectHint = isPending
    ? "Check your wallet — a connection request is waiting for you."
    : error
      ? `Your wallet said: ${((error as { shortMessage?: string }).shortMessage ?? error.message).slice(0, 90)}`
      : null;

  // The identity slot is satisfied by EITHER proof: a Farcaster session, or the connected wallet's
  // Coinbase attestation (checked on-chain; null = still checking).
  const identityDone = viewer.isAuthed || verified === true;

  return (
    <div className="cel mx-auto mt-8 max-w-sm rounded-2xl bg-paper p-5">
      <div className="text-center font-display text-lg font-extrabold">Get set up</div>
      <p className="mt-1 text-center text-sm text-ink/60">
        Two things: a wallet to hold your letters, and proof you&apos;re one person for the free daily.
      </p>

      {/* ── 1 · WALLET ─────────────────────────────────────────────────────────────────── */}
      <Slot
        n={1}
        title="Connect a wallet"
        tag="required"
        done={isConnected}
        doneLabel={shortAddr(address)}
        blurb="Your letters and words live in it — the game can't start without one. On Farcaster? Use a wallet linked to your account, so you keep one bag everywhere."
      >
        {hasBase && (
          // Hand-rolled in Base's brand (their premade button accepts no styling — props are
          // exactly {align, variant, colorScheme, onClick}). Wagmi connector underneath: Base
          // Account auth alone is SIWE — an address with no way to send transactions.
          <button
            onClick={() => connectWith((id) => /coinbase|base/.test(id))}
            className="cel flex w-full items-center justify-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-extrabold text-white"
          >
            <span aria-hidden className="h-3.5 w-3.5 rounded-[2px] bg-white" />
            Sign in with Base
          </button>
        )}
        {hasInjected && (
          <button
            onClick={() => connectWith((id, t) => t === "injected" || id === "injected")}
            className="cel w-full rounded-xl bg-paper-dark px-4 py-2.5 text-sm font-extrabold"
          >
            {isPending ? "Check your wallet…" : "Connect wallet"}
          </button>
        )}
      </Slot>

      {/* ── 2 · IDENTITY ───────────────────────────────────────────────────────────────── */}
      <Slot
        n={2}
        title="Prove you're you"
        tag="unlocks the free daily"
        done={identityDone}
        doneLabel={
          viewer.isAuthed
            ? viewer.username
              ? `@${viewer.username}`
              : `fid ${viewer.fid}`
            : "Coinbase-verified wallet"
        }
        blurb="One free letter a day — one per person, not per wallet. A Coinbase-verified wallet counts too, so step 1 may already cover you."
      >
        <button
          onClick={viewer.signIn}
          className="cel flex w-full items-center justify-center gap-2 rounded-xl bg-[#855DCD] px-4 py-2.5 text-sm font-extrabold text-white"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/fc-arch-icon.png" alt="" className="h-3.5 w-auto" />
          Sign in with Farcaster
        </button>
      </Slot>

      {connectHint && (
        <p className="mt-3 text-center text-xs font-bold text-candy" role="status">
          {connectHint}
        </p>
      )}
    </div>
  );
}

/** One numbered slot: its buttons until satisfied, then a quiet confirmation. */
function Slot({
  n,
  title,
  tag,
  done,
  doneLabel,
  blurb,
  children,
}: {
  n: number;
  title: string;
  tag: string;
  done: boolean;
  doneLabel?: string;
  blurb: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <div className="flex items-center gap-2">
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full border-2 border-ink text-[11px] font-extrabold ${
            done ? "bg-teal text-paper" : "bg-paper-dark"
          }`}
        >
          {done ? <Check weight="bold" size={11} /> : n}
        </span>
        <span className="font-display text-sm font-extrabold">{title}</span>
        <span className={`text-[10px] font-bold uppercase tracking-wide ${tag === "required" ? "text-candy" : "text-ink/45"}`}>
          {tag}
        </span>
      </div>
      {done ? (
        <div className="mt-2 flex items-center justify-center gap-1.5 rounded-xl border-2 border-teal/40 bg-teal/10 px-4 py-2 text-xs font-bold text-teal">
          <Check weight="bold" size={13} /> {doneLabel}
        </div>
      ) : (
        <>
          <p className="mt-1 text-xs text-ink/55">{blurb}</p>
          <div className="mt-2 flex flex-col gap-2">{children}</div>
        </>
      )}
    </div>
  );
}
