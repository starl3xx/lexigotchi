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
 * The wallet button opens the RainbowKit modal (lib/onchain/wagmi lists the wallets). The modal
 * carries its own "confirm in your wallet" state and a retry, which covers the live failure the old
 * hand-rolled hint answered: Rabby queues a connection request inside the extension, and every
 * further click queued silently behind it.
 *
 * Inside a Farcaster host none of this renders: the mini-app connector auto-connects the host
 * wallet and the SDK supplies the FID — this panel is only ever the open-web experience. After the
 * wallet connects, DailyUnlock (Home + Mint) keeps offering the optional link where the daily lives.
 */
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useViewer } from "./useViewer";
import { Check, Wallet } from "./ui/icons";

export function ConnectPanel() {
  const { openConnectModal, connectModalOpen } = useConnectModal();
  const viewer = useViewer();

  return (
    <div className="cel mx-auto mt-8 max-w-sm rounded-2xl bg-paper p-5">
      <div className="text-center font-display text-lg font-extrabold">Start playing</div>
      <p className="mt-1 text-center text-sm text-ink/60">
        Your wallet is your Lexigotchi account. Your letters and words live in it.
      </p>

      <button
        onClick={openConnectModal}
        // Undefined until RainbowKit has mounted — never a dead button that looks alive.
        disabled={!openConnectModal}
        className="cel mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-candy px-4 py-3 font-display text-base font-extrabold text-paper transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-50"
      >
        <Wallet weight="bold" size={18} />
        {connectModalOpen ? "Pick a wallet…" : "Connect wallet"}
      </button>
      <p className="mt-2 text-center text-xs text-ink/50">
        New to wallets? The list can make one for you with a passkey. Nothing to install.
      </p>

      {/* ── OPTIONAL · LINK ──────────────────────────────────────────────────────────────── */}
      <div className="mt-5 border-t-2 border-dashed border-ink/15 pt-4">
        <div className="flex items-center gap-2">
          <span className="font-display text-sm font-extrabold">Link Farcaster</span>
          <span className="text-[10px] font-bold uppercase tracking-wide text-ink/45">optional</span>
        </div>
        {viewer.isAuthed ? (
          <div className="mt-2 flex items-center justify-center gap-1.5 rounded-xl border-2 border-teal/40 bg-teal/10 px-4 py-2 text-xs font-bold text-teal">
            <Check weight="bold" size={13} /> {viewer.username ? `@${viewer.username}` : `fid ${viewer.fid}`}
          </div>
        ) : (
          <>
            <p className="mt-1 text-xs text-ink/55">
              Proves you’re one person, which unlocks one free letter a day. A Coinbase-verified
              wallet does the same, so you can skip this and verify later.
            </p>
            <button
              onClick={viewer.signIn}
              className="cel mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[#855DCD] px-4 py-2.5 text-sm font-extrabold text-white"
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
