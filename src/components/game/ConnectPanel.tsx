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
import { SignInWithBaseButton } from "@base-org/account-ui/react";
import { useViewer } from "./useViewer";
import { shortAddr } from "@/lib/admin/format";
import { Check } from "./ui/icons";

export function ConnectPanel() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const viewer = useViewer();

  const connectWith = useCallback(
    (match: (id: string, type: string) => boolean) => {
      const target = connectors.find((c) => match(c.id.toLowerCase(), c.type.toLowerCase()));
      if (target) connect({ connector: target });
    },
    [connect, connectors],
  );

  const hasBase = connectors.some((c) => /coinbase|base/i.test(c.id) || /coinbase/i.test(c.name));
  const hasInjected = connectors.some((c) => c.type === "injected" || c.id === "injected");

  return (
    <div className="cel mx-auto mt-8 max-w-sm rounded-2xl bg-paper p-5">
      <div className="text-center font-display text-lg font-extrabold">Get set up</div>
      <p className="mt-1 text-center text-sm text-ink/60">
        A wallet holds your letters. Farcaster — or a Coinbase-verified wallet — unlocks the free daily.
      </p>

      <div className="mt-5 flex flex-col gap-3">
        {/* 1 — Base */}
        <Option
          done={isConnected}
          doneLabel={shortAddr(address)}
          caption="Holds your letters and words."
        >
          {hasBase && (
            // Base's own button, wired to the wagmi connector rather than @base-org/account's
            // provider. Base Account auth is SIWE — it proves an ADDRESS and stops there, while the
            // game needs a live wallet to send transactions. The connector gives both, connects the
            // same Base Account, and keeps wallet state in one place instead of forking it.
            <SignInWithBaseButton
              align="center"
              variant="solid"
              colorScheme="light"
              onClick={() => connectWith((id) => /coinbase|base/.test(id))}
            />
          )}
        </Option>

        {/* 2 — any browser wallet */}
        {!isConnected && hasInjected && (
          <Option done={false} caption="Any browser extension wallet.">
            <button
              onClick={() => connectWith((id, t) => t === "injected" || id === "injected")}
              className="cel w-full rounded-xl bg-paper-dark px-4 py-2.5 text-sm font-extrabold"
            >
              Connect wallet
            </button>
          </Option>
        )}

        {/* 3 — Farcaster identity */}
        <Option
          done={viewer.isAuthed}
          doneLabel={viewer.username ? `@${viewer.username}` : viewer.fid ? `fid ${viewer.fid}` : ""}
          caption="Unlocks the free daily — one per account. No Farcaster? A Coinbase-verified wallet works too."
        >
          <button
            onClick={viewer.signIn}
            className="cel w-full rounded-xl bg-teal px-4 py-2.5 text-sm font-extrabold text-paper"
          >
            Sign in with Farcaster
          </button>
        </Option>
      </div>
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
