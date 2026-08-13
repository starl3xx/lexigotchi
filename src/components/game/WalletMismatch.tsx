"use client";
/**
 * The single-bag warning.
 *
 * Letters mint to whatever wallet is CONNECTED. Inside a Farcaster host that is always a wallet
 * linked to the account — but on the web a player can sign in with Farcaster and then connect any
 * wallet at all, quietly forking their collection: web letters in one bag, in-app letters in
 * another. The app can see this coming (Farcaster publishes the account's linked wallets), so it
 * says so BEFORE the fork happens, not after.
 *
 * Dismissable per session — it's guidance, not a gate. Players with reasons (a dedicated gaming
 * wallet, say) shouldn't be nagged every render.
 */
import { useState } from "react";
import { useAccount } from "wagmi";
import { Card } from "./primitives";
import { Warning } from "./ui/icons";
import { useViewer } from "./useViewer";

export function WalletMismatch() {
  const { address } = useAccount();
  const viewer = useViewer();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !address || !viewer.isAuthed || !viewer.linkedWallets) return null;
  if (viewer.linkedWallets.includes(address.toLowerCase())) return null;

  return (
    <Card className="border-gold bg-gold/10">
      <div className="flex items-start gap-2.5">
        <Warning weight="fill" size={20} className="mt-0.5 shrink-0 text-gold-deep" />
        <div className="text-xs text-ink/75">
          <span className="font-display text-sm font-extrabold">This wallet isn&apos;t linked to your Farcaster account.</span>
          <p className="mt-0.5">
            Letters mint to the connected wallet — this one&apos;s won&apos;t follow you into the Farcaster
            app. For one bag everywhere, connect a wallet your account has verified.
          </p>
          <button onClick={() => setDismissed(true)} className="mt-1.5 font-bold text-ink/45 underline">
            I know what I&apos;m doing
          </button>
        </div>
      </div>
    </Card>
  );
}
