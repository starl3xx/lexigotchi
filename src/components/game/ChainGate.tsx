"use client";
/**
 * The gate between "we know the player's state" and "we're rendering it".
 *
 * Without this, an unavailable chain read doesn't look like an error — it looks like poverty.
 * `params` stays undefined, `fmtWord(undefined)` renders the literal "NaN", and `undefined >= n` is
 * false, so every affordability check fails and the mint screen routes a solvent player to the Buy
 * sheet. No console error, no crash, no clue. The most common cause is a missing NEXT_PUBLIC_CHAIN_ID,
 * which resolves to mainnet where no contract is deployed.
 *
 * So: nothing that spends or displays chain-derived numbers renders until status is "ready", and
 * every other status says explicitly what is wrong and what to do about it.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { useGame } from "./state";

export type ChainStatus = "no-wallet" | "loading" | "ready" | "error";

/**
 * Catches render-time throws so one bad read can't blank the entire app.
 *
 * There was no error boundary anywhere in this tree, which means any throw inside a screen unmounted
 * the whole game — including the nav that would let a player get somewhere else.
 */
export class ScreenErrorBoundary extends Component<
  { children: ReactNode; onReset?: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the detail in the console; the UI stays legible.
    console.error("[lexigotchi] screen crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="cel mx-auto mt-8 max-w-sm rounded-2xl bg-paper p-5 text-center">
        <div className="font-display text-lg font-extrabold">That screen fell over.</div>
        <p className="mt-1 text-sm text-ink/60">
          The rest of the game still works — this is a bug on our side, not something you did.
        </p>
        <p className="mt-2 break-words font-mono text-[10px] text-ink/40">{this.state.error.message}</p>
        <button
          onClick={() => {
            this.setState({ error: null });
            this.props.onReset?.();
          }}
          className="cel mt-4 rounded-xl bg-teal px-4 py-2 text-sm font-extrabold text-paper"
        >
          Try again
        </button>
      </div>
    );
  }
}

function Shell({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="cel mx-auto mt-8 max-w-sm rounded-2xl bg-paper p-5 text-center">
      <div className="font-display text-lg font-extrabold">{title}</div>
      <p className="mt-1 text-sm text-ink/60">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** A quiet placeholder — deliberately NOT zeroes, which would read as "you own nothing". */
export function ChainSkeleton() {
  return (
    <div className="mx-auto mt-8 max-w-sm animate-pulse space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-16 rounded-2xl border-[3px] border-ink/10 bg-ink/[0.04]" />
      ))}
      <p className="text-center text-xs text-ink/40">Reading the chain…</p>
    </div>
  );
}

/**
 * Render `children` only when chain state is actually known.
 *
 * The distinction that matters: "loading" and "no-wallet" are NOT the same as "zero". A player with
 * a full bag must never see an empty one because a read is in flight — they'll conclude they were
 * robbed, and every support message after that starts from the wrong premise.
 */
export function ChainGate({ children, connect }: { children: ReactNode; connect?: () => void }) {
  const { state } = useGame();
  const status = state.status;

  if (status === "ready") return <>{children}</>;

  if (status === "loading") return <ChainSkeleton />;

  if (status === "no-wallet") {
    return (
      <Shell
        title="Connect to play"
        body="Your letters and words live on-chain, so we need to know which wallet is yours."
        action={
          connect && (
            <button onClick={connect} className="cel rounded-xl bg-candy px-4 py-2 text-sm font-extrabold text-paper">
              Connect wallet
            </button>
          )
        }
      />
    );
  }

  return (
    <Shell
      title="Can't reach the chain"
      body={
        state.error ??
        "We couldn't read your collection. This is a connection problem, not a change to what you own."
      }
    />
  );
}
