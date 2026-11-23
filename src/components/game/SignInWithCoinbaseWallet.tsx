"use client";
/**
 * "Sign in with Coinbase Wallet": a direct door to the Base Account connector, under its new name.
 *
 * NAMES (2026-11): Coinbase renamed Base Account to **Coinbase Wallet**; its popup now says "Base
 * Account is now Coinbase Wallet". The developer side did not move. The SDK is still
 * `@base-org/account` and the wagmi connector is still `baseAccount`, and Coinbase's docs still
 * offer only the sealed "Sign in with Base" button, whose label can't be changed. A player tapped
 * "Base" and landed in a popup that said "Coinbase Wallet", so this is our own button with the
 * popup's name (decisions.md #13). It is text only, in Coinbase blue, styled like the Farcaster
 * button beside it. No logo: the one RainbowKit bundles predates the new mark, and a guessed logo is
 * worse than none.
 *
 * WHAT IT DOES HERE: connect. The wallet is the Lexigotchi account, so this makes the player's
 * Coinbase Wallet their game wallet: the same thing the connect modal's "Coinbase Wallet" row does
 * (lib/onchain/wagmi). There is no server sign-in (SIWE) behind it because no Lexigotchi route asks
 * for proof of wallet ownership: the free-daily voucher binds `buyer`, so only that wallet can spend
 * it (api/mint/free-daily). It also does NOT unlock the free daily by itself: this wallet is not a
 * Coinbase-verified wallet, and that gate is unchanged.
 *
 * Rendered only where no wallet is connected (ConnectPanel, BalanceSheet's signed-out branch), so a
 * tap never swaps out a wallet the player already uses. Never inside a mini-app host: the host
 * connects its own wallet there.
 *
 * Nothing is awaited between the tap and the wallet popup, because Safari's popup blocker kills a
 * window.open that follows an await. wagmi's baseAccount connector lazy-loads the SDK inside
 * `getProvider()`, so the provider is warmed on mount, before any tap.
 */
import { useEffect } from "react";
import { useConnect } from "wagmi";
import { CircleNotch } from "./ui/icons";

/** The id wagmi gives RainbowKit's Base Account wallet's connector (lib/onchain/wagmi). */
export const BASE_ACCOUNT_CONNECTOR_ID = "baseAccount";

/** Coinbase's brand blue. */
const COINBASE_BLUE = "#0052FF";

export function SignInWithCoinbaseWallet() {
  const { connect, connectors, isPending, variables } = useConnect();
  const wallet = connectors.find((c) => c.id === BASE_ACCOUNT_CONNECTOR_ID);

  useEffect(() => {
    // Warm the SDK so the tap opens the popup with no await in between (see the header).
    void wallet?.getProvider().catch(() => {});
  }, [wallet]);

  if (!wallet) return null;

  const waiting = isPending && variables?.connector === wallet;
  return (
    <button
      onClick={() => connect({ connector: wallet })}
      disabled={waiting}
      style={{ backgroundColor: COINBASE_BLUE }}
      className="cel flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 font-display text-base font-extrabold text-white transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-80"
    >
      {waiting ? (
        <>
          <CircleNotch className="animate-spin" /> Check your Coinbase Wallet…
        </>
      ) : (
        "Sign in with Coinbase Wallet"
      )}
    </button>
  );
}

/** A hairline "or" between the two ways in. */
export function OrDivider() {
  return (
    <div className="my-3 flex items-center gap-3 text-[11px] font-bold uppercase tracking-wide text-ink/40" aria-hidden>
      <span className="h-px flex-1 bg-ink/15" />
      or
      <span className="h-px flex-1 bg-ink/15" />
    </div>
  );
}
