"use client";
/**
 * One sign-in surface, three ways in.
 *
 * The game needs two different credentials, and they answer different questions:
 *
 *   WALLET     — where your letters and words live. Required to hold or spend anything.
 *   FARCASTER  — who you are. Required for the FID-gated free daily, which is one-per-ACCOUNT.
 *
 * Base and a browser wallet are two routes to the first; Farcaster is the second. They are shown as
 * three peers rather than nested groups, because a player picking a sign-in does not care about our
 * taxonomy — but each says what it actually unlocks, so the difference is discoverable.
 *
 * This replaced two separate prompts: ChainGate demanded a wallet before rendering any screen, and
 * the Farcaster CTA appeared later inside HomeScreen — so a web player hit two unexplained "connect"
 * moments in sequence with no idea why the first wasn't enough.
 *
 * Inside a Farcaster host or Base App none of this is a prompt: the mini-app connector auto-connects
 * and the SDK supplies the identity, so this panel is only ever the open-web experience.
 */
import { useCallback } from "react";
import { useAccount, useConnect } from "wagmi";
import { useViewer } from "./useViewer";
import { shortAddr } from "@/lib/admin/format";
import { Check } from "./ui/icons";

export function ConnectPanel() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, error, isPending } = useConnect();
  const viewer = useViewer();

  const connectWith = useCallback(
    (match: (id: string, type: string) => boolean) => {
      const target = connectors.find((c) => match(c.id.toLowerCase(), c.type.toLowerCase()));
      if (target) connect({ connector: target });
    },
    [connect, connectors],
  );

  // Surfaced, never swallowed. The live failure this answers: Rabby queues a connection request
  // inside the extension, every further click queues silently behind it, and the player reports
  // "nothing happens" — the truth ("check your wallet") was known the whole time, just not shown.
  const connectHint = isPending
    ? "Check your wallet — a connection request is waiting for you."
    : error
      ? `Your wallet said: ${((error as { shortMessage?: string }).shortMessage ?? error.message).slice(0, 90)}`
      : null;

  const hasBase = connectors.some((c) => /coinbase|base/i.test(c.id) || /coinbase/i.test(c.name));
  const hasInjected = connectors.some((c) => c.type === "injected" || c.id === "injected");

  return (
    <div className="cel mx-auto mt-8 max-w-sm rounded-2xl bg-paper p-5">
      <div className="text-center font-display text-lg font-extrabold">Get set up</div>
      <p className="mt-1 text-center text-sm text-ink/60">
        A wallet holds your letters. Farcaster — or a Coinbase-verified wallet — unlocks the free daily.
      </p>

      <div className="mt-5 flex flex-col gap-3">
        {/* 1 — Farcaster identity. First because it answers the panel's headline promise (the free
            daily), and styled to Farcaster's brand — the purple + arch mark players already know
            from every other mini app (same treatment as LHAW's share button). */}
        <Option
          done={viewer.isAuthed}
          doneLabel={viewer.username ? `@${viewer.username}` : viewer.fid ? `fid ${viewer.fid}` : ""}
          caption="Unlocks the free daily letter — one per account."
        >
          <button
            onClick={viewer.signIn}
            className="cel flex w-full items-center justify-center gap-2 rounded-xl bg-[#855DCD] px-4 py-2.5 text-sm font-extrabold text-white"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/fc-arch-icon.png" alt="" className="h-3.5 w-auto" />
            Sign in with Farcaster
          </button>
        </Option>

        {/* 2 — Base */}
        <Option
          done={isConnected}
          doneLabel={shortAddr(address)}
          caption="A smart wallet for your letters — Coinbase-verified? It unlocks the daily too."
        >
          {hasBase && (
            // Hand-rolled in Base's brand (black + the white Square mark) rather than
            // @base-org/account-ui's premade button: its props are exactly {align, variant,
            // colorScheme, onClick} — no className, no style passthrough — so it can never wear
            // the cel frame the other two options do, and three sign-in buttons in two visual
            // languages read as a mistake. Same treatment as the Farcaster button above.
            //
            // Still the wagmi connector, not @base-org/account's provider. Base Account auth is
            // SIWE — it proves an ADDRESS and stops there, while the game needs a live wallet to
            // send transactions. The connector gives both, connects the same Base Account, and
            // keeps wallet state in one place instead of forking it.
            <button
              onClick={() => connectWith((id) => /coinbase|base/.test(id))}
              className="cel flex w-full items-center justify-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-extrabold text-white"
            >
              <span aria-hidden className="h-3.5 w-3.5 rounded-[2px] bg-white" />
              Sign in with Base
            </button>
          )}
        </Option>

        {/* 3 — any browser wallet */}
        {!isConnected && hasInjected && (
          <Option done={false} caption="Any browser extension wallet.">
            <button
              onClick={() => connectWith((id, t) => t === "injected" || id === "injected")}
              className="cel w-full rounded-xl bg-paper-dark px-4 py-2.5 text-sm font-extrabold"
            >
              {isPending ? "Check your wallet…" : "Connect wallet"}
            </button>
          </Option>
        )}
      </div>

      {connectHint && (
        <p className="mt-3 text-center text-xs font-bold text-candy" role="status">
          {connectHint}
        </p>
      )}
    </div>
  );
}

/** One choice: its button until satisfied, then a quiet confirmation. */
function Option({
  done,
  doneLabel,
  caption,
  children,
}: {
  done: boolean;
  doneLabel?: string;
  caption: string;
  children?: React.ReactNode;
}) {
  if (done) {
    return (
      <div className="flex items-center justify-center gap-1.5 rounded-xl border-2 border-teal/40 bg-teal/10 px-4 py-2 text-xs font-bold text-teal">
        <Check weight="bold" size={13} /> {doneLabel}
      </div>
    );
  }
  if (!children) return null;
  return (
    <div>
      {children}
      <p className="mt-1 text-center text-[11px] text-ink/45">{caption}</p>
    </div>
  );
}
