"use client";
/**
 * Base's official "Sign in with Base" button, wired to the Base Account connector.
 *
 * WHAT IT DOES HERE: connect. The wallet is the Lexigotchi account, and a Base Account is a wallet,
 * so signing in with Base makes the player's Base Account their game wallet: the same thing the
 * RainbowKit modal's "Base" row does, behind Base's own branded door. There is no server sign-in
 * (SIWE) behind it because no Lexigotchi route asks for proof of wallet ownership: the free-daily
 * voucher binds `buyer`, so only that wallet can spend it (api/mint/free-daily). It also does NOT
 * unlock the free daily by itself: a Base Account is not a Coinbase-verified wallet, and that gate
 * is unchanged.
 *
 * Rendered only where no wallet is connected (ConnectPanel, BalanceSheet's signed-out branch), so a
 * tap never swaps out a wallet the player already uses. Never inside a mini-app host: the host
 * connects its own wallet there.
 *
 * THREE DETAILS borrowed from Let's Have A Word!, which ships the same button:
 *   - Dynamic import with ssr:false. @base-org/account-ui embeds the BaseSans font as a ~47 KB gz
 *     base64 chunk; a static import would put it on every first load, including every mini-app
 *     player who can never see this button. The placeholder matches the button's 56px height.
 *   - The component is sealed (align / variant / colorScheme / onClick, CSS inlined by the
 *     package), so it is not restyled to match the game. Base's brand rules want it as-is.
 *   - Nothing is awaited between the tap and the wallet popup, because Safari's popup blocker kills
 *     a window.open that follows an await. wagmi's baseAccount connector lazy-loads the Base SDK
 *     inside `getProvider()`, so the provider is warmed on mount, before any tap.
 */
import dynamic from "next/dynamic";
import { useEffect } from "react";
import { useConnect } from "wagmi";
import { CircleNotch } from "./ui/icons";

const SignInWithBaseButton = dynamic(
  () => import("@base-org/account-ui/react").then((m) => m.SignInWithBaseButton),
  {
    ssr: false,
    loading: () => <div className="h-14 w-full animate-pulse rounded-[8px] bg-ink/10" aria-hidden />,
  },
);

/** The id RainbowKit's `baseAccount` wallet gives its wagmi connector (lib/onchain/wagmi). */
export const BASE_ACCOUNT_CONNECTOR_ID = "baseAccount";

export function SignInWithBase() {
  const { connect, connectors, isPending, variables } = useConnect();
  const base = connectors.find((c) => c.id === BASE_ACCOUNT_CONNECTOR_ID);

  useEffect(() => {
    // Warm the SDK so the tap opens the popup with no await in between (see the header).
    void base?.getProvider().catch(() => {});
  }, [base]);

  if (!base) return null;

  const waiting = isPending && variables?.connector === base;
  if (waiting) {
    // Same 56px × 8px footprint as Base's button, so nothing moves under the finger that tapped it.
    return (
      <div className="flex h-14 w-full items-center justify-center gap-2 rounded-[8px] bg-ink/85 text-[17px] text-paper">
        <CircleNotch className="animate-spin" /> Check your Base Account…
      </div>
    );
  }

  return (
    <SignInWithBaseButton align="center" variant="solid" colorScheme="light" onClick={() => connect({ connector: base })} />
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
