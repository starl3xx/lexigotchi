"use client";
/**
 * What a gated tab shows when the server refuses (lib/admin/serverAuth.ts): a sign-in button, or the
 * setting to change. Each locked state names its fix.
 */
import { useConnectModal } from "@rainbow-me/rainbowkit";
import type { AdminRefusal } from "./useAdminApi";
import { AdminCard, Banner } from "./ui";
import { Lock, Warning } from "./icons";
import { shortAddr } from "@/lib/admin/format";

export function GatedState({
  refusal,
  canSignIn,
  signIn,
  signingIn,
  signInError,
  address,
}: {
  refusal: AdminRefusal;
  canSignIn: boolean;
  signIn: () => void;
  signingIn: boolean;
  signInError: string | null;
  address: string | null;
}) {
  const { openConnectModal } = useConnectModal();
  const title =
    refusal.error === "sign_in" ? "Sign in to see this" : refusal.error === "not_allowed" ? "Not an operator wallet" : "Not set up on this deployment";
  return (
    <AdminCard title={title}>
      <p className="text-sm text-ink/70">
        This tab lists players and this deployment&apos;s keys, so the server checks who is asking. {refusal.hint}
      </p>
      {refusal.error === "sign_in" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canSignIn ? (
            <button
              onClick={signIn}
              disabled={signingIn}
              className="cel rounded-xl bg-candy px-4 py-2 text-sm font-extrabold text-paper disabled:opacity-50"
            >
              {signingIn ? "Waiting for the wallet…" : `Sign in as ${shortAddr(address)}`}
            </button>
          ) : address ? (
            <Banner tone="warning" icon={<Warning weight="bold" size={14} />}>
              Wallet sign-in needs profiles switched on here (PROFILES_ENABLED=true and a 32+ character PROFILE_SESSION_SECRET).
            </Banner>
          ) : (
            <button
              onClick={openConnectModal}
              disabled={!openConnectModal}
              className="cel rounded-xl bg-candy px-4 py-2 text-sm font-extrabold text-paper disabled:opacity-50"
            >
              Connect the operator wallet
            </button>
          )}
          <span className="text-xs text-ink/50">One signature, no transaction. The session lasts 30 days.</span>
        </div>
      )}
      {refusal.error === "not_allowed" && refusal.who && (
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-ink/55">
          <Lock weight="bold" size={12} /> Signed in as <span className="font-mono">{refusal.who.startsWith("0x") ? shortAddr(refusal.who) : refusal.who}</span>
        </p>
      )}
      {signInError && <p className="mt-2 text-xs text-candy">{signInError}</p>}
    </AdminCard>
  );
}
