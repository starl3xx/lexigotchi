"use client";
/**
 * Client-side access gate for the operator console.
 *
 * Accepts EITHER an allowlisted wallet or an allowlisted Farcaster identity (see lib/admin/auth).
 * The wallet is the primary path: every operation this console builds must be signed by the owner
 * key anyway, so the connected wallet is the credential that actually corresponds to the power being
 * granted. The Farcaster path stays because inside a mini-app host an identity arrives with no
 * sign-in step at all.
 *
 * Sign In With Neynar is deliberately gone. It retires 2026-08-14, and a FID-only gate would have
 * locked an operator out of a normal browser the moment it did.
 */
import { useAccount, useConnect } from "wagmi";
import { useCallback } from "react";
import { useViewer } from "@/components/game/useViewer";
import { ADMIN_OPEN, ADMIN_UNCONFIGURED, isAdmin, isAdminWallet } from "@/lib/admin/auth";
import { AdminConsole } from "./AdminConsole";
import { CircleNotch, ShieldCheck } from "./icons";
import { shortAddr } from "@/lib/admin/format";

export function AdminGate() {
  const v = useViewer();
  const { address, isConnected } = useAccount();
  const allowed = isAdmin({ fid: v.isAuthed ? v.fid : null, wallet: address });

  // Only the Farcaster identity has a genuine loading state; the wallet is known synchronously.
  if (v.environment === "loading" && !isConnected) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <CircleNotch weight="bold" size={28} className="animate-spin text-ink/40" />
      </div>
    );
  }
  if (allowed) {
    return (
      <AdminConsole
        operator={{
          kind: ADMIN_OPEN ? "dev" : isAdminWallet(address) ? "wallet" : "fid",
          label: ADMIN_OPEN
            ? "dev"
            : isAdminWallet(address)
              ? shortAddr(address)
              : v.username
                ? `@${v.username}`
                : v.fid
                  ? `fid ${v.fid}`
                  : "operator",
        }}
      />
    );
  }
  return <GateScreen viewer={v} address={address} />;
}

function GateScreen({
  viewer,
  address,
}: {
  viewer: ReturnType<typeof useViewer>;
  address?: `0x${string}`;
}) {
  const { connect, connectors } = useConnect();
  const connectWallet = useCallback(() => {
    // Same reasoning as the game shell: connectors[0] is the mini-app connector, which auto-connects
    // inside a Farcaster host — so if this button is visible we're on the web and want `injected`.
    const target = connectors.find((c) => c.type === "injected" || c.id === "injected") ?? connectors[0];
    if (target) connect({ connector: target });
  }, [connect, connectors]);

  if (ADMIN_UNCONFIGURED) {
    return (
      <Shell title="Console not configured">
        <p className="mt-2 text-sm text-ink/65">
          The operator console is locked on this deployment (fail-closed). Set{" "}
          <code className="text-xs">NEXT_PUBLIC_ADMIN_WALLETS</code> to your owner wallet address and redeploy — or{" "}
          <code className="text-xs">NEXT_PUBLIC_ADMIN_OPEN=1</code> to open it deliberately.
        </p>
      </Shell>
    );
  }

  return (
    <Shell title="Operator access">
      {address ? (
        <p className="mt-2 text-sm text-ink/65">
          Connected as <strong>{shortAddr(address)}</strong>, but this wallet isn&apos;t on the operator
          allowlist. Add it to <code className="text-xs">NEXT_PUBLIC_ADMIN_WALLETS</code>, or switch accounts in
          your wallet.
        </p>
      ) : viewer.isAuthed ? (
        <p className="mt-2 text-sm text-ink/65">
          Signed in as <strong>{viewer.username ? `@${viewer.username}` : `fid ${viewer.fid}`}</strong>, but that
          identity isn&apos;t on the allowlist. Connect the owner wallet instead, or add the FID to{" "}
          <code className="text-xs">NEXT_PUBLIC_ADMIN_FIDS</code>.
        </p>
      ) : (
        <p className="mt-2 text-sm text-ink/65">
          This console is for the game&apos;s owner / operator. Connect the wallet that owns the contracts.
        </p>
      )}
      {!address && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={connectWallet}
            className="cel rounded-xl bg-candy px-4 py-2 text-sm font-extrabold text-paper"
          >
            Connect wallet
          </button>
        </div>
      )}
      <p className="mt-4 text-xs text-ink/40">
        <a href="/play" className="underline">
          ← Back to the game
        </a>
      </p>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="cel w-full max-w-md rounded-2xl bg-paper p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border-[3px] border-ink bg-paper-dark">
          <ShieldCheck weight="bold" size={24} />
        </div>
        <h1 className="font-display text-2xl font-extrabold">{title}</h1>
        {children}
      </div>
    </div>
  );
}
